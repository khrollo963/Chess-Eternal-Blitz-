import type { Pool, PoolClient } from 'pg';
import { databaseError, schemaIdentifier } from '../storage/postgres.js';

/** One held Session-pooler connection owns the process lease. Never transaction mode. */
export class PostgresRuntime {
  private client: PoolClient | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending = false;
  private lost = false;
  private readonly qualified: string;
  constructor(private pool: Pool, private schema: string, readonly instanceId: string,
    private options: { clock?: () => number; onLost?: () => void | Promise<void>; heartbeatMs?: number } = {}) {
    this.qualified = schemaIdentifier(schema);
  }
  private now() { return (this.options.clock ?? Date.now)(); }
  private loss = () => {
    if (this.lost) return;
    this.lost = true; clearInterval(this.timer);
    try { void Promise.resolve(this.options.onLost?.()).catch(() => {}); } catch { /* fail closed callback */ }
  };
  async start(): Promise<void> {
    if (this.client) throw new Error('Service runtime already started');
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      const lease = await client.query('SELECT pg_try_advisory_lock(hashtext($1), 193817) AS acquired', [this.schema]);
      if (!lease.rows[0].acquired) throw new Error('Service already active');
      await client.query(`INSERT INTO ${this.qualified}.server_instances(instance_id,last_heartbeat_at,status)
        VALUES ($1,$2,'active') ON CONFLICT(instance_id) DO UPDATE SET last_heartbeat_at=EXCLUDED.last_heartbeat_at,status='active'`, [this.instanceId, this.now()]);
      this.client = client;
      client.on('error', this.loss); client.on('end', this.loss);
      this.timer = setInterval(() => { void this.heartbeat().catch(this.loss); }, this.options.heartbeatMs ?? 5000);
      this.timer.unref();
    } catch {
      if (client) client.release(true);
      throw databaseError();
    }
  }
  async heartbeat(): Promise<void> {
    if (!this.client || this.lost) throw databaseError();
    if (this.pending) return;
    this.pending = true;
    try { await this.client.query(`UPDATE ${this.qualified}.server_instances SET last_heartbeat_at=$2 WHERE instance_id=$1`, [this.instanceId, this.now()]); }
    catch { this.loss(); throw databaseError(); }
    finally { this.pending = false; }
  }
  async lastHeartbeat(instanceId: string): Promise<number | null> {
    try {
      const rows = (await this.pool.query(`SELECT last_heartbeat_at FROM ${this.qualified}.server_instances WHERE instance_id=$1`, [instanceId])).rows;
      return rows[0] ? Number(rows[0].last_heartbeat_at) : null;
    } catch { throw databaseError(); }
  }
  get healthy() { return this.client !== null && !this.lost; }
  async stop(): Promise<void> {
    clearInterval(this.timer);
    const client = this.client; this.client = null;
    if (!client) return;
    client.removeListener('error', this.loss); client.removeListener('end', this.loss);
    let broken = this.lost;
    try {
      if (!broken) {
        await client.query(`UPDATE ${this.qualified}.server_instances SET last_heartbeat_at=$2,status='stopped' WHERE instance_id=$1`, [this.instanceId, this.now()]);
        await client.query('SELECT pg_advisory_unlock(hashtext($1), 193817)', [this.schema]);
      }
    } catch { broken = true; }
    finally { client.release(broken); }
  }
}
