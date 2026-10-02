import { expect, test } from 'bun:test';
import { EnochianEngine } from '../src/generated/enochian-engine.mjs';
import { CommandProcessor, parseCommand } from '../src/domain/commands.js';
import { createMatch, publicSnapshot } from '../src/domain/match.js';
import { MemoryMatchStore } from '../src/storage/MemoryMatchStore.js';

const actor = { actorId: 'private-owner', seat: 'R' as const, controller: 'human' as const };
function command(requestId = 'request-1', expectedRevision = 0) {
  return { requestId, matchId: 'match-1', expectedRevision, protocolVersion: 1, rulesVersion: 'enochian-current-1', action: { type: 'move', fr: 6, fc: 7, tr: 5, tc: 7 } };
}
async function fixture() {
  const store = new MemoryMatchStore();
  const record = createMatch('match-1');
  record.phase = 'active';
  record.seats.R.ownerId = actor.actorId;
  record.seats.R.controller = 'human';
  record.seats.R.connected = true;
  await store.create(record);
  const published: unknown[] = [];
  const processor = new CommandProcessor({ store, clock: () => 1000, publish: snapshot => { published.push(snapshot); } });
  return { store, record, processor, published };
}

test('accepted move persists snapshot and dedup before publishing', async () => {
  const { store, processor, published } = await fixture();
  const result = await processor.execute(actor, command());
  expect(result.ok).toBe(true);
  expect((await store.load('match-1'))?.revision).toBe(1);
  expect(published).toHaveLength(1);
  expect(await processor.execute(actor, command())).toEqual(result);
  expect(published).toHaveLength(1);
});

test('public projection has four seats and excludes private identity and extra secret fields', () => {
  const record = createMatch('match-1');
  record.seats.R.ownerId = 'private-owner';
  Object.assign(record, { recoveryToken: 'private-token', email: 'private-email' });
  Object.assign(record.seats.R, { recoveryHash: 'private-hash' });
  const snapshot = publicSnapshot(record);
  expect(Object.keys(snapshot.seats)).toEqual(['R', 'B', 'Y', 'K']);
  expect(JSON.stringify(snapshot)).not.toContain('private-');
  expect(snapshot.board).toEqual(EnochianEngine.initialState().board);
});

test('strict parsing rejects unknown keys, incompatible versions and malformed or oversized coordinates', () => {
  for (const payload of [
    { ...command(), seat: 'R' }, { ...command(), protocolVersion: 99 },
    { ...command(), action: { ...command().action, fr: 1.5 } },
    { ...command(), action: { ...command().action, tr: 8, tc: 8 } },
    { ...command(), requestId: 'x'.repeat(5000) },
    { ...command(), action: { ...command().action, secret: true } },
    { ...command(), action: { type: 'withdraw' } },
  ]) expect(parseCommand(payload).ok).toBe(false);
  expect(parseCommand({ ...command(), action: { type: 'move', fr: 7, fc: 8, tr: 7, tc: 7 } }).ok).toBe(true);
});

test('authorization, revision, phase, turn and frozen guards reject without mutation', async () => {
  const { store, processor } = await fixture();
  expect((await processor.execute({ ...actor, actorId: 'intruder' }, command())).code).toBe('unauthorized');
  expect((await processor.execute(actor, command('stale', 1))).code).toBe('stale_revision');
  expect((await processor.execute(actor, { ...command(), action: { type: 'move', fr: 0, fc: 6, tr: 0, tc: 5 } })).code).toBe('wrong_seat');
  expect((await processor.execute(actor, { ...command(), action: { ...command().action, tr: 3 } })).code).toBe('illegal_move');
  expect((await store.load('match-1'))?.revision).toBe(0);
  const separate = createMatch('paused'); separate.phase = 'paused'; separate.seats.R.ownerId = actor.actorId; separate.seats.R.controller = 'human'; separate.seats.R.connected = true;
  await store.create(separate);
  expect((await processor.execute(actor, { ...command(), matchId: 'paused' })).code).toBe('invalid_phase');
  const frozen = createMatch('frozen'); frozen.phase = 'active'; frozen.seats.R.ownerId = actor.actorId; frozen.seats.R.connected = true; frozen.seats.R.controller = 'human'; frozen.engine.alive.R = false;
  await store.create(frozen);
  expect((await processor.execute(actor, { ...command(), matchId: 'frozen' })).code).toBe('frozen_army');
  const turn = createMatch('turn'); turn.phase = 'active'; turn.seats.R.ownerId = actor.actorId; turn.seats.R.connected = true; turn.seats.R.controller = 'human'; turn.engine.turnIndex = 1;
  await store.create(turn);
  expect((await processor.execute(actor, { ...command(), matchId: 'turn' })).code).toBe('out_of_turn');
});

test('nothing is acknowledged or published while persistence is pending', async () => {
  const { store, processor, published } = await fixture();
  const commit = store.commit.bind(store);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let reached!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  store.commit = async input => { reached(); await wait; return commit(input); };
  let acknowledged = false;
  const pending = processor.execute(actor, command()).then(result => { acknowledged = true; return result; });
  await entered;
  expect(acknowledged).toBe(false);
  expect(published).toHaveLength(0);
  expect((await store.load('match-1'))?.revision).toBe(0);
  release();
  expect((await pending).ok).toBe(true);
});

