import { COLORS, type Color, type MatchRecord } from './match.js';
import { rankedRoster, isUnstartedVoid } from './ranked-admission.js';
import { canonicalEngine } from '../engine.js';
import type { RecoveryRecord } from '../recovery/RecoveryCoordinator.js';

export const RANKED_ABSENCE_MS = 300000;
export const RANKED_RESTRICTION_MS = 600000;
export const INITIAL_RATING = 1200;
export const RATING_K = 32;
export type RankedRecord = MatchRecord & Pick<RecoveryRecord, 'absence' | 'expiredDepartures' | 'recovery'>;
const terminal = (record: MatchRecord) => record.phase === 'finished' || record.phase === 'void' || !!record.terminalResult;
const validTime = (now: number) => Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(now + RANKED_RESTRICTION_MS);
const humans = (record: MatchRecord) => COLORS.every(color => record.seats[color].ownerId && record.seats[color].controller === 'human') && new Set(COLORS.map(color => record.seats[color].ownerId)).size === 4;
function ledger(record: RankedRecord, color: Color) {
  record.absence ??= {};
  return record.absence[color] ??= { usedMs: 0, departedAt: null };
}
function settle(record: RankedRecord, color: Color, now: number) {
  const entry = ledger(record, color);
  if (entry.departedAt !== null) entry.usedMs = Math.min(RANKED_ABSENCE_MS, entry.usedMs + Math.max(0, now - entry.departedAt));
  entry.departedAt = null;
}
function voidMatch(record: RankedRecord, now: number, reason: 'abandonment' | 'service_outage', offenders: Color[]) {
  record.phase = 'void'; record.terminalResult = { kind: 'void', winningTeam: null, reason };
  record.expiredDepartures = [...offenders];
  for (const color of COLORS) { if (!record.recovery) settle(record, color, now); record.seats[color].disconnectDeadline = null; }
  record.recoveryDeadline = null;
  delete record.recovery;
}

/** Candidate mutation only. Caller clones, commits with revision CAS, then acknowledges. */
export function departRanked(record: RankedRecord, color: Color, now: number, intentional = false): boolean {
  if (!COLORS.includes(color) || !validTime(now) || record.mode !== 'ranked' || !['active', 'paused'].includes(record.phase) || terminal(record) || record.recovery || !humans(record)) return false;
  const seat = record.seats[color];
  if (!seat.connected && !intentional) return false;
  seat.connected = false;
  if (intentional) { voidMatch(record, now, 'abandonment', [color]); return true; }
  const entry = ledger(record, color);
  if (entry.usedMs >= RANKED_ABSENCE_MS) { voidMatch(record, now, 'abandonment', [color]); return true; }
  entry.departedAt = now;
  seat.disconnectDeadline = now + RANKED_ABSENCE_MS - entry.usedMs;
  record.phase = 'paused';
  return true;
}

/** No timer assumptions: at the boundary all already-expired missing players are recorded. */
export function expireRanked(record: RankedRecord, now: number): Color[] {
  if (!validTime(now) || record.mode !== 'ranked' || terminal(record) || record.phase !== 'paused') return [];
  if (record.recovery) {
    if (now >= record.recovery.deadline) voidMatch(record, now, 'service_outage', []);
    return [];
  }
  const offenders = COLORS.filter(color => !record.seats[color].connected && record.seats[color].disconnectDeadline !== null && now >= record.seats[color].disconnectDeadline!);
  if (offenders.length) voidMatch(record, now, 'abandonment', offenders);
  return offenders;
}

export type RankedReclaimStatus = 'reclaimed' | 'expired' | 'terminal' | 'unauthorized' | 'invalid_phase';
export function reclaimRanked(record: RankedRecord, color: Color, ownerId: string, now: number): RankedReclaimStatus {
  if (!COLORS.includes(color) || !ownerId || record.seats[color].ownerId !== ownerId) return 'unauthorized';
  if (terminal(record)) return 'terminal';
  if (!validTime(now) || record.mode !== 'ranked' || record.phase !== 'paused' || record.recovery || !humans(record)) return 'invalid_phase';
  const seat = record.seats[color];
  if (expireRanked(record, now).length) return 'expired';
  if (seat.connected || seat.disconnectDeadline === null || now >= seat.disconnectDeadline) return 'unauthorized';
  settle(record, color, now);
  seat.connected = true; seat.disconnectDeadline = null;
  if (COLORS.every(candidate => record.seats[candidate].connected)) record.phase = 'active';
  return 'reclaimed';
}

