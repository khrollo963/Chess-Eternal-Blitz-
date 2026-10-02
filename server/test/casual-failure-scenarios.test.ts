import { expect, test } from 'bun:test';
import { createGameServer } from '../src/index.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { LobbyService } from '../src/domain/lobby.js';

async function httpFixture(run: (f: { endpoint: string; store: MemoryLobbyStore; post: (path: string, body: unknown) => Promise<Response>; time: (value: number) => void; ready: (value: boolean) => void }) => Promise<void>) {
  let now = 0, ready = true;
  const store = new MemoryLobbyStore();
  const { server } = createGameServer({ store, clock: () => now, isReady: () => ready, botOptions: { delayMs: 10000 } });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const endpoint = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown) => fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await server.listen(port, '127.0.0.1');
    await run({ endpoint, store, post, time: value => { now = value; }, ready: value => { ready = value; } });
  } finally { await server.gracefullyShutdown(false); }
}

test('malformed invitation JSON is a client error rather than a retryable storage outage', async () => {
  await httpFixture(async ({ endpoint }) => {
    for (const path of ['/invitations', '/invitations/join']) {
      const response = await fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"color":' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: 'invalid_command' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});

test('invitation capacity gets a retryable HTTP rate status while unexpected storage errors remain redacted', async () => {
  await httpFixture(async ({ post, store }) => {
    for (const [message, status, code] of [
      ['lobby_capacity', 429, 'lobby_capacity'],
      ['PRIVATE_STORAGE_SENTINEL', 503, 'storage_unavailable'],
    ] as const) {
      store.createInvited = async () => { throw new Error(message); };
      const response = await post('/invitations', { mode: 'casual', name: 'Red', color: 'R' });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code });
    }
  });
});

test('HTTP rejected joins, unavailable service, and exact invitation expiry preserve the roster', async () => {
  await httpFixture(async ({ post, store, time, ready }) => {
    const response = await post('/invitations', { mode: 'casual', name: 'Red', color: 'R' });
    expect(response.status).toBe(201);
    const ticket = await response.json();
    const before = await store.load(ticket.matchId);
    for (const [body, code] of [
      [{ code: ticket.code, name: 'Also red', color: 'R' }, 'color_unavailable'],
      [{ code: 'WRONG-CODE', name: 'Blue', color: 'B' }, 'not_found'],
      [{ code: ticket.code, name: 'Blue', color: 'invalid' }, 'invalid_color'],
      [{ code: ticket.code, name: '<script>', color: 'B' }, 'invalid_name'],
    ] as const) {
      const rejected = await post('/invitations/join', body);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ code });
      expect(await store.load(ticket.matchId)).toEqual(before);
    }
    const wrongCredential = await post('/invitations/recover', { matchId: ticket.matchId, credential: ticket.code });
    expect(wrongCredential.status).toBe(401);
    expect(await wrongCredential.json()).toEqual({ code: 'unauthorized' });
    ready(false);
    const unavailable = await post('/invitations/join', { code: ticket.code, name: 'Blue', color: 'B' });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ code: 'storage_unavailable' });
    expect(await store.load(ticket.matchId)).toEqual(before);
    ready(true); time(1800000);
    const expired = await post('/invitations/join', { code: ticket.code, name: 'Blue', color: 'B' });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ code: 'deadline_expired' });
    expect(await store.load(ticket.matchId)).toEqual(before);
  });
});

test('taken-color command reports the actionable code and leaves both ready seats unchanged', async () => {
  const store = new MemoryLobbyStore(), lobby = new LobbyService({ store, clock: () => 0 });
  const red = await lobby.create('casual', 'Red', 'R');
  await lobby.join(red.code, 'Blue', 'B');
  await lobby.connect(red.matchId, red.credential, 'red');
  let record = (await store.load(red.matchId))!;
  await lobby.command(red.matchId, 'red', 'ready', record.revision, { type: 'ready', ready: true });
  record = (await store.load(red.matchId))!;
  const rejected = await lobby.command(red.matchId, 'red', 'taken-blue', record.revision, { type: 'color', color: 'B' });
  expect(rejected).toEqual({ ok: false, code: 'color_unavailable', retryable: false, requestId: 'taken-blue' });
  expect(await store.load(red.matchId)).toEqual(record);
});

test('a reserved third human blocks start until connected and explicitly ready; active invitations stay closed', async () => {
  const store = new MemoryLobbyStore(), lobby = new LobbyService({ store, clock: () => 0 });
  const red = await lobby.create('casual', 'Red', 'R');
  const blue = await lobby.join(red.code, 'Blue', 'B');
  const yellow = await lobby.join(red.code, 'Yellow', 'Y');
  await lobby.connect(red.matchId, red.credential, 'red');
  await lobby.connect(red.matchId, blue.credential, 'blue');
  for (const connection of ['red', 'blue']) {
    const record = (await store.load(red.matchId))!;
    expect((await lobby.command(red.matchId, connection, `ready-${connection}`, record.revision, { type: 'ready', ready: true })).ok).toBe(true);
  }
  expect((await store.load(red.matchId))!.phase).toBe('lobby');
  await lobby.connect(red.matchId, yellow.credential, 'yellow');
  expect((await store.load(red.matchId))!.phase).toBe('lobby');
  const before = (await store.load(red.matchId))!;
  expect((await lobby.command(red.matchId, 'yellow', 'ready-yellow', before.revision, { type: 'ready', ready: true })).snapshot?.phase).toBe('active');
  const active = (await store.load(red.matchId))!;
  expect(active.seats.K.controller).toBe('bot');
  await expect(lobby.join(red.code, 'Late black', 'K')).rejects.toThrow('invalid_phase');
  expect(await store.load(red.matchId)).toEqual(active);
});
