import { Server } from "@colyseus/core";
import { BunWebSockets } from "@colyseus/bun-websockets";
import { assertRuntime, readConfig, runtimeDiagnostics } from "./config.js";
import { EnochianRoom, type RoomDelegates } from "./rooms/EnochianRoom.js";
import { canonicalEngine } from "./engine.js";

export function createGameServer(options: {
  delegates?: RoomDelegates;
  reconnectionSeconds?: number;
  idleTimeout?: number;
} = {}) {
  assertRuntime();
  const transport = new BunWebSockets({
    idleTimeout: options.idleTimeout ?? 120,
    sendPings: true,
    maxPayloadLength: 4096,
  });
  const server = new Server({ transport, gracefullyShutdown: false, greet: false });
  const delegates = options.delegates ?? { authenticate: () => false };
  server.define("enochian", EnochianRoom, { delegates, reconnectionSeconds: options.reconnectionSeconds });
  const app = transport.getExpressApp();
  app.get("/health", (_req, res) => res.json({ status: "ok", ...runtimeDiagnostics() }));
  // Memory-only preflight is not production multiplayer readiness.
  app.get("/ready", (_req, res) => res.status(503).json({ ready: false, reason: "durable-store-not-configured" }));
  return { server, transport, app, engine: canonicalEngine };
}

if (import.meta.main) {
  const config = readConfig();
  const { server } = createGameServer();
  await server.listen(config.port, config.hostname);
  console.info(JSON.stringify({ ...runtimeDiagnostics(), port: config.port, hostname: config.hostname }));
  let shutdown: Promise<void> | undefined;
  const close = () => shutdown ??= server.gracefullyShutdown(false);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
