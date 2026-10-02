import { expect, test } from 'bun:test';
import { LobbyService } from '../src/domain/lobby.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { publicSnapshot } from '../src/domain/match.js';

function fixture(options: Record<string, unknown> = {}) {
  let now = 1000;
  const store = new MemoryLobbyStore();
  const lobby = new LobbyService({ store, clock: () => now, ...options });
  return { store, lobby, advance: (ms: number) => { now += ms; } };
}
test('collision reservation retries without replacing a private match', async () => {
  const codes = ['ABCDEFGH', 'ABCDEFGH', 'BCDEFGHJ'];
  const { lobby, store } = fixture({ code: () => codes.shift()! });
  const a = await lobby.create('casual', 'Alice', 'R');
  const b = await lobby.create('casual', 'Bob', 'R');
  expect(a.code).not.toBe(b.code);
  expect((await store.loadByInvite(a.code))?.matchId).toBe(a.matchId);
  expect(JSON.stringify(publicSnapshot((await store.load(a.matchId))!))).not.toContain(a.credential);
});
test('credentials authenticate before snapshots and duplicate active connections are rejected', async () => {
  const { lobby } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  await expect(lobby.connect(a.matchId, a.code, 'evil')).rejects.toThrow('unauthorized');
  const connected = await lobby.connect(a.matchId, a.credential, 'one');
  expect(connected.snapshot.seats.R.connected).toBe(true);
  await expect(lobby.connect(a.matchId, a.credential, 'two')).rejects.toThrow('duplicate_connection');
});
test('absolute expiry cannot be extended by joining and full rooms reject a fifth human', async () => {
  const { lobby, advance } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  for (const color of ['B', 'Y', 'K'] as const) await lobby.join(a.code, color, color);
  await expect(lobby.join(a.code, 'fifth', 'R')).rejects.toThrow('room_full');
  advance(1800000);
  await expect(lobby.connect(a.matchId, a.credential, 'one')).rejects.toThrow('deadline_expired');
  await expect(lobby.join(a.code, 'late', 'R')).rejects.toThrow('deadline_expired');
});
test('explicit ready starts two human casual roster and bots only after both ready', async () => {
  const { lobby, store } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  const b = await lobby.join(a.code, 'Bob', 'B');
  await lobby.connect(a.matchId, a.credential, 'one');
  await lobby.connect(a.matchId, b.credential, 'two');
  let record = (await store.load(a.matchId))!;
  await lobby.command(a.matchId, 'one', 'r1', record.revision, { type: 'ready', ready: true });
  record = (await store.load(a.matchId))!;
  expect(record.phase).toBe('lobby');
  const result = await lobby.command(a.matchId, 'two', 'r2', record.revision, { type: 'ready', ready: true });
  expect(result.snapshot?.phase).toBe('active');
  expect(result.snapshot?.seats.Y.controller).toBe('bot');
  await expect(lobby.join(a.code, 'late', 'Y')).rejects.toThrow('invalid_phase');
});
test('prestart departure revokes ownership and frees color while color changes clear readiness', async () => {
  const { lobby, store } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  await lobby.connect(a.matchId, a.credential, 'one');
  let record = (await store.load(a.matchId))!;
  await lobby.command(a.matchId, 'one', 'r', record.revision, { type: 'ready', ready: true });
  record = (await store.load(a.matchId))!;
  await lobby.command(a.matchId, 'one', 'c', record.revision, { type: 'color', color: 'Y' });
  record = (await store.load(a.matchId))!;
  expect(record.seats.Y.ready).toBe(false);
  await lobby.depart(a.matchId, 'one');
  await expect(lobby.connect(a.matchId, a.credential, 'again')).rejects.toThrow('unauthorized');
  await lobby.join(a.code, 'Replacement', 'Y');
});
test('concurrent readiness has one CAS winner and duplicate commands replay', async () => {
  const { lobby, store } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  const b = await lobby.join(a.code, 'Bob', 'B');
  await lobby.connect(a.matchId, a.credential, 'one');
  await lobby.connect(a.matchId, b.credential, 'two');
  const revision = (await store.load(a.matchId))!.revision;
  const results = await Promise.all(['one', 'two'].map((id, i) => lobby.command(a.matchId, id, `r${i}`, revision, { type: 'ready', ready: true })));
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect(results.filter(result => result.code === 'stale_revision')).toHaveLength(1);
  const winner = results[0]!.ok ? 0 : 1;
  expect(await lobby.command(a.matchId, ['one', 'two'][winner]!, `r${winner}`, revision, { type: 'ready', ready: true })).toEqual(results[winner]!);
});
test('ranked remains gated and requires four distinct server verified accounts', async () => {
  await expect(fixture().lobby.create('ranked', 'A', 'R', { accountId: 'a' })).rejects.toThrow('ranked_disabled');
  const { lobby, store } = fixture({ rankedEnabled: true });
  await expect(lobby.create('ranked', 'A', 'R')).rejects.toThrow('unauthorized');
  const a = await lobby.create('ranked', 'A', 'R', { accountId: 'a' });
  await expect(lobby.join(a.code, 'A2', 'B', { accountId: 'a' })).rejects.toThrow('duplicate_account');
  const tickets = [a];
  for (const color of ['B', 'Y', 'K'] as const) tickets.push(await lobby.join(a.code, color, color, { accountId: color }));
  for (let i = 0; i < 4; i++) await lobby.connect(a.matchId, tickets[i]!.credential, `c${i}`);
  for (let i = 0; i < 4; i++) await lobby.command(a.matchId, `c${i}`, `r${i}`, (await store.load(a.matchId))!.revision, { type: 'ready', ready: true });
  expect((await store.load(a.matchId))!.phase).toBe('active');
});
test('plain names reject markup and control characters', async () => {
  const { lobby } = fixture();
  for (const name of ['<script>', 'x\n', 'a'.repeat(33), '']) await expect(lobby.create('casual', name, 'R')).rejects.toThrow('invalid_name');
});
test('storage failure keeps ready snapshot unchanged and reports retryable storage failure', async () => {
  const { lobby, store } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  await lobby.connect(a.matchId, a.credential, 'one');
  const before = (await store.load(a.matchId))!;
  store.commit = async () => { throw new Error('private-storage-secret'); };
  const result = await lobby.command(a.matchId, 'one', 'ready', before.revision, { type: 'ready', ready: true });
  expect(result).toEqual({ ok: false, code: 'storage_unavailable', retryable: true, requestId: 'ready' });
  expect(await store.load(a.matchId)).toEqual(before);
});
test('color contention and malformed actions do not mutate state', async () => {
  const { lobby, store } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  await lobby.join(a.code, 'Bob', 'B');
  await lobby.connect(a.matchId, a.credential, 'one');
  const before = (await store.load(a.matchId))!;
  expect((await lobby.command(a.matchId, 'one', 'color', before.revision, { type: 'color', color: 'B' })).ok).toBe(false);
  for (const action of [Object.assign(Object.create({}), { type: 'ready', ready: true }), { type: 'ready', ready: true, credential: 'secret' }, null]) {
    expect((await lobby.command(a.matchId, 'one', 'invalid', before.revision, action as never)).code).toBe('invalid_command');
  }
  expect(await store.load(a.matchId)).toEqual(before);
});
test('racing changed payload with the same request ID cannot replay an accepted acknowledgement', async () => {
  const { lobby, store } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  await lobby.connect(a.matchId, a.credential, 'one');
  const revision = (await store.load(a.matchId))!.revision;
  const results = await Promise.all([lobby.command(a.matchId, 'one', 'same', revision, { type: 'ready', ready: true }), lobby.command(a.matchId, 'one', 'same', revision, { type: 'ready', ready: false })]);
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect(results.filter(result => result.code === 'request_conflict')).toHaveLength(1);
});
test('simultaneous prestart departures both release ownership despite a CAS race', async () => {
  const { lobby, store } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  const b = await lobby.join(a.code, 'Bob', 'B');
  await lobby.connect(a.matchId, a.credential, 'one');
  await lobby.connect(a.matchId, b.credential, 'two');
  const results = await Promise.allSettled([lobby.depart(a.matchId, 'one'), lobby.depart(a.matchId, 'two')]);
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
  const record = (await store.load(a.matchId))!;
  expect(record.seats.R.ownerId).toBeNull();
  expect(record.seats.B.ownerId).toBeNull();
  await expect(lobby.connect(a.matchId, a.credential, 'again')).rejects.toThrow('unauthorized');
  await expect(lobby.connect(a.matchId, b.credential, 'again')).rejects.toThrow('unauthorized');
});
test('an obsolete departure callback cannot clear the replacement connection', async () => {
  const { lobby, store } = fixture();
  const a = await lobby.create('casual', 'Alice', 'R');
  await lobby.connect(a.matchId, a.credential, 'old');
  await lobby.depart(a.matchId, 'old');
  const replacement = await lobby.join(a.code, 'Replacement', 'R');
  await lobby.connect(a.matchId, replacement.credential, 'retained');
  const before = await store.load(a.matchId);
  await lobby.depart(a.matchId, 'old');
  expect(await store.load(a.matchId)).toEqual(before);
  expect((await lobby.actorForConnection(a.matchId, 'retained')).seat).toBe('R');
});
