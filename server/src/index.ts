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
import { RankedService } from './domain/RankedService.js';
import { registerSignIn } from './http/signin.js';
import { SecureBunWebSockets } from './http/SecureBunWebSockets.js';
import type { TransportSecurity } from './http/transport-security.js';

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
  transportSecurity?: TransportSecurity;
  ingressPolicy?: 'railway-edge-only' | 'local-fixture';
} = {}) {
  assertRuntime();
  const websocketOptions = {
    idleTimeout: options.idleTimeout ?? 120,
    sendPings: true,
    maxPayloadLength: 4096,
  };
  const transport = options.transportSecurity
    ? new SecureBunWebSockets(websocketOptions, { security: options.transportSecurity, ingressPolicy: options.ingressPolicy ?? 'railway-edge-only', clock: options.clock })
    : new BunWebSockets(websocketOptions);
  const server = new Server({ transport, gracefullyShutdown: false, greet: false,
    // Declare the existing Express app so Colyseus checks its registered root
    // route before adding the router's default banner on the Bun transport.
    express: () => {},
  });
  const delegates = options.delegates ?? { authenticate: () => false };
  const lobby = options.store ? new LobbyService({ store: options.store, rankedEnabled: options.rankedEnabled, clock: options.clock }) : undefined;
  const casual = options.store && lobby ? new CasualService({ store: options.store, lobby, clock: options.clock }) : undefined;
  const ranked = options.store && lobby ? new RankedService({ store: options.store, lobby, clock: options.clock }) : undefined;
  const connections = options.connections ?? (casual ? {
    async connect(matchId: string, credential: unknown, connectionId: string) {
      const record = await options.store!.load(matchId);
      return record?.mode === 'ranked' ? ranked!.connect(matchId, credential, connectionId) : casual.connect(matchId, credential, connectionId);
    },
    async depart(matchId: string, connectionId: string, intentional: boolean) {
      if (options.isReady && !options.isReady()) return true;
      const record = await options.store!.load(matchId);
      return record?.mode === 'ranked' ? ranked!.depart(matchId, connectionId, intentional) : casual.depart(matchId, connectionId, intentional);
    },
  } : undefined);
  server.define("enochian", EnochianRoom, { delegates, reconnectionSeconds: options.reconnectionSeconds, lobby, store: options.store,
    isReady: options.isReady, verifyAuth: options.verifyAuth, connections, casual, ranked, clock: options.clock, botOptions: options.botOptions, transportSecurity: options.transportSecurity });
  const app = transport.getExpressApp();
  app.get("/health", (_req, res) => res.json({ status: "ok", ...runtimeDiagnostics() }));
  // Memory-only preflight is not production multiplayer readiness.
  app.get("/ready", (_req, res) => options.isReady?.() ? res.json({ ready: true })
    : res.status(503).json({ ready: false, reason: "durable-store-not-configured-or-recovering" }));
  if (lobby) registerInvitations(app, lobby, options.verifyAuth, options.isReady);
  registerIdentityConfiguration(app, options.identityConfig, options.rankedEnabled ?? false);
  registerSignIn(app, { identityConfig: options.identityConfig, verifyAuth: options.verifyAuth, clock: options.clock });
  return { server, transport, app, engine: canonicalEngine, lobby, casual, ranked };
}

if (import.meta.main) {
  const { startServer } = await import('./recovery/start-server.js');
  await startServer(process.env);
}
