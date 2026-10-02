import type { MatchRecord } from '../domain/match.js';
import type { MatchStore } from './MatchStore.js';

/** Trusted identity adapter output. Never populate from a client body/accountId. */
export interface VerifiedAuth { accountId: string }
export interface GuestOwnership { credentialHash: string; connectionId: string | null; accountId: string | null }
export interface LobbyRecord extends MatchRecord {
  lobby: { inviteCode: string; roomId: string | null; owners: Record<string, GuestOwnership> };
}
export interface LobbyStore extends MatchStore {
  /** Atomically inserts snapshot and unique code reservation; false only on collision. */
  createInvited(record: LobbyRecord): Promise<boolean>;
  loadByInvite(code: string): Promise<LobbyRecord | null>;
  listRecoverable(): Promise<MatchRecord[]>;
}
