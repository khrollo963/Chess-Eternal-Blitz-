import { Pool, type PoolConfig, type PoolClient } from 'pg';

export function schemaIdentifier(schema: string): string {
  if (!/^enochian_[a-z0-9_]{1,48}$/.test(schema)) throw new Error('Invalid private database schema');
  return `"${schema}"`;
}

export function postgresPoolConfig(options: { connectionString: string; ca: string; max?: number }): PoolConfig {
  const max = options.max ?? 3;
  if (!Number.isSafeInteger(max) || max < 1 || max > 5 || !options.ca.trim()) throw new Error('Invalid database pool configuration');
  let target: URL;
  try { target = new URL(options.connectionString); } catch { throw new Error('Invalid database connection configuration'); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('Invalid database connection configuration');
  for (const key of [...target.searchParams.keys()]) if (key.toLowerCase().startsWith('ssl') || key.toLowerCase() === 'uselibpqcompat') target.searchParams.delete(key);
  return { connectionString: target.href, ssl: { ca: options.ca, rejectUnauthorized: true }, max,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 10000, lock_timeout: 5000, query_timeout: 15000 };
}

/** Do not include the driver message, detail, query, connection URL or cause. */
export function databaseError(): Error { return new Error('Private database operation failed'); }
export function createPostgresPool(options: { connectionString: string; ca: string; max?: number }): Pool {
  const pool = new Pool(postgresPoolConfig(options));
  // An idle socket failure must not become an unhandled event containing credentials.
  pool.on('error', () => {});
  return pool;
}

export async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try { client = await pool.connect(); } catch { throw databaseError(); }
  let broken = false;
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw databaseError();
  } finally { client.release(broken); }
}
