import { test, expect } from 'bun:test';
import { LobbyService } from '../src/domain/lobby.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { RecoveryCoordinator, type RecoveryRecord } from '../src/recovery/RecoveryCoordinator.js';
import { FencedStore } from '../src/recovery/FencedStore.js';
import { COLORS, publicSnapshot } from '../src/domain/match.js';

async function setup(mode: 'casual' | 'ranked' = 'casual') {
  let now = 1000;
  const raw = new MemoryLobbyStore(), old = new FencedStore(raw, 'old', () => now);
  const lobby = new LobbyService({ store: old, clock: () => now, rankedEnabled: mode === 'ranked' });
  const first = await lobby.create(mode, 'Red', 'R', mode === 'ranked' ? { accountId: 'account-R' } : undefined);
  const invites = [first];
  for (const color of (mode === 'ranked' ? COLORS.slice(1) : ['B'] as const)) invites.push(await lobby.join(first.code, color, color, mode === 'ranked' ? { accountId: `account-${color}` } : undefined));
  for (let i = 0; i < invites.length; i++) await lobby.connect(first.matchId, invites[i]!.credential, `connection-${i}`);
  for (let i = 0; i < invites.length; i++) {
    const record = (await raw.load(first.matchId))!;
    expect((await lobby.command(first.matchId, `connection-${i}`, `ready-${i}`, record.revision, { type: 'ready', ready: true })).ok).toBe(true);
  }
  return { raw, old, first, invites, clock: () => now, setTime: (time: number) => { now = time; } };
}

test('restart preserves canonical position, freezes absence and replaces transport mapping privately', async () => {
  const fixture = await setup();
  const before = (await fixture.raw.load(fixture.first.matchId)) as RecoveryRecord;
  before.seats.R.disconnectDeadline = 181000;
  // Use the ordinary atomic adapter boundary to persist the observed departure.
  const expectedRevision = before.revision; before.revision++;
  await fixture.raw.commit({ matchId: before.matchId, expectedRevision, next: before, events: [{ type: 'drop' }], command: {
    actorId: 'system', requestId: 'drop', fingerprint: 'drop', committedAt: 1000,
    result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(before) },
  } });
  fixture.setTime(900000);
  const coordinator = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  const claimed = await coordinator.claim(before.matchId, 10000, 'new-room');
  expect(claimed.engine).toEqual(before.engine);
  expect(claimed.recovery?.remainingByColor.R).toBe(171000);
  expect(claimed.recoveryDeadline).toBe(1200000);
  expect(claimed.phase).toBe('paused');
  expect(claimed.lobby.roomId).toBe('new-room');
  expect(Object.values(claimed.lobby.owners).every(owner => owner.connectionId === null)).toBe(true);
  const publicText = JSON.stringify(publicSnapshot(claimed));
  expect(publicText).not.toContain('credentialHash'); expect(publicText).not.toContain('instanceId');
  expect(publicText).not.toContain(fixture.first.credential);
  await expect(fixture.old.load(before.matchId)).rejects.toThrow('obsolete_service_instance');
  await expect(coordinator.recover(before.matchId, fixture.first.code, 'attacker')).rejects.toThrow('unauthorized');
});

test('service recovery resumes only after all required owners return before its deadline', async () => {
  const fixture = await setup('ranked'); fixture.setTime(200000);
  const coordinator = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  await coordinator.claim(fixture.first.matchId, 1000, 'room-recovered');
  for (let i = 0; i < 3; i++) {
    expect((await coordinator.recover(fixture.first.matchId, fixture.invites[i]!.credential, `new-${i}`)).snapshot?.phase).toBe('paused');
  }
  fixture.setTime(499999);
  expect((await coordinator.recover(fixture.first.matchId, fixture.invites[3]!.credential, 'new-3')).snapshot?.phase).toBe('active');
  expect((await fixture.raw.load(fixture.first.matchId))?.recoveryDeadline).toBeNull();
});

