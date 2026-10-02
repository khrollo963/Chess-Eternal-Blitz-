import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import { databaseError, schemaIdentifier, transaction } from './postgres.js';

const initial = readFileSync(new URL('../../migrations/001-initial.sql', import.meta.url), 'utf8');
const hash = createHash('sha256').update(initial).digest('hex');
const tables = ['schema_migrations', 'matches', 'snapshots', 'commands', 'events', 'seats', 'deadlines',
  'accounts', 'admission_locks', 'settlements', 'rating_entries', 'server_instances'];

async function checkHistory(client: Pick<PoolClient, 'query'>, qualified: string): Promise<void> {
  const rows = (await client.query(`SELECT version, sha256 FROM ${qualified}.schema_migrations ORDER BY version`)).rows;
  if (rows.length !== 1 || rows[0].version !== 1 || rows[0].sha256 !== hash) throw databaseError();
}

/** Read-only startup check. Never migrate or repair an existing database implicitly. */
export async function verifyPrivateSchema(pool: Pool, schema: string): Promise<void> {
  const qualified = schemaIdentifier(schema);
  try { await checkHistory(pool, qualified); } catch { throw databaseError(); }
}

/** Explicit operator action only. Existing unmanaged/unknown histories fail closed. */
export async function migratePrivateSchema(pool: Pool, options: { schema: string; allowCreate?: boolean }): Promise<void> {
  const qualified = schemaIdentifier(options.schema);
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`enochian-migrations:${options.schema}`]);
    const exists = (await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [options.schema])).rowCount;
    if (exists) { await checkHistory(client, qualified); return; }
    if (!options.allowCreate) throw databaseError();
    await client.query(`CREATE SCHEMA ${qualified}`);
    await client.query(initial.replaceAll('__SCHEMA__', qualified));
    await client.query(`REVOKE ALL ON SCHEMA ${qualified} FROM PUBLIC`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${qualified} FROM PUBLIC`);
    for (const role of ['anon', 'authenticated']) {
      if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
        await client.query(`REVOKE ALL ON SCHEMA ${qualified} FROM ${role}`);
        await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${qualified} FROM ${role}`);
      }
    }
    for (const table of tables) await client.query(`ALTER TABLE ${qualified}.${table} ENABLE ROW LEVEL SECURITY`);
    await client.query(`INSERT INTO ${qualified}.schema_migrations(version,sha256) VALUES (1,$1)`, [hash]);
  });
}
