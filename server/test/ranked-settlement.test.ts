import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COLORS, createMatch } from '../src/domain/match.js';
import type { RankedRecord } from '../src/domain/ranked.js';
import type { LobbyRecord } from '../src/storage/LobbyStore.js';
import { PostgresRankedSettlement } from '../src/storage/PostgresRankedSettlement.js';
import type { Pool } from 'pg';
import { canonicalEngine } from '../src/engine.js';

test('ranked settlement rejects unsafe schema identifiers before any database work', () => {
  expect(() => new PostgresRankedSettlement({} as Pool, { schema: 'public;DROP TABLE accounts' })).toThrow('Invalid private database schema');
});

const isolated = !!process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_ISOLATED === '1';
(isolated ? test : test.skip)('isolated ranked settlement is atomic, immutable, replayable and releases admission locks', async () => {
  const { createPostgresPool } = await import('../src/storage/postgres.js');
  const { migratePrivateSchema } = await import('../src/storage/migrations.js');
  const { PostgresMatchStore } = await import('../src/storage/PostgresMatchStore.js');
  if (!process.env.TEST_DATABASE_CA_FILE) throw new Error('Isolated database CA required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL!, ca: readFileSync(process.env.TEST_DATABASE_CA_FILE, 'utf8') });
  const schema = `enochian_test_${randomUUID().replaceAll('-', '')}`, sql = `"${schema}"`;
  let created = false, stage = 'migration';
  try {
    await migratePrivateSchema(pool, { schema, allowCreate: true }); created = true;
    const store = new PostgresMatchStore(pool, { schema });
    const first = new PostgresRankedSettlement(pool, { schema }), second = new PostgresRankedSettlement(pool, { schema });
    const fixture = async (id: string, reason: 'victory' | 'abandonment' | 'service_outage' | 'lobby_expired' | 'active', count = 4) => {
      const record: LobbyRecord & RankedRecord = { ...createMatch(id, 'ranked'), lobby: { inviteCode: `CODE${id}`, roomId: null, owners: {} } };
      record.phase = reason === 'active' ? 'active' : reason === 'victory' ? 'finished' : 'void';
      record.terminalResult = reason === 'active' ? null : reason === 'victory' ? { kind: 'victory', winningTeam: canonicalEngine.TEAM.R, reason: null } : { kind: 'void', winningTeam: null, reason };
      for (const color of COLORS.slice(0, count)) {
        const ownerId = `private-${id}-${color}`, accountId = randomUUID();
        record.lobby.owners[ownerId] = { credentialHash: ownerId, accountId, connectionId: null };
        record.seats[color] = { ...record.seats[color], ownerId, controller: 'human', ready: true, connected: true };
      }
      if (reason === 'abandonment' || reason === 'service_outage') record.expiredDepartures = ['R', 'K'];
      await store.create(record); return record;
    };
    const accountsFor = async (record: LobbyRecord) => (await pool.query(`SELECT account_id,rating,restricted_until FROM ${sql}.accounts WHERE account_id=ANY($1::text[]) ORDER BY account_id`,
      [Object.values(record.lobby.owners).map(owner => owner.accountId)])).rows;
    const locksFor = async (id: string) => (await pool.query(`SELECT account_id FROM ${sql}.admission_locks WHERE match_id=$1`, [id])).rowCount;
    stage = 'competing victory';
    const win = await fixture('victory', 'victory');
    expect(await locksFor(win.matchId)).toBe(4);
    expect(await first.listPending()).toContain(win.matchId);
    const snapshot = await store.load(win.matchId);
    const [a, b] = await Promise.all([first.settle(win.matchId, 1000), second.settle(win.matchId, 2000)]);
    expect(a).toEqual(b); expect(a!.entries.map(entry => entry.delta)).toEqual([16, -16, 16, -16]);
    expect((await pool.query(`SELECT 1 FROM ${sql}.settlements WHERE match_id=$1`, [win.matchId])).rowCount).toBe(1);
    expect((await pool.query(`SELECT 1 FROM ${sql}.rating_entries WHERE settlement_id=$1`, [a!.settlementId])).rowCount).toBe(4);
    expect(await locksFor(win.matchId)).toBe(0); expect(await store.load(win.matchId)).toEqual(snapshot);
    expect(await first.listPending()).not.toContain(win.matchId);
    const ratings = await accountsFor(win); expect(await second.settle(win.matchId, 800000)).toEqual(a);
    expect(await accountsFor(win)).toEqual(ratings);
    stage = 'offender penalties';
    const voided = await fixture('abandoned', 'abandonment');
    const voidPlan = await first.settle(voided.matchId, 10000);
    expect(voidPlan!.entries.map(entry => entry.delta)).toEqual([-32, 0, 0, -32]);
    expect(voidPlan!.entries.map(entry => entry.restrictionUntil)).toEqual([610000, null, null, 610000]);
    expect(await locksFor(voided.matchId)).toBe(0);
    const punished = await accountsFor(voided);
    expect(await second.settle(voided.matchId, 900000)).toEqual(voidPlan); expect(await accountsFor(voided)).toEqual(punished);
    stage = 'service outage';
    const outage = await fixture('outage', 'service_outage'), beforeOutage = await accountsFor(outage);
    const noPenalty = await first.settle(outage.matchId, 20000);
    expect(noPenalty!.entries.every(entry => entry.delta === 0 && entry.restrictionUntil === null)).toBe(true);
    expect(await accountsFor(outage)).toEqual(beforeOutage); expect(await locksFor(outage.matchId)).toBe(0);
    stage = 'partial unstarted void';
    const partial = await fixture('partial', 'lobby_expired', 2), partialRatings = await accountsFor(partial);
    expect((await first.settle(partial.matchId, 30000))!.entries.every(entry => entry.delta === 0)).toBe(true);
    expect(await accountsFor(partial)).toEqual(partialRatings); expect(await locksFor(partial.matchId)).toBe(0);
    stage = 'transaction rollback';
    const interrupted = await fixture('rollback', 'abandonment'), initial = await accountsFor(interrupted);
    const failing = new PostgresRankedSettlement(pool, { schema, hooks: { beforeCommit: () => { throw new Error('PRIVATE_FAILURE_SENTINEL'); } } });
    await expect(failing.settle(interrupted.matchId, 40000)).rejects.toThrow('Private database operation failed');
    expect(await accountsFor(interrupted)).toEqual(initial); expect(await locksFor(interrupted.matchId)).toBe(4);
    expect((await pool.query(`SELECT 1 FROM ${sql}.settlements WHERE match_id=$1`, [interrupted.matchId])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM ${sql}.rating_entries WHERE settlement_id=$1`, [`ranked:${interrupted.matchId}`])).rowCount).toBe(0);
    expect(await first.listPending()).toContain(interrupted.matchId);
    expect(await first.settle(interrupted.matchId, 50000)).not.toBeNull(); expect(await locksFor(interrupted.matchId)).toBe(0);
    stage = 'lost acknowledgement';
    const lost = await fixture('lostack', 'victory');
    const crash = new PostgresRankedSettlement(pool, { schema, hooks: { afterCommit: () => { throw new Error('PRIVATE_AFTER_SENTINEL'); } } });
    await expect(crash.settle(lost.matchId, 60000)).rejects.toThrow('Private database operation failed');
    const afterCrash = await accountsFor(lost); const replay = await first.settle(lost.matchId, 70000);
    expect(replay!.settledAt).toBe(60000); expect(await accountsFor(lost)).toEqual(afterCrash); expect(await locksFor(lost.matchId)).toBe(0);
    stage = 'no nonterminal settlement';
    const active = await fixture('playing', 'active');
    expect(await first.settle(active.matchId, 80000)).toBeNull(); expect(await locksFor(active.matchId)).toBe(4);
    expect(await first.listPending()).not.toContain(active.matchId);
    stage = 'missing started account fails closed';
    const missing = await fixture('missingaccount', 'victory');
    const missingId = Object.values(missing.lobby.owners)[0]!.accountId;
    await pool.query(`DELETE FROM ${sql}.admission_locks WHERE account_id=$1`, [missingId]);
    await pool.query(`DELETE FROM ${sql}.accounts WHERE account_id=$1`, [missingId]);
    await expect(first.settle(missing.matchId, 90000)).rejects.toThrow('Private database operation failed');
    expect((await pool.query(`SELECT 1 FROM ${sql}.accounts WHERE account_id=$1`, [missingId])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM ${sql}.settlements WHERE match_id=$1`, [missing.matchId])).rowCount).toBe(0);
  } catch { throw new Error(`Isolated ranked settlement acceptance failed (${stage})`); }
  finally {
    try { if (created) { await pool.query(`DROP SCHEMA ${sql} CASCADE`); expect((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount).toBe(0); } }
    catch { throw new Error('Disposable ranked settlement schema cleanup failed'); }
    finally { await pool.end(); }
  }
}, 60000);
