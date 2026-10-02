import { expect, test } from "bun:test";
import { Client, CloseCode, type Room } from "@colyseus/sdk";
import { createGameServer } from "../src/index.js";
import { assertRuntime } from "../src/config.js";

async function waitFor(predicate: () => boolean, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error("Timed out waiting for transport event");
    await Bun.sleep(10);
  }
}

test("Bun SDK auth, schema, lobby, heartbeat, drop/reconnect and graceful close", async () => {
  assertRuntime();
  console.info(`G9 runtime Bun ${process.versions.bun}`);
  const events: string[] = [];
  const { server, app, engine } = createGameServer({ idleTimeout: 2, delegates: {
    authenticate(options) {
      events.push("auth");
      return (options as { token?: string }).token === "probe-private" ? { id: "probe" } : false;
    },
    join: client => { expect(client.auth.id).toBe("probe"); events.push("join"); },
    drop: () => { events.push("drop"); },
    reconnect: () => { events.push("reconnect"); },
    leave: () => { events.push("leave"); },
    dispose: () => { events.push("dispose"); },
  } });
  expect(Object.keys(engine.initialState().board)).toHaveLength(36);
  // Representative routes test transport HTTP/auth behavior; not production identity.
  app.get("/probe/auth", (req, res) => {
    res.status(req.headers.authorization === "Bearer probe-private" ? 200 : 401).json({ authenticated: req.headers.authorization === "Bearer probe-private" });
  });
  app.get("/probe/invite/:code", (req, res) => {
    res.status(req.params.code === "ABCD" ? 200 : 404).json({ code: req.params.code, roomType: "enochian" });
  });
  // Reserve an ephemeral loopback port; transport does not expose its actual port.
  const reservation = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  const http = `http://127.0.0.1:${port}`;
  const sdk = new Client(http);
  const clients: Room[] = [];
  try {
    await server.listen(port, "127.0.0.1");
    expect((await (await fetch(`${http}/health`)).json()).bun).toBe("1.4.2");
    expect((await fetch(`${http}/ready`)).status).toBe(503);
    expect((await fetch(`${http}/probe/auth`)).status).toBe(401);
    expect((await fetch(`${http}/probe/auth`, { headers: { authorization: "Bearer probe-private" } })).status).toBe(200);
    expect((await fetch(`${http}/probe/invite/ABCD`)).status).toBe(200);
    expect((await fetch(`${http}/probe/invite/nope`)).status).toBe(404);
    await expect(sdk.joinOrCreate("enochian", { token: "wrong" })).rejects.toThrow();
    const first = await sdk.create("enochian", { token: "probe-private" });
    clients.push(first);
    const second = await sdk.joinById(first.roomId, { token: "probe-private" });
    clients.push(second);
    await waitFor(() => first.state?.connected === 2 && second.state?.connected === 2);
    let message: unknown;
    second.onMessage("lobby", value => { message = value; });
    first.onMessage("lobby", () => {});
    first.send("lobby", "hello");
    await waitFor(() => second.state?.revision === 1 && message !== undefined);
    expect(second.state.lastLobbyMessage).toBe("hello");
    expect(message).toEqual({ sender: first.sessionId, message: "hello" });
    // No application messages for >3 idle windows. Bun's ping/pong keeps it alive.
    await Bun.sleep(6500);
    expect(first.connection.isOpen).toBe(true);
    expect(events.filter(event => event === "drop")).toHaveLength(0);
    first.reconnection.minUptime = 0;
    const originalSession = first.sessionId;
    first.connection.close(CloseCode.MAY_TRY_RECONNECT, "probe unexpected drop");
    await waitFor(() => events.includes("drop") && events.includes("reconnect"));
    expect(first.sessionId).toBe(originalSession);
    await waitFor(() => second.state?.connected === 2);
    const drops = events.filter(event => event === "drop").length;
    await second.leave();
    await waitFor(() => events.includes("leave"));
    expect(events.filter(event => event === "drop")).toHaveLength(drops);
    const disposals = events.filter(event => event === "dispose").length;
    await first.leave();
    await waitFor(() => events.filter(event => event === "dispose").length > disposals);
  } finally {
    for (const room of clients) { room.reconnection.enabled = false; if (room.connection.isOpen) await room.leave(); }
    await server.gracefullyShutdown(false);
  }
  await expect(fetch(`${http}/health`)).rejects.toThrow();
}, 20000);
