import { test, expect } from 'bun:test';
import { Client, type Room } from '@colyseus/sdk';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPostgresPool } from '../src/storage/postgres.js';
import { migratePrivateSchema } from '../src/storage/migrations.js';
import { startServer } from '../src/recovery/start-server.js';
import { canonicalEngine, publicSnapshot, PROTOCOL_VERSION, RULES_VERSION } from '../src/domain/match.js';
import { PostgresMatchStore } from '../src/storage/PostgresMatchStore.js';

const isolated = !!process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_ISOLATED === '1';
const waitFor = async (predicate: () => boolean, milliseconds = 10000) => {
  const end = Date.now() + milliseconds;
  while (!predicate()) { if (Date.now() >= end) throw new Error('Recovery assertion timed out'); await Bun.sleep(10); }
};
function lines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(); let text = ''; const decoder = new TextDecoder();
  return async (predicate: (value: any) => boolean) => {
    const timeout = setTimeout(() => { void reader.cancel(); }, 20000);
    try {
      while (true) {
        const newline = text.indexOf('\n');
        if (newline >= 0) {
          const line = text.slice(0, newline); text = text.slice(newline + 1);
          let parsed: unknown; try { parsed = JSON.parse(line); } catch { continue; }
          if (predicate(parsed)) return parsed as any;
          continue;
        }
        const chunk = await reader.read(); if (chunk.done) throw new Error('Child recovery fixture stopped');
        text += decoder.decode(chunk.value, { stream: true });
        if (text.length > 4096) throw new Error('Unexpected child fixture output');
      }
    } finally { clearTimeout(timeout); }
  };
}