test('new processor replays stored acknowledgement despite turn/control changes', async () => {
  const { store, processor } = await fixture();
  const first = await processor.execute(actor, command());
  const recovered = new CommandProcessor({ store });
  expect(await recovered.execute(actor, command())).toEqual(first);
  expect((await recovered.execute({ ...actor, actorId: 'another-account' }, command())).code).toBe('stale_revision');
});

test('failed publication leaves accepted result durable and does not repeat the move', async () => {
  const { store } = await fixture();
  const processor = new CommandProcessor({ store, publish: () => { throw new Error('disconnected'); } });
  const first = await processor.execute(actor, command());
  expect(first.ok).toBe(true);
  expect(await processor.execute(actor, command())).toEqual(first);
  expect((await store.load('match-1'))?.engine.moveCount).toBe(1);
});

test('deadline boundary and controller mismatch cannot authorize moves', async () => {
  const store = new MemoryMatchStore(); const record = createMatch('match-1');
  record.phase = 'active'; record.seats.R = { ...record.seats.R, ownerId: actor.actorId, controller: 'human', connected: true, disconnectDeadline: 1000 };
  await store.create(record);
  const processor = new CommandProcessor({ store, clock: () => 1000 });
  expect((await processor.execute(actor, command())).code).toBe('deadline_expired');
  expect((await processor.execute({ ...actor, controller: 'bot' }, command())).code).toBe('unauthorized');
  expect((await store.load('match-1'))?.revision).toBe(0);
});

test('terminal command stores final engine outcome and public result atomically', async () => {
  const store = new MemoryMatchStore(); const record = createMatch('match-1');
  record.phase = 'active'; record.seats.R = { ...record.seats.R, ownerId: actor.actorId, controller: 'human', connected: true };
  record.engine.board = { '4,4': { color: 'R', type: 'ROOK' }, '4,5': { color: 'B', type: 'KING' }, '7,8': { color: 'R', type: 'KING' }, '0,-1': { color: 'Y', type: 'KING' } };
  record.engine.alive.K = false;
  await store.create(record);
  const processor = new CommandProcessor({ store });
  const result = await processor.execute(actor, { ...command(), action: { type: 'move', fr: 4, fc: 4, tr: 4, tc: 5 } });
  expect(result.snapshot?.phase).toBe('finished');
  expect(result.snapshot?.terminalResult).toEqual({ kind: 'victory', winningTeam: 1, reason: null });
  expect((await store.load('match-1'))?.engine.over).toBe(true);
});

test('memory adapter clones input/output and never prunes active or recoverable matches', async () => {
  const store = new MemoryMatchStore(); const active = createMatch('active'); active.retainUntil = 1;
  await store.create(active); active.seats.R.ownerId = 'changed';
  const loaded = (await store.load('active'))!; loaded.seats.R.ownerId = 'changed';
  expect((await store.load('active'))?.seats.R.ownerId).toBeNull();
  const terminal = createMatch('terminal'); terminal.phase = 'finished'; terminal.retainUntil = 1000; terminal.recoveryDeadline = 2000;
  await store.create(terminal);
  expect(store.prune(1000)).toBe(0);
  expect(store.prune(2000)).toBe(1);
  expect(await store.load('active')).not.toBeNull();
});

test('changed payload with accepted request ID is rejected before stale revision', async () => {
  const { processor } = await fixture();
  await processor.execute(actor, command());
  expect((await processor.execute(actor, { ...command(), action: { ...command().action, tc: 6 } })).code).toBe('request_conflict');
});

test('concurrent commands apply once, including across processors sharing the same store', async () => {
  const { store, processor } = await fixture();
  const other = new CommandProcessor({ store, clock: () => 1000 });
  const results = await Promise.all([processor.execute(actor, command('a')), processor.execute(actor, command('b')), other.execute(actor, command('c'))]);
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect((await store.load('match-1'))?.revision).toBe(1);
});

test('persistence failure is retryable and publishes nothing; same request succeeds on retry', async () => {
  const { store, published, processor } = await fixture();
  const commit = store.commit.bind(store);
  let fail = true;
  store.commit = async input => { if (fail) throw new Error('private-database-secret'); return commit(input); };
  const result = await processor.execute(actor, command());
  expect(result.code).toBe('storage_unavailable');
  expect(result.retryable).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private-');
  expect((await store.load('match-1'))?.revision).toBe(0);
  expect(published).toHaveLength(0);
  fail = false;
  expect((await processor.execute(actor, command())).ok).toBe(true);
});

test('bounded storage rejects new commands without evicting accepted duplicate results', async () => {
  const store = new MemoryMatchStore({ maxCommandsPerMatch: 1 });
  const record = createMatch('match-1'); record.phase = 'active'; record.seats.R.ownerId = actor.actorId; record.seats.R.controller = 'human'; record.seats.R.connected = true;
  await store.create(record);
  const processor = new CommandProcessor({ store, clock: () => 1000 });
  const result = await processor.execute(actor, command());
  const next = (await store.load('match-1'))!;
  next.seats.B = { ...next.seats.B, ownerId: 'blue', controller: 'human', connected: true };
  // A new fixture at the accepted revision models a loaded match with a second owner.
  const blueStore = new MemoryMatchStore({ maxCommandsPerMatch: 0 }); await blueStore.create(next);
  const blueProcessor = new CommandProcessor({ store: blueStore });
  expect((await blueProcessor.execute({ actorId: 'blue', seat: 'B', controller: 'human' }, { ...command('next', 1), action: { type: 'move', fr: 0, fc: 6, tr: 0, tc: 5 } })).code).toBe('command_capacity');
  expect(await processor.execute(actor, command())).toEqual(result);
});
