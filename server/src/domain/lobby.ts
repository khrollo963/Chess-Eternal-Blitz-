import { COLORS, createMatch, publicSnapshot, type Color, type MatchRecord } from './match.js';
import { opaqueToken, inviteCode, credentialHash, verifyCredential, displayName } from '../identity/guest.js';
import type { LobbyRecord, LobbyStore, VerifiedAuth } from '../storage/LobbyStore.js';
import type { CommandResult } from '../storage/MatchStore.js';
import { initializeBotOwners } from './casual.js';

export interface Invitation { matchId: string; code: string; credential: string }
export type LobbyAction = { type: 'ready'; ready: boolean } | { type: 'color'; color: Color };
const fail = (code: string): never => { throw new Error(code); };
const asLobby = (record: MatchRecord | null): LobbyRecord => {
  if (!record || !('lobby' in record)) return fail('not_found');
  return record as LobbyRecord;
};
function parseAction(action: unknown): LobbyAction | null {
  try {
    if (!action || typeof action !== 'object' || Object.getPrototypeOf(action) !== Object.prototype || JSON.stringify(action).length > 128) return null;
    const input = action as Record<string, unknown>;
    if (Object.keys(input).length !== 2) return null;
    if (input.type === 'ready' && typeof input.ready === 'boolean') return { type: 'ready', ready: input.ready };
    if (input.type === 'color' && COLORS.includes(input.color as Color)) return { type: 'color', color: input.color as Color };
  } catch { /* malformed or cyclic input */ }
  return null;
}
export class LobbyService {
  private transportPermits = new Map<string, string>();
  private store: LobbyStore;
  private clock: () => number;
  private code: () => string;
  private rankedEnabled: boolean;
  constructor(options: { store: LobbyStore; clock?: () => number; code?: () => string; rankedEnabled?: boolean }) {
    this.store = options.store; this.clock = options.clock ?? Date.now; this.code = options.code ?? inviteCode;
    this.rankedEnabled = options.rankedEnabled ?? false;
  }
  private checkLobby(record: LobbyRecord) {
    if (record.phase !== 'lobby') fail('invalid_phase');
    if (record.lobbyDeadline === null || this.clock() >= record.lobbyDeadline) fail('deadline_expired');
  }
  private identity(record: LobbyRecord, auth?: VerifiedAuth) {
    if (record.mode === 'ranked') {
      if (!this.rankedEnabled) fail('ranked_disabled');
      if (!auth?.accountId || auth.accountId.length > 128) fail('unauthorized');
      if (Object.values(record.lobby.owners).some(owner => owner.accountId === auth!.accountId)) fail('duplicate_account');
    }
  }
  private add(record: LobbyRecord, name: string, color: Color, credential: string, auth?: VerifiedAuth) {
    if (!COLORS.includes(color)) fail('invalid_color');
    if (COLORS.every(c => record.seats[c].ownerId)) fail('room_full');
    if (record.seats[color].ownerId) fail('color_unavailable');
    this.identity(record, auth);
    const ownerId = credentialHash(credential);
    record.lobby.owners[ownerId] = { credentialHash: ownerId, connectionId: null, accountId: auth?.accountId ?? null };
    record.seats[color] = { color, ownerId, displayName: displayName(name), controller: 'human', connected: false, ready: false, disconnectDeadline: null };
  }
  async create(mode: 'casual' | 'ranked', name: string, color: Color, auth?: VerifiedAuth): Promise<Invitation> {
    if (mode !== 'casual' && mode !== 'ranked') fail('invalid_mode');
    displayName(name);
    const credential = opaqueToken();
    for (let attempt = 0; attempt < 16; attempt++) {
      const record: LobbyRecord = { ...createMatch(opaqueToken(), mode), lobby: { inviteCode: this.code(), roomId: null, owners: {} } };
      record.lobbyDeadline = this.clock() + 1800000;
      this.add(record, name, color, credential, auth);
      if (await this.store.createInvited(record)) return { matchId: record.matchId, code: record.lobby.inviteCode, credential };
    }
    return fail('invite_capacity');
  }
  async join(code: string, name: string, color: Color, auth?: VerifiedAuth): Promise<Invitation> {
    const record = asLobby(await this.store.loadByInvite(code)); this.checkLobby(record);
    const credential = opaqueToken(); this.add(record, name, color, credential, auth);
    await this.save(record, 'join', opaqueToken());
    return { matchId: record.matchId, code, credential };
  }
  async authenticate(matchId: string, credential: unknown) {
    if (typeof credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential)) return fail('unauthorized');
    const record = asLobby(await this.store.load(matchId));
    const ownerId = typeof credential === 'string' ? credentialHash(credential) : '';
    const owner = record.lobby.owners[ownerId];
    if (!owner || !verifyCredential(credential, owner.credentialHash)) return fail('unauthorized');
    const color = COLORS.find(c => record.seats[c].ownerId === ownerId);
    if (!color) return fail('unauthorized');
    if (record.phase === 'lobby') this.checkLobby(record);
    return { record, ownerId, owner, color };
  }
  async connect(matchId: string, credential: unknown, connectionId: string) {
    const { record, owner, ownerId, color } = await this.authenticate(matchId, credential);
    if (owner.connectionId !== null) fail('duplicate_connection');
    // Active reclaim timing/control is owned by Task 8; never admit through this lobby path.
    if (record.phase !== 'lobby') fail('invalid_phase');
    owner.connectionId = connectionId; record.seats[color].connected = true;
    const result = await this.save(record, ownerId, opaqueToken());
    return { actor: { actorId: ownerId, seat: color, controller: 'human' as const }, snapshot: result.snapshot! };
  }
  async actorForConnection(matchId: string, connectionId: string) {
    const record = asLobby(await this.store.load(matchId));
    const ownerId = Object.keys(record.lobby.owners).find(id => record.lobby.owners[id]?.connectionId === connectionId);
    const color = COLORS.find(c => record.seats[c].ownerId === ownerId);
    if (!ownerId || !color || !record.seats[color].connected || record.seats[color].controller !== 'human') return fail('unauthorized');
    return { actorId: ownerId, seat: color, controller: 'human' as const };
  }
  async bindRoom(matchId: string, roomId: string) {
    const record = asLobby(await this.store.load(matchId));
    this.checkLobby(record);
    if (record.lobby.roomId !== null) fail('invalid_phase');
    record.lobby.roomId = roomId;
    await this.save(record, 'transport', opaqueToken());
  }
  prepareTransport(matchId: string): string {
    const permit = opaqueToken(); this.transportPermits.set(matchId, permit); return permit;
  }
  consumeTransportPermit(matchId: string, permit: unknown): boolean {
    const expected = this.transportPermits.get(matchId);
    const accepted = typeof permit === 'string' && expected !== undefined && verifyCredential(permit, credentialHash(expected));
    if (accepted) this.transportPermits.delete(matchId);
    return accepted;
  }
  async voidCreation(matchId: string) {
    const record = asLobby(await this.store.load(matchId));
    record.phase = 'void'; record.terminalResult = { kind: 'void', winningTeam: null, reason: 'transport_creation_failed' };
    record.retainUntil = this.clock() + 1800000;
    await this.save(record, 'transport', opaqueToken());
  }
  async lookup(code: string): Promise<{ matchId: string; roomId: string | null }> {
    const record = asLobby(await this.store.loadByInvite(code)); this.checkLobby(record);
    return { matchId: record.matchId, roomId: record.lobby.roomId };
  }
  async command(matchId: string, connectionId: string, requestId: string, revision: number, action: LobbyAction): Promise<CommandResult> {
    const parsed = parseAction(action);
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(requestId) || !Number.isSafeInteger(revision) || revision < 0 || !parsed) return { ok: false, code: 'invalid_command', retryable: false };
    action = parsed;
    try {
      const record = asLobby(await this.store.load(matchId));
      const ownerId = Object.keys(record.lobby.owners).find(id => record.lobby.owners[id]?.connectionId === connectionId);
      if (!ownerId) fail('unauthorized');
      const fingerprint = JSON.stringify({ matchId, revision, action });
      const duplicate = await this.store.findCommand(matchId, ownerId!, requestId);
      if (duplicate) return duplicate.fingerprint === fingerprint ? duplicate.result : { ok: false, code: 'request_conflict', retryable: false, requestId };
      if (record.revision !== revision) fail('stale_revision');
      this.checkLobby(record);
      const color = COLORS.find(c => record.seats[c].ownerId === ownerId)!;
      if (action.type === 'ready') record.seats[color].ready = action.ready;
      else if (action.color !== color) {
        if (record.seats[action.color].ownerId) fail('color_unavailable');
        record.seats[action.color] = { ...record.seats[color], color: action.color, ready: false };
        record.seats[color] = createMatch('blank').seats[color];
      }
      const humans = COLORS.filter(c => record.seats[c].ownerId !== null);
      if (humans.length >= 2 && humans.every(c => record.seats[c].ready && record.seats[c].connected)) {
        if (record.mode === 'casual') record.phase = 'active';
        else if (this.rankedEnabled && humans.length === 4 && new Set(Object.values(record.lobby.owners).map(o => o.accountId)).size === 4 && Object.values(record.lobby.owners).every(o => o.accountId)) record.phase = 'active';
        if (record.phase === 'active') { record.lobbyDeadline = null; initializeBotOwners(record); }
      }
      return await this.save(record, ownerId!, requestId, fingerprint, action);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'storage_unavailable';
      const known = ['unauthorized', 'stale_revision', 'deadline_expired', 'invalid_phase', 'not_found', 'ranked_cooldown', 'ranked_match_locked'];
      const safeCode = known.includes(code) ? code as CommandResult['code'] : code === 'color_unavailable' ? 'invalid_command' : code === 'command_capacity' ? 'command_capacity' : 'storage_unavailable';
      return { ok: false, code: safeCode, retryable: safeCode === 'stale_revision' || safeCode === 'storage_unavailable', requestId };
    }
  }
  async depart(matchId: string, connectionId: string) {
    // Framework leave callbacks cannot ask a vanished client to retry a CAS loss.
    // Reload ownership each time; a stale callback must never clear another session.
    for (let attempt = 0; attempt < 16; attempt++) {
      const record = asLobby(await this.store.load(matchId));
      const ownerId = Object.keys(record.lobby.owners).find(id => record.lobby.owners[id]?.connectionId === connectionId);
      if (!ownerId || record.phase !== 'lobby') return;
      const color = COLORS.find(c => record.seats[c].ownerId === ownerId)!;
      delete record.lobby.owners[ownerId]; record.seats[color] = createMatch('blank').seats[color];
      try { await this.save(record, ownerId, opaqueToken()); return; }
      catch (error) { if (!(error instanceof Error) || error.message !== 'stale_revision') throw error; }
    }
    return fail('storage_unavailable');
  }
  private async save(record: LobbyRecord, actorId: string, requestId: string, fingerprint = requestId, event: unknown = { type: 'lobby' }): Promise<CommandResult> {
    const expectedRevision = record.revision; record.revision++;
    const result: CommandResult = { ok: true, code: 'accepted', retryable: false, requestId, snapshot: publicSnapshot(record) };
    const committed = await this.store.commit({ matchId: record.matchId, expectedRevision, next: record, events: [event], command: { actorId, requestId, fingerprint, result, committedAt: this.clock() } });
    if (committed.status === 'conflict') return fail('stale_revision');
    if (committed.status === 'capacity') return fail('command_capacity');
    if (committed.status === 'duplicate') return committed.command.fingerprint === fingerprint ? committed.command.result : { ok: false, code: 'request_conflict', retryable: false, requestId };
    return result;
  }
}
