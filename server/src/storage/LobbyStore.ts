import type { MatchRecord, Phase } from '../domain/match.js';
import type { MatchStore } from './MatchStore.js';

/** Trusted identity adapter output. Never populate from a client body/accountId. */
export interface VerifiedAuth { accountId: string }
export interface GuestOwnership { credentialHash: string; connectionId: string | null; accountId: string | null }
export interface LobbyRecord extends MatchRecord {
  lobby: { inviteCode: string; roomId: string | null; owners: Record<string, GuestOwnership> };
}
/** Scheduling hints only. Mutation paths must still reload and verify ownership/revision. */
export interface MaintenanceHead { revision: number; phase: Phase; nextDeadline: number | null; serviceInstanceId: string | null }
export interface LifecycleDue { matchId: string; kind: 'lobby' | 'recovery'; deadline: number }
export interface LobbyStore extends MatchStore {
  /** Atomic global lobby admission, snapshot and unique code; false only on collision, lobby_capacity when full. */
  createInvited(record: LobbyRecord): Promise<boolean>;
  loadByInvite(code: string): Promise<LobbyRecord | null>;
  listRecoverable(): Promise<MatchRecord[]>;
  maintenanceHead(matchId: string): Promise<MaintenanceHead | null>;
  listLifecycleDue(now: number, limit?: number, instanceId?: string): Promise<LifecycleDue[]>;
}
