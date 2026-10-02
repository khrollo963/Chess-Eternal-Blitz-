import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COLORS, createMatch } from '../src/domain/match.js';
import { opaqueToken, credentialHash } from '../src/identity/guest.js';
import type { LobbyRecord } from '../src/storage/LobbyStore.js';
import { PostgresMatchStore } from '../src/storage/PostgresMatchStore.js';
import { CommandProcessor } from '../src/domain/commands.js';
import { createPostgresPool } from '../src/storage/postgres.js';
import { migratePrivateSchema } from '../src/storage/migrations.js';
import { startServer } from '../src/recovery/start-server.js';

const isolated = !!process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_ISOLATED === '1';
(isolated ? test : test.skip)('startup settles a committed terminal move whose acknowledgement and settlement were interrupted', async () => {
  if (!process.env.TEST_DATABASE_CA_FILE) throw new Error('Isolated database CA required');
  const caPath = process.env.TEST_DATABASE_CA_FILE;
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL!, ca: readFileSync(caPath, 'utf8') });
  const schema = `enochian_pending_${randomUUID().replaceAll('-', '')}`;
  let created = false, app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await migratePrivateSchema(pool, { schema, allowCreate: true }); created = true;
    const record: LobbyRecord = { ...createMatch('pending-victory', 'ranked'), lobby: { inviteCode: 'PENDING', roomId: null, owners: {} } };
    for (const color of COLORS) {
      const ownerId = credentialHash(opaqueToken());
      record.lobby.owners[ownerId] = { credentialHash: ownerId, connectionId: color, accountId: randomUUID() };
      record.seats[color] = { ...record.seats[color], ownerId, controller: 'human', connected: true, ready: true };
    }
    // Legal mechanics fixture: K is already captured, R can capture B's last opposing king.
    record.phase = 'active';
    record.engine = { board: { '7,8': { color: 'R', type: 'KING' }, '0,-1': { color: 'Y', type: 'KING' },
      '6,6': { color: 'R', type: 'ROOK' }, '6,7': { color: 'B', type: 'KING' } },
      alive: { R: true, B: true, Y: true, K: false }, turnIndex: 0, over: false, moveCount: 80 };
    const raw = new PostgresMatchStore(pool, { schema }); await raw.create(record);
    const lost = new PostgresMatchStore(pool, { schema, hooks: { afterCommit: () => { throw new Error('interrupted acknowledgement'); } } });
    const command = { requestId: 'final-move', matchId: record.matchId, expectedRevision: 0,
      protocolVersion: 1, rulesVersion: 'enochian-current-1', action: { type: 'move', fr: 6, fc: 6, tr: 6, tc: 7 } };
    const actor = { actorId: record.seats.R.ownerId!, seat: 'R' as const, controller: 'human' as const };
    expect((await new CommandProcessor({ store: lost }).execute(actor, command)).code).toBe('storage_unavailable');
    const final = await raw.load(record.matchId);
    expect(final?.phase).toBe('finished');
    expect((final as typeof record & { pendingSettlement: boolean }).pendingSettlement).toBe(true);
    expect((await pool.query(`SELECT 1 FROM "${schema}".admission_locks`)).rowCount).toBe(4);
    expect((await pool.query(`SELECT 1 FROM "${schema}".settlements`)).rowCount).toBe(0);
    const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
    const port = reservation.port!; reservation.stop(true);
    app = await startServer({ DATABASE_URL: process.env.TEST_DATABASE_URL!, DATABASE_CA_FILE: caPath,
      DATABASE_SCHEMA: schema, PORT: String(port), HOST: '127.0.0.1' }, { signals: false });
    expect(app.isReady()).toBe(true);
    expect(await app.durable!.settlement.listPending()).toEqual([]);
    expect((await pool.query(`SELECT 1 FROM "${schema}".admission_locks`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM "${schema}".rating_entries`)).rowCount).toBe(4);
    expect((await new CommandProcessor({ store: raw }).execute(actor, command)).ok).toBe(true);
    await app.durable!.settlePending();
    expect((await raw.load(record.matchId))?.revision).toBe(final?.revision);
    expect((await pool.query(`SELECT 1 FROM "${schema}".settlements`)).rowCount).toBe(1);
  } finally {
    await app?.close();
    try {
      if (created) {
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        expect((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount).toBe(0);
      }
    } finally { await pool.end(); }
  }
}, 60000);
