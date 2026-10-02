import { expect, test } from 'bun:test';
import { LobbyService } from '../src/domain/lobby.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { publicSnapshot } from '../src/domain/match.js';
import { createMatch } from '../src/domain/match.js';
import { PostgresMatchStore } from '../src/storage/PostgresMatchStore.js';
import { readLobbyCapacity } from '../src/storage/lobby-capacity.js';
import type { Pool } from 'pg';
import { startServer } from '../src/recovery/start-server.js';

test('concurrent guest creation admits only the configured global lobby capacity', async () => {
  const store = new MemoryLobbyStore({ maxUnstartedLobbies: 2 });
  const lobby = new LobbyService({ store });
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => lobby.create('casual', 'Guest', 'R')));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
  const rejected = results.filter(result => result.status === 'rejected');
  expect(rejected).toHaveLength(10);
  expect(rejected.every(result => result.status === 'rejected' && result.reason.message === 'lobby_capacity')).toBe(true);
  expect(await store.listRecoverable()).toHaveLength(2);
});

test('terminal transition releases lobby admission without removing retained records', async () => {
  const store = new MemoryLobbyStore({ maxUnstartedLobbies: 1 });
  const lobby = new LobbyService({ store });
  const first = await lobby.create('casual', 'Guest', 'R');
  await expect(lobby.create('casual', 'Guest', 'R')).rejects.toThrow('lobby_capacity');
  const record = (await store.load(first.matchId))!;
  const next = { ...record, phase: 'void' as const, revision: record.revision + 1, retainUntil: Date.now() + 300000 };
  expect((await store.commit({ matchId: first.matchId, expectedRevision: record.revision, next, events: [],
    command: { actorId: 'service', requestId: 'expire', fingerprint: 'expire', committedAt: Date.now(),
      result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(next) } } })).status).toBe('committed');
  await expect(lobby.create('casual', 'Replacement', 'R')).resolves.toBeDefined();
  expect(await store.load(first.matchId)).toEqual(next);
});

test('PostgreSQL capacity rejection holds the admission lock and rolls back before any insert', async () => {
  const statements: string[] = [];
  let released = false;
  const client = {
    async query(sql: string, values?: unknown[]) {
      statements.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) expect(values).toEqual(['enochian-lobby-capacity:enochian_test']);
      if (sql.includes('WHERE invite_code=')) return { rowCount: 0, rows: [] };
      if (sql.includes('count(*)')) return { rowCount: 1, rows: [{ count: 2 }] };
      if (sql.startsWith('INSERT')) throw new Error('Capacity rejection must never insert');
      return { rowCount: 0, rows: [] };
    },
    release() { released = true; },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const store = new PostgresMatchStore(pool, { schema: 'enochian_test', maxUnstartedLobbies: 2 });
  await expect(store.createInvited({ ...createMatch('new'), lobby: { inviteCode: 'NEW', roomId: null, owners: {} } })).rejects.toThrow('lobby_capacity');
  expect(statements.map(sql => sql.startsWith('SELECT') ? sql.includes('pg_advisory') ? 'lock' : sql.includes('invite_code') ? 'collision' : 'count' : sql))
    .toEqual(['BEGIN', 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED', 'lock', 'collision', 'count', 'ROLLBACK']);
  expect(released).toBe(true);
});

test('capacity configuration cannot silently disable admission bounds', () => {
  expect(readLobbyCapacity({})).toBe(64);
  expect(readLobbyCapacity({ MULTIPLAYER_MAX_UNSTARTED_LOBBIES: '1' })).toBe(1);
  expect(readLobbyCapacity({ MULTIPLAYER_MAX_UNSTARTED_LOBBIES: '256' })).toBe(256);
  for (const value of ['', '0', '-1', '257', 'Infinity', '1.5', ' 2', '02']) {
    expect(() => readLobbyCapacity({ MULTIPLAYER_MAX_UNSTARTED_LOBBIES: value })).toThrow('Invalid lobby capacity');
  }
  expect(() => new MemoryLobbyStore({ maxUnstartedLobbies: 0 })).toThrow();
  expect(() => new PostgresMatchStore({} as Pool, { schema: 'enochian_test', maxUnstartedLobbies: 257 })).toThrow();
});

test('invalid lobby capacity fails startup before database acquisition', async () => {
  await expect(startServer({ MULTIPLAYER_MAX_UNSTARTED_LOBBIES: '0', DATABASE_URL: 'postgres://unused.invalid/db' }, { signals: false }))
    .rejects.toThrow('Invalid lobby capacity');
});

test('an invite collision at capacity remains a collision without replacing the retained lobby', async () => {
  const store = new MemoryLobbyStore({ maxUnstartedLobbies: 1 });
  const first = { ...createMatch('first'), lobby: { inviteCode: 'SAME', roomId: null, owners: {} } };
  expect(await store.createInvited(first)).toBe(true);
  expect(await store.createInvited({ ...first, matchId: 'second' })).toBe(false);
  expect(await store.loadByInvite('SAME')).toEqual(first);
  expect(await store.load('second')).toBeNull();
});
