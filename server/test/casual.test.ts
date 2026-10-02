import { expect, test } from 'bun:test';
import { createMatch } from '../src/domain/match.js';
import { departCasual, reclaimCasual, expireCasual, freezeAbsence, returnedOwner, initializeBotOwners, type CasualRecord } from '../src/domain/casual.js';

const fixture = () => {
  const record: CasualRecord = createMatch('casual'); record.phase = 'active';
  record.seats.R = { ...record.seats.R, ownerId: 'owner-r', controller: 'human', connected: true };
  return record;
};
test('return at 179999 is accepted but at 180000 is permanently denied despite delayed expiry', () => {
  const early = fixture(); departCasual(early, 'R', 0);
  expect(reclaimCasual(early, 'R', 'owner-r', 179999)).toBe('reclaimed');
  const late = fixture(); departCasual(late, 'R', 0);
  expect(reclaimCasual(late, 'R', 'owner-r', 180000)).toBe('expired');
  expect(late.seats.R.controller).toBe('bot'); expect(late.seats.R.disconnectDeadline).toBeNull();
});
test('repeated drops consume remaining budget and simultaneous clocks are independent', () => {
  const record = fixture(); record.seats.B = { ...record.seats.B, ownerId: 'owner-b', controller: 'human', connected: true };
  departCasual(record, 'R', 100); reclaimCasual(record, 'R', 'owner-r', 100100); departCasual(record, 'R', 200000);
  departCasual(record, 'B', 230000);
  expect(record.seats.R.disconnectDeadline).toBe(280000); expect(record.seats.B.disconnectDeadline).toBe(410000);
  expect(expireCasual(record, 280000)).toEqual(['R']); expect(record.seats.B.controller).toBe('temporary_bot');
});
test('intentional leave is permanent and terminal results remain final during absence', () => {
  const record = fixture(); departCasual(record, 'R', 0, true);
  expect(reclaimCasual(record, 'R', 'owner-r', 1)).toBe('expired');
  const terminal = fixture(); departCasual(terminal, 'R', 0); terminal.phase = 'finished';
  terminal.terminalResult = { kind: 'victory', winningTeam: 2, reason: null };
  const before = structuredClone(terminal);
  expect(reclaimCasual(terminal, 'R', 'owner-r', 1)).toBe('terminal'); expect(terminal).toEqual(before);
});
test('reclaim preserves accepted bot moves and cannot thaw a captured army', () => {
  const record = fixture(); departCasual(record, 'R', 0); record.engine.moveCount = 9; record.engine.alive.R = false;
  expect(reclaimCasual(record, 'R', 'owner-r', 1)).toBe('reclaimed');
  expect(record.engine.moveCount).toBe(9); expect(record.engine.alive.R).toBe(false);
});
test('service freeze charges only observed absence and resumed ledger excludes outage', () => {
  const record = fixture(); departCasual(record, 'R', 100); freezeAbsence(record, 60100);
  expect(record.absence?.R).toEqual({ usedMs: 60000, departedAt: null });
  returnedOwner(record, 'R'); record.seats.R.controller = 'human'; record.seats.R.connected = true;
  departCasual(record, 'R', 1000000); expect(record.seats.R.disconnectDeadline).toBe(1120000);
});
test('private stable bot owners exist only for empty bot seats', () => {
  const record = fixture(); initializeBotOwners(record); const owner = record.seats.B.ownerId;
  expect(owner).toBeTruthy(); initializeBotOwners(record); expect(record.seats.B.ownerId).toBe(owner);
  expect(record.seats.R.ownerId).toBe('owner-r');
});
