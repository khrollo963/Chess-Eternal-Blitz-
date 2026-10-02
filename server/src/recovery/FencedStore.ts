import type { MatchRecord } from '../domain/match.js';
import type { LobbyRecord, LobbyStore } from '../storage/LobbyStore.js';
import type { MatchCommit } from '../storage/MatchStore.js';
import type { RecoveryRecord } from './RecoveryCoordinator.js';

/** CAS plus private instance ownership rejects actions from an obsolete process. */
export class FencedStore implements LobbyStore {
  constructor(private store: LobbyStore, private instanceId: string, private clock: () => number = Date.now) {}
  private owned(record: MatchRecord | null, allowTerminalRead = false) {
    if (allowTerminalRead && record && (record.phase === 'finished' || record.phase === 'void')) return record;
    if (record && (record as RecoveryRecord).service?.instanceId !== this.instanceId) throw new Error('obsolete_service_instance');
    return record;
  }
  private initial<T extends MatchRecord>(record: T): T {
    const next = structuredClone(record) as T & RecoveryRecord;
    next.service = { instanceId: this.instanceId, observedAt: this.clock() };
    return next;
  }
  create(record: MatchRecord) { return this.store.create(this.initial(record)); }
  createInvited(record: LobbyRecord) { return this.store.createInvited(this.initial(record)); }
  async load(matchId: string) { return this.owned(await this.store.load(matchId), true); }
  async loadByInvite(code: string) { return this.owned(await this.store.loadByInvite(code)) as LobbyRecord | null; }
  async findCommand(matchId: string, actorId: string, requestId: string) {
    await this.load(matchId); return this.store.findCommand(matchId, actorId, requestId);
  }
  async commit(input: MatchCommit) {
    this.owned(input.next); this.owned(await this.store.load(input.matchId));
    return this.store.commit(input);
  }
  async listRecoverable() {
    return (await this.store.listRecoverable()).filter(record => (record as RecoveryRecord).service?.instanceId === this.instanceId);
  }
  async maintenanceHead(matchId: string) {
    const head = await this.store.maintenanceHead(matchId);
    if (head && head.phase !== 'finished' && head.phase !== 'void' && head.serviceInstanceId !== this.instanceId) throw new Error('obsolete_service_instance');
    return head;
  }
  listLifecycleDue(now: number, limit = 64) { return this.store.listLifecycleDue(now, limit, this.instanceId); }
}
