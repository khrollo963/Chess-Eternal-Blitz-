import { Room, type Client, type AuthContext } from "@colyseus/core";
import { EnochianState, type PublicState } from "./EnochianState.js";

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
}

// Transport lifecycle adapter, not durable seat ownership or disconnect policy.
export class EnochianRoom extends Room<{ state: PublicState }> {
  maxClients = 4;
  private delegates!: RoomDelegates;
  private reconnectionSeconds = 5;
  private liveSessions = new Set<string>();

  onCreate(options: RoomScaffoldOptions) {
    this.delegates = options.delegates;
    this.reconnectionSeconds = options.reconnectionSeconds ?? 5;
    this.setState(new EnochianState());
    this.state.phase = "lobby";
    this.state.connected = 0;
    this.state.revision = 0;
    this.state.lastLobbyMessage = "";
    this.onMessage("lobby", (client, payload: unknown) => {
      if (typeof payload !== "string" || payload.length > 120) return;
      this.state.lastLobbyMessage = payload;
      this.state.revision++;
      this.broadcast("lobby", { sender: client.sessionId, message: payload });
    });
  }

  async onAuth(_client: Client, options: unknown, context: AuthContext) {
    return this.delegates.authenticate(options, context);
  }
  async onJoin(client: Client) {
    await this.delegates.join?.(client);
    this.liveSessions.add(client.sessionId);
    this.state.connected = this.liveSessions.size;
  }
  async onDrop(client: Client) {
    // Register the reservation before yielding to the domain delegate.
    const reservation = this.allowReconnection(client, this.reconnectionSeconds);
    this.liveSessions.delete(client.sessionId);
    this.state.connected = this.liveSessions.size;
    await this.delegates.drop?.(client);
    try { await reservation; } catch { /* Colyseus invokes onLeave after expiry. */ }
  }
  async onReconnect(client: Client) {
    await this.delegates.reconnect?.(client);
    this.liveSessions.add(client.sessionId);
    this.state.connected = this.liveSessions.size;
  }
  async onLeave(client: Client, code?: number) {
    // Idempotent whether intentional, expired, or already counted as dropped.
    this.liveSessions.delete(client.sessionId);
    this.state.connected = this.liveSessions.size;
    await this.delegates.leave?.(client, code);
  }
  async onDispose() { await this.delegates.dispose?.(); }
}
