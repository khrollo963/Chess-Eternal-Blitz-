import type { MatchRecord, PublicSnapshot } from '../domain/match.js';

export type CommandCode = 'accepted' | 'invalid_command' | 'incompatible_version' | 'unauthorized' |
  'not_found' | 'request_conflict' | 'stale_revision' | 'invalid_phase' | 'wrong_seat' |
  'out_of_turn' | 'frozen_army' | 'illegal_move' | 'storage_unavailable' | 'command_capacity' | 'deadline_expired' | 'ranked_cooldown' | 'ranked_match_locked' |
  'placement_failed' | 'no_offer' | 'offer_pending';
export interface CommandResult {
  ok: boolean; code: CommandCode; requestId?: string; retryable: boolean;
  snapshot?: PublicSnapshot;
  reason?: 'no_safe_pair';
}
export interface StoredCommand {
  actorId: string; requestId: string; fingerprint: string; result: CommandResult; committedAt: number;
}
export interface MatchCommit {
  matchId: string; expectedRevision: number; next: MatchRecord;
  command: StoredCommand; events: unknown[];
}
export type CommitResult = { status: 'committed' } | { status: 'duplicate'; command: StoredCommand } |
  { status: 'conflict' } | { status: 'capacity' };
/** Implementations atomically save successor, events/deadlines and dedup acknowledgement.
 * actorId and all private seat fields belong only in private storage, never room metadata.
 */
export interface MatchStore {
  create(record: MatchRecord): Promise<void>;
  load(matchId: string): Promise<MatchRecord | null>;
  findCommand(matchId: string, actorId: string, requestId: string): Promise<StoredCommand | null>;
  commit(input: MatchCommit): Promise<CommitResult>;
}
