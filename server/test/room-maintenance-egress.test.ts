import { expect, test } from 'bun:test';
import { matchMaker } from '@colyseus/core';
import { createGameServer } from '../src/index.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { publicSnapshot } from '../src/domain/match.js';
import type { EnochianRoom } from '../src/rooms/EnochianRoom.js';
import type { CasualRecord } from '../src/domain/casual.js';
import type { LobbyRecord } from '../src/storage/LobbyStore.js';

type MaintainedRoom = { maintain(): Promise<void> };
async function fixture(run: (f: { store: MemoryLobbyStore; room: EnochianRoom; maintain: () => Promise<void>; matchId: string; time: (value: number) => void; ready: (value: boolean) => void; pendingBots: () => number; reset: () => void; reads: () => number; headReads: () => number }) => Promise<void>) {
  const store = new MemoryLobbyStore();
  let now = 0, reads = 0, headReads = 0, ready = true, serial = 0;
  const botJobs = new Map<number, () => Promise<void>>();
  const load = store.load.bind(store);
  const head = store.maintenanceHead.bind(store);
  store.load = async id => { reads++; return load(id); };
  store.maintenanceHead = async id => { headReads++; return head(id); };
  const { server } = createGameServer({ store, clock: () => now, isReady: () => ready, botOptions: { delayMs: 10000, maxNodes: 5,
    scheduler: { set: callback => { botJobs.set(++serial, callback); return serial; }, clear: handle => { botJobs.delete(handle as number); } } } });
  const reserved = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reserved.port!; reserved.stop(true);
  try {
    await server.listen(port, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${port}/invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'casual', name: 'Red', color: 'R' }) });
    expect(response.status).toBe(201);
    const ticket = await response.json();
    const room = matchMaker.getLocalRoomById(ticket.roomId) as EnochianRoom;
    const maintain = () => (room as unknown as MaintainedRoom).maintain();
    await maintain();
    reads = 0; headReads = 0;
    await run({ store, room, maintain, matchId: ticket.matchId, time: value => { now = value; }, ready: value => { ready = value; }, pendingBots: () => botJobs.size, reset: () => { reads = 0; headReads = 0; }, reads: () => reads, headReads: () => headReads });
  } finally { await server.gracefullyShutdown(false); }
}

test('unchanged idle room maintenance never reloads the private record', async () => {
  await fixture(async f => {
    for (let i = 0; i < 10; i++) await f.maintain();
    expect(f.reads()).toBe(0);
    expect(f.headReads()).toBe(10);
    expect(f.room.state.phase).toBe('lobby');
  });
});

test('overlapping idle callbacks share one scalar metadata query', async () => {
  await fixture(async f => {
    await Promise.all(Array.from({ length: 10 }, () => f.maintain()));
    expect(f.reads()).toBe(0);
    expect(f.headReads()).toBe(1);
  });
});

test('metadata detects a missed publication and reloads exactly one changed record', async () => {
  await fixture(async f => {
    const next = (await f.store.load(f.matchId))!;
    const revision = next.revision; next.revision++; next.seats.R.displayName = 'Updated';
    await f.store.commit({ matchId: f.matchId, expectedRevision: revision, next, events: [], command: { actorId: 'external', requestId: 'missed', fingerprint: 'missed', committedAt: 0, result: { ok: true, code: 'accepted', retryable: false } } });
    f.reset(); await f.maintain();
    expect(f.room.state.revision).toBe(next.revision);
    expect(f.room.state.seats.get('R')!.displayName).toBe('Updated');
    expect(f.reads()).toBe(1);
    await f.maintain(); expect(f.reads()).toBe(1);
  });
});

test('an already published revision still refreshes private bot state exactly once', async () => {
  await fixture(async f => {
    const next = (await f.store.load(f.matchId))!;
    const revision = next.revision; next.revision++; next.seats.R.ready = true;
    await f.store.commit({ matchId: f.matchId, expectedRevision: revision, next, events: [], command: { actorId: 'external', requestId: 'published', fingerprint: 'published', committedAt: 0, result: { ok: true, code: 'accepted', retryable: false } } });
    f.reset(); f.room.publishCommitted(publicSnapshot(next)); await f.maintain();
    expect(f.room.state.revision).toBe(next.revision);
    expect(f.reads()).toBe(1);
    await f.maintain(); expect(f.reads()).toBe(1);
  });
});

test('idle optimization still expires casual absence at the exact deadline', async () => {
  await fixture(async f => {
    const next = (await f.store.load(f.matchId))! as LobbyRecord & CasualRecord;
    const revision = next.revision; next.revision++; next.phase = 'active'; next.lobbyDeadline = null;
    Object.assign(next.seats.R, { controller: 'temporary_bot', connected: false, disconnectDeadline: 1000 });
    next.absence = { R: { usedMs: 179000, departedAt: 0 } };
    await f.store.commit({ matchId: f.matchId, expectedRevision: revision, next, events: [], command: { actorId: 'external', requestId: 'absent', fingerprint: 'absent', committedAt: 0, result: { ok: true, code: 'accepted', retryable: false } } });
    await f.maintain(); f.reset();
    f.time(999); await f.maintain(); expect(f.reads()).toBe(0);
    expect(f.room.state.seats.get('R')!.controller).toBe('temporary_bot');
    f.time(1000); await f.maintain();
    expect(f.room.state.seats.get('R')!.controller).toBe('bot');
    expect(f.room.state.seats.get('R')!.disconnectDeadline).toBe(-1);
    expect(f.reads()).toBeGreaterThan(0);
    f.reset(); await f.maintain(); expect(f.reads()).toBe(0);
  });
});

test('readiness recovery refreshes cancelled bot work even when durable revision is unchanged', async () => {
  await fixture(async f => {
    const next = (await f.store.load(f.matchId))!;
    const revision = next.revision; next.revision++; next.phase = 'active'; next.lobbyDeadline = null;
    next.seats.R.controller = 'bot';
    await f.store.commit({ matchId: f.matchId, expectedRevision: revision, next, events: [], command: { actorId: 'external', requestId: 'bot', fingerprint: 'bot', committedAt: 0, result: { ok: true, code: 'accepted', retryable: false } } });
    await f.maintain(); expect(f.pendingBots()).toBe(1);
    f.reset(); f.ready(false); await f.maintain();
    expect(f.pendingBots()).toBe(0); expect(f.reads()).toBe(0);
    f.ready(true); await f.maintain();
    expect(f.pendingBots()).toBe(1); expect(f.reads()).toBe(1);
    await f.maintain(); expect(f.reads()).toBe(1);
  });
});
