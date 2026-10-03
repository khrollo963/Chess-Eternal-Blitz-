import { COLORS, PROTOCOL_VERSION, RULES_VERSION, canonicalEngine, publicSnapshot, type Color, type MatchRecord, type Phase } from '../domain/match.js';
import { opaqueToken, credentialHash, verifyCredential } from '../identity/guest.js';
import type { LobbyRecord, LobbyStore } from '../storage/LobbyStore.js';
import type { CommandResult } from '../storage/MatchStore.js';
import { SERVICE_RECOVERY_ACTOR } from '../storage/MatchStore.js';
import { invalidateExchange } from '../domain/exchange.js';

export interface RecoveryRecord extends LobbyRecord {
  absence?: Partial<Record<Color, { usedMs: number; departedAt: number | null }>>;
  /** Departures already expired at the last service observation retain their consequence. */
  expiredDepartures?: Color[];
  pendingSettlement?: boolean;
  service?: { instanceId: string; observedAt: number };
  recovery?: {
    previousPhase: Phase; cutoff: number; startedAt: number; deadline: number;
    remainingByColor: Record<Color, number | null>;
    requiredOwners: string[]; returnedOwners: string[];
  };
}
const recordOf = (record: MatchRecord | null): RecoveryRecord => {
  if (!record || !('lobby' in record)) throw new Error('not_found');
  return record as RecoveryRecord;
};

/** Service recovery is separate from individually observed player departures. */
export class RecoveryCoordinator {
  constructor(private options: {
    store: LobbyStore; instanceId: string; clock?: () => number;
    freezeAbsence?: (record: RecoveryRecord, cutoff: number) => void;
    returnedOwner?: (record: RecoveryRecord, color: Color) => void;
  }) {}
  private now() { return (this.options.clock ?? Date.now)(); }
  private async ownedRecord(matchId: string): Promise<RecoveryRecord> {
    const record = recordOf(await this.options.store.load(matchId));
    if (record.phase !== 'finished' && record.phase !== 'void' && record.service?.instanceId !== this.options.instanceId) throw new Error('obsolete_service_instance');
    return record;
  }

  async claim(matchId: string, lastHeartbeat: number | null, roomId: string | null): Promise<RecoveryRecord> {
    const record = recordOf(await this.options.store.load(matchId));
    const now = this.now();
    if(record.protocolVersion !== PROTOCOL_VERSION || ![RULES_VERSION,'enochian-current-1'].includes(record.rulesVersion)) throw new Error('incompatible_version');
    if (record.service?.instanceId === this.options.instanceId) return record;
    const previousRulesVersion = record.rulesVersion;
    record.rulesVersion = RULES_VERSION;
    const terminal = record.phase === 'finished' || record.phase === 'void';
    const previousInstance = record.service?.instanceId;
    // A last durable observation is conservative when the exact crash instant is unknown.
    const cutoff = Math.min(now, Math.max(0, lastHeartbeat ?? record.service?.observedAt ?? now));
    record.service = { instanceId: this.options.instanceId, observedAt: now };
    record.lobby.roomId = roomId;
    for (const owner of Object.values(record.lobby.owners)) owner.connectionId = null;
    for (const color of COLORS) record.seats[color].connected = false;
    if (!terminal) {
      if (record.phase !== 'lobby') {
        // A repeated outage retains the first frozen budgets and never charges outage time.
        if (!record.recovery) {
          const allowance = record.mode === 'casual' ? 180000 : 300000;
          const remainingByColor = Object.fromEntries(COLORS.map(color => [color,
            record.seats[color].disconnectDeadline === null ? null : Math.max(0, Math.min(
              allowance - (record.absence?.[color]?.usedMs ?? 0),
              record.seats[color].disconnectDeadline! - Math.max(cutoff, record.absence?.[color]?.departedAt ?? cutoff)))])) as Record<Color, number | null>;
          // Persist consumed time before recovery can discard its frozen budget.
          // No player absence clock runs while the service is unavailable.
          for (const color of COLORS) {
            const remaining = remainingByColor[color];
            if (remaining !== null) {
              record.absence ??= {};
              record.absence[color] = { usedMs: allowance - remaining, departedAt: null };
            }
          }
          this.options.freezeAbsence?.(record, cutoff);
          const expired = COLORS.filter(color => remainingByColor[color] === 0);
          if (record.mode === 'ranked' && expired.length) {
            record.phase = 'void'; record.terminalResult = { kind: 'void', winningTeam: null, reason: 'abandonment' };
            record.expiredDepartures = expired;
            record.pendingSettlement = true;
            record.recoveryDeadline = null;
            await this.save(record, { type: 'departure_expired_before_outage', offenders: expired, cutoff });
            return record;
          }
          if (record.mode === 'casual') for (const color of expired) record.seats[color].controller = 'bot';
          record.recovery = { previousPhase: record.phase, cutoff, startedAt: now, deadline: now + 300000,
            remainingByColor, requiredOwners: COLORS.filter(color => record.seats[color].ownerId && record.seats[color].controller !== 'bot')
              .map(color => record.seats[color].ownerId!), returnedOwners: [] };
        } else {
          record.recovery.startedAt = now; record.recovery.deadline = now + 300000;
          record.recovery.returnedOwners = [];
        }
        record.phase = 'paused'; record.recoveryDeadline = record.recovery.deadline;
        for (const color of COLORS) record.seats[color].disconnectDeadline = null;
      }
    }
    // Existing v1 games retain their board and move count. Apply newly approved
    // terminal rules after preserving any already-expired departure consequence.
    // Finished/void historical results are never reinterpreted.
    if(!terminal && record.phase !== 'lobby'){
      const outcome = canonicalEngine.outcome(record.engine);
      if(outcome){
        record.phase = 'finished'; record.engine.over = true;
        record.terminalResult = {kind:outcome.kind ?? 'victory',winningTeam:outcome.winningTeam,reason:outcome.reason ?? null};
        record.pendingSettlement = record.mode === 'ranked';
        record.recoveryDeadline = null; delete record.recovery;
        for(const color of COLORS) record.seats[color].disconnectDeadline = null;
      }
    }
    await this.save(record, { type: 'service_recovery', previousInstance, previousRulesVersion, cutoff });
    return record;
  }

