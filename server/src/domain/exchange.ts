import { canonicalEngine } from '../engine.js';
import { COLORS, type Color, type Controller, type EngineState, type MatchRecord } from './match.js';

export const EXCHANGE_OFFER_MS = 60000;
export interface Square { r: number; c: number }
export const THRONES: Readonly<Record<Color, Readonly<Square>>> = Object.freeze({
  Y: Object.freeze({ r: 0, c: -1 }), B: Object.freeze({ r: -1, c: 7 }),
  R: Object.freeze({ r: 7, c: 8 }), K: Object.freeze({ r: 8, c: 0 }),
});
export interface Prisoner {
  id: string; king: Color; captor: Color; capturedRevision: number; capturedMoveCount: number;
  kingOwnerId: string | null; captorOwnerId: string | null;
}
export interface ExchangeOffer {
  id: string; proposer: Color; counterpart: Color; guardRevision: number; expiresAt: number;
  prisoners: [Prisoner, Prisoner];
}
/** Private extension: never spread these identity bindings into synchronized state. */
export type ExchangeRecord = MatchRecord & {
  prisoners?: Partial<Record<Color, Prisoner>>; exchangeOffer?: ExchangeOffer | null;
};
/** Server-supplied context only, not an untrusted client action. */
export interface ExchangeActor {
  actorId: string; seat: Color; controller: Controller; multiplayer: boolean;
  expectedRevision: number; now: number;
}
export type ExchangeStatus = 'offered' | 'accepted' | 'rejected' | 'local_mode' | 'invalid_phase' |
  'stale_revision' | 'unauthorized' | 'wrong_captor' | 'frozen_captor' | 'ineligible_captor' |
  'invalid_prisoners' | 'out_of_turn' | 'offer_pending' | 'invalid_offer' | 'no_offer' |
  'stale_offer' | 'expired' | 'placement_failed';
export interface ExchangeResult {
  status: ExchangeStatus; reason?: 'no_safe_pair'; placements?: Partial<Record<Color, Square>>;
}
export type ExchangeInvalidation = 'move' | 'control_change' | 'pause' | 'end';
const key = ({ r, c }: Square) => `${r},${c}`;
const team = (color: Color): number => canonicalEngine.TEAM[color];
const ally = (color: Color): Color => COLORS.find(other => other !== color && team(other) === team(color))!;
const hasKing = (record: MatchRecord, color: Color) => Object.values(record.engine.board).some(piece => piece.color === color && piece.type === 'KING');

/** Candidate-only helpers: callers clone first and commit with revision CAS. No I/O or clocks. */
export function recordKingCaptures(record: ExchangeRecord, events: readonly unknown[], captureRevision = record.revision): void {
  for (const value of events) {
    if (!value || typeof value !== 'object') continue;
    const event = value as { type?: unknown; piece?: { color?: unknown; type?: unknown }; byColor?: unknown };
    if (event.type !== 'capture' || event.piece?.type !== 'KING' || !COLORS.includes(event.piece.color as Color) || !COLORS.includes(event.byColor as Color)) continue;
    const king = event.piece.color as Color, captor = event.byColor as Color;
    if (team(king) === team(captor) || record.engine.alive[king] || hasKing(record, king)) continue;
    const id = `${record.matchId}:${captureRevision}:${king}`;
    if (record.prisoners?.[king]?.id === id) continue;
    record.prisoners ??= {};
    record.prisoners[king] = { id, king, captor, capturedRevision: captureRevision, capturedMoveCount: record.engine.moveCount,
      kingOwnerId: record.seats[king].ownerId, captorOwnerId: record.seats[captor].ownerId };
  }
}

