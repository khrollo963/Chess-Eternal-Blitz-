import { expect, test } from 'bun:test';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { createGameServer } from '../src/index.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { publicSnapshot } from '../src/domain/match.js';
import type { EnochianRoom } from '../src/rooms/EnochianRoom.js';

async function wait(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error('Terminal lifecycle timed out'); await Bun.sleep(5); }
}

for (const phase of ['finished', 'void'] as const) test(`${phase} rooms stop polling, preserve connected final snapshots, then dispose without losing HTTP recovery`, async () => {
  const store = new MemoryLobbyStore();
  const load = store.load.bind(store); let reads = 0, disposed = 0;
  store.load = async id => { reads++; return load(id); };
  const { server } = createGameServer({ store, delegates: { authenticate: () => false, dispose: () => { disposed++; } } });
  const reserved = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reserved.port!; reserved.stop(true);
  const endpoint = `http://127.0.0.1:${port}`, sdk = new Client(endpoint), clients: Room[] = [];
  const post = async (path: string, body: unknown) => (await fetch(endpoint + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  try {
    await server.listen(port, '127.0.0.1');
    const a = await post('/invitations', { mode: 'casual', name: 'Red', color: 'R' });
    const b = await post('/invitations/join', { code: a.code, name: 'Blue', color: 'B' });
    for (const ticket of [a, b]) {
      const client = await sdk.joinById(a.roomId, { credential: ticket.credential });
      client.reconnection.enabled = false; clients.push(client);
    }
    const transportRoom = matchMaker.getLocalRoomById(a.roomId) as EnochianRoom;
    const record = (await load(a.matchId))!, previous = record.revision;
    record.phase = phase; record.revision++; record.engine.over = true; record.lobbyDeadline = null;
    record.terminalResult = phase === 'finished' ? { kind: 'victory', winningTeam: 1, reason: null }
      : { kind: 'void', winningTeam: null, reason: 'lobby_expired' };
    expect((await store.commit({ matchId: a.matchId, expectedRevision: previous, next: record, events: [{ type: phase }],
      command: { actorId: 'system', requestId: `terminal-${phase}`, fingerprint: phase, committedAt: Date.now(),
        result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(record) } } })).status).toBe('committed');
    // External expiry publishes void; ordinary polling also discovers a finished record.
    if (phase === 'void') transportRoom.publishCommitted(publicSnapshot(record));
    await wait(() => clients.every(client => client.state.phase === phase));
    expect(matchMaker.getLocalRoomById(a.roomId)).toBe(transportRoom);
    expect(clients.every(client => client.connection.isOpen)).toBe(true);
    const terminalReads = reads;
    await Bun.sleep(1150);
    expect(reads).toBe(terminalReads);
    expect(disposed).toBe(0);
    await clients[0]!.leave();
    await wait(() => transportRoom.clients.length === 1);
    expect(matchMaker.getLocalRoomById(a.roomId)).toBe(transportRoom);
    expect(clients[1]!.state.phase).toBe(phase);
    expect(disposed).toBe(0);
    await clients[1]!.leave();
    await wait(() => matchMaker.getLocalRoomById(a.roomId) === undefined);
    expect(disposed).toBe(1);
    const emptyReads = reads;
    await Bun.sleep(1150);
    expect(reads).toBe(emptyReads);
    const recovered = await post('/invitations/recover', { matchId: a.matchId, credential: a.credential });
    expect(recovered.snapshot.phase).toBe(phase);
    expect(recovered.snapshot.terminalResult).toEqual(record.terminalResult);
    expect(recovered.roomId).toBeUndefined();
    expect((await load(a.matchId))!.revision).toBe(record.revision);
    await expect(sdk.joinById(a.roomId, { credential: a.credential })).rejects.toThrow();
    // A terminal transition can also arrive after every transport client is gone.
    const empty = await post('/invitations', { mode: 'casual', name: 'Unconnected', color: 'R' });
    const emptyRoom = matchMaker.getLocalRoomById(empty.roomId) as EnochianRoom;
    const emptyRecord = (await load(empty.matchId))!, emptyRevision = emptyRecord.revision;
    emptyRecord.phase = phase; emptyRecord.revision++; emptyRecord.engine.over = true;
    emptyRecord.lobbyDeadline = null; emptyRecord.terminalResult = record.terminalResult;
    expect((await store.commit({ matchId: empty.matchId, expectedRevision: emptyRevision, next: emptyRecord, events: [],
      command: { actorId: 'system', requestId: 'terminal-empty', fingerprint: phase, committedAt: Date.now(),
        result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(emptyRecord) } } })).status).toBe('committed');
    emptyRoom.publishCommitted(publicSnapshot(emptyRecord));
    await wait(() => matchMaker.getLocalRoomById(empty.roomId) === undefined);
    expect(disposed).toBe(2);
    expect((await post('/invitations/recover', { matchId: empty.matchId, credential: empty.credential })).snapshot.phase).toBe(phase);
  } finally {
    for (const client of clients) if (client.connection.isOpen) await client.leave();
    await server.gracefullyShutdown(false);
  }
}, 15000);