  async recover(matchId: string, credential: unknown, connectionId: string): Promise<CommandResult> {
    const record = await this.ownedRecord(matchId);
    if (typeof credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new Error('unauthorized');
    const ownerId = credentialHash(credential), owner = record.lobby.owners[ownerId];
    if (!owner || !verifyCredential(credential, owner.credentialHash)) throw new Error('unauthorized');
    const color = COLORS.find(candidate => record.seats[candidate].ownerId === ownerId);
    if (!color) throw new Error('unauthorized');
    if (record.phase === 'finished' || record.phase === 'void') return {
      ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(record),
    };
    const recovery = record.recovery;
    if (!recovery || !recovery.requiredOwners.includes(ownerId)) throw new Error('invalid_phase');
    if (this.now() >= recovery.deadline) {
      const expired = await this.expire(matchId);
      if (expired) return expired;
      return { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(await this.ownedRecord(matchId)) };
    }
    if (owner.connectionId !== null) throw new Error('duplicate_connection');
    owner.connectionId = connectionId; record.seats[color].connected = true;
    record.seats[color].controller = 'human';
    recovery.returnedOwners.push(ownerId);
    this.options.returnedOwner?.(record, color);
    if (recovery.requiredOwners.every(id => recovery.returnedOwners.includes(id))) {
      record.phase = 'active'; record.recoveryDeadline = null; delete record.recovery;
    }
    return this.save(record, { type: 'service_return', color });
  }

  async expire(matchId: string): Promise<CommandResult | null> {
    for (let attempt = 0; attempt < 16; attempt++) {
      const record = await this.ownedRecord(matchId);
      if (!record.recovery || record.phase === 'finished' || record.phase === 'void' || this.now() < record.recovery.deadline) return null;
      try { return await this.expireRecord(record); }
      catch (error) { if (!(error instanceof Error) || error.message !== 'stale_revision') throw error; }
    }
    throw new Error('stale_revision');
  }
  async bindTransport(matchId: string, roomId: string): Promise<CommandResult> {
    const record = recordOf(await this.options.store.load(matchId));
    if (record.service?.instanceId !== this.options.instanceId || record.lobby.roomId !== null) throw new Error('invalid_phase');
    record.lobby.roomId = roomId;
    return this.save(record, { type: 'service_transport_bound' });
  }
  async expireLobby(matchId: string): Promise<CommandResult | null> {
    for (let attempt = 0; attempt < 16; attempt++) {
      const record = await this.ownedRecord(matchId);
      if (record.phase !== 'lobby' || record.lobbyDeadline === null || this.now() < record.lobbyDeadline) return null;
      record.phase = 'void'; record.terminalResult = { kind: 'void', winningTeam: null, reason: 'lobby_expired' };
      record.lobbyDeadline = null; record.retainUntil = this.now() + 300000;
      try { return await this.save(record, { type: 'lobby_expired' }); }
      catch (error) { if (!(error instanceof Error) || error.message !== 'stale_revision') throw error; }
    }
    throw new Error('stale_revision');
  }
  async depart(matchId: string, connectionId: string, intentional = false): Promise<CommandResult | null> {
    for (let attempt = 0; attempt < 16; attempt++) {
      const record = await this.ownedRecord(matchId);
      if (!record.recovery) return null;
      const ownerId = Object.keys(record.lobby.owners).find(id => record.lobby.owners[id]?.connectionId === connectionId);
      if (!ownerId) return null;
      record.lobby.owners[ownerId]!.connectionId = null;
      record.recovery.returnedOwners = record.recovery.returnedOwners.filter(id => id !== ownerId);
      const color = COLORS.find(candidate => record.seats[candidate].ownerId === ownerId)!;
      record.seats[color].connected = false;
      if (intentional && record.mode === 'ranked') {
        record.phase = 'void'; record.terminalResult = { kind: 'void', winningTeam: null, reason: 'abandonment' };
        record.expiredDepartures = [color]; record.pendingSettlement = true;
        record.recoveryDeadline = null; delete record.recovery;
      } else if (intentional) {
        record.seats[color].controller = 'bot'; record.seats[color].disconnectDeadline = null;
        record.absence ??= {}; record.absence[color] = { usedMs: 180000, departedAt: null };
        record.recovery.requiredOwners = record.recovery.requiredOwners.filter(id => id !== ownerId);
        if (record.recovery.requiredOwners.every(id => record.recovery!.returnedOwners.includes(id))) {
          record.phase = 'active'; record.recoveryDeadline = null; delete record.recovery;
        }
      }
      try { return await this.save(record, { type: 'service_return_interrupted', color }); }
      catch (error) { if (!(error instanceof Error) || error.message !== 'stale_revision') throw error; }
    }
    throw new Error('stale_revision');
  }
  private expireRecord(record: RecoveryRecord): Promise<CommandResult> {
    const recovery = record.recovery!;
    const now = this.now();
    if (record.mode === 'ranked') {
      record.phase = 'void'; record.terminalResult = { kind: 'void', winningTeam: null, reason: 'service_outage' };
      record.pendingSettlement = true;
      // Ranked settlement consumes this reason with no abandonment offenders.
    } else {
      record.phase = 'active';
      for (const color of COLORS) {
        const seat = record.seats[color];
        if (seat.ownerId && recovery.requiredOwners.includes(seat.ownerId) && !seat.connected) {
          const remaining = recovery.remainingByColor[color] ?? Math.max(0, 180000 - (record.absence?.[color]?.usedMs ?? 0));
          seat.controller = remaining > 0 ? 'temporary_bot' : 'bot';
          seat.disconnectDeadline = remaining > 0 ? now + remaining : null;
          record.absence ??= {};
          const budget = record.absence[color] ?? { usedMs: 180000 - remaining, departedAt: null };
          budget.departedAt = remaining > 0 ? now : null;
          record.absence[color] = budget;
        }
      }
    }
    record.recoveryDeadline = null; delete record.recovery;
    return this.save(record, { type: 'service_recovery_expired', mode: record.mode, offenders: [] });
  }
  private async save(record: RecoveryRecord, event: unknown): Promise<CommandResult> {
    if (record.service?.instanceId !== this.options.instanceId) throw new Error('obsolete_service_instance');
    invalidateExchange(record, record.phase === 'finished' || record.phase === 'void' ? 'end' : record.phase === 'paused' ? 'pause' : 'control_change');
    const expectedRevision = record.revision; record.revision++;
    const requestId = opaqueToken();
    const result: CommandResult = { ok: true, code: 'accepted', retryable: false, requestId, snapshot: publicSnapshot(record) };
    const commit = await this.options.store.commit({ matchId: record.matchId, expectedRevision, next: record, events: [event],
      command: { actorId: SERVICE_RECOVERY_ACTOR, requestId, fingerprint: requestId, result, committedAt: this.now() } });
    if (commit.status !== 'committed') throw new Error(commit.status === 'capacity' ? 'command_capacity' : 'stale_revision');
    return result;
  }
}
