import { expect, test } from "bun:test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertRuntime } from "../src/config.js";

// An explicitly supplied isolated database only. Never discover/start local
// PostgreSQL binaries or use an installed database/service as a fallback.
const optedIn = !!process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_ISOLATED === "1";
(optedIn ? test : test.skip)("pg commits, rolls back and serializes competing revisions on an opt-in isolated database", async () => {
  assertRuntime();
  const caFile = process.env.TEST_DATABASE_CA_FILE ?? process.env.DATABASE_CA_FILE;
  if (!caFile) throw new Error("Verified database CA file required for the external probe");
  // URL SSL options would override pg's explicit verified TLS configuration.
  const target = new URL(process.env.TEST_DATABASE_URL!);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) target.searchParams.delete(key);
  const pool = new Pool({
    connectionString: target.href, max: 3, connectionTimeoutMillis: 5000,
    ssl: { ca: readFileSync(caFile, "utf8"), rejectUnauthorized: true },
  });
  const schema = `enochian_probe_${randomUUID().replaceAll("-", "")}`;
  const matchTable = `${schema}.probe_match`;
  const commandTable = `${schema}.probe_command`;
  let created = false;
  try {
    const connection = await pool.connect();
    try {
      const stream = (connection as unknown as { connection: { stream: { encrypted?: boolean; authorized?: boolean } } }).connection.stream;
      expect(stream.encrypted).toBe(true);
      expect(stream.authorized).toBe(true);
    } finally { connection.release(); }
    await pool.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await pool.query(`CREATE TABLE ${matchTable} (id text PRIMARY KEY, revision integer NOT NULL); CREATE TABLE ${commandTable} (id text PRIMARY KEY, revision integer NOT NULL)`);
    await pool.query(`INSERT INTO ${matchTable} VALUES ('match', 0)`);
    const transaction = async (id: string, rollback = false) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const changed = await client.query(`UPDATE ${matchTable} SET revision=revision+1 WHERE id='match' AND revision=0 RETURNING revision`);
        if (changed.rowCount) await client.query(`INSERT INTO ${commandTable} VALUES ($1, $2)`, [id, changed.rows[0].revision]);
        await client.query(rollback ? "ROLLBACK" : "COMMIT");
        return changed.rowCount;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    };
    expect(await transaction("rolled-back", true)).toBe(1);
    expect((await pool.query(`SELECT revision FROM ${matchTable}`)).rows[0].revision).toBe(0);
    expect((await pool.query(`SELECT * FROM ${commandTable}`)).rowCount).toBe(0);
    const competed = await Promise.all([transaction("one"), transaction("two")]);
    expect(competed.reduce<number>((sum, count) => sum + (count ?? 0), 0)).toBe(1);
    expect((await pool.query(`SELECT revision FROM ${matchTable}`)).rows[0].revision).toBe(1);
    expect((await pool.query(`SELECT * FROM ${commandTable}`)).rowCount).toBe(1);
    const committed = (await pool.query(`SELECT id FROM ${commandTable}`)).rows[0].id;
    await expect(pool.query(`INSERT INTO ${commandTable} VALUES ($1, 2)`, [committed])).rejects.toThrow();
    expect((await pool.query(`SELECT * FROM ${commandTable}`)).rowCount).toBe(1);
  } catch (error) {
    // Never put connection strings/passwords or raw driver details in output.
    const code = (error as { code?: unknown }).code;
    const safeCode = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : "";
    throw new Error(`Isolated database compatibility probe failed${safeCode}`);
  } finally {
    try {
      if (created) {
        await pool.query(`DROP SCHEMA ${schema} CASCADE`);
        expect((await pool.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount).toBe(0);
      }
    }
    catch { throw new Error("Isolated database compatibility probe cleanup failed; inspect the generated probe schema"); }
    finally { await pool.end(); }
  }
}, 60000);
