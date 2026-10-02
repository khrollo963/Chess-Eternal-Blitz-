import { expect, test } from 'bun:test';
import { Client, type Room } from '@colyseus/sdk';
import { createGameServer } from '../src/index.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { canonicalEngine } from '../src/domain/match.js';

async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= end) throw new Error('Timed out'); await Bun.sleep(10); }
}
test('private HTTP invitations and real SDK credentials synchronize committed lobby and move revisions', async () => {
  const store = new MemoryLobbyStore();
  const { server } = createGameServer({ store });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const endpoint = `http://127.0.0.1:${port}`;
  const sdk = new Client(endpoint), clients: Room[] = [];
  const post = async (path: string, body: unknown) => fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await server.listen(port, '127.0.0.1');
    const created = await post('/invitations', { mode: 'casual', name: 'Alice', color: 'R' });
    expect(created.status).toBe(201);
    const a = await created.json();
    expect((await fetch(endpoint + '/ready')).status).toBe(503);
    const mapping = await (await fetch(`${endpoint}/invitations/${a.code}`)).json();
    expect(Object.keys(mapping).sort()).toEqual(['matchId', 'roomId']);
    const rejected = await post('/invitations/recover', { matchId: a.matchId, credential: a.code });
    expect(rejected.status).toBe(401);
    await expect(sdk.joinById(a.roomId, { credential: a.code })).rejects.toThrow();
    await expect(sdk.create('enochian', { matchId: a.matchId })).rejects.toThrow();
    const first = await sdk.joinById(a.roomId, { credential: a.credential }); clients.push(first);
    first.onMessage('ack', () => {});
    await expect(sdk.joinById(a.roomId, { credential: a.credential })).rejects.toThrow();
    const b = await (await post('/invitations/join', { code: a.code, name: 'Bob', color: 'B' })).json();
    const second = await sdk.joinById(a.roomId, { credential: b.credential }); clients.push(second);
    second.onMessage('ack', () => {});
    await waitFor(() => first.state?.connected === 2);
    expect(first.state.matchId).toBe(a.matchId);
    expect(first.state.board.size).toBe(36);
    expect(JSON.stringify(first.state.toJSON())).not.toContain(a.credential);
    expect(JSON.stringify(first.state.toJSON())).not.toContain('ownerId');
    const select = async (room: Room, color: string, id: string) => {
      const revision = (await store.load(a.matchId))!.revision;
      room.send('lobby_command', { matchId: a.matchId, requestId: id, expectedRevision: revision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action: { type: 'color', color } });
      await waitFor(() => first.state.revision === revision + 1 && second.state.revision === revision + 1);
    };
    await select(first, 'Y', 'a-yellow');
    await select(second, 'R', 'b-red');
    await select(first, 'B', 'a-blue');
    const sendReady = (room: Room, id: string) => room.send('lobby_command', { matchId: a.matchId, requestId: id, expectedRevision: room.state.revision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action: { type: 'ready', ready: true } });
    const before = first.state.revision;
    sendReady(first, 'a-ready');
    await waitFor(() => second.state.revision === before + 1);
    expect(second.state.phase).toBe('lobby');
    sendReady(second, 'b-ready');
    await waitFor(() => first.state.phase === 'active');
    expect(first.state.seats.get('Y').controller).toBe('bot');
    const activeRevision = first.state.revision;
    second.send('command', { matchId: a.matchId, requestId: 'move1', expectedRevision: activeRevision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action: { type: 'move', fr: 6, fc: 7, tr: 5, tc: 7 } });
    await waitFor(() => second.state.revision === activeRevision + 1);
    expect((await store.load(a.matchId))?.revision).toBe(second.state.revision);
    expect(second.state.moveCount).toBe(1);
    const record = (await store.load(a.matchId))!;
    let move: { fr: number; fc: number; tr: number; tc: number } | undefined;
    for (const [key, piece] of Object.entries(record.engine.board)) {
      if (piece.color !== 'B') continue;
      const [r, c] = key.split(',').map(Number);
      const to = canonicalEngine.legalMoves(record.engine, { r: r!, c: c! })[0];
      if (to) { move = { fr: r!, fc: c!, tr: to.r, tc: to.c }; break; }
    }
    expect(move).toBeDefined();
    first.send('command', { matchId: a.matchId, requestId: 'blue-move', expectedRevision: record.revision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action: { type: 'move', ...move } });
    await waitFor(() => second.state.revision === record.revision + 1);
    expect(second.state.moveCount).toBe(2);
  } finally {
    for (const room of clients) { room.reconnection.enabled = false; if (room.connection.isOpen) await room.leave(); }
    await server.gracefullyShutdown(false);
  }
}, 15000);
test('storage errors are redacted at SDK authentication and command boundaries', async () => {
  const store = new MemoryLobbyStore();
  const { server } = createGameServer({ store });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const endpoint = `http://127.0.0.1:${port}`, sdk = new Client(endpoint);
  const originalLoad = store.load.bind(store), originalError = console.error;
  const logged: string[] = [];
  let room: Room | undefined;
  try {
    await server.listen(port, '127.0.0.1');
    const ticket = await (await fetch(endpoint + '/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'casual', name: 'Alice', color: 'R' }) })).json();
    console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    store.load = async () => { throw new Error('PRIVATE_DATABASE_SENTINEL'); };
    let rejected: unknown;
    try { await sdk.joinById(ticket.roomId, { credential: ticket.credential }); } catch (error) { rejected = error; }
    expect(String(rejected)).toContain('storage_unavailable');
    expect(String(rejected)).not.toContain('PRIVATE_DATABASE_SENTINEL');
    expect(logged.join('\n')).not.toContain('PRIVATE_DATABASE_SENTINEL');
    store.load = originalLoad;
    room = await sdk.joinById(ticket.roomId, { credential: ticket.credential });
    let ack: { code: string; retryable: boolean } | undefined;
    room.onMessage('ack', value => { ack = value; });
    store.load = async () => { throw new Error('PRIVATE_DATABASE_SENTINEL'); };
    room.send('command', { matchId: ticket.matchId, requestId: 'fail', expectedRevision: 0, protocolVersion: 1, rulesVersion: 'enochian-current-1', action: { type: 'move', fr: 6, fc: 7, tr: 5, tc: 7 } });
    await waitFor(() => ack !== undefined);
    expect(ack).toEqual({ ok: false, code: 'storage_unavailable', retryable: true } as never);
    expect(logged.join('\n')).not.toContain('PRIVATE_DATABASE_SENTINEL');
  } finally {
    store.load = originalLoad; console.error = originalError;
    if (room) { room.reconnection.enabled = false; if (room.connection.isOpen) await room.leave(); }
    await server.gracefullyShutdown(false);
  }
}, 15000);