function guard(record: ExchangeRecord, actor: ExchangeActor): ExchangeStatus | null {
  if (!actor.multiplayer) return 'local_mode';
  if (record.phase !== 'active' || record.terminalResult || record.engine.over) return 'invalid_phase';
  if (actor.expectedRevision !== record.revision) return 'stale_revision';
  if (!COLORS.includes(actor.seat) || !actor.actorId || !Number.isSafeInteger(actor.now) || actor.now < 0 || actor.controller !== 'human' || record.seats[actor.seat].ownerId !== actor.actorId) return 'unauthorized';
  return null;
}
function captorEligibility(record: ExchangeRecord, colors: readonly Color[]): ExchangeStatus | null {
  for (const color of colors) {
    if (!record.engine.alive[color] || !hasKing(record, color)) return 'frozen_captor';
    const seat = record.seats[color];
    if (seat.controller !== 'human' || !seat.connected || !seat.ownerId) return 'ineligible_captor';
  }
  return null;
}
function prisonerValid(record: ExchangeRecord, prisoner: Prisoner): boolean {
  return !record.engine.alive[prisoner.king] && !hasKing(record, prisoner.king) &&
    record.prisoners?.[prisoner.king]?.id === prisoner.id &&
    record.prisoners[prisoner.king]?.captor === prisoner.captor &&
    record.seats[prisoner.king].ownerId === prisoner.kingOwnerId &&
    record.seats[prisoner.captor].ownerId === prisoner.captorOwnerId;
}

function qualification(record: ExchangeRecord, proposer: Color, counterpart: Color): { status: ExchangeStatus } | { prisoners: [Prisoner, Prisoner] } {
  if (!COLORS.includes(counterpart) || team(proposer) === team(counterpart)) return { status: 'wrong_captor' };
  const ownPrisoner = record.prisoners?.[ally(counterpart)], alliedPrisoner = record.prisoners?.[ally(proposer)];
  if (!ownPrisoner || !alliedPrisoner || ownPrisoner.captor !== proposer || alliedPrisoner.captor !== counterpart) return { status: 'wrong_captor' };
  const eligibility = captorEligibility(record, [proposer, counterpart]); if (eligibility) return { status: eligibility };
  if (!prisonerValid(record, ownPrisoner) || !prisonerValid(record, alliedPrisoner)) return { status: 'invalid_prisoners' };
  const immediate = ownPrisoner.capturedRevision > alliedPrisoner.capturedRevision &&
    ownPrisoner.capturedRevision === record.revision && ownPrisoner.capturedMoveCount === record.engine.moveCount;
  if (!immediate && COLORS[record.engine.turnIndex] !== proposer) return { status: 'out_of_turn' };
  const prisoners = [ownPrisoner, alliedPrisoner].sort((a, b) => COLORS.indexOf(a.king) - COLORS.indexOf(b.king)) as [Prisoner, Prisoner];
  return { prisoners };
}
/** Color-only advisory hint, derived from exactly the command eligibility rules. */
export function publicExchangeAvailable(record: ExchangeRecord): Partial<Record<Color, Color>> {
  const available: Partial<Record<Color, Color>> = {};
  if (record.phase !== 'active' || record.terminalResult || record.engine.over || (record.exchangeOffer && record.exchangeOffer.guardRevision === record.revision)) return available;
  for (const proposer of COLORS) for (const counterpart of COLORS) {
    if ('prisoners' in qualification(record, proposer, counterpart)) { available[proposer] = counterpart; break; }
  }
  return available;
}
export function offerExchange(record: ExchangeRecord, actor: ExchangeActor, input: { offerId: string; counterpart: Color }): ExchangeResult {
  const blocked = guard(record, actor); if (blocked) return { status: blocked };
  const qualified = qualification(record, actor.seat, input.counterpart); if ('status' in qualified) return qualified;
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(input.offerId) || !Number.isSafeInteger(actor.now + EXCHANGE_OFFER_MS)) return { status: 'invalid_offer' };
  if (record.exchangeOffer && actor.now < record.exchangeOffer.expiresAt && record.exchangeOffer.guardRevision === record.revision) return { status: 'offer_pending' };
  record.exchangeOffer = { id: input.offerId, proposer: actor.seat, counterpart: input.counterpart,
    guardRevision: record.revision + 1, expiresAt: actor.now + EXCHANGE_OFFER_MS, prisoners: structuredClone(qualified.prisoners) };
  return { status: 'offered' };
}

