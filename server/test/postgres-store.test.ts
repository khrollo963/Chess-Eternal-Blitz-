import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMatch, publicSnapshot } from '../src/domain/match.js';
import type { MatchCommit } from '../src/storage/MatchStore.js';
import type { LobbyRecord } from '../src/storage/LobbyStore.js';

test('durable adapter and explicit migration boundary are available', async () => {
  expect(await import('../src/storage/PostgresMatchStore.js').catch(() => null)).not.toBeNull();
  expect(await import('../src/storage/migrations.js').catch(() => null)).not.toBeNull();
});

const isolated = !!process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_ISOLATED === '1';
(isolated ? test : test.skip)('disposable PostgreSQL schema preserves CAS, dedup, rollback, recovery and migration identity', async () => {
  const { createPostgresPool } = await import('../src/storage/postgres.js');
  const { migratePrivateSchema, verifyPrivateSchema } = await import('../src/storage/migrations.js');
  const { PostgresMatchStore } = await import('../src/storage/PostgresMatchStore.js');
  const caPath = process.env.TEST_DATABASE_CA_FILE;
  if (!caPath) throw new Error('Isolated database CA required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL!, ca: readFileSync(caPath, 'utf8') });
  const schema = `enochian_test_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  let stage = 'migration';
  try {
    await migratePrivateSchema(pool, { schema, allowCreate: true }); created = true;
    await verifyPrivateSchema(pool, schema);
    await migratePrivateSchema(pool, { schema });
    stage = 'invite creation';
    const store = new PostgresMatchStore(pool, { schema, maxCommandsPerMatch: 2 });
    const other = new PostgresMatchStore(pool, { schema, maxCommandsPerMatch: 2 });
    const record: LobbyRecord = { ...createMatch('match'), lobby: { inviteCode: 'ABC123', roomId: null, owners: {} } };
    record.seats.R.ownerId = 'private-owner';
    expect(await store.createInvited(record)).toBe(true);
    expect(await other.createInvited({ ...record, matchId: 'collision' })).toBe(false);
    await expect(store.create(record)).rejects.toThrow('Private database');
    expect(await other.loadByInvite('ABC123')).toEqual(record);
    expect(await other.listRecoverable()).toEqual([record]);
    const makeCommit = (id: string, revision = 0): MatchCommit => {
      const next = { ...structuredClone(record), revision: revision + 1 };
      next.lobby.roomId = 'transport-private'; next.seats.R.disconnectDeadline = 12345;
      return { matchId: 'match', expectedRevision: revision, next,
        command: { actorId: 'private-owner', requestId: id, fingerprint: id, committedAt: 1000,
          result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(next) } }, events: [{ type: 'test-event' }] };
    };
    const rolled = new PostgresMatchStore(pool, { schema, hooks: { beforeCommit: () => { throw new Error('inject'); } } });
    stage = 'rollback';
    await expect(rolled.commit(makeCommit('rollback'))).rejects.toThrow('Private database');
    expect((await store.load('match'))?.revision).toBe(0);
    expect(await store.findCommand('match', 'private-owner', 'rollback')).toBeNull();
    expect((await pool.query(`SELECT * FROM "${schema}".events`)).rowCount).toBe(0);
    stage = 'CAS and replay';
    const competing = await Promise.all([store.commit(makeCommit('one')), other.commit(makeCommit('two'))]);
    expect(competing.map(x => x.status).sort()).toEqual(['committed', 'conflict']);
    const winner = competing[0]!.status === 'committed' ? 'one' : 'two';
    const duplicate = await other.commit(makeCommit(winner));
    expect(duplicate.status).toBe('duplicate');
    const concurrentDuplicate = await Promise.all([store.commit(makeCommit(winner)), other.commit(makeCommit(winner))]);
    expect(concurrentDuplicate.map(x => x.status)).toEqual(['duplicate', 'duplicate']);
    const invalid = makeCommit('invalid-successor', 1);
    invalid.next.revision = 9;
    await expect(store.commit(invalid)).rejects.toThrow('Private database');
    expect((await store.load('match'))?.revision).toBe(1);
    stage = 'post-commit crash';
    const next = makeCommit('after-crash', 1);
    const crash = new PostgresMatchStore(pool, { schema, hooks: { afterCommit: () => { throw new Error('crash'); } } });
    await expect(crash.commit(next)).rejects.toThrow('Private database');
    expect((await other.commit(next)).status).toBe('duplicate');
    expect((await store.commit(makeCommit('over-capacity', 2))).status).toBe('capacity');
    stage = 'ledger constraints';
    expect((await other.loadByInvite('ABC123'))?.lobby.roomId).toBe('transport-private');
    expect((await pool.query(`SELECT deadline FROM "${schema}".deadlines WHERE kind='seat:R'`)).rows[0].deadline).toBe('12345');
    await expect(pool.query(`INSERT INTO "${schema}".events VALUES ('match',2,0,'{}')`)).rejects.toThrow();
    const policies = await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 AND NOT rowsecurity', [schema]);
    expect(policies.rowCount).toBe(0);
    const publicAccess = await pool.query('SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a WHERE n.nspname=$1 AND a.grantee=0 AND a.privilege_type=\'USAGE\'', [schema]);
    expect(publicAccess.rowCount).toBe(0);
    stage = 'migration mismatch';
    await pool.query(`UPDATE "${schema}".schema_migrations SET sha256='${'0'.repeat(64)}'`);
    await expect(verifyPrivateSchema(pool, schema)).rejects.toThrow('Private database');
    await expect(migratePrivateSchema(pool, { schema })).rejects.toThrow('Private database');
    await pool.query(`UPDATE "${schema}".schema_migrations SET version=2`);
    await expect(verifyPrivateSchema(pool, schema)).rejects.toThrow('Private database');
  } catch { throw new Error(`Isolated PostgreSQL store acceptance failed (${stage})`); }
  finally {
    try { if (created) { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); expect((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount).toBe(0); } }
    catch { throw new Error('Disposable PostgreSQL schema cleanup failed'); }
    finally { await pool.end(); }
  }
}, 60000);

test('PostgreSQL configuration enforces verified TLS and bounded pools', async () => {
  const module = await import('../src/storage/postgres.js').catch(() => null);
  expect(module).not.toBeNull();
  if (!module) return;
  const config = module.postgresPoolConfig({ connectionString: 'postgres://user:secret@example.test/db?sslmode=disable&sslrootcert=bad&ssl=true', ca: 'public-ca', max: 3 });
  expect(config.ssl).toEqual({ ca: 'public-ca', rejectUnauthorized: true });
  expect(config.connectionString).not.toContain('ssl');
  expect(config.max).toBe(3);
  expect(() => module.postgresPoolConfig({ connectionString: 'postgres://example.test/db', ca: 'ca', max: 6 })).toThrow();
  expect(() => module.schemaIdentifier('public')).toThrow();
  expect(() => module.schemaIdentifier('enochian_private; DROP SCHEMA public')).toThrow();
});
