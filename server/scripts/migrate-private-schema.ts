import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertRuntime } from '../src/config.js';
import { createPostgresPool, schemaIdentifier } from '../src/storage/postgres.js';
import { migratePrivateSchema } from '../src/storage/migrations.js';

// Explicit operator command; startup never invokes this and no drop/repair exists.
assertRuntime();
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--create') throw new Error('Usage: bun scripts/migrate-private-schema.ts --create enochian_<private-schema>');
const schema = args[1]!;
schemaIdentifier(schema);
if (!process.env.DATABASE_URL || !process.env.DATABASE_CA_FILE) throw new Error('Private database configuration required');
const pool = createPostgresPool({ connectionString: process.env.DATABASE_URL, ca: readFileSync(resolve(process.env.DATABASE_CA_FILE), 'utf8') });
try {
  await migratePrivateSchema(pool, { schema, allowCreate: true });
  console.info(JSON.stringify({ schema, migrationVersion: 1, verified: true }));
} finally { await pool.end(); }
