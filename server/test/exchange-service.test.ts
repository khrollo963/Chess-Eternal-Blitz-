import { expect, test } from 'bun:test';
import { createMatch, COLORS, publicSnapshot, type Color } from '../src/domain/match.js';
import { CommandProcessor } from '../src/domain/commands.js';
import { recordKingCaptures, type ExchangeRecord } from '../src/domain/exchange.js';
import { ExchangeService, parseExchangeCommand } from '../src/domain/ExchangeService.js';
import { departCasual } from '../src/domain/casual.js';
import { MemoryMatchStore } from '../src/storage/MemoryMatchStore.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { RecoveryCoordinator, type RecoveryRecord } from '../src/recovery/RecoveryCoordinator.js';
import { EnochianState, applySnapshot } from '../src/rooms/EnochianState.js';

function recordFixture(): ExchangeRecord {
  const record: ExchangeRecord = createMatch('exchange-1'); record.phase = 'active';
  for (const color of COLORS) Object.assign(record.seats[color], { ownerId: `private-${color}`, controller: 'human', connected: true });
  record.engine.board = { '7,7': { color: 'R', type: 'KING' }, '0,7': { color: 'B', type: 'KING' } };
  record.engine.alive = { R: true, B: true, Y: false, K: false };
  record.revision = 1; record.engine.moveCount = 1;
  recordKingCaptures(record, [{ type: 'capture', piece: { color: 'Y', type: 'KING' }, byColor: 'B' }]);
  record.revision = 2; record.engine.moveCount = 2;
  recordKingCaptures(record, [{ type: 'capture', piece: { color: 'K', type: 'KING' }, byColor: 'R' }]);
  return record;
}
const actor = (seat: Color = 'R') => ({ actorId: `private-${seat}`, seat, controller: 'human' as const });
const envelope = (requestId = 'offer-1', revision = 2, action: unknown = { type: 'offer', counterpart: 'B' }) => ({ requestId, matchId: 'exchange-1', expectedRevision: revision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action });
async function fixture() {
  const store = new MemoryMatchStore(); await store.create(recordFixture()); let now = 100;
  const published: unknown[] = [];
  const service = new ExchangeService({ store, clock: () => now, publish: snapshot => { published.push(snapshot); } });
  return { store, service, published, setNow: (value: number) => { now = value; } };
}
test('exchange parsing is strict, bounded, versioned and reconstructs allowed action fields', () => {
  expect(parseExchangeCommand(envelope()).ok).toBe(true);
  for (const value of [null, { ...envelope(), actorId: 'evil' }, envelope('x'.repeat(2049)), { ...envelope(), expectedRevision: -1 }, envelope('bad', 2, { type: 'offer', counterpart: 'Z' }), envelope('bad', 2, { type: 'offer', counterpart: 'B', ownerId: 'evil' }), envelope('bad', 2, { type: 'accept', offerId: 'x', throne: [0, 0] }), envelope('bad', 2, { type: 'accept', offerId: '' }), { ...envelope(), protocolVersion: 8 }]) expect(parseExchangeCommand(value).ok).toBe(false);
});
test('offer and accept are durable, privately bound, actor-deduplicated before revision and publicly projected', async () => {
  const { store, service, published } = await fixture();
  const initial = publicSnapshot((await store.load('exchange-1'))!); expect(initial.exchangeAvailable).toEqual({ R: 'B' });
  const initialSchema = new EnochianState(); applySnapshot(initialSchema, initial); expect(initialSchema.seats.get('R')?.exchangeCounterpart).toBe('B');
  const offered = await service.execute(actor(), envelope()); expect(offered.ok).toBe(true); expect(offered.snapshot?.exchangeOffer?.id).toBe('offer-1');
  expect(JSON.stringify(offered)).not.toContain('private-'); expect((await store.load('exchange-1'))?.revision).toBe(3);
  expect(offered.snapshot?.exchangeAvailable).toEqual({});
  expect(await service.execute(actor(), envelope())).toEqual(offered); expect(published).toHaveLength(1);
  expect((await service.execute(actor(), envelope('offer-1', 2, { type: 'reject', offerId: 'offer-1' }))).code).toBe('request_conflict');
  expect((await service.execute(actor('Y'), envelope())).ok).toBe(false);
  const accepted = await service.execute(actor('B'), envelope('accept-1', 3, { type: 'accept', offerId: 'offer-1' })); expect(accepted.ok).toBe(true);
  expect(accepted.snapshot?.alive.Y).toBe(true); expect(accepted.snapshot?.alive.K).toBe(true); expect(accepted.snapshot?.exchangeOffer).toBeNull();
  expect(await service.execute(actor('B'), envelope('accept-1', 3, { type: 'accept', offerId: 'offer-1' }))).toEqual(accepted);
  const schema = new EnochianState(); applySnapshot(schema, offered.snapshot!);
  expect(schema.exchangeId).toBe('offer-1'); expect(JSON.stringify(schema.toJSON())).not.toContain('private-');
  applySnapshot(schema, accepted.snapshot!); expect(schema.exchangeId).toBe('');
});
test('CAS makes racing distinct acceptance commands commit exactly once across services', async () => {
  const { store, service } = await fixture(); await service.execute(actor(), envelope());
  const other = new ExchangeService({ store, clock: () => 101 });
  const results = await Promise.all([service.execute(actor('B'), envelope('accept-a', 3, { type: 'accept', offerId: 'offer-1' })), other.execute(actor('B'), envelope('accept-b', 3, { type: 'accept', offerId: 'offer-1' }))]);
  expect(results.filter(result => result.ok)).toHaveLength(1); expect((await store.load('exchange-1'))?.revision).toBe(4);
});
test('strict delayed expiry persists clearance and a stale incoming command cannot restore kings', async () => {
  const { store, service, setNow } = await fixture(); await service.execute(actor(), envelope());
  setNow(60099); await service.expire('exchange-1'); expect((await store.load('exchange-1'))?.revision).toBe(3);
  setNow(60100); expect((await service.execute(actor('B'), envelope('late', 3, { type: 'accept', offerId: 'offer-1' }))).ok).toBe(false);
  await service.expire('exchange-1'); const record = (await store.load('exchange-1')) as ExchangeRecord;
  expect(record.exchangeOffer).toBeNull(); expect(record.engine.alive.Y).toBe(false); expect(record.engine.alive.K).toBe(false);
});
test('canonical moves invalidate offers and canonical king captures persist the ledger in same revision', async () => {
  const { store, service } = await fixture(); await service.execute(actor(), envelope());
  const moves = new CommandProcessor({ store, clock: () => 101 });
  expect((await moves.execute(actor(), envelope('move', 3, { type: 'move', fr: 7, fc: 7, tr: 6, tc: 7 }))).ok).toBe(true);
  expect(((await store.load('exchange-1')) as ExchangeRecord).exchangeOffer).toBeNull();
  const captured = recordFixture(); captured.matchId = 'capture'; captured.prisoners = {}; captured.revision = 0; captured.engine.moveCount = 0;
  captured.engine.alive = { R: true, B: true, Y: true, K: true };
  captured.engine.board['6,7'] = { color: 'K', type: 'KING' }; captured.engine.board['0,-1'] = { color: 'Y', type: 'KING' };
  await store.create(captured);
  const result = await moves.execute(actor(), { ...envelope('capture', 0, { type: 'move', fr: 7, fc: 7, tr: 6, tc: 7 }), matchId: 'capture' });
  expect(result.ok).toBe(true); expect(((await store.load('capture')) as ExchangeRecord).prisoners?.K).toMatchObject({ captor: 'R', king: 'K', capturedRevision: 1 });
});
test('disconnect clears an offer and committed terminal result denies acceptance without mutation', async () => {
  const { store, service } = await fixture(); await service.execute(actor(), envelope());
  const next = (await store.load('exchange-1')) as ExchangeRecord;
  expect(departCasual(next, 'R', 102)).toBe(true); expect(next.exchangeOffer).toBeNull();
  next.phase = 'finished'; next.engine.over = true; next.terminalResult = { kind: 'victory', winningTeam: 2, reason: null }; next.revision++;
  await store.commit({ matchId: next.matchId, expectedRevision: 3, next, events: [], command: { actorId: 'lifecycle', requestId: 'end', fingerprint: 'end', result: { ok: true, code: 'accepted', retryable: false }, committedAt: 102 } });
  const before = await store.load(next.matchId);
  expect((await service.execute(actor('B'), envelope('race', 4, { type: 'accept', offerId: 'offer-1' }))).code).toBe('invalid_phase'); expect(await store.load(next.matchId)).toEqual(before);
});
test('unsafe placement rejects without committing any partial exchange or revealing storage errors', async () => {
  const { store, service } = await fixture(); const record = recordFixture(); record.matchId = 'blocked';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) record.engine.board[`${r},${c}`] ??= { color: 'R', type: 'BLOCKER' };
  record.engine.board['0,-1'] = { color: 'R', type: 'BLOCKER' }; record.engine.board['8,0'] = { color: 'R', type: 'BLOCKER' }; await store.create(record);
  await service.execute(actor(), { ...envelope(), matchId: 'blocked' }); const before = await store.load('blocked');
  const result = await service.execute(actor('B'), { ...envelope('accept', 3, { type: 'accept', offerId: 'offer-1' }), matchId: 'blocked' });
  expect(result.code).toBe('placement_failed'); expect(result.reason).toBe('no_safe_pair'); expect(await store.load('blocked')).toEqual(before);
  store.commit = async () => { throw new Error('private-credentials'); };
  const failure = await service.execute(actor(), envelope()); expect(failure.code).toBe('storage_unavailable'); expect(JSON.stringify(failure)).not.toContain('private-');
});
test('canonical terminal move committed before acceptance leaves outcome final and kings frozen', async () => {
  const record = recordFixture(); record.engine.turnIndex = 1; record.engine.board['7,6'] = { color: 'B', type: 'ROOK' };
  const store = new MemoryMatchStore(); await store.create(record);
  const service = new ExchangeService({ store, clock: () => 100 }); expect((await service.execute(actor(), envelope())).ok).toBe(true);
  const moves = new CommandProcessor({ store, clock: () => 101 });
  const terminal = await moves.execute(actor('B'), envelope('final-capture', 3, { type: 'move', fr: 7, fc: 6, tr: 7, tc: 7 }));
  expect(terminal.snapshot?.phase).toBe('finished'); expect(terminal.snapshot?.terminalResult?.winningTeam).toBe(2);
  expect((await service.execute(actor('B'), envelope('too-late', 4, { type: 'accept', offerId: 'offer-1' }))).code).toBe('invalid_phase');
  expect((await store.load(record.matchId))?.engine.alive).toEqual({ R: false, B: true, Y: false, K: false });
});
test('recovery claim durably invalidates a pending offer while preserving the capture ledger and board', async () => {
  const record = Object.assign(recordFixture(), { lobby: { inviteCode: 'TEST01', hostOwnerId: 'private-R', roomId: 'old-room', owners: {} }, service: { instanceId: 'old', observedAt: 100 } }) as RecoveryRecord;
  const store = new MemoryLobbyStore(); await store.create(record);
  const service = new ExchangeService({ store, clock: () => 100 }); expect((await service.execute(actor(), envelope())).ok).toBe(true);
  const before = (await store.load(record.matchId))!;
  const recovery = new RecoveryCoordinator({ store, instanceId: 'new', clock: () => 200 });
  const claimed = await recovery.claim(record.matchId, 100, 'new-room');
  expect(claimed.phase).toBe('paused'); expect(claimed.exchangeOffer).toBeNull(); expect(claimed.prisoners).toEqual(before.prisoners); expect(claimed.engine).toEqual(before.engine);
  expect((await store.load(record.matchId))?.exchangeOffer).toBeNull();
});