test('late ranked service return voids without abandonment consequences and cannot reopen terminal state', async () => {
  const fixture = await setup('ranked'); fixture.setTime(200000);
  const coordinator = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  await coordinator.claim(fixture.first.matchId, 1000, 'room-recovered'); fixture.setTime(500000);
  const expired = await coordinator.recover(fixture.first.matchId, fixture.first.credential, 'late');
  expect(expired.snapshot?.terminalResult).toEqual({ kind: 'void', winningTeam: null, reason: 'service_outage' });
  const revision = expired.snapshot!.revision;
  expect(await coordinator.expire(fixture.first.matchId)).toBeNull();
  expect((await coordinator.recover(fixture.first.matchId, fixture.invites[1]!.credential, 'later')).snapshot?.revision).toBe(revision);
  const reclaimed = await new RecoveryCoordinator({ store: fixture.raw, instanceId: 'third', clock: fixture.clock }).claim(fixture.first.matchId, 500000, 'third-room');
  expect(reclaimed.phase).toBe('void'); expect(reclaimed.terminalResult).toEqual(expired.snapshot!.terminalResult);
});

test('repeated outages keep the original frozen absence budget and casual expiry returns control to bots', async () => {
  const fixture = await setup(); fixture.setTime(200000);
  const first = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  await first.claim(fixture.first.matchId, 1000, 'room-new');
  fixture.setTime(900000);
  const second = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'third', clock: fixture.clock });
  const claimed = await second.claim(fixture.first.matchId, 400000, 'room-third');
  expect(claimed.recovery?.cutoff).toBe(1000);
  await second.recover(fixture.first.matchId, fixture.first.credential, 'returned'); fixture.setTime(1200000);
  const expired = await second.expire(fixture.first.matchId);
  expect(expired?.snapshot?.phase).toBe('active'); expect(expired?.snapshot?.seats.R.controller).toBe('human');
  expect(expired?.snapshot?.seats.B.controller).toBe('temporary_bot');
  expect(expired?.snapshot?.seats.B.disconnectDeadline).toBe(1380000);
});

test('an individually expired ranked allowance before the last heartbeat cannot be erased by recovery', async () => {
  const fixture = await setup('ranked');
  const record = (await fixture.raw.load(fixture.first.matchId)) as RecoveryRecord;
  const expectedRevision = record.revision;
  record.seats.R.disconnectDeadline = 10000; record.seats.R.connected = false;
  record.phase = 'paused'; record.revision++;
  await fixture.raw.commit({ matchId: record.matchId, expectedRevision, next: record, events: [], command: {
    actorId: 'system', requestId: 'departure', fingerprint: 'departure', committedAt: 1000,
    result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(record) },
  } });
  fixture.setTime(900000);
  const coordinator = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  const claimed = await coordinator.claim(record.matchId, 20000, 'new-room');
  expect(claimed.phase).toBe('void');
  expect(claimed.terminalResult?.reason).toBe('abandonment');
  expect(claimed.expiredDepartures).toEqual(['R']);
});

test('a second drop while service recovery waits removes that owner from the resumed roster', async () => {
  const fixture = await setup('ranked');
  const coordinator = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  await coordinator.claim(fixture.first.matchId, 1000, 'new-room');
  await coordinator.recover(fixture.first.matchId, fixture.first.credential, 'return-R');
  await coordinator.depart(fixture.first.matchId, 'return-R');
  for (let i = 1; i < 4; i++) await coordinator.recover(fixture.first.matchId, fixture.invites[i]!.credential, `new-${i}`);
  expect((await fixture.raw.load(fixture.first.matchId))?.phase).toBe('paused');
  expect((await coordinator.recover(fixture.first.matchId, fixture.first.credential, 'second-R')).snapshot?.phase).toBe('active');
});

test('a departure after the last heartbeat cannot gain absence time from that stale cutoff', async () => {
  const fixture = await setup();
  const record = (await fixture.raw.load(fixture.first.matchId)) as RecoveryRecord;
  const expectedRevision = record.revision;
  record.absence = { R: { usedMs: 30000, departedAt: 20000 } };
  record.seats.R.disconnectDeadline = 170000; record.seats.R.connected = false; record.revision++;
  await fixture.raw.commit({ matchId: record.matchId, expectedRevision, next: record, events: [], command: {
    actorId: 'system', requestId: 'late-departure', fingerprint: 'late-departure', committedAt: 20000,
    result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(record) },
  } });
  fixture.setTime(900000);
  const coordinator = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  expect((await coordinator.claim(record.matchId, 10000, 'new-room')).recovery?.remainingByColor.R).toBe(150000);
});

