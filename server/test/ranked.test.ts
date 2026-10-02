import { expect, test } from 'bun:test';
import { COLORS, createMatch, type Color } from '../src/domain/match.js';
import { departRanked, reclaimRanked, expireRanked, freezeRankedAbsence, returnedRankedOwner, buildRankedSettlement, rankedEntryAllowed, type RankedRecord, type RankedAccountRating } from '../src/domain/ranked.js';
import type { LobbyRecord } from '../src/storage/LobbyStore.js';
import { CommandProcessor } from '../src/domain/commands.js';
import { MemoryMatchStore } from '../src/storage/MemoryMatchStore.js';
import { offerExchange } from '../src/domain/exchange.js';

function fixture() {
  const record: RankedRecord & LobbyRecord = { ...createMatch('ranked-match', 'ranked'), lobby: { inviteCode: 'CODE', roomId: 'room', owners: {} } };
  record.phase = 'active';
  const accounts = {} as Record<Color, RankedAccountRating>;
  COLORS.forEach((color, i) => {
    const ownerId = `owner-${color}`, accountId = `12345678-1234-4123-8123-${String(i).padStart(12, '0')}`;
    record.seats[color] = { color, ownerId, displayName: color, controller: 'human', connected: true, ready: true, disconnectDeadline: null };
    record.lobby.owners[ownerId] = { credentialHash: ownerId, connectionId: color, accountId };
    accounts[color] = { accountId, rating: 1200 };
  });
  return { record, accounts };
}

test('ranked return succeeds at 299999 and fails at 300000 without timer callbacks', () => {
  const { record } = fixture(); const revision = record.revision;
  expect(departRanked(record, 'R', 0)).toBe(true);
  expect(record.phase).toBe('paused'); expect(record.seats.R.controller).toBe('human');
  const late = structuredClone(record);
  expect(reclaimRanked(record, 'R', 'owner-R', 299999)).toBe('reclaimed');
  expect(record.phase).toBe('active'); expect(record.absence?.R?.usedMs).toBe(299999);
  expect(reclaimRanked(late, 'R', 'owner-R', 300000)).toBe('expired');
  expect(late.phase).toBe('void'); expect(late.expiredDepartures).toEqual(['R']);
  expect(record.revision).toBe(revision); expect(late.revision).toBe(revision);
});

test('simultaneous clocks are independent, one missing player prevents resume and repeated drops consume remainder', () => {
  const { record } = fixture();
  departRanked(record, 'R', 1000); departRanked(record, 'B', 2000);
  expect(record.seats.R.disconnectDeadline).toBe(301000); expect(record.seats.B.disconnectDeadline).toBe(302000);
  expect(reclaimRanked(record, 'R', 'owner-R', 11000)).toBe('reclaimed'); expect(record.phase).toBe('paused');
  expect(reclaimRanked(record, 'B', 'owner-B', 12000)).toBe('reclaimed'); expect(record.phase).toBe('active');
  departRanked(record, 'R', 20000);
  expect(record.seats.R.disconnectDeadline).toBe(310000);
  expect(expireRanked(record, 309999)).toEqual([]);
  expect(expireRanked(record, 310000)).toEqual(['R']); expect(record.absence?.R?.usedMs).toBe(300000);
});

test('only already expired missing players are offenders, including simultaneous expiry', () => {
  const { record } = fixture(); departRanked(record, 'R', 0); departRanked(record, 'B', 100);
  expect(expireRanked(record, 300000)).toEqual(['R']); expect(record.expiredDepartures).toEqual(['R']);
  const together = fixture().record; departRanked(together, 'Y', 0); departRanked(together, 'K', 0);
  expect(expireRanked(together, 300000)).toEqual(['Y', 'K']);
});

test('intentional leave voids immediately for the leaving player; terminal results remain final', () => {
  const { record } = fixture(); expect(departRanked(record, 'Y', 100, true)).toBe(true);
  expect(record.terminalResult?.reason).toBe('abandonment'); expect(record.expiredDepartures).toEqual(['Y']);
  const before = structuredClone(record);
  expect(reclaimRanked(record, 'Y', 'owner-Y', 101)).toBe('terminal'); expect(departRanked(record, 'K', 102)).toBe(false);
  expect(expireRanked(record, 999999)).toEqual([]); expect(record).toEqual(before);
});

test('ranked lifecycle rejects missing or bot rosters, never assigns a bot and rejects wrong ownership', () => {
  const { record } = fixture(); record.seats.K.controller = 'bot';
  const before = structuredClone(record); expect(departRanked(record, 'R', 0)).toBe(false); expect(record).toEqual(before);
  record.seats.K.controller = 'human'; departRanked(record, 'R', 0);
  expect(reclaimRanked(record, 'R', 'attacker', 1)).toBe('unauthorized');
  expect(COLORS.every(color => record.seats[color].controller === 'human')).toBe(true);
});

test('paused records reject moves and prisoner exchange', async () => {
  const { record } = fixture(); departRanked(record, 'B', 0);
  const store = new MemoryMatchStore(); await store.create(record);
  const result = await new CommandProcessor({ store }).execute({ actorId: 'owner-R', seat: 'R', controller: 'human' }, { matchId: record.matchId, requestId: 'paused-move', expectedRevision: record.revision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action: { type: 'move', fr: 6, fc: 7, tr: 5, tc: 7 } });
  expect(result.code).toBe('invalid_phase');
  expect(offerExchange(record, { actorId: 'owner-R', seat: 'R', controller: 'human', multiplayer: true, expectedRevision: record.revision, now: 1 }, { offerId: 'offer', counterpart: 'B' }).status).toBe('invalid_phase');
});

