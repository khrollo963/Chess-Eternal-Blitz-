import { expect, test } from 'bun:test';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { LobbyService } from '../src/domain/lobby.js';
import { CasualService } from '../src/domain/CasualService.js';
import { BotScheduler } from '../src/domain/bots.js';
import { CommandProcessor } from '../src/domain/commands.js';
import type { LobbyRecord } from '../src/storage/LobbyStore.js';
import type { CasualRecord } from '../src/domain/casual.js';

async function fixture() {
  let now = 0;
  const store = new MemoryLobbyStore(), lobby = new LobbyService({ store, clock: () => now });
  const a = await lobby.create('casual', 'A', 'R'), b = await lobby.join(a.code, 'B', 'B');
  await lobby.connect(a.matchId, a.credential, 'a'); await lobby.connect(a.matchId, b.credential, 'b');
  let record = (await store.load(a.matchId))!;
  await lobby.command(a.matchId, 'a', 'ready-a', record.revision, { type: 'ready', ready: true });
  record = (await store.load(a.matchId))!;
  await lobby.command(a.matchId, 'b', 'ready-b', record.revision, { type: 'ready', ready: true });
  const service = new CasualService({ store, lobby, clock: () => now });
  return { store, lobby, a, b, service, time: (value: number) => { now = value; }, load: async () => (await store.load(a.matchId))! as LobbyRecord & CasualRecord };
}
test('persisted lifecycle boundary, repeated drops and original credential only', async () => {
  const f = await fixture();
  expect((await f.load()).seats.Y.ownerId).toBe(`server-bot:${f.a.matchId}:Y`);
  await f.service.depart(f.a.matchId, 'a', false);
  expect((await f.load()).absence?.R).toEqual({ usedMs: 0, departedAt: 0 });
  await expect(f.service.connect(f.a.matchId, f.a.code, 'evil')).rejects.toThrow('unauthorized');
  f.time(179999); await f.service.connect(f.a.matchId, f.a.credential, 'a2');
  await f.service.depart(f.a.matchId, 'a', true); // old callback cannot erase replacement
  expect((await f.load()).seats.R.connected).toBe(true);
  await f.service.depart(f.a.matchId, 'a2', false);
  expect((await f.load()).seats.R.disconnectDeadline).toBe(180000);
  f.time(180000);
  await expect(f.service.connect(f.a.matchId, f.a.credential, 'late')).rejects.toThrow('deadline_expired');
  expect((await f.load()).seats.R.controller).toBe('bot');
  expect((await f.load()).seats.R.disconnectDeadline).toBeNull();
});
test('CAS retries recheck original session and concurrent reclaim grants one connection', async () => {
  const f = await fixture(); await f.service.depart(f.a.matchId, 'a', false);
  const results = await Promise.allSettled([f.service.connect(f.a.matchId, f.a.credential, 'one'), f.service.connect(f.a.matchId, f.a.credential, 'two')]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect((await f.load()).seats.R.controller).toBe('human');
});
test('reclaim cancels stale bot revision and retains previously accepted canonical bot move', async () => {
  const f = await fixture(); await f.service.depart(f.a.matchId, 'a', false);
  const callbacks: Array<() => Promise<void>> = [];
  const bots = new BotScheduler({ store: f.store, processor: new CommandProcessor({ store: f.store, clock: () => 0 }),
    clock: () => 0, random: () => 0, maxNodes: 5, scheduler: { set: callback => { callbacks.push(callback); return callbacks.length; }, clear: () => {} } });
  bots.schedule(await f.load()); await callbacks[0]!();
  expect((await f.load()).engine.moveCount).toBe(1);
  await f.service.connect(f.a.matchId, f.a.credential, 'return');
  await callbacks[0]!(); expect((await f.load()).engine.moveCount).toBe(1);
  bots.dispose();
});
test('late maintenance persists independent permanent controls before canonical bot work', async () => {
  const f = await fixture();
  await Promise.all([f.service.depart(f.a.matchId, 'a', false), f.service.depart(f.a.matchId, 'b', false)]);
  f.time(180000); await f.service.expire(f.a.matchId);
  const expired = await f.load();
  expect(expired.seats.R.controller).toBe('bot'); expect(expired.seats.B.controller).toBe('bot');
  expect(expired.seats.R.disconnectDeadline).toBeNull(); expect(expired.seats.B.disconnectDeadline).toBeNull();
  const callbacks: Array<() => Promise<void>> = [];
  const bots = new BotScheduler({ store: f.store, processor: new CommandProcessor({ store: f.store, clock: () => 180000 }),
    clock: () => 180000, random: () => 0, maxNodes: 5, scheduler: { set: callback => { callbacks.push(callback); return 1; }, clear: () => {} } });
  bots.schedule(expired); await callbacks[0]!();
  expect((await f.load()).engine.moveCount).toBe(1); bots.dispose();
});