test('simultaneous departures during recovery both remove their returned ownership', async () => {
  const fixture = await setup('ranked');
  const coordinator = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  await coordinator.claim(fixture.first.matchId, 1000, 'new-room');
  await coordinator.recover(fixture.first.matchId, fixture.invites[0]!.credential, 'return-0');
  await coordinator.recover(fixture.first.matchId, fixture.invites[1]!.credential, 'return-1');
  await Promise.all([coordinator.depart(fixture.first.matchId, 'return-0'), coordinator.depart(fixture.first.matchId, 'return-1')]);
  const record = await fixture.raw.load(fixture.first.matchId) as RecoveryRecord;
  expect(record.recovery?.returnedOwners).toEqual([]);
  expect(record.seats.R.connected).toBe(false); expect(record.seats.B.connected).toBe(false);
});

test('a new service can read final results owned by an earlier instance without permission to mutate them', async () => {
  const fixture = await setup();
  const record = (await fixture.raw.load(fixture.first.matchId)) as RecoveryRecord;
  const expectedRevision = record.revision;
  record.phase = 'void'; record.terminalResult = { kind: 'void', winningTeam: null, reason: 'service_outage' }; record.revision++;
  await fixture.raw.commit({ matchId: record.matchId, expectedRevision, next: record, events: [], command: {
    actorId: 'system', requestId: 'final', fingerprint: 'final', committedAt: 1000,
    result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(record) },
  } });
  const next = new FencedStore(fixture.raw, 'new');
  expect((await next.load(record.matchId))?.terminalResult).toEqual(record.terminalResult);
  await expect(next.commit({ matchId: record.matchId, expectedRevision: record.revision, next: { ...record, revision: record.revision + 1 }, events: [],
    command: { actorId: 'system', requestId: 'illegal-new', fingerprint: 'illegal-new', committedAt: 1000,
      result: { ok: true, code: 'accepted', retryable: false } } })).rejects.toThrow('obsolete_service_instance');
  await expect(next.commit({ matchId: record.matchId, expectedRevision: record.revision,
    next: { ...record, revision: record.revision + 1, service: { instanceId: 'new', observedAt: 1000 } } as RecoveryRecord, events: [],
    command: { actorId: 'system', requestId: 'overwritten-owner', fingerprint: 'overwritten-owner', committedAt: 1000,
      result: { ok: true, code: 'accepted', retryable: false } } })).rejects.toThrow('obsolete_service_instance');
});

test('late recovery and scheduled expiry racing together both observe the same final result', async () => {
  const fixture = await setup('ranked');
  const coordinator = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  await coordinator.claim(fixture.first.matchId, 1000, 'new-room'); fixture.setTime(301000);
  const results = await Promise.allSettled([coordinator.recover(fixture.first.matchId, fixture.first.credential, 'late'), coordinator.expire(fixture.first.matchId)]);
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
  expect((await fixture.raw.load(fixture.first.matchId))?.terminalResult?.reason).toBe('service_outage');
});

test('an obsolete service recovery coordinator cannot admit players after another instance claims the match', async () => {
  const fixture = await setup();
  const old = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  await old.claim(fixture.first.matchId, 1000, 'new-room');
  await new RecoveryCoordinator({ store: fixture.raw, instanceId: 'third', clock: fixture.clock }).claim(fixture.first.matchId, 1000, 'third-room');
  await expect(old.recover(fixture.first.matchId, fixture.first.credential, 'obsolete')).rejects.toThrow('obsolete_service_instance');
});

test('early return after outage keeps already consumed absence without charging recovery time', async () => {
  const fixture = await setup();
  const record = (await fixture.raw.load(fixture.first.matchId)) as RecoveryRecord;
  const expectedRevision = record.revision;
  record.absence = { R: { usedMs: 30000, departedAt: 20000 } };
  record.seats.R.disconnectDeadline = 170000; record.seats.R.connected = false; record.revision++;
  await fixture.raw.commit({ matchId: record.matchId, expectedRevision, next: record, events: [], command: {
    actorId: 'system', requestId: 'absence', fingerprint: 'absence', committedAt: 20000,
    result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(record) },
  } });
  fixture.setTime(900000);
  const coordinator = new RecoveryCoordinator({ store: fixture.raw, instanceId: 'new', clock: fixture.clock });
  await coordinator.claim(record.matchId, 40000, 'new-room');
  await coordinator.recover(record.matchId, fixture.invites[0]!.credential, 'new-0');
  await coordinator.recover(record.matchId, fixture.invites[1]!.credential, 'new-1');
  const returned = await fixture.raw.load(record.matchId) as RecoveryRecord;
  expect(returned.absence?.R).toEqual({ usedMs: 50000, departedAt: null });
  expect(returned.phase).toBe('active'); expect(returned.recovery).toBeUndefined();
});
