import { expect, test } from 'bun:test';
import { createMatch } from '../src/domain/match.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { FencedStore } from '../src/recovery/FencedStore.js';
import { RecoveryCoordinator } from '../src/recovery/RecoveryCoordinator.js';
import { runGlobalMaintenance } from '../src/recovery/global-maintenance.js';
import { PostgresMatchStore } from '../src/storage/PostgresMatchStore.js';
import { PostgresRankedSettlement } from '../src/storage/PostgresRankedSettlement.js';
import type { Pool } from 'pg';

class CountingStore extends MemoryLobbyStore {
  reads = 0;
  override async load(matchId: string) { this.reads++; return super.load(matchId); }
}

test('idle global ticks never download full match records', async () => {
  const raw = new CountingStore(), store = new FencedStore(raw, 'service', () => 0);
  await store.createInvited({ ...createMatch('idle'), lobbyDeadline: 1800000,
    lobby: { inviteCode: 'IDLE', roomId: 'transport', owners: {} } });
  const recovery = new RecoveryCoordinator({ store: raw, instanceId: 'service', clock: () => 100 });
  let settlements = 0;
  for (let i = 0; i < 20; i++) await runGlobalMaintenance({ store, recovery, now: 100,
    settlePending: async () => { settlements++; } });
  expect(raw.reads).toBe(0);
  expect(settlements).toBe(20);
});

test('exact lobby deadline and bounded batches expire all due work without loading future or foreign matches', async () => {
  const raw = new CountingStore({ maxUnstartedLobbies: 128 }), store = new FencedStore(raw, 'service', () => 0);
  for (let i = 0; i < 65; i++) await store.createInvited({ ...createMatch(`due-${String(i).padStart(2, '0')}`), lobbyDeadline: 100,
    lobby: { inviteCode: `DUE${i}`, roomId: null, owners: {} } });
  await raw.createInvited({ ...createMatch('foreign'), lobbyDeadline: 100, service: { instanceId: 'other', observedAt: 0 },
    lobby: { inviteCode: 'FOREIGN', roomId: null, owners: {} } } as Parameters<typeof raw.createInvited>[0]);
  let now = 99, published = 0;
  const recovery = new RecoveryCoordinator({ store: raw, instanceId: 'service', clock: () => now });
  const tick = () => runGlobalMaintenance({ store, recovery, now, settlePending: async () => {}, onCommitted: () => { published++; } });
  await tick(); expect(raw.reads).toBe(0); expect(published).toBe(0);
  now = 100; await tick(); expect(raw.reads).toBe(64); expect(published).toBe(64);
  await tick(); expect(raw.reads).toBe(65); expect(published).toBe(65);
  await tick(); expect(raw.reads).toBe(65);
  expect((await raw.load('foreign'))!.phase).toBe('lobby');
});

test('recovery grace expires exactly at its deadline without manufactured ranked offenders', async () => {
  const raw = new CountingStore(), store = new FencedStore(raw, 'service', () => 0);
  await store.createInvited({ ...createMatch('recover', 'ranked'), phase: 'paused', lobbyDeadline: null, recoveryDeadline: 300000,
    recovery: { previousPhase: 'active', cutoff: 0, startedAt: 0, deadline: 300000,
      remainingByColor: { R: null, B: null, Y: null, K: null }, requiredOwners: [], returnedOwners: [] },
    lobby: { inviteCode: 'RECOVERY', roomId: null, owners: {} } } as Parameters<typeof store.createInvited>[0]);
  let now = 299999;
  const recovery = new RecoveryCoordinator({ store: raw, instanceId: 'service', clock: () => now });
  const tick = () => runGlobalMaintenance({ store, recovery, now, settlePending: async () => {} });
  await tick(); expect(raw.reads).toBe(0);
  now = 300000; await tick(); expect(raw.reads).toBe(1);
  const final = await raw.load('recover');
  expect(final?.terminalResult?.reason).toBe('service_outage');
  expect(final).not.toHaveProperty('expiredDepartures');
});

