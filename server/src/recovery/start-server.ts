import { matchMaker } from '@colyseus/core';
import { createGameServer } from '../index.js';
import { readConfig, runtimeDiagnostics } from '../config.js';
import { openDurableRuntime } from './DurableRuntime.js';
import { publicSnapshot } from '../domain/match.js';
import type { RecoveryRecord } from './RecoveryCoordinator.js';
import type { EnochianRoom } from '../rooms/EnochianRoom.js';
import type { PostgresStoreOptions } from '../storage/PostgresMatchStore.js';
import { createSupabaseIdentity, readSupabaseIdentityConfig } from '../identity/supabase.js';
import { publicEndpoint, TransportSecurity } from '../http/transport-security.js';
import { registerClientPages } from '../http/client-pages.js';
import { readLobbyCapacity } from '../storage/lobby-capacity.js';
import { runGlobalMaintenance } from './global-maintenance.js';
import { startupDiagnostic, type StartupStage } from './startup-diagnostics.js';

export async function startServer(env: Record<string, string | undefined>, options: { signals?: boolean; storeHooks?: PostgresStoreOptions['hooks'] } = {}) {
  // Validate before durable-runtime errors are converted into unavailable readiness.
  readLobbyCapacity(env);
  const config = readConfig(env);
  const identity = readSupabaseIdentityConfig(env);
  if (config.rankedEnabled && !identity) throw new Error('Ranked requires identity configuration');
  let transportSecurity: TransportSecurity | undefined;
  const needsSecurity = env.NODE_ENV === 'production' || !!env.MULTIPLAYER_PUBLIC_ENDPOINT || !!env.MULTIPLAYER_ALLOWED_ORIGINS || !!env.MULTIPLAYER_INGRESS_POLICY;
  if (needsSecurity) {
    // This is an explicit deployment boundary, never a forwarded-proto/header decision.
    // The operator must expose the service only through Railway's approved HTTPS ingress.
    if (env.MULTIPLAYER_INGRESS_POLICY !== 'railway-edge-only') throw new Error('Invalid ingress policy');
    const endpoint = publicEndpoint(env.MULTIPLAYER_PUBLIC_ENDPOINT ?? '');
    const origins = (env.MULTIPLAYER_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (!origins.length || !origins.includes(endpoint)) throw new Error('Invalid allowed origin');
    if (env.MULTIPLAYER_ALLOW_MISSING_ORIGIN !== undefined && !['true', 'false'].includes(env.MULTIPLAYER_ALLOW_MISSING_ORIGIN)) throw new Error('Invalid missing origin policy');
    transportSecurity = new TransportSecurity({ allowedOrigins: origins, allowMissingOrigin: env.MULTIPLAYER_ALLOW_MISSING_ORIGIN === 'true' });
  }
  let ready = false, closing: Promise<void> | undefined;
  let app: ReturnType<typeof createGameServer> | undefined;
  let maintenance: ReturnType<typeof setInterval> | undefined;
  const durable = await openDurableRuntime(env, () => { ready = false; if (app) void close(); }, options).catch(error => {
    console.error(JSON.stringify(startupDiagnostic('durable-runtime', error))); return null;
  });
  const publish = (record: RecoveryRecord) => {
    if (!record.lobby.roomId) return;
    const room = matchMaker.getLocalRoomById(record.lobby.roomId) as EnochianRoom | undefined;
    room?.publishCommitted(publicSnapshot(record));
  };
  app = createGameServer({ store: durable?.store, rankedEnabled: config.rankedEnabled, signInProviders: config.signInProviders,
    identityConfig: identity, verifyAuth: identity ? createSupabaseIdentity(identity) : undefined,
    transportSecurity, ingressPolicy: transportSecurity ? 'railway-edge-only' : undefined,
    isReady: () => ready && !!durable?.runtime.healthy,
    connections: durable ? {
      async connect(matchId, credential, connectionId) {
        await durable.recovery.expire(matchId);
        await app!.casual!.expire(matchId);
        await app!.ranked!.expire(matchId);
        const latest = await durable.store.load(matchId) as RecoveryRecord | null;
        if (!latest?.recovery && latest?.phase !== 'finished' && latest?.phase !== 'void') return latest?.mode === 'ranked'
          ? app!.ranked!.connect(matchId, credential, connectionId) : app!.casual!.connect(matchId, credential, connectionId);
        const auth = await app!.lobby!.authenticate(matchId, credential);
        const result = await durable.recovery.recover(matchId, credential, connectionId);
        return { actor: { actorId: auth.ownerId, seat: auth.color, controller: 'human' }, snapshot: result.snapshot! };
      },
      async depart(matchId, connectionId, intentional) {
        // Server draining or a lost lease is infrastructure failure, never intentional Leave.
        if (!ready) return true;
        return (await durable.recovery.depart(matchId, connectionId, intentional)) !== null ||
          await app!.ranked!.depart(matchId, connectionId, intentional) || await app!.casual!.depart(matchId, connectionId, intentional);
      },
      async preflight(matchId) { await durable.recovery.expireLobby(matchId); await durable.recovery.expire(matchId); },
    } : undefined,
  });
  function close(): Promise<void> {
    return closing ??= (async () => {
      ready = false; clearInterval(maintenance);
      process.removeListener('SIGINT', close); process.removeListener('SIGTERM', close);
      try { await app?.server.gracefullyShutdown(false); }
      finally { await durable?.close(); }
    })();
  }
  let stage: StartupStage = 'client-pages';
  try {
    if (transportSecurity) registerClientPages(app.app, env.MULTIPLAYER_PUBLIC_ENDPOINT!);
    stage = 'listen';
    await app.server.listen(config.port, config.hostname);
    if (durable) {
      stage = 'rehydrate';
      await durable.rehydrate(app.lobby!, async (matchId, creationPermit) => {
        const room = await matchMaker.createRoom('enochian', { matchId, creationPermit });
        return room.roomId;
      });
      stage = 'settlement';
      await durable.settlePending({ drain: true });
      ready = durable.runtime.healthy;
      let busy = false;
      maintenance = setInterval(() => {
        if (busy || !ready) return;
        busy = true;
        void runGlobalMaintenance({ store: durable.store, recovery: durable.recovery, now: Date.now(), settlePending: () => durable.settlePending(),
          async onCommitted(matchId) {
              const latest = await durable.store.load(matchId) as RecoveryRecord;
              publish(latest);
              const room = latest.lobby.roomId ? matchMaker.getLocalRoomById(latest.lobby.roomId) : undefined;
              if (latest.phase === 'void' && room && room.clients.length === 0) await room.disconnect();
          }
        }).catch(error => {
          // Another accepted action winning CAS is normal; the next tick rechecks.
          if (error instanceof Error && error.message === 'stale_revision') return;
          ready = false; void close();
        }).finally(() => { busy = false; });
      }, 1000);
      maintenance.unref();
    }
    stage = 'ready';
    if (options.signals !== false) { process.once('SIGINT', close); process.once('SIGTERM', close); }
    console.info(JSON.stringify({ ...runtimeDiagnostics(), port: config.port, hostname: config.hostname, multiplayerReady: ready }));
    return { ...app, durable, close, isReady: () => ready };
  } catch (error) {
    const diagnostic = startupDiagnostic(stage, error);
    console.error(JSON.stringify(diagnostic));
    try { await close(); } catch { /* Preserve the redacted startup failure if cleanup also fails. */ }
    throw new Error(`Multiplayer startup failed (${diagnostic.stage}:${diagnostic.code})`);
  }
}
