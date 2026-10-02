import { COLORS, publicSnapshot, type PublicSnapshot } from './match.js';
import { departRanked, expireRanked, reclaimRanked, type RankedRecord } from './ranked.js';
import { invalidateExchange } from './exchange.js';
import type { LobbyService } from './lobby.js';
import type { LobbyRecord, LobbyStore } from '../storage/LobbyStore.js';
import { opaqueToken } from '../identity/guest.js';

type Record = LobbyRecord & RankedRecord & { pendingSettlement?: boolean };
/** Ranked players retain human control. All timeline decisions share move revision CAS. */
export class RankedService {
  constructor(private options: { store: LobbyStore; lobby: LobbyService; clock?: () => number;
    publish?: (snapshot: PublicSnapshot) => void | Promise<void> }) {}
  private now() { return (this.options.clock ?? Date.now)(); }
  async expire(matchId: string): Promise<void> {
    for (let attempt = 0; attempt < 16; attempt++) {
      const record = await this.options.store.load(matchId) as Record | null;
      if (!record || record.mode !== 'ranked') return;
      const phase = record.phase;
      expireRanked(record, this.now());
      if (phase === record.phase) return;
      if (await this.save(record, 'ranked_expired')) return;
    }
    throw new Error('storage_unavailable');
  }
  async connect(matchId: string, credential: unknown, connectionId: string) {
    await this.expire(matchId);
    for (let attempt = 0; attempt < 16; attempt++) {
      const { record: base, owner, ownerId, color } = await this.options.lobby.authenticate(matchId, credential);
      const record = base as Record;
      if (record.phase === 'lobby') return this.options.lobby.connect(matchId, credential, connectionId);
      if (owner.connectionId !== null) throw new Error('duplicate_connection');
      const result = reclaimRanked(record, color, ownerId, this.now());
      if (result !== 'reclaimed') {
        if (result === 'expired') await this.expire(matchId);
        throw new Error(result === 'expired' || result === 'terminal' ? 'deadline_expired' : result === 'unauthorized' ? 'unauthorized' : 'invalid_phase');
      }
      owner.connectionId = connectionId;
      if (await this.save(record, 'ranked_return')) return {
        actor: { actorId: ownerId, seat: color, controller: 'human' as const }, snapshot: publicSnapshot(record),
      };
    }
    throw new Error('storage_unavailable');
  }
  async depart(matchId: string, connectionId: string, intentional: boolean): Promise<boolean> {
    await this.expire(matchId);
    for (let attempt = 0; attempt < 16; attempt++) {
      const record = await this.options.store.load(matchId) as Record | null;
      if (!record || record.mode !== 'ranked' || !['active', 'paused'].includes(record.phase)) return false;
      const ownerId = Object.keys(record.lobby.owners).find(id => record.lobby.owners[id]?.connectionId === connectionId);
      if (!ownerId) return true;
      const color = COLORS.find(candidate => record.seats[candidate].ownerId === ownerId);
      if (!color || !departRanked(record, color, this.now(), intentional)) return false;
      record.lobby.owners[ownerId]!.connectionId = null;
      if (await this.save(record, intentional ? 'ranked_leave' : 'ranked_drop')) return true;
    }
    throw new Error('storage_unavailable');
  }
  private async save(record: Record, event: string): Promise<boolean> {
    invalidateExchange(record, record.terminalResult ? 'end' : 'pause');
    if (record.terminalResult) record.pendingSettlement = true;
    const expectedRevision = record.revision; record.revision++;
    const requestId = opaqueToken(), snapshot = publicSnapshot(record);
    const committed = await this.options.store.commit({ matchId: record.matchId, expectedRevision, next: record, events: [{ type: event }],
      command: { actorId: 'ranked_lifecycle', requestId, fingerprint: requestId, committedAt: this.now(),
        result: { ok: true, code: 'accepted', retryable: false, snapshot } } });
    if (committed.status === 'conflict') return false;
    if (committed.status !== 'committed') throw new Error('storage_unavailable');
    try { await this.options.publish?.(snapshot); } catch { /* committed state resynchronizes */ }
    return true;
  }
}