function offerGuard(record: ExchangeRecord, actor: ExchangeActor, offerId: string): ExchangeStatus | null {
  const blocked = guard(record, actor); if (blocked) return blocked;
  const offer = record.exchangeOffer;
  if (!offer || offer.id !== offerId) return 'no_offer';
  if (offer.guardRevision !== record.revision) return 'stale_offer';
  if (actor.now >= offer.expiresAt) return 'expired';
  if (actor.seat !== offer.counterpart) return 'wrong_captor';
  const eligibility = captorEligibility(record, [offer.proposer, offer.counterpart]); if (eligibility) return eligibility;
  if (!offer.prisoners.every(prisoner => prisonerValid(record, prisoner))) return 'invalid_prisoners';
  return null;
}
export function rejectExchange(record: ExchangeRecord, actor: ExchangeActor, offerId: string): ExchangeResult {
  const blocked = offerGuard(record, actor, offerId); if (blocked) return { status: blocked };
  record.exchangeOffer = null; return { status: 'rejected' };
}
export function invalidateExchange(record: ExchangeRecord, _reason: ExchangeInvalidation): boolean {
  if (!record.exchangeOffer) return false;
  record.exchangeOffer = null; return true;
}
export function expireExchange(record: ExchangeRecord, now: number): boolean {
  if (!record.exchangeOffer || !Number.isSafeInteger(now) || now < record.exchangeOffer.expiresAt) return false;
  record.exchangeOffer = null; return true;
}

function squares(state: EngineState, color: Color): Square[] {
  const throne = THRONES[color], candidates: Square[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (!state.board[`${r},${c}`]) candidates.push({ r, c });
  const distance = (square: Square) => Math.max(Math.abs(square.r - throne.r), Math.abs(square.c - throne.c));
  candidates.sort((a, b) => distance(a) - distance(b) || a.r - b.r || a.c - b.c);
  if (!state.board[key(throne)]) candidates.unshift({ ...throne });
  return candidates;
}
/** One snapshot, both armies thawed, both kings present during every canonical attack probe. */
function restoration(record: ExchangeRecord, prisoners: [Prisoner, Prisoner]): { state: EngineState; placements: Partial<Record<Color, Square>> } | null {
  const state = structuredClone(record.engine), [first, second] = prisoners.map(prisoner => prisoner.king) as [Color, Color];
  state.alive[first] = true; state.alive[second] = true;
  const enemies = (color: Color) => new Set(COLORS.filter(other => team(other) !== team(color)));
  // At most 65 candidates each: 4096 ordinary-board pairs plus external-throne
  // combinations (4225 total). Never expand the search beyond existing geometry.
  const firstSquares = squares(state, first), secondSquares = squares(state, second);
  for (const a of firstSquares) for (const b of secondSquares) {
    const aKey = key(a), bKey = key(b); if (aKey === bKey) continue;
    state.board[aKey] = { color: first, type: 'KING' }; state.board[bKey] = { color: second, type: 'KING' };
    const safe = !canonicalEngine.isSquareAttacked(state, state.board, a.r, a.c, enemies(first)) &&
      !canonicalEngine.isSquareAttacked(state, state.board, b.r, b.c, enemies(second));
    if (safe) return { state, placements: { [first]: { ...a }, [second]: { ...b } } };
    delete state.board[aKey]; delete state.board[bKey];
  }
  return null;
}
export function acceptExchange(record: ExchangeRecord, actor: ExchangeActor, offerId: string): ExchangeResult {
  const blocked = offerGuard(record, actor, offerId); if (blocked) return { status: blocked };
  const offer = record.exchangeOffer!, restored = restoration(record, offer.prisoners);
  if (!restored) return { status: 'placement_failed', reason: 'no_safe_pair' };
  record.engine = restored.state;
  for (const prisoner of offer.prisoners) delete record.prisoners![prisoner.king];
  record.exchangeOffer = null;
  return { status: 'accepted', placements: restored.placements };
}
export interface PublicExchangeOffer {
  id: string; proposer: Color; counterpart: Color; guardRevision: number; expiresAt: number; prisoners: [Color, Color];
}
/** Explicit allowlist; owner IDs and private capture identifiers are excluded. */
export function publicExchange(record: ExchangeRecord): PublicExchangeOffer | null {
  const offer = record.exchangeOffer;
  return offer ? { id: offer.id, proposer: offer.proposer, counterpart: offer.counterpart,
    guardRevision: offer.guardRevision, expiresAt: offer.expiresAt, prisoners: [offer.prisoners[0].king, offer.prisoners[1].king] } : null;
}