test('metadata hints cannot authorize work after another instance claims the match', async () => {
  const raw = new CountingStore(), store = new FencedStore(raw, 'service', () => 0);
  await raw.createInvited({ ...createMatch('foreign'), lobbyDeadline: 0, service: { instanceId: 'other', observedAt: 0 },
    lobby: { inviteCode: 'FOREIGN', roomId: null, owners: {} } } as Parameters<typeof raw.createInvited>[0]);
  // A previously fetched hint can be stale by the time processing begins.
  store.listLifecycleDue = async () => [{ matchId: 'foreign', kind: 'lobby', deadline: 0 }];
  const recovery = new RecoveryCoordinator({ store: raw, instanceId: 'service', clock: () => 1 });
  await expect(runGlobalMaintenance({ store, recovery, now: 1, settlePending: async () => {} })).rejects.toThrow('obsolete_service_instance');
  await expect(store.maintenanceHead('foreign')).rejects.toThrow('obsolete_service_instance');
  expect((await raw.load('foreign'))?.revision).toBe(0);
});

test('room metadata includes applicable absolute deadlines, excludes terminal retention and reads no full records', async () => {
  const raw = new CountingStore(), store = new FencedStore(raw, 'service', () => 0);
  const active = { ...createMatch('active'), phase: 'active' as const, lobbyDeadline: 1, recoveryDeadline: 2,
    exchangeOffer: { expiresAt: 400 } as NonNullable<ReturnType<typeof createMatch>['exchangeOffer']>, lobby: { inviteCode: 'ACTIVE', roomId: null, owners: {} } };
  active.seats.R.disconnectDeadline = 500;
  await store.createInvited(active);
  expect((await store.maintenanceHead('active'))?.nextDeadline).toBe(400);
  await store.createInvited({ ...active, matchId: 'terminal', phase: 'void', retainUntil: 3,
    lobby: { ...active.lobby, inviteCode: 'TERMINAL' } });
  expect((await store.maintenanceHead('terminal'))?.nextDeadline).toBeNull();
  expect(await store.maintenanceHead('missing')).toBeNull();
  expect(raw.reads).toBe(0);
});

test('PostgreSQL maintenance returns bounded scalar metadata scoped to the lease instance, not record payloads', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { async query(sql: string, values: unknown[]) {
    calls.push({ sql, values });
    return { rows: sql.includes('SELECT d.match_id') ? [{ match_id: 'due', kind: 'lobby', deadline: '100' }]
      : sql.includes('SELECT m.revision') ? [{ revision: 4, phase: 'active', service_instance_id: 'service', next_deadline: '500' }]
      : [{ match_id: 'pending' }] };
  } } as unknown as Pool;
  const raw = new PostgresMatchStore(pool, { schema: 'enochian_fixture' }), store = new FencedStore(raw, 'service');
  expect(await store.listLifecycleDue(100, 2)).toEqual([{ matchId: 'due', kind: 'lobby', deadline: 100 }]);
  expect(calls[0]!.values).toEqual([100, 2, 'service']);
  expect(calls[0]!.sql).toContain('LIMIT $2'); expect(calls[0]!.sql).toContain('"enochian_fixture".deadlines');
  expect(calls[0]!.sql).toContain('d.deadline <= $1');
  expect(await store.maintenanceHead('active')).toEqual({ revision: 4, phase: 'active', serviceInstanceId: 'service', nextDeadline: 500 });
  expect(calls[1]!.values).toEqual(['active']);
  expect(await new PostgresRankedSettlement(pool, { schema: 'enochian_fixture' }).listPending(2)).toEqual(['pending']);
  expect(calls[2]!.values).toEqual([2]); expect(calls[2]!.sql).toContain('LIMIT $1');
  for (const call of calls) expect(call.sql).not.toMatch(/SELECT\s+(?:m\.)?record(?:\s|,)/i);
  await expect(store.listLifecycleDue(100, 257)).rejects.toThrow('Invalid maintenance bounds');
  await expect(store.listLifecycleDue(-1)).rejects.toThrow('Invalid maintenance time');
});
