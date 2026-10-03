import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { createGameServer } from '../src/index.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { COLORS } from '../src/domain/match.js';

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error('SDK state timed out'); await Bun.sleep(10); }
}

test('ranked SDK admission requires the freshly verified original account and four human readiness', async () => {
  const store = new MemoryLobbyStore(), accounts = new Map(COLORS.map(color => [`Bearer ${color}`, randomUUID()]));
  const { server } = createGameServer({ store, rankedEnabled: true, verifyAuth: async header => {
    if (header === undefined) return undefined;
    const accountId = accounts.get(header);
    if (!accountId) throw new Error('unauthorized');
    return { accountId };
  }, identityConfig: { url: 'https://auth.example.test', publishableKey: 'sb_publishable_publicfixture' } });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const endpoint = `http://127.0.0.1:${port}`, sdk = new Client(endpoint), rooms: Room[] = [];
  const post = (path: string, data: unknown, authorization?: string) => fetch(endpoint + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(data),
  });
  try {
    await server.listen(port, '127.0.0.1');
    expect((await post('/invitations', { mode: 'ranked', name: 'Guest', color: 'R' })).status).toBe(400);
    const first = await (await post('/invitations', { mode: 'ranked', name: 'Red', color: 'R' }, 'Bearer R')).json();
    await expect(sdk.joinById(first.roomId, { credential: first.credential })).rejects.toThrow('unauthorized');
    await expect(sdk.joinById(first.roomId, { credential: first.credential, authorization: 'Bearer B' })).rejects.toThrow('unauthorized');
    const tickets = [first];
    for (const color of COLORS.slice(1)) tickets.push(await (await post('/invitations/join', { code: first.code, name: color, color }, `Bearer ${color}`)).json());
    for (let i = 0; i < 4; i++) {
      const room = await sdk.joinById(first.roomId, { credential: tickets[i].credential, authorization: `Bearer ${COLORS[i]}` });
      room.onMessage('ack', () => {}); rooms.push(room);
    }
    await waitFor(() => rooms[0]!.state.connected === 4);
    for (let i = 0; i < 4; i++) {
      const revision = (await store.load(first.matchId))!.revision;
      rooms[i]!.send('lobby_command', { matchId: first.matchId, requestId: `ready-${i}`, expectedRevision: revision,
        protocolVersion: 1, rulesVersion: 'enochian-current-2', action: { type: 'ready', ready: true } });
      await waitFor(() => rooms[0]!.state.revision === revision + 1);
    }
    expect(rooms[0]!.state.phase).toBe('active');
    expect(Object.values((await store.load(first.matchId))!.seats).every(seat => seat.controller === 'human')).toBe(true);
    expect((await post('/invitations/recover', { matchId: first.matchId, credential: first.credential })).status).toBe(401);
    expect((await post('/invitations/recover', { matchId: first.matchId, credential: first.credential }, 'Bearer B')).status).toBe(401);
    accounts.delete('Bearer R');
    expect((await post('/invitations/recover', { matchId: first.matchId, credential: first.credential }, 'Bearer R')).status).toBe(401);
    const configuration = await (await fetch(endpoint + '/identity/config')).json();
    expect(configuration.providers).toEqual(['email']);
    expect(configuration.rankedEnabled).toBe(true);
    expect(JSON.stringify(configuration)).not.toContain('DATABASE_URL');
  } finally {
    // Server drain preserves infrastructure semantics instead of intentional player Leave.
    for (const room of rooms) room.reconnection.enabled = false;
    await server.gracefullyShutdown(false);
  }
}, 15000);
