import { Room, type Client, type AuthContext } from "@colyseus/core";
import { EnochianState, applySnapshot, type PublicState } from "./EnochianState.js";
import type { LobbyService, LobbyAction } from '../domain/lobby.js';
import type { LobbyStore } from '../storage/LobbyStore.js';
import { CommandProcessor } from '../domain/commands.js';
import { publicSnapshot, type PublicSnapshot } from '../domain/match.js';

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

  async onCreate(options: RoomScaffoldOptions) {
    try { await this.createRoom(options); } catch (error) { throw safeDomainError(error); }
  }
  private async createRoom(options: RoomScaffoldOptions) {
    this.delegates = options.delegates;
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
      const moves = new CommandProcessor({ store: this.store, publish });
      this.onMessage('command', async (client, payload: unknown) => {
        try {
          const actor = await this.lobby!.actorForConnection(this.matchId!, client.sessionId);
          client.send('ack', await moves.execute(actor, payload));
        } catch (error) { const code = safeDomainError(error).message; client.send('ack', { ok: false, code, retryable: code === 'storage_unavailable' }); }
      });
      this.onMessage('lobby_command', async (client, payload: unknown) => {
        const input = payload as { matchId?: string; requestId?: string; expectedRevision?: number; action?: LobbyAction; protocolVersion?: number; rulesVersion?: string };
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).length !== 6 || Object.keys(input).some(key => !['matchId','requestId','expectedRevision','action','protocolVersion','rulesVersion'].includes(key))) { client.send('ack', { ok: false, code: 'invalid_command', retryable: false }); return; }
        if (!input || input.matchId !== this.matchId || input.protocolVersion !== 1 || input.rulesVersion !== 'enochian-current-1') { client.send('ack', { ok: false, code: 'incompatible_version', retryable: false }); return; }
        const result = await this.lobby!.command(this.matchId!, client.sessionId, input.requestId!, input.expectedRevision!, input.action!);
        if (result.ok && result.snapshot) publish(result.snapshot);
        client.send('ack', result);
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
    if (this.lobby) {
      const credential = (options as { credential?: unknown } | null)?.credential;
      const auth = await this.lobby.authenticate(this.matchId!, credential);
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
      const connected = await this.lobby.connect(this.matchId!, client.auth.credential, client.sessionId);
      client.auth = connected.actor;
      if (connected.snapshot.revision >= this.state.revision) applySnapshot(this.state, connected.snapshot);
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
    if (this.lobby) { await this.onLeave(client); return; }
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
      await this.lobby.depart(this.matchId!, client.sessionId);
      const record = await this.store!.load(this.matchId!);
      if (record && record.revision >= this.state.revision) applySnapshot(this.state, publicSnapshot(record));
      return;
    }
    // Idempotent whether intentional, expired, or already counted as dropped.
    this.liveSessions.delete(client.sessionId);
    this.state.connected = this.liveSessions.size;
    await this.delegates.leave?.(client, code);
  }
  async onDispose() { try { await this.delegates.dispose?.(); } catch (error) { throw safeDomainError(error); } }
}
