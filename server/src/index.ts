import { Server } from "@colyseus/core";
import { BunWebSockets } from "@colyseus/bun-websockets";
import { assertRuntime, runtimeDiagnostics } from "./config.js";
import { EnochianRoom, type RoomDelegates, type ConnectionHooks } from "./rooms/EnochianRoom.js";
import { canonicalEngine } from "./engine.js";
import { LobbyService } from './domain/lobby.js';
import type { LobbyStore, VerifiedAuth } from './storage/LobbyStore.js';
import { registerInvitations } from './http/invitations.js';
import { CasualService } from './domain/CasualService.js';
import type { BotTimer } from './domain/bots.js';
import type { SupabaseIdentityConfig } from './identity/supabase.js';
import { registerIdentityConfiguration } from './http/identity.js';

export function createGameServer(options: {
  delegates?: RoomDelegates;
  reconnectionSeconds?: number;
  idleTimeout?: number;
  store?: LobbyStore;
  verifyAuth?: (authorization: string | undefined) => Promise<VerifiedAuth | undefined>;
  identityConfig?: SupabaseIdentityConfig;
  rankedEnabled?: boolean;
  isReady?: () => boolean;
  connections?: ConnectionHooks;
  clock?: () => number;
  botOptions?: { scheduler?: BotTimer; random?: () => number; maxNodes?: number; delayMs?: number };
} = {}) {
  assertRuntime();
  const transport = new BunWebSockets({
    idleTimeout: options.idleTimeout ?? 120,
    sendPings: true,
    maxPayloadLength: 4096,
  });
  const server = new Server({ transport, gracefullyShutdown: false, greet: false });
  const delegates = options.delegates ?? { authenticate: () => false };
  const lobby = options.store ? new LobbyService({ store: options.store, rankedEnabled: options.rankedEnabled, clock: options.clock }) : undefined;
  const casual = options.store && lobby ? new CasualService({ store: options.store, lobby, clock: options.clock }) : undefined;
  const connections = options.connections ?? (casual ? {
    connect: (matchId: string, credential: unknown, connectionId: string) => casual.connect(matchId, credential, connectionId),
    depart: (matchId: string, connectionId: string, intentional: boolean) => options.isReady && !options.isReady() ? Promise.resolve(true) : casual.depart(matchId, connectionId, intentional),
  } : undefined);
  server.define("enochian", EnochianRoom, { delegates, reconnectionSeconds: options.reconnectionSeconds, lobby, store: options.store,
    isReady: options.isReady, verifyAuth: options.verifyAuth, connections, casual, clock: options.clock, botOptions: options.botOptions });
  const app = transport.getExpressApp();
  app.get("/health", (_req, res) => res.json({ status: "ok", ...runtimeDiagnostics() }));
  // Memory-only preflight is not production multiplayer readiness.
  app.get("/ready", (_req, res) => options.isReady?.() ? res.json({ ready: true })
    : res.status(503).json({ ready: false, reason: "durable-store-not-configured-or-recovering" }));
  if (lobby) registerInvitations(app, lobby, options.verifyAuth, options.isReady);
  registerIdentityConfiguration(app, options.identityConfig, options.rankedEnabled ?? false);
  return { server, transport, app, engine: canonicalEngine, lobby, casual };
}

if (import.meta.main) {
  const { startServer } = await import('./recovery/start-server.js');
  await startServer(process.env);
}
