import { matchMaker } from '@colyseus/core';
import { createGameServer } from '../index.js';
import { readConfig, runtimeDiagnostics } from '../config.js';
import { openDurableRuntime } from './DurableRuntime.js';
import { publicSnapshot } from '../domain/match.js';
import type { RecoveryRecord } from './RecoveryCoordinator.js';
import type { EnochianRoom } from '../rooms/EnochianRoom.js';
import type { PostgresStoreOptions } from '../storage/PostgresMatchStore.js';

export async function startServer(env: Record<string, string | undefined>, options: { signals?: boolean; storeHooks?: PostgresStoreOptions['hooks'] } = {}) {
  const config = readConfig(env);
  let ready = false, closing: Promise<void> | undefined;
  let app: ReturnType<typeof createGameServer> | undefined;
  let maintenance: ReturnType<typeof setInterval> | undefined;
  const durable = await openDurableRuntime(env, () => { ready = false; if (app) void close(); }, options).catch(() => null);
  const publish = (record: RecoveryRecord) => {
    if (!record.lobby.roomId) return;
    const room = matchMaker.getLocalRoomById(record.lobby.roomId) as EnochianRoom | undefined;
    room?.publishCommitted(publicSnapshot(record));
  };
  app = createGameServer({ store: durable?.store, isReady: () => ready && !!durable?.runtime.healthy,
    connections: durable ? {
      async connect(matchId, credential, connectionId) {
        const record = await durable.store.load(matchId) as RecoveryRecord | null;
        if (!record?.recovery && record?.phase !== 'finished' && record?.phase !== 'void') return app!.lobby!.connect(matchId, credential, connectionId);
        const auth = await app!.lobby!.authenticate(matchId, credential);
        const result = await durable.recovery.recover(matchId, credential, connectionId);
        return { actor: { actorId: auth.ownerId, seat: auth.color, controller: 'human' }, snapshot: result.snapshot! };
      },
      async depart(matchId, connectionId) {
        // Server draining or a lost lease is infrastructure failure, never intentional Leave.
        if (!ready) return true;
        return (await durable.recovery.depart(matchId, connectionId)) !== null;
      },
    } : undefined,
  });
  function close(): Promise<void> {
    return closing ??= (async () => {
      ready = false; clearInterval(maintenance);
      process.removeListener('SIGINT', close); process.removeListener('SIGTERM', close);
      await app?.server.gracefullyShutdown(false);
      await durable?.close();
    })();
  }
  try {
    await app.server.listen(config.port, config.hostname);
    if (durable) {
      await durable.rehydrate(app.lobby!, async (matchId, creationPermit) => {
        const room = await matchMaker.createRoom('enochian', { matchId, creationPermit });
        return room.roomId;
      });
      ready = durable.runtime.healthy;
      let busy = false;
      maintenance = setInterval(() => {
        if (busy || !ready) return;
        busy = true;
        void (async () => {
          for (const record of await durable.store.listRecoverable()) {
            const result = await durable.recovery.expireLobby(record.matchId) ?? await durable.recovery.expire(record.matchId);
            if (result) {
              const latest = await durable.store.load(record.matchId) as RecoveryRecord;
              publish(latest);
              const room = latest.lobby.roomId ? matchMaker.getLocalRoomById(latest.lobby.roomId) : undefined;
              if (latest.phase === 'void' && room && room.clients.length === 0) await room.disconnect();
            }
          }
        })().catch(error => {
          // Another accepted action winning CAS is normal; the next tick rechecks.
          if (error instanceof Error && error.message === 'stale_revision') return;
          ready = false; void close();
        }).finally(() => { busy = false; });
      }, 1000);
      maintenance.unref();
    }
    if (options.signals !== false) { process.once('SIGINT', close); process.once('SIGTERM', close); }
    console.info(JSON.stringify({ ...runtimeDiagnostics(), port: config.port, hostname: config.hostname, multiplayerReady: ready }));
    return { ...app, durable, close, isReady: () => ready };
  } catch {
    await close(); throw new Error('Multiplayer startup failed');
  }
}