(isolated ? test : test.skip)('abrupt process loss after durable commit replays the move once through new transport and original credentials', async () => {
  const schema = `enochian_crash_${randomUUID().replaceAll('-', '')}`;
  const caPath = process.env.TEST_DATABASE_CA_FILE!;
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL!, ca: readFileSync(caPath, 'utf8'), max: 3 });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL!, DATABASE_CA_FILE: caPath,
    DATABASE_SCHEMA: schema, PORT: String(port), HOST: '127.0.0.1' };
  const endpoint = `http://127.0.0.1:${port}`;
  let created = false, stage = 'migration';
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let restored: Awaited<ReturnType<typeof startServer>> | undefined;
  const rooms: Room[] = [];
  const post = async (path: string, data: unknown) => {
    const response = await fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!response.ok) throw new Error('Recovery HTTP request failed'); return response.json();
  };
  try {
    await migratePrivateSchema(pool, { schema, allowCreate: true }); created = true;
    stage = 'child startup';
    child = Bun.spawn([process.execPath, 'test/helpers/durable-child.ts'], { env, stdout: 'pipe', stderr: 'pipe' });
    const nextLine = lines(child.stdout as ReadableStream<Uint8Array>);
    expect((await nextLine(value => value.multiplayerReady !== undefined)).multiplayerReady).toBe(true);
    const sdk = new Client(endpoint);
    const first = await post('/invitations', { mode: 'casual', name: 'Red', color: 'R' });
    const second = await post('/invitations/join', { code: first.code, name: 'Blue', color: 'B' });
    // A final result belongs to the soon-to-die process and will not be rehydrated.
    const finalTicket = await post('/invitations', { mode: 'casual', name: 'Final', color: 'R' });
    const raw = new PostgresMatchStore(pool, { schema });
    const finalRecord = (await raw.load(finalTicket.matchId))!;
    const finalRevision = finalRecord.revision;
    finalRecord.phase = 'void'; finalRecord.terminalResult = { kind: 'void', winningTeam: null, reason: 'fixture_terminal' }; finalRecord.revision++;
    await raw.commit({ matchId: finalRecord.matchId, expectedRevision: finalRevision, next: finalRecord, events: [], command: {
      actorId: 'fixture', requestId: 'fixture-final', fingerprint: 'fixture-final', committedAt: Date.now(),
      result: { ok: true, code: 'accepted', retryable: false, snapshot: publicSnapshot(finalRecord) },
    } });
    const red = await sdk.joinById(first.roomId, { credential: first.credential }); rooms.push(red);
    const blue = await sdk.joinById(second.roomId, { credential: second.credential }); rooms.push(blue);
    red.reconnection.enabled = false; blue.reconnection.enabled = false;
    let ack: any;
    red.onMessage('ack', value => { ack = value; }); blue.onMessage('ack', () => {});
    await waitFor(() => red.state?.connected === 2);
    red.send('lobby_command', { matchId: first.matchId, requestId: 'ready-R', expectedRevision: red.state.revision,
      protocolVersion: PROTOCOL_VERSION, rulesVersion: RULES_VERSION, action: { type: 'ready', ready: true } });
    await waitFor(() => ack?.requestId === 'ready-R');
    await waitFor(() => blue.state.revision === ack.snapshot.revision);
    blue.send('lobby_command', { matchId: first.matchId, requestId: 'ready-B', expectedRevision: blue.state.revision,
      protocolVersion: PROTOCOL_VERSION, rulesVersion: RULES_VERSION, action: { type: 'ready', ready: true } });
    await waitFor(() => red.state.phase === 'active');
    stage = 'commit without acknowledgement';
    const initial = canonicalEngine.initialState();
    const source = Object.entries(initial.board).find(([key, piece]) => piece.color === 'R' && canonicalEngine.legalMoves(initial,
      { r: Number(key.split(',')[0]), c: Number(key.split(',')[1]) }).length)!;
    const [fr, fc] = source[0].split(',').map(Number);
    const destination = canonicalEngine.legalMoves(initial, { r: fr!, c: fc! })[0]!;
    const command = { matchId: first.matchId, requestId: 'crash-move', expectedRevision: red.state.revision,
      protocolVersion: PROTOCOL_VERSION, rulesVersion: RULES_VERSION, action: { type: 'move', fr, fc, tr: destination.r, tc: destination.c } };
    red.send('command', command);
    expect((await nextLine(value => value.testCommitted === true)).matchId).toBe(first.matchId);
    expect(ack?.requestId).not.toBe('crash-move');
    child.kill('SIGKILL'); await child.exited;
    stage = 'replacement process composition';
    restored = await startServer(env, { signals: false });
    expect(restored.isReady()).toBe(true);
    const finalResponse = await post('/invitations/recover', { matchId: finalTicket.matchId, credential: finalTicket.credential });
    expect(finalResponse.snapshot.terminalResult.reason).toBe('fixture_terminal');
    expect(finalResponse.roomId).toBeUndefined();
    const mapping = await post('/invitations/recover', { matchId: first.matchId, credential: first.credential });
    expect(mapping.roomId).not.toBe(first.roomId);
    await expect(post('/invitations/recover', { matchId: first.matchId, credential: first.code })).rejects.toThrow();
    const returnedRed = await new Client(endpoint).joinById(mapping.roomId, { credential: first.credential }); rooms.push(returnedRed);
    returnedRed.reconnection.enabled = false;
    await waitFor(() => returnedRed.state?.phase === 'paused');
    const returnedBlue = await new Client(endpoint).joinById(mapping.roomId, { credential: second.credential }); rooms.push(returnedBlue);
    returnedBlue.reconnection.enabled = false; returnedBlue.onMessage('ack', () => {});
    await waitFor(() => returnedRed.state.phase === 'active');
    expect(returnedRed.state.moveCount).toBe(1);
    let replay: any; returnedRed.onMessage('ack', value => { replay = value; });
    returnedRed.send('command', command); await waitFor(() => replay?.requestId === 'crash-move');
    expect(replay.ok).toBe(true); expect(replay.snapshot.moveCount).toBe(1);
    const events = await pool.query(`SELECT count(*)::integer AS count FROM "${schema}".commands WHERE request_id='crash-move'`);
    expect(events.rows[0].count).toBe(1);
    expect((await restored.durable!.rawStore.load(first.matchId))?.engine.moveCount).toBe(1);
  } catch { throw new Error(`Isolated abrupt recovery acceptance failed (${stage})`); }
  finally {
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; }
    for (const room of rooms) { room.reconnection.enabled = false; if (room.connection.isOpen) await room.leave().catch(() => {}); }
    await restored?.close();
    try { if (created) { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); expect((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount).toBe(0); } }
    finally { await pool.end(); }
  }
}, 60000);
