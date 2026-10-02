import { Room, type Client, type AuthContext } from "@colyseus/core";
import { EnochianState, applySnapshot, type PublicState } from "./EnochianState.js";
import type { LobbyService, LobbyAction } from '../domain/lobby.js';
import type { LobbyStore } from '../storage/LobbyStore.js';
import type { VerifiedAuth } from '../storage/LobbyStore.js';
import { CommandProcessor } from '../domain/commands.js';
import type { ActorContext } from '../domain/commands.js';
import { publicSnapshot, type PublicSnapshot } from '../domain/match.js';
import { BotScheduler, type BotTimer } from '../domain/bots.js';
import type { CasualService } from '../domain/CasualService.js';
import { ExchangeService, parseExchangeCommand } from '../domain/ExchangeService.js';

function safeDomainError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  return new Error(['unauthorized','duplicate_connection','deadline_expired','invalid_phase','stale_revision','command_capacity','application_recovery_required','not_found'].includes(message) ? message : 'storage_unavailable');
}

export interface RoomDelegates {
  authenticate(options: unknown, context: AuthContext): unknown | Promise<unknown>;
  join?(client: Client): void | Promise<void>;
  drop?(client: Client): void | Promise<void>;
  reconnect?(client: Client): void | Promise<void>;
  leave?(client: Client, code?: number): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
export interface RoomScaffoldOptions {
  delegates: RoomDelegates;
  reconnectionSeconds?: number;
  lobby?: LobbyService;
  store?: LobbyStore;
  matchId?: string;
  creationPermit?: string;
  isReady?: () => boolean;
  connections?: ConnectionHooks;
  verifyAuth?: (authorization: string | undefined) => Promise<VerifiedAuth | undefined>;
  casual?: CasualService;
  clock?: () => number;
  botOptions?: { scheduler?: BotTimer; random?: () => number; maxNodes?: number; delayMs?: number };
}
export interface ConnectionHooks {
  connect(matchId: string, credential: unknown, connectionId: string): Promise<{ actor: ActorContext; snapshot: PublicSnapshot }>;
  depart(matchId: string, connectionId: string, intentional: boolean): Promise<boolean>;
  preflight?(matchId: string): Promise<void>;
}

// Transport lifecycle adapter, not durable seat ownership or disconnect policy.
export class EnochianRoom extends Room<{ state: PublicState }> {
  maxClients = 4;
  private delegates!: RoomDelegates;
  private reconnectionSeconds = 5;
  private liveSessions = new Set<string>();
  private lobby?: LobbyService;
  private store?: LobbyStore;
  private matchId?: string;
  private isReady?: () => boolean;
  private connections?: ConnectionHooks;
  private verifyAuth?: (authorization: string | undefined) => Promise<VerifiedAuth | undefined>;
  private droppedSessions = new Set<string>();
  private casual?: CasualService;
  private bots?: BotScheduler;
  private exchange?: ExchangeService;
  private maintenance?: ReturnType<typeof setInterval>;
  private disposed = false;
  private draining = false;

