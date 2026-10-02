import { COLORS, publicSnapshot, type PublicSnapshot } from './match.js';
import { departCasual, expireCasual, reclaimCasual, type CasualRecord } from './casual.js';
import type { LobbyService } from './lobby.js';
import type { LobbyRecord, LobbyStore } from '../storage/LobbyStore.js';
import { opaqueToken } from '../identity/guest.js';

type Record = LobbyRecord & CasualRecord;
/** All lifecycle changes use the same revision fence as canonical moves. */
export class CasualService {
  constructor(private options: { store: LobbyStore; lobby: LobbyService; clock?: () => number; publish?: (snapshot: PublicSnapshot) => void | Promise<void> }) {}
  private now() { return (this.options.clock ?? Date.now)(); }
  async expire(matchId: string): Promise<void> {
    for (let attempt = 0; attempt < 16; attempt++) {
      const record = await this.options.store.load(matchId) as Record | null;
      if (!record || !expireCasual(record, this.now()).length) return;
      if (await this.save(record, 'casual_expired')) return;
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
      const result = reclaimCasual(record, color, ownerId, this.now());
      // A delayed callback cannot grant a session on or after the absolute boundary.
      if (result !== 'reclaimed') {
        if (result === 'expired') await this.expire(matchId);
        throw new Error(result === 'expired' ? 'deadline_expired' : result === 'unauthorized' ? 'unauthorized' : 'invalid_phase');
      }
      owner.connectionId = connectionId;
      if (await this.save(record, 'casual_return')) return { actor: { actorId: ownerId, seat: color, controller: 'human' as const }, snapshot: publicSnapshot(record) };
    }
    throw new Error('storage_unavailable');
  }
  async depart(matchId: string, connectionId: string, intentional: boolean): Promise<boolean> {
    await this.expire(matchId);
    for (let attempt = 0; attempt < 16; attempt++) {
      const record = await this.options.store.load(matchId) as Record | null;
      if (!record || record.mode !== 'casual' || record.phase !== 'active') return false;
      const ownerId = Object.keys(record.lobby.owners).find(id => record.lobby.owners[id]?.connectionId === connectionId);
      if (!ownerId) return true;
      const color = COLORS.find(color => record.seats[color].ownerId === ownerId);
      if (!color || !departCasual(record, color, this.now(), intentional)) return true;
      record.lobby.owners[ownerId]!.connectionId = null;
      if (await this.save(record, intentional ? 'casual_leave' : 'casual_drop')) return true;
    }
    throw new Error('storage_unavailable');
  }
  private async save(record: Record, event: string): Promise<boolean> {
    const expectedRevision = record.revision; record.revision++;
    const requestId = opaqueToken(), snapshot = publicSnapshot(record);
    const result = await this.options.store.commit({ matchId: record.matchId, expectedRevision, next: record, events: [{ type: event }],
      command: { actorId: 'casual_lifecycle', requestId, fingerprint: requestId, result: { ok: true, code: 'accepted', retryable: false, snapshot }, committedAt: this.now() } });
    if (result.status === 'conflict') return false;
    if (result.status !== 'committed') throw new Error('storage_unavailable');
    try { await this.options.publish?.(snapshot); } catch { /* durable state remains authoritative */ }
    return true;
  }
}
