import { expect, test } from 'bun:test';
import { COLORS, createMatch, type Color } from '../src/domain/match.js';
import { acceptExchange, expireExchange, invalidateExchange, offerExchange, publicExchange, recordKingCaptures, rejectExchange, EXCHANGE_OFFER_MS, THRONES, type ExchangeRecord } from '../src/domain/exchange.js';

function fixture(): ExchangeRecord {
  const record: ExchangeRecord = createMatch('exchange'); record.phase = 'active';
  for (const color of COLORS) Object.assign(record.seats[color], { ownerId: `owner-${color}`, controller: 'human', connected: true });
  record.engine.board = { '7,7': { color: 'R', type: 'KING' }, '0,7': { color: 'B', type: 'KING' } };
  record.engine.alive = { R: true, B: true, Y: false, K: false };
  record.revision = 1; record.engine.moveCount = 1;
  recordKingCaptures(record, [{ type: 'capture', piece: { color: 'Y', type: 'KING' }, byColor: 'B' }]);
  record.revision = 2; record.engine.moveCount = 2;
  recordKingCaptures(record, [{ type: 'capture', piece: { color: 'K', type: 'KING' }, byColor: 'R' }]);
  record.engine.turnIndex = 1; return record;
}
function actor(record: ExchangeRecord, seat: Color = 'R', now = 100) {
  return { actorId: `owner-${seat}`, seat, controller: 'human' as const, multiplayer: true, expectedRevision: record.revision, now };
}
function offered(record = fixture()) {
  expect(offerExchange(record, actor(record), { offerId: 'offer-1', counterpart: 'B' }).status).toBe('offered');
  record.revision++; return record;
}
test('captures record only canonical king events, deduplicate, and never expose owner identities', () => {
  const record = fixture(); const before = structuredClone(record.prisoners);
  recordKingCaptures(record, [{ type: 'freeze', color: 'Y' }, { type: 'capture', piece: { color: 'K', type: 'PAWN' }, byColor: 'R' }, { type: 'capture', piece: { color: 'K', type: 'KING' }, byColor: 'R' }]);
  expect(record.prisoners).toEqual(before);
  offered(record); expect(JSON.stringify(publicExchange(record))).not.toContain('owner-');
  expect(publicExchange(record)?.prisoners).toEqual(['Y', 'K']);
});
test('second captor can offer immediately; either captor can offer on later own turns under G4', () => {
  const record = fixture(); expect(offerExchange(record, actor(record), { offerId: 'immediate', counterpart: 'B' }).status).toBe('offered');
  invalidateExchange(record, 'move'); record.revision++; record.engine.moveCount++;
  expect(offerExchange(record, actor(record), { offerId: 'later', counterpart: 'B' }).status).toBe('out_of_turn');
  record.engine.turnIndex = 0;
  expect(offerExchange(record, actor(record), { offerId: 'later', counterpart: 'B' }).status).toBe('offered');
  const first = fixture(); first.engine.turnIndex = 0;
  expect(offerExchange(first, actor(first, 'B'), { offerId: 'first', counterpart: 'R' }).status).toBe('out_of_turn');
  first.engine.turnIndex = 1;
  expect(offerExchange(first, actor(first, 'B'), { offerId: 'first-later', counterpart: 'R' }).status).toBe('offered');
});
test('wrong captors, local commands, frozen/dead captors and AI control cannot negotiate', () => {
  const record = fixture(); expect(offerExchange(record, actor(record), { offerId: 'wrong', counterpart: 'Y' }).status).toBe('wrong_captor');
  expect(offerExchange(record, { ...actor(record), multiplayer: false }, { offerId: 'local', counterpart: 'B' }).status).toBe('local_mode');
  for (const color of ['R', 'B'] as const) {
    const frozen = fixture(); frozen.engine.alive[color] = false;
    expect(offerExchange(frozen, actor(frozen), { offerId: 'dead', counterpart: 'B' }).status).toBe('frozen_captor');
    for (const controller of ['temporary_bot', 'bot'] as const) {
      const bot = fixture(); bot.seats[color].controller = controller;
      expect(offerExchange(bot, actor(bot), { offerId: 'bot', counterpart: 'B' }).status).toBe('ineligible_captor');
    }
  }
});
test('both captors and all owner bindings are rechecked at acceptance', () => {
  for (const mutate of [(r: ExchangeRecord) => { r.seats.R.connected = false; }, (r: ExchangeRecord) => { r.seats.B.controller = 'temporary_bot'; }, (r: ExchangeRecord) => { r.seats.Y.ownerId = 'new-owner'; }, (r: ExchangeRecord) => { r.engine.alive.R = false; }]) {
    const record = offered(); mutate(record); const before = structuredClone(record);
    expect(acceptExchange(record, actor(record, 'B'), 'offer-1').status).not.toBe('accepted'); expect(record).toEqual(before);
  }
});
test('offers expire at the exact deadline and reject stale revisions and duplicate acceptance', () => {
  const late = offered(); expect(acceptExchange(late, actor(late, 'B', 100 + EXCHANGE_OFFER_MS), 'offer-1').status).toBe('expired');
  const stale = offered(); expect(acceptExchange(stale, { ...actor(stale, 'B'), expectedRevision: 2 }, 'offer-1').status).toBe('stale_revision');
  stale.revision++; expect(acceptExchange(stale, actor(stale, 'B'), 'offer-1').status).toBe('stale_offer');
  const record = offered(); expect(acceptExchange(record, actor(record, 'B', 60099), 'offer-1').status).toBe('accepted');
  expect(acceptExchange(record, actor(record, 'B'), 'offer-1').status).toBe('no_offer');
});
test('expiry invalidates at deadline even when scheduling is delayed', () => {
  const record = offered(); expect(expireExchange(record, 60099)).toBe(false);
  expect(expireExchange(record, 60100)).toBe(true); expect(publicExchange(record)).toBeNull(); expect(expireExchange(record, 60101)).toBe(false);
});
test('only counterpart can reject and future own-turn proposals remain possible', () => {
  const record = offered(); expect(rejectExchange(record, actor(record), 'offer-1').status).toBe('wrong_captor');
  expect(rejectExchange(record, actor(record, 'B'), 'offer-1').status).toBe('rejected');
  record.revision++; record.engine.turnIndex = 0;
  expect(offerExchange(record, actor(record), { offerId: 'again', counterpart: 'B' }).status).toBe('offered');
});
test('any move/control/pause/end invalidates and canonical terminal results are final', () => {
  for (const reason of ['move', 'control_change', 'pause', 'end'] as const) {
    const record = offered(); expect(invalidateExchange(record, reason)).toBe(true); expect(publicExchange(record)).toBeNull();
  }
  for (const end of [(r: ExchangeRecord) => { r.phase = 'finished'; r.terminalResult = { kind: 'victory', winningTeam: 1, reason: null }; }, (r: ExchangeRecord) => { r.engine.over = true; }, (r: ExchangeRecord) => { r.phase = 'paused'; }]) {
    const record = offered(); end(record); const before = structuredClone(record);
    expect(acceptExchange(record, actor(record, 'B'), 'offer-1').status).toBe('invalid_phase'); expect(record).toEqual(before);
  }
});
test('restore only the two kings to original external thrones, thaw both, preserve turn and removed pieces', () => {
  const record = offered(); const turn = record.engine.turnIndex, count = record.engine.moveCount;
  const result = acceptExchange(record, actor(record, 'B'), 'offer-1'); expect(result.status).toBe('accepted');
  expect(record.engine.board['0,-1']).toEqual({ color: 'Y', type: 'KING' }); expect(record.engine.board['8,0']).toEqual({ color: 'K', type: 'KING' });
  expect(record.engine.alive.Y).toBe(true); expect(record.engine.alive.K).toBe(true);
  expect(Object.keys(record.engine.board)).toHaveLength(4); expect(record.engine.turnIndex).toBe(turn); expect(record.engine.moveCount).toBe(count); expect(record.prisoners).toEqual({});
});
test('occupied thrones use king-step distance then row/column ties', () => {
  const record = fixture(); record.engine.board['0,-1'] = { color: 'R', type: 'PAWN' }; record.engine.board['8,0'] = { color: 'R', type: 'PAWN' };
  offered(record); expect(acceptExchange(record, actor(record, 'B'), 'offer-1').status).toBe('accepted');
  expect(record.engine.board['0,0']).toEqual({ color: 'Y', type: 'KING' }); expect(record.engine.board['7,0']).toEqual({ color: 'K', type: 'KING' });
});
test('threatened thrones and thawed enemy armies are included in safety checks', () => {
  const record = fixture(); record.engine.board['0,0'] = { color: 'K', type: 'ROOK' };
  // K is currently frozen; its rook will attack Y throne after both are restored.
  offered(record); expect(acceptExchange(record, actor(record, 'B'), 'offer-1').status).toBe('accepted');
  expect(record.engine.board['0,-1']).toBeUndefined(); expect(record.engine.board['1,1']).toEqual({ color: 'Y', type: 'KING' });
});
function crowded(holes: string[]): ExchangeRecord {
  const record = fixture();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (!record.engine.board[`${r},${c}`] && !holes.includes(`${r},${c}`)) record.engine.board[`${r},${c}`] = { color: 'R', type: 'BLOCKER' };
  for (const throne of [THRONES.Y, THRONES.K]) record.engine.board[`${throne.r},${throne.c}`] = { color: 'R', type: 'BLOCKER' };
  return record;
}
test('two restored enemy kings cannot share a square or threaten each other; no pair changes nothing', () => {
  for (const holes of [['3,3'], ['3,3', '3,4']]) {
    const record = offered(crowded(holes)); const before = structuredClone(record);
    const result = acceptExchange(record, actor(record, 'B'), 'offer-1'); expect(result.status).toBe('placement_failed');
    expect(result).toMatchObject({ reason: 'no_safe_pair' }); expect(record).toEqual(before);
  }
  const record = offered(crowded(['3,3', '5,5'])); expect(acceptExchange(record, actor(record, 'B'), 'offer-1').status).toBe('accepted');
  expect(record.engine.board['3,3']?.color).toBe('Y'); expect(record.engine.board['5,5']?.color).toBe('K');
});
