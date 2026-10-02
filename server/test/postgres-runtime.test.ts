import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPostgresPool } from '../src/storage/postgres.js';
import { migratePrivateSchema } from '../src/storage/migrations.js';
import { PostgresRuntime } from '../src/recovery/postgres-runtime.js';

const isolated = !!process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_ISOLATED === '1';
(isolated ? test : test.skip)('hosted process lease fences duplicate servers and records durable outage cutoff', async () => {
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL!, ca: readFileSync(process.env.TEST_DATABASE_CA_FILE!, 'utf8'), max: 5 });
  const schema = `enochian_runtime_${randomUUID().replaceAll('-', '')}`;
  let created = false, now = 1000;
  const old = new PostgresRuntime(pool, schema, 'old', { clock: () => now, heartbeatMs: 60000 });
  const next = new PostgresRuntime(pool, schema, 'new', { clock: () => now, heartbeatMs: 60000 });
  try {
    await migratePrivateSchema(pool, { schema, allowCreate: true }); created = true;
    await old.start(); expect(old.healthy).toBe(true);
    await expect(next.start()).rejects.toThrow('Private database');
    now = 9000; await old.heartbeat(); expect(await old.lastHeartbeat('old')).toBe(9000);
    await old.stop(); expect(old.healthy).toBe(false);
    await next.start(); expect(next.healthy).toBe(true); expect(await next.lastHeartbeat('old')).toBe(9000);
    await next.stop();
  } catch { throw new Error('Isolated process lease acceptance failed'); }
  finally {
    await old.stop(); await next.stop();
    try { if (created) { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); expect((await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount).toBe(0); } }
    finally { await pool.end(); }
  }
}, 60000);
