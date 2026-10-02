import { expect, test } from 'bun:test';
import { Client, CloseCode, type Room } from '@colyseus/sdk';
import { createGameServer } from '../src/index.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { canonicalEngine } from '../src/engine.js';
import { COLORS } from '../src/domain/match.js';

test('real SDK two humans and two canonical bots complete a full initial-state match after a drop and reclaim', async () => {
  const store = new MemoryLobbyStore(); let seed = 42;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const { server } = createGameServer({ store, botOptions: { random, maxNodes: 32, delayMs: 1 } });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const endpoint = `http://127.0.0.1:${port}`, sdk = new Client(endpoint), clients: Room[] = [];
  const post = async (path: string, body: unknown) => (await fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const wait = async (predicate: () => Promise<boolean>) => {
    const until = Date.now() + 5000;
    while (!await predicate()) { if (Date.now() >= until) throw new Error('transport timed out'); await Bun.sleep(2); }
  };
  try {
    await server.listen(port, '127.0.0.1');
    const a = await post('/invitations', { mode: 'casual', name: 'Red', color: 'R' });
    const b = await post('/invitations/join', { code: a.code, name: 'Blue', color: 'B' });
    let red = await sdk.joinById(a.roomId, { credential: a.credential }); clients.push(red);
    const blue = await sdk.joinById(a.roomId, { credential: b.credential }); clients.push(blue);
    for (const room of clients) { room.onMessage('ack', () => {}); room.reconnection.enabled = false; }
    const envelope = async (requestId: string, action: unknown) => ({ matchId: a.matchId, requestId, expectedRevision: (await store.load(a.matchId))!.revision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action });
    red.send('lobby_command', await envelope('ready-red', { type: 'ready', ready: true }));
    await wait(async () => (await store.load(a.matchId))!.seats.R.ready);
    blue.send('lobby_command', await envelope('ready-blue', { type: 'ready', ready: true }));
    await wait(async () => (await store.load(a.matchId))!.phase === 'active');
    expect(Object.keys((await store.load(a.matchId))!.engine.board)).toHaveLength(36);
    red.connection.close(CloseCode.MAY_TRY_RECONNECT, 'test network drop');
    await wait(async () => (await store.load(a.matchId))!.engine.moveCount > 0);
    expect((await store.load(a.matchId))!.seats.R.controller).toBe('temporary_bot');
    const before = (await store.load(a.matchId))!.engine.moveCount;
    red = await sdk.joinById(a.roomId, { credential: a.credential }); clients.push(red);
    red.onMessage('ack', () => {}); red.reconnection.enabled = false;
    expect((await store.load(a.matchId))!.engine.moveCount).toBeGreaterThanOrEqual(before);
    let sequence = 0, absent = false;
    const deadline = Date.now() + 45000;
    while ((await store.load(a.matchId))!.phase === 'active') {
      if (Date.now() >= deadline) throw new Error('full canonical match exceeded bounded time');
      const record = (await store.load(a.matchId))!, color = COLORS[record.engine.turnIndex]!;
      if (!absent && record.engine.moveCount >= 100) {
        red.connection.close(CloseCode.MAY_TRY_RECONNECT, 'test absent at completion');
        await wait(async () => (await store.load(a.matchId))!.seats.R.controller === 'temporary_bot');
        absent = true; continue;
      }
      if (record.seats[color].controller === 'human') {
        const move = canonicalEngine.chooseAiMove(structuredClone(record.engine), color, 'medium', random, { maxNodes: 32 });
        expect(move).not.toBeNull();
        const room = color === 'R' ? red : blue;
        let ack: { ok: boolean; code: string } | undefined;
        const unsubscribe = room.onMessage('ack', value => { ack = value; });
        room.send('command', { matchId: a.matchId, requestId: `human-${sequence++}`, expectedRevision: record.revision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action: { type: 'move', ...move } });
        await wait(async () => !!ack); unsubscribe();
        expect(ack!.ok).toBe(true);
      } else await Bun.sleep(2);
    }
    const finished = (await store.load(a.matchId))!;
    expect(finished.phase).toBe('finished'); expect(finished.terminalResult?.kind).toBe('victory');
    expect(finished.engine.moveCount).toBeGreaterThan(4);
    expect(absent).toBe(true); expect(finished.seats.R.connected).toBe(false);
    const returned = await post('/invitations/recover', { matchId: a.matchId, credential: a.credential });
    expect(returned.snapshot.terminalResult).toEqual(finished.terminalResult);
    expect(returned.roomId).toBeUndefined();
    expect((await store.load(a.matchId))!.revision).toBe(finished.revision);
    expect(JSON.stringify(red.state.toJSON())).not.toContain('ownerId');
    expect(JSON.stringify(red.state.toJSON())).not.toContain('absence');
  } finally {
    await server.gracefullyShutdown(false);
  }
}, 60000);
