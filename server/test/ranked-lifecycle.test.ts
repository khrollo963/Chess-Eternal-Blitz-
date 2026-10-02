import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { COLORS } from '../src/domain/match.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { LobbyService } from '../src/domain/lobby.js';
import { RankedService } from '../src/domain/RankedService.js';

async function fixture() {
  let now = 1000;
  const store = new MemoryLobbyStore(), lobby = new LobbyService({ store, rankedEnabled: true, clock: () => now });
  const a = await lobby.create('ranked', 'Red', 'R', { accountId: randomUUID() });
  const invites = [a];
  for (const color of COLORS.slice(1)) invites.push(await lobby.join(a.code, color, color, { accountId: randomUUID() }));
  for (let i = 0; i < 4; i++) await lobby.connect(a.matchId, invites[i]!.credential, `client-${i}`);
  for (let i = 0; i < 4; i++) await lobby.command(a.matchId, `client-${i}`, `ready-${i}`, (await store.load(a.matchId))!.revision, { type: 'ready', ready: true });
  const service = new RankedService({ store, lobby, clock: () => now });
  return { store, lobby, service, a, invites, time: (value: number) => { now = value; } };
}

test('ranked concurrent departures and returns resume only when all owners are present', async () => {
  const f = await fixture();
  await Promise.all([f.service.depart(f.a.matchId, 'client-0', false), f.service.depart(f.a.matchId, 'client-1', false)]);
  expect((await f.store.load(f.a.matchId))?.phase).toBe('paused');
  f.time(300999);
  await f.service.connect(f.a.matchId, f.invites[0]!.credential, 'return-0');
  expect((await f.store.load(f.a.matchId))?.phase).toBe('paused');
  await f.service.connect(f.a.matchId, f.invites[1]!.credential, 'return-1');
  expect((await f.store.load(f.a.matchId))?.phase).toBe('active');
  await f.service.depart(f.a.matchId, 'client-0', true);
  expect((await f.store.load(f.a.matchId))?.phase).toBe('active');
});

test('timeout racing a return has one final void and cannot regain control', async () => {
  const f = await fixture();
  await f.service.depart(f.a.matchId, 'client-0', false); f.time(301000);
  await Promise.allSettled([f.service.connect(f.a.matchId, f.a.credential, 'late'), f.service.expire(f.a.matchId)]);
  const record = await f.store.load(f.a.matchId);
  expect(record?.terminalResult?.reason).toBe('abandonment');
  expect((record as unknown as { expiredDepartures: string[] }).expiredDepartures).toEqual(['R']);
  expect((record as unknown as { pendingSettlement: boolean }).pendingSettlement).toBe(true);
  expect(record?.seats.R.controller).toBe('human');
  expect(record?.seats.R.connected).toBe(false);
});
