import { MemoryMatchStore } from './MemoryMatchStore.js';
import type { LobbyRecord, LobbyStore } from './LobbyStore.js';
import type { MatchRecord } from '../domain/match.js';

/** Memory test adapter. Reservation is made synchronously before yielding. */
export class MemoryLobbyStore extends MemoryMatchStore implements LobbyStore {
  private invites = new Map<string, string>();
  async createInvited(record: LobbyRecord): Promise<boolean> {
    if (this.invites.has(record.lobby.inviteCode)) return false;
    this.invites.set(record.lobby.inviteCode, record.matchId);
    try { await super.create(record); } catch (error) { this.invites.delete(record.lobby.inviteCode); throw error; }
    return true;
  }
  async loadByInvite(code: string): Promise<LobbyRecord | null> {
    const matchId = this.invites.get(code);
    return matchId ? await this.load(matchId) as LobbyRecord | null : null;
  }
  async listRecoverable(): Promise<MatchRecord[]> {
    const records = await Promise.all([...this.invites.values()].map(matchId => this.load(matchId)));
    return records.filter((record): record is MatchRecord => record !== null && record.phase !== 'finished' && record.phase !== 'void');
  }
}
