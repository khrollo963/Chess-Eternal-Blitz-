import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COLORS, createMatch, publicSnapshot } from '../src/domain/match.js';
import { rankedRoster } from '../src/domain/ranked-admission.js';
import type { LobbyRecord } from '../src/storage/LobbyStore.js';
import { LobbyService } from '../src/domain/lobby.js';
import { PostgresMatchStore } from '../src/storage/PostgresMatchStore.js';
import { createPostgresPool } from '../src/storage/postgres.js';
import { migratePrivateSchema } from '../src/storage/migrations.js';

function fixture(): LobbyRecord {
  const record: LobbyRecord = { ...createMatch('ranked', 'ranked'), lobby: { inviteCode: 'code', roomId: null, owners: {} } };
  for (const color of COLORS) {
    record.seats[color] = { ...record.seats[color], ownerId: color, controller: 'human', connected: true, ready: true };
    record.lobby.owners[color] = { credentialHash: color, connectionId: color, accountId: randomUUID() };
  }
  return record;
}

test('ranked admission validates trusted distinct identities and the instant of start', async () => {
  const previous = fixture(), active = structuredClone(previous); active.phase = 'active';
  expect(rankedRoster(active, previous)).toHaveLength(4);
  const dropped = structuredClone(active); dropped.seats.K.connected = false;
  expect(() => rankedRoster(dropped, previous)).toThrow('invalid_phase');
  active.lobby.owners.K!.accountId = active.lobby.owners.R!.accountId;
  expect(() => rankedRoster(active, previous)).toThrow('duplicate_account');
});

test('ranked excludes bots, guest identities and post-start roster replacement', () => {
  const previous = fixture(); previous.phase = 'active';
  const next = structuredClone(previous);
  next.seats.R.controller = 'temporary_bot';
  expect(() => rankedRoster(next, previous)).toThrow('unauthorized');
  next.seats.R.controller = 'human'; next.lobby.owners.R!.accountId = 'guest';
  expect(() => rankedRoster(next, previous)).toThrow('unauthorized');
  next.lobby.owners.R!.accountId = randomUUID();
  expect(() => rankedRoster(next, previous)).toThrow('invalid_phase');
});

const isolated = !!process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_ISOLATED === '1';
(isolated ? test : test.skip)('hosted ranked admission serializes accounts, persists cooldown and rolls back conflicting start', async () => {
  if (!process.env.TEST_DATABASE_CA_FILE) throw new Error('Isolated database CA required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL!, ca: readFileSync(process.env.TEST_DATABASE_CA_FILE, 'utf8') });
  const schema = `enochian_admission_${randomUUID().replaceAll('-', '')}`;
  let created = false, now = 1000;
  try {
    await migratePrivateSchema(pool, { schema, allowCreate: true }); created = true;
    const store = new PostgresMatchStore(pool, { schema, clock: () => now });
    const lobby = new LobbyService({ store, rankedEnabled: true, clock: () => now });
    const identity = { accountId: randomUUID() };
    const outcomes = await Promise.allSettled([lobby.create('ranked', 'First', 'R', identity), lobby.create('ranked', 'Second', 'B', identity)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    const accepted = outcomes.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof lobby.create>>>;
    const first = accepted.value;
    expect((await pool.query(`SELECT * FROM "${schema}".matches`)).rowCount).toBe(1);
    expect((await pool.query(`SELECT * FROM "${schema}".admission_locks`)).rowCount).toBe(1);
    await lobby.connect(first.matchId, first.credential, 'original');
    await lobby.depart(first.matchId, 'original');
    expect((await pool.query(`SELECT * FROM "${schema}".admission_locks`)).rowCount).toBe(0);
    await pool.query(`UPDATE "${schema}".accounts SET restricted_until=2000 WHERE account_id=$1`, [identity.accountId]);
    now = 1999;
    await expect(lobby.create('ranked', 'Cooldown', 'R', identity)).rejects.toThrow('ranked_cooldown');
    now = 2000;
    const next = await lobby.create('ranked', 'Ready', 'R', identity);
    const invites = [next];
    for (const color of COLORS.slice(1)) invites.push(await lobby.join(next.code, color, color, { accountId: randomUUID() }));
    for (let index = 0; index < 4; index++) await lobby.connect(next.matchId, invites[index]!.credential, `client-${index}`);
    const record = await store.load(next.matchId) as LobbyRecord;
    for (const color of COLORS) record.seats[color].ready = true;
    record.phase = 'active'; record.seats.K.connected = false; record.revision++;
    await expect(store.commit({ matchId: record.matchId, expectedRevision: record.revision - 1, next: record, events: [], command: {
      actorId: 'test', requestId: 'drop-racing-start', fingerprint: 'start', committedAt: now,
      result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(record) },
    } })).rejects.toThrow('invalid_phase');
    expect((await store.load(record.matchId))?.phase).toBe('lobby');
    expect((await pool.query(`SELECT * FROM "${schema}".admission_locks WHERE match_id=$1`, [record.matchId])).rowCount).toBe(4);
  } finally {
    try {
      if (created) {
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        expect((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount).toBe(0);
      }
    } finally { await pool.end(); }
  }
}, 60000);
