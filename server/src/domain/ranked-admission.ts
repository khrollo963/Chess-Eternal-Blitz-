import { COLORS, type Color, type MatchRecord } from './match.js';
import type { LobbyRecord } from '../storage/LobbyStore.js';

export type AdmissionCode = 'unauthorized' | 'duplicate_account' | 'ranked_match_locked' | 'ranked_cooldown' | 'invalid_phase';
/** Only these deliberately public domain failures may cross the database boundary. */
export class AdmissionError extends Error {
  constructor(readonly code: AdmissionCode) { super(code); }
}
export interface RankedSeat { color: Color; accountId: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Identity values here are private adapter output, never a request body field. */
export function rankedRoster(record: MatchRecord, previous?: MatchRecord | null): RankedSeat[] {
  if (record.mode !== 'ranked') return [];
  const metadata = (record as Partial<LobbyRecord>).lobby;
  if (!metadata) throw new AdmissionError('unauthorized');
  const roster: RankedSeat[] = [];
  for (const color of COLORS) {
    const seat = record.seats[color];
    if (!seat.ownerId) continue;
    const accountId = metadata.owners[seat.ownerId]?.accountId;
    if (!accountId || !uuid.test(accountId) || seat.controller !== 'human') throw new AdmissionError('unauthorized');
    roster.push({ color, accountId });
  }
  if (new Set(roster.map(seat => seat.accountId)).size !== roster.length) throw new AdmissionError('duplicate_account');
  const started = record.phase === 'active' || record.phase === 'paused' || record.phase === 'finished';
  if (started && roster.length !== 4) throw new AdmissionError('invalid_phase');
  if (previous?.phase === 'lobby' && record.phase === 'active' &&
      COLORS.some(color => !record.seats[color].connected || !record.seats[color].ready)) throw new AdmissionError('invalid_phase');
  if (previous && previous.phase !== 'lobby') {
    const old = rankedRoster(previous);
    if (JSON.stringify(old) !== JSON.stringify(roster)) throw new AdmissionError('invalid_phase');
  }
  return roster;
}

export function isUnstartedVoid(record: MatchRecord, previous?: MatchRecord | null): boolean {
  return record.phase === 'void' && (previous?.phase === 'lobby' ||
    ['lobby_expired', 'transport_creation_failed'].includes(record.terminalResult?.reason ?? ''));
}
