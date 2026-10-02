import { MemoryMatchStore } from './MemoryMatchStore.js';
import type { LobbyRecord, LobbyStore, LifecycleDue, MaintenanceHead } from './LobbyStore.js';
import type { MatchRecord } from '../domain/match.js';
import { lobbyCapacity, LobbyCapacityError } from './lobby-capacity.js';
import { maintenanceLimit, maintenanceTime, recordMaintenanceHead } from './maintenance.js';

/** Memory test adapter. Reservation is made synchronously before yielding. */
export class MemoryLobbyStore extends MemoryMatchStore implements LobbyStore {
  private invites = new Map<string, string>();
  private readonly maxUnstartedLobbies: number;
  constructor(options: { maxCommandsPerMatch?: number; maxMatches?: number; maxUnstartedLobbies?: number } = {}) {
    super(options);
    this.maxUnstartedLobbies = lobbyCapacity(options.maxUnstartedLobbies);
  }
  async createInvited(record: LobbyRecord): Promise<boolean> {
    if (this.invites.has(record.lobby.inviteCode)) return false;
    // Count and super.create's mutation both occur before the first await.
    if (record.phase === 'lobby' && this.countPhase('lobby') >= this.maxUnstartedLobbies) throw new LobbyCapacityError();
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
  async maintenanceHead(matchId: string): Promise<MaintenanceHead | null> {
    for (const record of this.storedRecords()) if (record.matchId === matchId) return recordMaintenanceHead(record);
    return null;
  }
  async listLifecycleDue(now: number, limit = 64, instanceId?: string): Promise<LifecycleDue[]> {
    maintenanceTime(now); maintenanceLimit(limit);
    const due: LifecycleDue[] = [];
    for (const record of this.storedRecords()) {
      if (instanceId !== undefined && recordMaintenanceHead(record).serviceInstanceId !== instanceId) continue;
      const kind = record.phase === 'lobby' ? 'lobby' : record.phase === 'paused' ? 'recovery' : null;
      const deadline = kind === 'lobby' ? record.lobbyDeadline : kind === 'recovery' ? record.recoveryDeadline : null;
      if (kind && deadline !== null && deadline <= now) due.push({ matchId: record.matchId, kind, deadline });
    }
    return due.sort((a, b) => a.deadline - b.deadline || a.matchId.localeCompare(b.matchId)).slice(0, limit);
  }
}
