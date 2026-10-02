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
