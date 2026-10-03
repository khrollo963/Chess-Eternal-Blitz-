import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Client, CloseCode, type Room } from '@colyseus/sdk';
import { createGameServer } from '../src/index.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { COLORS } from '../src/domain/match.js';
import { canonicalEngine } from '../src/engine.js';

async function setup() {
  let now = 1000;
  const store = new MemoryLobbyStore(), accounts = new Map(COLORS.map(color => [`Bearer ${color}`, randomUUID()]));
  const { server } = createGameServer({ store, rankedEnabled: true, clock: () => now, verifyAuth: async header => {
    const accountId = header && accounts.get(header); if (!accountId) throw new Error('unauthorized'); return { accountId };
  } });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  await server.listen(port, '127.0.0.1');
  const endpoint = `http://127.0.0.1:${port}`, sdk = new Client(endpoint), clients: Room[] = [];
  const post = async (path: string, body: unknown, authorization: string) => (await fetch(endpoint + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(body),
  })).json();
  const wait = async (predicate: () => Promise<boolean>) => {
    const until = Date.now() + 5000;
    while (!await predicate()) { if (Date.now() >= until) throw new Error('Ranked SDK timed out'); await Bun.sleep(2); }
  };
  try {
    const first = await post('/invitations', { mode: 'ranked', name: 'Red', color: 'R' }, 'Bearer R'), tickets = [first];
    for (const color of COLORS.slice(1)) tickets.push(await post('/invitations/join', { code: first.code, name: color, color }, `Bearer ${color}`));
    for (let i = 0; i < 4; i++) {
      const room = await sdk.joinById(first.roomId, { credential: tickets[i].credential, authorization: `Bearer ${COLORS[i]}` });
      room.onMessage('ack', () => {}); room.reconnection.enabled = false; clients.push(room);
    }
    for (let i = 0; i < 4; i++) {
      const before = (await store.load(first.matchId))!;
      clients[i]!.send('lobby_command', { matchId: first.matchId, requestId: `ready-${i}`, expectedRevision: before.revision,
        protocolVersion: 1, rulesVersion: 'enochian-current-2', action: { type: 'ready', ready: true } });
      await wait(async () => (await store.load(first.matchId))!.revision > before.revision);
    }
    return { store, server, sdk, clients, first, tickets, post, wait, time: (value: number) => { now = value; } };
  } catch (error) { await server.gracefullyShutdown(false); throw error; }
}

test('real ranked SDK drop pauses, strict return resumes and delayed expiry penalizes only the expired player', async () => {
  const f = await setup();
  try {
    f.clients[0]!.connection.close(CloseCode.MAY_TRY_RECONNECT, 'network drop');
    await f.wait(async () => (await f.store.load(f.first.matchId))!.phase === 'paused');
    const paused = (await f.store.load(f.first.matchId))!;
    let ack: { ok: boolean; code: string } | undefined;
    f.clients[2]!.onMessage('ack', value => { ack = value; });
    const move = { matchId: f.first.matchId, requestId: 'paused-move', expectedRevision: paused.revision,
      protocolVersion: 1, rulesVersion: 'enochian-current-2', action: { type: 'move', fr: 0, fc: 0, tr: 1, tc: 0 } };
    f.clients[2]!.send('command', move); await f.wait(async () => !!ack);
    expect(ack!.code).toBe('invalid_phase'); expect((await f.store.load(f.first.matchId))!.engine.moveCount).toBe(0);
    f.time(300999);
    const red = await f.sdk.joinById(f.first.roomId, { credential: f.first.credential, authorization: 'Bearer R' });
    red.onMessage('ack', () => {}); red.reconnection.enabled = false; f.clients.push(red);
    expect((await f.store.load(f.first.matchId))!.phase).toBe('active');
    red.connection.close(CloseCode.MAY_TRY_RECONNECT, 'repeat drop');
    f.clients[1]!.connection.close(CloseCode.MAY_TRY_RECONNECT, 'second independent drop');
    await f.wait(async () => !(await f.store.load(f.first.matchId))!.seats.B.connected);
    f.time(301000); ack = undefined;
    f.clients[2]!.send('command', { ...move, requestId: 'expiry-preflight', expectedRevision: (await f.store.load(f.first.matchId))!.revision });
    await f.wait(async () => !!ack);
    const final = (await f.store.load(f.first.matchId))!;
    expect(final.phase).toBe('void'); expect(final.terminalResult?.reason).toBe('abandonment');
    expect((final as typeof final & { expiredDepartures: string[] }).expiredDepartures).toEqual(['R']);
    expect(Object.values(final.seats).every(seat => seat.controller === 'human')).toBe(true);
    const recovered = await f.post('/invitations/recover', { matchId: f.first.matchId, credential: f.first.credential }, 'Bearer R');
    expect(recovered.snapshot.terminalResult).toEqual(final.terminalResult); expect(recovered.roomId).toBeUndefined();
  } finally { await f.server.gracefullyShutdown(false); }
}, 15000);

test('four real SDK human controllers complete a canonical ranked match and final command replays once', async () => {
  const f = await setup(); let seed = 42, last: unknown, lastRoom: Room | undefined;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    const until = Date.now() + 45000;
    let sequence = 0;
    while ((await f.store.load(f.first.matchId))!.phase === 'active') {
      if (Date.now() >= until || sequence >= 4000) throw new Error('Canonical ranked match exceeded bounded test');
      const record = (await f.store.load(f.first.matchId))!, color = COLORS[record.engine.turnIndex]!;
      const move = canonicalEngine.chooseAiMove(structuredClone(record.engine), color, 'medium', random, { maxNodes: 32 });
      expect(move).not.toBeNull();
      const room = f.clients[COLORS.indexOf(color)]!;
      let ack: { ok: boolean; code: string } | undefined;
      const unsubscribe = room.onMessage('ack', value => { ack = value; });
      last = { matchId: f.first.matchId, requestId: `human-${sequence++}`, expectedRevision: record.revision,
        protocolVersion: 1, rulesVersion: 'enochian-current-2', action: { type: 'move', ...move } };
      lastRoom = room; room.send('command', last);
      await f.wait(async () => !!ack); unsubscribe(); expect(ack!.ok).toBe(true);
    }
    const finished = (await f.store.load(f.first.matchId))!;
    expect(finished.phase).toBe('finished');
    const outcome = canonicalEngine.outcome(finished.engine)!;
    expect(finished.terminalResult).toEqual({kind:outcome.kind ?? 'victory',winningTeam:outcome.winningTeam,reason:outcome.reason ?? null});
    expect((finished as typeof finished & { pendingSettlement: boolean }).pendingSettlement).toBe(true);
    let replay: { ok: boolean } | undefined;
    lastRoom!.onMessage('ack', value => { replay = value; }); lastRoom!.send('command', last);
    await f.wait(async () => !!replay); expect(replay!.ok).toBe(true);
    expect((await f.store.load(f.first.matchId))!.revision).toBe(finished.revision);
    expect(Object.values(finished.seats).every(seat => seat.controller === 'human')).toBe(true);
  } finally { await f.server.gracefullyShutdown(false); }
}, 60000);