  async onCreate(options: RoomScaffoldOptions) {
    try { await this.createRoom(options); } catch (error) { throw safeDomainError(error); }
  }
  private async createRoom(options: RoomScaffoldOptions) {
    this.delegates = options.delegates;
    this.isReady = options.isReady; this.connections = options.connections; this.verifyAuth = options.verifyAuth;
    this.casual = options.casual;
    this.reconnectionSeconds = options.reconnectionSeconds ?? 5;
    this.setState(new EnochianState());
    this.state.phase = "lobby";
    this.state.connected = 0;
    this.state.revision = 0;
    this.state.lastLobbyMessage = "";
    if (options.lobby && options.store) {
      if (typeof options.matchId !== 'string' || !options.lobby.consumeTransportPermit(options.matchId, options.creationPermit) || !(await options.store.load(options.matchId))) throw new Error('unauthorized');
      this.lobby = options.lobby; this.store = options.store; this.matchId = options.matchId;
      this.autoDispose = false;
      await this.setPrivate(true);
      const publish = (snapshot: PublicSnapshot) => { if (snapshot.revision >= this.state.revision) applySnapshot(this.state, snapshot); };
      publish(publicSnapshot((await this.store.load(this.matchId))!));
      const committed = (snapshot: PublicSnapshot) => { publish(snapshot); void this.maintain().catch(() => this.bots?.cancel()); };
      const moves = new CommandProcessor({ store: this.store, publish: committed, clock: options.clock });
      this.exchange = new ExchangeService({ store: this.store, publish: committed, clock: options.clock });
      this.bots = new BotScheduler({ ...options.botOptions, store: this.store, processor: moves, clock: options.clock,
        afterJob: () => this.maintain() });
      this.maintenance = setInterval(() => { void this.maintain().catch(() => this.bots?.cancel()); }, 1000);
      this.maintenance.unref();
      await this.maintain();
      this.onMessage('command', async (client, payload: unknown) => {
        if (this.isReady && !this.isReady()) { client.send('ack', { ok: false, code: 'storage_unavailable', retryable: true }); return; }
        try {
          await this.preflight();
          const actor = await this.lobby!.actorForConnection(this.matchId!, client.sessionId);
          client.send('ack', await moves.execute(actor, payload));
        } catch (error) { const code = safeDomainError(error).message; client.send('ack', { ok: false, code, retryable: code === 'storage_unavailable' }); }
      });
      this.onMessage('lobby_command', async (client, payload: unknown) => {
        if (this.isReady && !this.isReady()) { client.send('ack', { ok: false, code: 'storage_unavailable', retryable: true }); return; }
        const input = payload as { matchId?: string; requestId?: string; expectedRevision?: number; action?: LobbyAction; protocolVersion?: number; rulesVersion?: string };
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).length !== 6 || Object.keys(input).some(key => !['matchId','requestId','expectedRevision','action','protocolVersion','rulesVersion'].includes(key))) { client.send('ack', { ok: false, code: 'invalid_command', retryable: false }); return; }
        if (!input || input.matchId !== this.matchId || input.protocolVersion !== 1 || input.rulesVersion !== 'enochian-current-1') { client.send('ack', { ok: false, code: 'incompatible_version', retryable: false }); return; }
        try {
          await this.preflight();
          const result = await this.lobby!.command(this.matchId!, client.sessionId, input.requestId!, input.expectedRevision!, input.action!);
          if (result.ok && result.snapshot) committed(result.snapshot);
          client.send('ack', result);
        } catch (error) { const code = safeDomainError(error).message; client.send('ack', { ok: false, code, retryable: code === 'storage_unavailable' }); }
      });
      this.onMessage('exchange_command', async (client, payload: unknown) => {
        if (this.isReady && !this.isReady()) { client.send('ack', { ok: false, code: 'storage_unavailable', retryable: true }); return; }
        const parsed = parseExchangeCommand(payload);
        if (!parsed.ok) { client.send('ack', parsed.result); return; }
        if (parsed.command.matchId !== this.matchId) { client.send('ack', { ok: false, code: 'unauthorized', retryable: false, requestId: parsed.command.requestId }); return; }
        try {
          await this.preflight();
          const actor = await this.lobby!.actorForConnection(this.matchId!, client.sessionId);
          client.send('ack', await this.exchange!.execute(actor, parsed.command));
        } catch (error) { const code = safeDomainError(error).message; client.send('ack', { ok: false, code, retryable: code === 'storage_unavailable' }); }
      });
      return;
    }
    this.onMessage("lobby", (client, payload: unknown) => {
      if (typeof payload !== "string" || payload.length > 120) return;
      this.state.lastLobbyMessage = payload;
      this.state.revision++;
      this.broadcast("lobby", { sender: client.sessionId, message: payload });
    });
  }

  async onAuth(_client: Client, options: unknown, context: AuthContext) {
    try { return await this.authenticateClient(options, context); } catch (error) { throw safeDomainError(error); }
  }
  private async authenticateClient(options: unknown, context: AuthContext) {
    if (this.isReady && !this.isReady()) throw new Error('storage_unavailable');
    if (this.lobby) {
      await this.preflight();
      const credential = (options as { credential?: unknown } | null)?.credential;
      const auth = await this.lobby.authenticate(this.matchId!, credential);
      if (auth.record.mode === 'ranked') {
        const supplied = (options as { authorization?: unknown } | null)?.authorization;
        const authorization = typeof supplied === 'string' ? supplied : context.token ? `Bearer ${context.token}` : context.headers.get('authorization') ?? undefined;
        const identity = await this.verifyAuth?.(authorization);
        if (!identity || identity.accountId !== auth.owner.accountId) throw new Error('unauthorized');
      }
      if (auth.record.seats[auth.color].controller === 'bot') throw new Error('deadline_expired');
      if (auth.record.phase === 'finished' || auth.record.phase === 'void') throw new Error('invalid_phase');
      if (auth.owner.connectionId !== null) throw new Error('duplicate_connection');
      return { actorId: auth.ownerId, seat: auth.color, controller: 'human', credential };
    }
    return this.delegates.authenticate(options, context);
  }
  async onJoin(client: Client) {
    try { await this.joinClient(client); } catch (error) { throw safeDomainError(error); }
  }
  private async joinClient(client: Client) {
    if (this.lobby) {
      const connected = this.connections ? await this.connections.connect(this.matchId!, client.auth.credential, client.sessionId)
        : await this.lobby.connect(this.matchId!, client.auth.credential, client.sessionId);
      client.auth = connected.actor;
      if (connected.snapshot.revision >= this.state.revision) applySnapshot(this.state, connected.snapshot);
      await this.maintain();
      return;
    }
    await this.delegates.join?.(client);
    this.liveSessions.add(client.sessionId);
    this.state.connected = this.liveSessions.size;
  }
  async onDrop(client: Client) {
    try { await this.dropClient(client); } catch (error) { throw safeDomainError(error); }
  }
  private async dropClient(client: Client) {
    if (this.lobby) { this.droppedSessions.add(client.sessionId); await this.departProduction(client, false); return; }
    // Register the reservation before yielding to the domain delegate.
    const reservation = this.allowReconnection(client, this.reconnectionSeconds);
    this.liveSessions.delete(client.sessionId);
    this.state.connected = this.liveSessions.size;
    await this.delegates.drop?.(client);
    try { await reservation; } catch { /* Colyseus invokes onLeave after expiry. */ }
  }
  async onReconnect(client: Client) {
    try { await this.reconnectClient(client); } catch (error) { throw safeDomainError(error); }
  }
  private async reconnectClient(client: Client) {
    if (this.lobby) throw new Error('application_recovery_required');
    await this.delegates.reconnect?.(client);
    this.liveSessions.add(client.sessionId);
    this.state.connected = this.liveSessions.size;
  }
  async onLeave(client: Client, code?: number) {
    try { await this.leaveClient(client, code); } catch (error) { throw safeDomainError(error); }
  }
  private async leaveClient(client: Client, code?: number) {
    if (this.lobby) {
      await this.departProduction(client, !this.droppedSessions.delete(client.sessionId));
      return;
    }
    // Idempotent whether intentional, expired, or already counted as dropped.
    this.liveSessions.delete(client.sessionId);
    this.state.connected = this.liveSessions.size;
    await this.delegates.leave?.(client, code);
  }
  private async departProduction(client: Client, intentional: boolean) {
    if (this.draining) return;
    const handled = await this.connections?.depart(this.matchId!, client.sessionId, intentional);
    if (!handled) await this.lobby!.depart(this.matchId!, client.sessionId);
    const record = await this.store!.load(this.matchId!);
    if (record) this.publishCommitted(publicSnapshot(record));
  }
  publishCommitted(snapshot: PublicSnapshot) {
    if (snapshot.matchId === this.matchId && snapshot.revision >= this.state.revision) applySnapshot(this.state, snapshot);
    void this.maintain().catch(() => this.bots?.cancel());
  }
  private async preflight() {
    await this.connections?.preflight?.(this.matchId!);
    await this.casual?.expire(this.matchId!);
    await this.exchange?.expire(this.matchId!);
  }
  private async maintain() {
    if (this.disposed || this.draining || !this.store || !this.matchId || (this.isReady && !this.isReady())) { this.bots?.cancel(); return; }
    await this.preflight();
    const record = await this.store.load(this.matchId);
    if (!record || this.disposed) return;
    if (record.revision >= this.state.revision) { applySnapshot(this.state, publicSnapshot(record)); this.bots?.schedule(record); }
  }
  onBeforeShutdown() { this.draining = true; this.bots?.cancel(); void this.disconnect(); }
  async onDispose() {
    this.disposed = true; clearInterval(this.maintenance); this.bots?.dispose();
    try { await this.delegates.dispose?.(); } catch (error) { throw safeDomainError(error); }
  }
}
