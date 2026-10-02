import { COLORS, type Color, type MatchRecord } from './match.js';

export const CASUAL_ABSENCE_MS = 180000;
export interface Absence { usedMs: number; departedAt: number | null }
export type CasualRecord = MatchRecord & { absence?: Partial<Record<Color, Absence>> };
const terminal = (record: MatchRecord) => record.phase === 'finished' || record.phase === 'void' || !!record.terminalResult;
function ledger(record: CasualRecord, color: Color): Absence {
  record.absence ??= {};
  return record.absence[color] ??= { usedMs: 0, departedAt: null };
}
/** Candidate-only helpers. Callers must persist their clone with revision CAS. */
export function settleAbsence(record: CasualRecord, color: Color, now: number): void {
  const entry = ledger(record, color);
  if (entry.departedAt !== null) entry.usedMs = Math.min(CASUAL_ABSENCE_MS, entry.usedMs + Math.max(0, now - entry.departedAt));
  entry.departedAt = null;
}
export function departCasual(record: CasualRecord, color: Color, now: number, intentional = false): boolean {
  const seat = record.seats[color];
  if (record.mode !== 'casual' || record.phase !== 'active' || terminal(record) || seat.controller !== 'human' || !seat.ownerId || !seat.connected) return false;
  const entry = ledger(record, color);
  seat.connected = false;
  if (intentional || entry.usedMs >= CASUAL_ABSENCE_MS) {
    entry.usedMs = CASUAL_ABSENCE_MS; entry.departedAt = null; seat.controller = 'bot'; seat.disconnectDeadline = null;
  } else {
    entry.departedAt = now; seat.controller = 'temporary_bot'; seat.disconnectDeadline = now + CASUAL_ABSENCE_MS - entry.usedMs;
  }
  return true;
}
export function expireCasual(record: CasualRecord, now: number): Color[] {
  if (record.mode !== 'casual' || record.phase !== 'active' || terminal(record)) return [];
  return COLORS.filter(color => {
    const seat = record.seats[color];
    if (seat.controller !== 'temporary_bot' || seat.disconnectDeadline === null || now < seat.disconnectDeadline) return false;
    settleAbsence(record, color, now); ledger(record, color).usedMs = CASUAL_ABSENCE_MS;
    seat.controller = 'bot'; seat.disconnectDeadline = null; return true;
  });
}
export function reclaimCasual(record: CasualRecord, color: Color, ownerId: string, now: number): 'reclaimed' | 'expired' | 'terminal' | 'unauthorized' | 'invalid_phase' {
  const seat = record.seats[color];
  if (!ownerId || seat.ownerId !== ownerId) return 'unauthorized';
  if (terminal(record)) return 'terminal';
  if (record.mode !== 'casual' || record.phase !== 'active') return 'invalid_phase';
  expireCasual(record, now);
  if (seat.controller === 'bot') return 'expired';
  if (seat.controller !== 'temporary_bot' || seat.disconnectDeadline === null || now >= seat.disconnectDeadline) return 'unauthorized';
  settleAbsence(record, color, now); seat.controller = 'human'; seat.connected = true; seat.disconnectDeadline = null;
  return 'reclaimed';
}
export function freezeAbsence(record: CasualRecord, cutoff: number): void {
  if (record.mode !== 'casual') return;
  for (const color of COLORS) if (record.absence?.[color]) settleAbsence(record, color, cutoff);
}
export function returnedOwner(record: CasualRecord, color: Color): void {
  if (record.mode === 'casual') ledger(record, color).departedAt = null;
}
/** Internal identities have no public credential and are never accepted from clients. */
export function initializeBotOwners(record: MatchRecord): void {
  if (record.mode !== 'casual') return;
  for (const color of COLORS) {
    const seat = record.seats[color];
    if (seat.controller === 'bot' && !seat.ownerId) seat.ownerId = `server-bot:${record.matchId}:${color}`;
  }
}
