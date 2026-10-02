import { expect, test } from 'bun:test';
import { BotScheduler } from '../src/domain/bots.js';
import { createMatch, publicSnapshot } from '../src/domain/match.js';
import { initializeBotOwners, reclaimCasual, departCasual } from '../src/domain/casual.js';
import { CommandProcessor } from '../src/domain/commands.js';
import { MemoryMatchStore } from '../src/storage/MemoryMatchStore.js';

async function fixture() {
  const store = new MemoryMatchStore(); const record = createMatch('bots'); record.phase = 'active'; initializeBotOwners(record);
  await store.create(record); const callbacks: Array<() => Promise<void>> = []; const cleared: unknown[] = [];
  const processor = new CommandProcessor({ store, clock: () => 1 });
  const bots = new BotScheduler({ store, processor, clock: () => 1, random: () => 0, maxNodes: 5,
    scheduler: { set: callback => { callbacks.push(callback); return callbacks.length; }, clear: handle => { cleared.push(handle); } } });
  return { store, record, callbacks, cleared, bots };
}
test('one canonical bot job commits one revision through shared processor', async () => {
  const { bots, record, callbacks, store } = await fixture(); bots.schedule(record); bots.schedule(record);
  expect(callbacks).toHaveLength(1); await callbacks[0]!(); await callbacks[0]!();
  expect((await store.load('bots'))?.engine.moveCount).toBe(1); expect((await store.load('bots'))?.revision).toBe(1);
});
test('cancelled callbacks cannot commit after disposal or lifecycle transition', async () => {
  const { bots, record, callbacks, store } = await fixture(); bots.schedule(record); bots.dispose(); await callbacks[0]!();
  expect((await store.load('bots'))?.revision).toBe(0);
});
test('ranked, terminal and frozen armies never schedule', async () => {
  const { bots, record, callbacks } = await fixture(); record.mode = 'ranked'; bots.schedule(record);
  record.mode = 'casual'; record.phase = 'finished'; bots.schedule(record);
  record.phase = 'active'; record.engine.alive.R = false; bots.schedule(record);
  expect(callbacks).toHaveLength(0);
});
test('human reclaim winning revision race invalidates previously queued bot', async () => {
  const { bots, record, callbacks, store } = await fixture();
  record.seats.R.controller = 'human'; record.seats.R.connected = true; departCasual(record, 'R', 0);
  // Persist temporary control before scheduling it.
  record.revision = 1;
  const first = { ok: true as const, code: 'accepted' as const, retryable: false, snapshot: publicSnapshot(record) };
  await store.commit({ matchId: 'bots', expectedRevision: 0, next: record, events: [], command: { actorId: 'lifecycle', requestId: 'drop', fingerprint: 'drop', result: first, committedAt: 0 } });
  bots.schedule(record); const next = structuredClone(record);
  expect(reclaimCasual(next, 'R', record.seats.R.ownerId!, 1)).toBe('reclaimed'); next.revision++;
  await store.commit({ matchId: 'bots', expectedRevision: 1, next, events: [], command: { actorId: 'lifecycle', requestId: 'return', fingerprint: 'return', result: first, committedAt: 1 } });
  await callbacks[0]!(); expect((await store.load('bots'))?.engine.moveCount).toBe(0);
});

test('exhausted command capacity stops repeated bot work at the unchanged revision', async () => {
  const store = new MemoryMatchStore({ maxCommandsPerMatch: 0 });
  const record = createMatch('capacity'); record.phase = 'active'; initializeBotOwners(record);
  await store.create(record);
  const callbacks: Array<() => Promise<void>> = []; let executions = 0;
  const processor = new CommandProcessor({ store });
  const bots = new BotScheduler({ store, processor: { execute: (actor, input) => { executions++; return processor.execute(actor, input); } },
    random: () => 0, maxNodes: 5,
    scheduler: { set: callback => { callbacks.push(callback); return callbacks.length; }, clear: () => {} },
    afterJob: async () => { bots.schedule((await store.load(record.matchId))!); },
  });
  bots.schedule(record); await callbacks[0]!();
  for (let tick = 0; tick < 10; tick++) bots.schedule((await store.load(record.matchId))!);
  expect(callbacks).toHaveLength(1);
  expect(executions).toBe(1);
  expect((await store.load(record.matchId))?.revision).toBe(0);
});

test('retryable failures self-retry with backoff when idle maintenance skips unchanged revisions', async () => {
  const store = new MemoryMatchStore(); const record = createMatch('retry'); record.phase = 'active'; initializeBotOwners(record);
  await store.create(record);
  const callbacks: Array<() => Promise<void>> = []; const delays: number[] = [];
  const bots = new BotScheduler({ store, processor: { execute: async () => ({ ok: false, code: 'storage_unavailable', retryable: true }) },
    random: () => 0, maxNodes: 5,
    scheduler: { set: (callback, delay) => { callbacks.push(callback); delays.push(delay); return callbacks.length; }, clear: () => {} },
  });
  bots.schedule(record);
  for (let attempt = 0; attempt < 8; attempt++) await callbacks[attempt]!();
  expect(delays).toEqual([25, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  bots.dispose();
  await callbacks[8]!();
  expect(callbacks).toHaveLength(9);
});

test('permanent bot rejection is released only after a genuine durable revision change', async () => {
  const store = new MemoryMatchStore(); const record = createMatch('changed'); record.phase = 'active'; initializeBotOwners(record);
  await store.create(record);
  const callbacks: Array<() => Promise<void>> = [];
  const bots = new BotScheduler({ store, processor: { execute: async () => ({ ok: false, code: 'illegal_move', retryable: false }) },
    random: () => 0, maxNodes: 5,
    scheduler: { set: callback => { callbacks.push(callback); return callbacks.length; }, clear: () => {} },
  });
  bots.schedule(record); await callbacks[0]!();
  bots.cancel(); bots.schedule(record);
  expect(callbacks).toHaveLength(1);
  const next = { ...record, revision: 1 };
  await store.commit({ matchId: record.matchId, expectedRevision: 0, next, events: [], command: {
    actorId: 'lifecycle', requestId: 'change', fingerprint: 'change', committedAt: 0,
    result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(next) },
  } });
  bots.schedule((await store.load(record.matchId))!);
  expect(callbacks).toHaveLength(2);
});

test('a bot with no canonical move does not retry an unchanged board forever', async () => {
  const store = new MemoryMatchStore(); const record = createMatch('no-moves');
  record.phase = 'active'; initializeBotOwners(record); record.engine.board = {};
  await store.create(record);
  const callbacks: Array<() => Promise<void>> = []; let afterJobs = 0;
  const bots = new BotScheduler({ store, processor: new CommandProcessor({ store }), maxNodes: 5,
    scheduler: { set: callback => { callbacks.push(callback); return callbacks.length; }, clear: () => {} },
    afterJob: () => { afterJobs++; bots.schedule(record); },
  });
  bots.schedule(record); await callbacks[0]!(); bots.schedule(record);
  expect(callbacks).toHaveLength(1);
  expect(afterJobs).toBe(0);
});
