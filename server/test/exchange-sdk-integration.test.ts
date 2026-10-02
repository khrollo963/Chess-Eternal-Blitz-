import { expect, test } from 'bun:test';
import { Client, CloseCode, type Room } from '@colyseus/sdk';
import { createGameServer } from '../src/index.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { recordKingCaptures } from '../src/domain/exchange.js';
import { publicSnapshot } from '../src/domain/match.js';
import type { CommandResult } from '../src/storage/MatchStore.js';

test('real SDK exchange endpoint persists canonical capture, synchronizes public offer/atomic kings and clears on disconnect', async () => {
  let now = 100;
  const store = new MemoryLobbyStore();
  const { server } = createGameServer({ store, clock: () => now, botOptions: { scheduler: { set: () => 0, clear: () => {} } } });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const endpoint = `http://127.0.0.1:${port}`, sdk = new Client(endpoint);
  const post = async (path: string, body: unknown) => (await fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const wait = async (predicate: () => Promise<boolean>) => {
    const until = Date.now() + 5000;
    while (!await predicate()) { if (Date.now() >= until) throw new Error('exchange transport timed out'); await Bun.sleep(5); }
  };
  try {
    await server.listen(port, '127.0.0.1');
    const a = await post('/invitations', { mode: 'casual', name: 'Red', color: 'R' });
    const b = await post('/invitations/join', { code: a.code, name: 'Blue', color: 'B' });
    const red = await sdk.joinById(a.roomId, { credential: a.credential }), blue = await sdk.joinById(a.roomId, { credential: b.credential });
    red.reconnection.enabled = false; blue.reconnection.enabled = false;
    red.onMessage('ack', () => {}); blue.onMessage('ack', () => {});
    const envelope = async (requestId: string, action: unknown) => ({ matchId: a.matchId, requestId, expectedRevision: (await store.load(a.matchId))!.revision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action });
    const send = async (room: Room, type: string, payload: unknown): Promise<CommandResult> => {
      let ack: CommandResult | undefined; const off = room.onMessage('ack', value => { ack = value; });
      room.send(type, payload); await wait(async () => !!ack); off(); return ack!;
    };
    expect((await send(red, 'lobby_command', await envelope('ready-r', { type: 'ready', ready: true }))).ok).toBe(true);
    expect((await send(blue, 'lobby_command', await envelope('ready-b', { type: 'ready', ready: true }))).ok).toBe(true);
    // Test-only loaded-position fixture. Actual second king capture below uses the
    // production command endpoint and canonical engine; no production orders/DB.
    const install = async () => {
      const record = (await store.load(a.matchId))!, expectedRevision = record.revision;
      record.engine.board = { '7,7': { color: 'R', type: 'KING' }, '0,7': { color: 'B', type: 'KING' }, '6,7': { color: 'K', type: 'KING' } };
      record.engine.alive = { R: true, B: true, Y: false, K: true }; record.engine.turnIndex = 0; record.engine.over = false; record.engine.moveCount = 1;
      record.prisoners = {}; record.exchangeOffer = null;
      recordKingCaptures(record, [{ type: 'capture', piece: { color: 'Y', type: 'KING' }, byColor: 'B' }]);
      record.revision++;
      await store.commit({ matchId: a.matchId, expectedRevision, next: record, events: [{ type: 'test_fixture' }], command: {
        actorId: 'test_fixture', requestId: `fixture-${record.revision}`, fingerprint: 'fixture', committedAt: now, result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(record) } } });
      const captured = await send(red, 'command', await envelope(`capture-${record.revision}`, { type: 'move', fr: 7, fc: 7, tr: 6, tc: 7 }));
      expect(captured.ok).toBe(true); expect((await store.load(a.matchId))!.prisoners?.K?.captor).toBe('R');
    };
    await install();
    const offer = await envelope('sdk-offer', { type: 'offer', counterpart: 'B' });
    const offered = await send(red, 'exchange_command', offer); expect(offered.ok).toBe(true);
    await wait(async () => red.state.exchangeId === 'sdk-offer' && blue.state.exchangeId === 'sdk-offer');
    expect(blue.state.exchangePrisonerFirst).toBe('Y'); expect(blue.state.exchangePrisonerSecond).toBe('K');
    const publicText = JSON.stringify(blue.state.toJSON());
    for (const secret of ['ownerId', 'kingOwnerId', 'captorOwnerId', 'credentialHash', a.credential, b.credential]) expect(publicText).not.toContain(secret);
    expect(await send(red, 'exchange_command', offer)).toEqual(offered);
    expect((await send(red, 'exchange_command', { ...offer, matchId: 'other-match' })).code).toBe('unauthorized');
    expect((await send(red, 'exchange_command', { ...offer, injected: true })).code).toBe('invalid_command');
    const accepted = await send(blue, 'exchange_command', await envelope('sdk-accept', { type: 'accept', offerId: 'sdk-offer' })); expect(accepted.ok).toBe(true);
    await wait(async () => blue.state.exchangeId === '' && blue.state.alive.get('Y').alive && blue.state.alive.get('K').alive);
    expect(blue.state.board.get('0,-1').type).toBe('KING'); expect(blue.state.board.get('8,0').type).toBe('KING');
    await install();
    expect((await send(red, 'exchange_command', await envelope('expiring', { type: 'offer', counterpart: 'B' }))).ok).toBe(true);
    now = 60100;
    expect((await send(blue, 'exchange_command', await envelope('late', { type: 'accept', offerId: 'expiring' }))).ok).toBe(false);
    expect((await store.load(a.matchId))!.exchangeOffer).toBeNull(); expect((await store.load(a.matchId))!.engine.alive.Y).toBe(false);
    now = 60101;
    expect((await send(blue, 'command', await envelope('blue-next', { type: 'move', fr: 0, fc: 7, tr: 1, tc: 7 }))).ok).toBe(true);
    expect((await send(red, 'exchange_command', await envelope('dropping', { type: 'offer', counterpart: 'B' }))).ok).toBe(true);
    red.connection.close(CloseCode.MAY_TRY_RECONNECT, 'test network drop');
    await wait(async () => !(await store.load(a.matchId))!.seats.R.connected);
    expect((await store.load(a.matchId))!.exchangeOffer).toBeNull();
  } finally { await server.gracefullyShutdown(false); }
}, 15000);
