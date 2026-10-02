import { readFileSync } from 'node:fs';
import { opaqueToken } from '../identity/guest.js';
import { createPostgresPool } from '../storage/postgres.js';
import { verifyPrivateSchema } from '../storage/migrations.js';
import { PostgresMatchStore, type PostgresStoreOptions } from '../storage/PostgresMatchStore.js';
import { FencedStore } from './FencedStore.js';
import { RecoveryCoordinator, type RecoveryRecord } from './RecoveryCoordinator.js';
import { PostgresRuntime } from './postgres-runtime.js';
import type { LobbyService } from '../domain/lobby.js';
import { PostgresRankedSettlement } from '../storage/PostgresRankedSettlement.js';
import { readLobbyCapacity } from '../storage/lobby-capacity.js';

/** Startup validates an operator-managed schema; it never creates online resources. */
export async function openDurableRuntime(env: Record<string, string | undefined>, onLost?: () => void | Promise<void>, options: { storeHooks?: PostgresStoreOptions['hooks'] } = {}) {
  const maxUnstartedLobbies = readLobbyCapacity(env);
  if (!env.DATABASE_URL) return null;
  const schema = env.DATABASE_SCHEMA ?? 'enochian_chess';
  const ca = env.DATABASE_CA_FILE ? readFileSync(env.DATABASE_CA_FILE, 'utf8') : readFileSync(new URL('../../certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8');
  const pool = createPostgresPool({ connectionString: env.DATABASE_URL, ca, max: 5 });
  const instanceId = opaqueToken();
  const runtime = new PostgresRuntime(pool, schema, instanceId, { onLost });
  try {
    await verifyPrivateSchema(pool, schema); await runtime.start();
    const rawStore = new PostgresMatchStore(pool, { schema, hooks: options.storeHooks, maxUnstartedLobbies });
    const store = new FencedStore(rawStore, instanceId);
    const recovery = new RecoveryCoordinator({ store: rawStore, instanceId });
    const settlement = new PostgresRankedSettlement(pool, { schema });
    return {
      pool, store, rawStore, recovery, settlement, runtime, instanceId,
      async settlePending(options: { drain?: boolean } = {}) {
        if (!runtime.healthy) throw new Error('Durable multiplayer unavailable');
        do {
          const pending = await settlement.listPending();
          for (const matchId of pending) {
            if (!runtime.healthy) throw new Error('Durable multiplayer unavailable');
            await settlement.settle(matchId, Date.now());
          }
          if (!options.drain || pending.length < 64) break;
        } while (true);
      },
      async rehydrate(lobby: LobbyService, createRoom: (matchId: string, permit: string) => Promise<string>) {
        const heartbeats = new Map<string, number | null>();
        for (const original of await rawStore.listRecoverable()) {
          const record = original as RecoveryRecord;
          if (record.service && !heartbeats.has(record.service.instanceId)) heartbeats.set(record.service.instanceId, await runtime.lastHeartbeat(record.service.instanceId));
          const heartbeat = record.service ? heartbeats.get(record.service.instanceId)! : null;
          const claimed = await recovery.claim(record.matchId, heartbeat, null);
          if (await recovery.expireLobby(record.matchId)) continue;
          if (claimed.phase === 'finished' || claimed.phase === 'void') continue;
          const roomId = await createRoom(record.matchId, lobby.prepareTransport(record.matchId));
          await recovery.bindTransport(record.matchId, roomId);
        }
      },
      async close() { await runtime.stop(); await pool.end(); },
    };
  } catch {
    await runtime.stop(); await pool.end(); throw new Error('Durable multiplayer unavailable');
  }
}