/** RecoveryCoordinator supplies the last observed service cutoff, not restart time. */
export function freezeRankedAbsence(record: RankedRecord, cutoff: number): void {
  if (record.mode !== 'ranked' || !validTime(cutoff)) return;
  for (const color of COLORS) if (record.absence?.[color]) settle(record, color, cutoff);
}
export function returnedRankedOwner(record: RankedRecord, color: Color): void {
  if (record.mode === 'ranked') ledger(record, color).departedAt = null;
}

export interface RankedAccountRating { accountId: string; rating?: number }
export interface RankedSettlementEntry {
  color: Color; accountId: string; previousRating: number; delta: number; rating: number;
  /** Null means no new restriction; it never clears a pre-existing account restriction. */
  restrictionUntil: number | null;
}
export interface RankedSettlementPlan {
  matchId: string; kind: 'victory' | 'draw' | 'void'; settledAt: number; offenders: Color[]; entries: RankedSettlementEntry[];
}
/** Pure proposal: durable unique match settlement, locking and atomic writes belong to the store. */
export function buildRankedSettlement(record: RankedRecord, accounts: Partial<Record<Color, RankedAccountRating>>, now: number): RankedSettlementPlan {
  if (record.mode !== 'ranked' || !validTime(now) || !terminal(record) || !record.terminalResult) throw new Error('invalid_phase');
  const roster = rankedRoster(record);
  const unstarted = isUnstartedVoid(record);
  if ((!unstarted && roster.length !== 4) || roster.some(seat => accounts[seat.color]?.accountId !== seat.accountId)) throw new Error('unauthorized');
  const ratings = Object.fromEntries(roster.map(({ color }) => [color, accounts[color]!.rating ?? INITIAL_RATING])) as Record<Color, number>;
  if (roster.some(({ color }) => !Number.isSafeInteger(ratings[color]))) throw new Error('invalid_rating');
  const result = record.terminalResult;
  let redDelta = 0;
  if (result.kind === 'victory') {
    const redTeam = canonicalEngine.TEAM.R, blueTeam = canonicalEngine.TEAM.B;
    if (result.winningTeam !== redTeam && result.winningTeam !== blueTeam) throw new Error('invalid_result');
    const redMean = ratings.R / 2 + ratings.Y / 2, blueMean = ratings.B / 2 + ratings.K / 2;
    const expectedWinner = 1 / (1 + 10 ** ((result.winningTeam === redTeam ? blueMean - redMean : redMean - blueMean) / 400));
    const winnerDelta = Math.round(RATING_K * (1 - expectedWinner));
    redDelta = result.winningTeam === redTeam ? winnerDelta : -winnerDelta;
  } else if (result.kind === 'draw') {
    if (result.winningTeam !== null || !['bare_kings','stalemate'].includes(result.reason ?? '')) throw new Error('invalid_result');
    const redMean = ratings.R / 2 + ratings.Y / 2, blueMean = ratings.B / 2 + ratings.K / 2;
    const expectedRed = 1 / (1 + 10 ** ((blueMean - redMean) / 400));
    redDelta = Math.round(RATING_K * (0.5 - expectedRed));
  }
  const offenders = result.kind === 'void' && result.reason === 'abandonment' ? COLORS.filter(color => record.expiredDepartures?.includes(color)) : [];
  const entries = roster.map(({ color }) => {
    const delta = (result.kind === 'victory' || result.kind === 'draw' ? (color === 'R' || color === 'Y' ? redDelta : -redDelta) : offenders.includes(color) ? -RATING_K : 0) || 0;
    const rating = ratings[color] + delta;
    if (!Number.isSafeInteger(rating)) throw new Error('invalid_rating');
    return { color, accountId: accounts[color]!.accountId, previousRating: ratings[color], delta, rating, restrictionUntil: offenders.includes(color) ? now + RANKED_RESTRICTION_MS : null };
  });
  return { matchId: record.matchId, kind: result.kind, settledAt: now, offenders, entries };
}
export function rankedEntryAllowed(restrictionUntil: number | null, now: number): boolean {
  return validTime(now) && (restrictionUntil === null || (Number.isSafeInteger(restrictionUntil) && now >= restrictionUntil));
}
