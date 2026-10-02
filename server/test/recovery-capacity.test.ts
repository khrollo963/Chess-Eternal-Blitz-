import { expect, test } from 'bun:test';
import type { Pool } from 'pg';
import { createMatch } from '../src/domain/match.js';
import { initializeBotOwners } from '../src/domain/casual.js';
import { RecoveryCoordinator } from '../src/recovery/RecoveryCoordinator.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { PostgresMatchStore } from '../src/storage/PostgresMatchStore.js';
import type { LobbyRecord, LobbyStore } from '../src/storage/LobbyStore.js';

function fixtureRecord(): LobbyRecord & { service: { instanceId: string; observedAt: number } } {
  const record = { ...createMatch('capped-recovery'), service: { instanceId: 'old', observedAt: 0 },
    lobby: { inviteCode: 'CAPPED', roomId: 'old-room' as string | null, owners: {} } };
  record.phase = 'active'; initializeBotOwners(record); return record;
}
async function rejectGameplay(store: LobbyStore, record: LobbyRecord) {
  for (const actorId of ['player', `server-bot:${record.matchId}:R`, 'service_recovery_spoof', 'exchange_lifecycle']) {
    expect((await store.commit({ matchId: record.matchId, expectedRevision: record.revision,
      next: { ...record, revision: record.revision + 1 }, events: [], command: { actorId,
        requestId: actorId.replaceAll(':', '-'), fingerprint: 'move', committedAt: 0,
        result: { ok: true, code: 'accepted', retryable: false },
      } })).status).toBe('capacity');
  }
}

test('a full 10000-command memory ledger can be claimed, rebound and expired while gameplay stays capped', async () => {
  const store = new MemoryLobbyStore(); let record = fixtureRecord(); await store.createInvited(record);
  for (let i = 0; i < 10000; i++) {
    const next = { ...record, revision: record.revision + 1 };
    const result = await store.commit({ matchId: record.matchId, expectedRevision: record.revision, next, events: [], command: {
      actorId: 'player', requestId: `fill-${i}`, fingerprint: `fill-${i}`, committedAt: 0,
      result: { ok: true, code: 'accepted', retryable: false },
    } });
    if (result.status !== 'committed') throw new Error('Fixture ledger fill failed');
    record = next;
  }
  await rejectGameplay(store, record);
  let now = 100;
  const recovery = new RecoveryCoordinator({ store, instanceId: 'new', clock: () => now });
  const claimed = await recovery.claim(record.matchId, 0, null);
  expect(claimed.revision).toBe(10001); expect(claimed.phase).toBe('paused');
  expect(claimed.service?.instanceId).toBe('new');
  await recovery.bindTransport(record.matchId, 'new-room');
  const rebound = (await store.load(record.matchId))! as LobbyRecord;
  expect(rebound.revision).toBe(10002); expect(rebound.lobby.roomId).toBe('new-room');
  await rejectGameplay(store, rebound);
  now = 300100; expect((await recovery.expire(record.matchId))?.ok).toBe(true);
  const final = (await store.load(record.matchId))!;
  expect(final.phase).toBe('active'); expect(final.terminalResult).toBeNull();
  expect(final.revision).toBe(10003);
}, 15000);

test('PostgreSQL query contract preserves CAS and the gameplay cap while trusted startup claim/bind commit', async () => {
  let record = { ...fixtureRecord(), revision: 10000 }, commandCount = 10000;
  const statements: string[] = [], actors: string[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (sql.includes('SELECT revision,record')) return { rowCount: 1, rows: [{ revision: record.revision, record: structuredClone(record) }] };
    if (sql.includes('SELECT record')) return { rowCount: 1, rows: [{ record: structuredClone(record) }] };
    if (sql.includes('SELECT *') && sql.includes('.commands')) return { rowCount: 0, rows: [] };
    if (sql.includes('count(*)')) return { rowCount: 1, rows: [{ count: commandCount }] };
    if (sql.startsWith('UPDATE') && sql.includes('.matches')) record = JSON.parse(values[5] as string);
    if (sql.startsWith('INSERT') && sql.includes('.commands')) { commandCount++; actors.push(values[1] as string); }
    return { rowCount: 1, rows: [] };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  const store = new PostgresMatchStore(pool, { schema: 'enochian_fixture' });
  await rejectGameplay(store, record); expect(actors).toEqual([]);
  const recovery = new RecoveryCoordinator({ store, instanceId: 'new', clock: () => 100 });
  await recovery.claim(record.matchId, 0, null); await recovery.bindTransport(record.matchId, 'new-room');
  expect(actors).toEqual(['service_recovery', 'service_recovery']);
  expect(commandCount).toBe(10002); expect(record.revision).toBe(10002);
  expect(record.lobby.roomId).toBe('new-room'); expect(record.service.instanceId).toBe('new');
  await rejectGameplay(store, record);
  expect(actors).toHaveLength(2);
  expect(statements.filter(sql => sql.includes('FOR UPDATE'))).toHaveLength(10);
  const stale = { ...record, revision: record.revision + 1 };
  expect((await store.commit({ matchId: record.matchId, expectedRevision: 0, next: stale, events: [], command: {
    actorId: 'service_recovery', requestId: 'stale', fingerprint: 'stale', committedAt: 100,
    result: { ok: true, code: 'accepted', retryable: false },
  } })).status).toBe('conflict');
  expect(actors).toHaveLength(2);
});