test('service recovery freezes allowances; its failed grace has no outage offenders', () => {
  const { record, accounts } = fixture(); departRanked(record, 'R', 100);
  freezeRankedAbsence(record, 10100); expect(record.absence?.R).toEqual({ usedMs: 10000, departedAt: null });
  record.recovery = { previousPhase: 'paused', cutoff: 10100, startedAt: 1000000, deadline: 1300000, remainingByColor: { R: 290000, B: null, Y: null, K: null }, requiredOwners: COLORS.map(color => `owner-${color}`), returnedOwners: [] };
  record.recoveryDeadline = 1300000;
  expect(reclaimRanked(record, 'R', 'owner-R', 1000001)).toBe('invalid_phase');
  expect(expireRanked(record, 1299999)).toEqual([]); expect(record.phase).toBe('paused');
  expect(expireRanked(record, 1300000)).toEqual([]); expect(record.terminalResult?.reason).toBe('service_outage');
  expect(record.absence?.R?.usedMs).toBe(10000);
  const plan = buildRankedSettlement(record, accounts, 1300000); expect(plan.offenders).toEqual([]); expect(plan.entries.every(entry => entry.delta === 0 && entry.restrictionUntil === null)).toBe(true);
  returnedRankedOwner(record, 'R'); expect(record.absence?.R?.departedAt).toBeNull();
});

test('team Elo uses canonical R/Y versus B/K, common rounded deltas and a zero-sum normal result', () => {
  const { record, accounts } = fixture(); record.phase = 'finished'; record.terminalResult = { kind: 'victory', winningTeam: 1, reason: null };
  let plan = buildRankedSettlement(record, accounts, 1000);
  expect(plan.entries.map(entry => entry.delta)).toEqual([16, -16, 16, -16]); expect(plan.entries.reduce((sum, entry) => sum + entry.delta, 0)).toBe(0);
  accounts.R.rating = 1400; accounts.Y.rating = 1800; accounts.B.rating = 800; accounts.K.rating = 1200;
  plan = buildRankedSettlement(record, accounts, 1000); expect(plan.entries.map(entry => entry.delta)).toEqual([1, -1, 1, -1]);
  record.terminalResult.winningTeam = 2; plan = buildRankedSettlement(record, accounts, 1000); expect(plan.entries.map(entry => entry.delta)).toEqual([-31, 31, -31, 31]);
  expect(accounts.R.rating).toBe(1400);
});

test('void penalties use historical expired departures, no rating floor and settlement-based cooldown boundaries', () => {
  const { record, accounts } = fixture(); record.phase = 'void'; record.terminalResult = { kind: 'void', winningTeam: null, reason: 'abandonment' }; record.expiredDepartures = ['R', 'K'];
  accounts.R.rating = -10; const plan = buildRankedSettlement(record, accounts, 1000);
  expect(plan.matchId).toBe(record.matchId); expect(plan.entries.map(entry => entry.delta)).toEqual([-32, 0, 0, -32]); expect(plan.entries[0]?.rating).toBe(-42);
  expect(plan.entries[0]?.restrictionUntil).toBe(601000);
  expect(rankedEntryAllowed(601000, 600999)).toBe(false); expect(rankedEntryAllowed(601000, 601000)).toBe(true);
  record.terminalResult.reason = 'service_outage'; expect(buildRankedSettlement(record, accounts, 1000).offenders).toEqual([]);
});

test('unrated accounts default to 1200; settlement rejects nonterminal, mismatched and invalid ratings', () => {
  const { record, accounts } = fixture(); expect(() => buildRankedSettlement(record, accounts, 0)).toThrow('invalid_phase');
  record.phase = 'finished'; record.terminalResult = { kind: 'victory', winningTeam: 1, reason: null };
  delete accounts.R.rating; expect(buildRankedSettlement(record, accounts, 0).entries[0]?.previousRating).toBe(1200);
  accounts.R.rating = Number.NaN; expect(() => buildRankedSettlement(record, accounts, 0)).toThrow('invalid_rating');
  accounts.R.rating = 1200; accounts.R.accountId = accounts.B.accountId; expect(() => buildRankedSettlement(record, accounts, 0)).toThrow('unauthorized');
});

test('unstarted void settles only admitted accounts without penalties and requires their durable account inputs', () => {
  const { record, accounts } = fixture();
  record.seats.B = createMatch('blank').seats.B; record.seats.Y = createMatch('blank').seats.Y; record.seats.K = createMatch('blank').seats.K;
  record.phase = 'void'; record.terminalResult = { kind: 'void', winningTeam: null, reason: 'lobby_expired' };
  const plan = buildRankedSettlement(record, { R: accounts.R }, 1000);
  expect(plan.entries).toHaveLength(1); expect(plan.entries[0]?.delta).toBe(0); expect(plan.entries[0]?.restrictionUntil).toBeNull(); expect(plan.offenders).toEqual([]);
  expect(() => buildRankedSettlement(record, {}, 1000)).toThrow('unauthorized');
  record.seats.R = createMatch('blank').seats.R; expect(buildRankedSettlement(record, {}, 1000).entries).toEqual([]);
});
