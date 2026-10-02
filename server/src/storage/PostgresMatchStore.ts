import type { Pool, PoolClient } from 'pg';
import { COLORS, type MatchRecord } from '../domain/match.js';
import type { LobbyRecord, LobbyStore, LifecycleDue, MaintenanceHead } from './LobbyStore.js';
import type { CommitResult, MatchCommit, StoredCommand } from './MatchStore.js';
import { SERVICE_RECOVERY_ACTOR } from './MatchStore.js';
import { databaseError, schemaIdentifier, transaction } from './postgres.js';
import { reconcileRankedAdmission } from './PostgresRankedAdmission.js';
import { lobbyCapacity, LobbyCapacityError } from './lobby-capacity.js';
import { maintenanceLimit, maintenanceTime } from './maintenance.js';

export interface PostgresStoreOptions {
  schema: string; maxCommandsPerMatch?: number; maxUnstartedLobbies?: number; clock?: () => number;
  /** Failure injection only; production composition must not supply hooks. */
  hooks?: { beforeCommit?: (input: MatchCommit) => void | Promise<void>; afterCommit?: (input: MatchCommit) => void | Promise<void> };
}

function lobby(record: MatchRecord): LobbyRecord['lobby'] | undefined {
  return (record as Partial<LobbyRecord>).lobby;
}
function stored(row: Record<string, any>): StoredCommand {
  return { actorId: row.actor_id, requestId: row.request_id, fingerprint: row.fingerprint,
    result: row.result, committedAt: Number(row.committed_at) };
}

/** Private, durable ledger. Every mutation uses one connection and transaction. */
export class PostgresMatchStore implements LobbyStore {
  private readonly schema: string;
  private readonly maxCommands: number;
  private readonly maxUnstartedLobbies: number;
  constructor(private readonly pool: Pool, private readonly options: PostgresStoreOptions) {
    this.schema = schemaIdentifier(options.schema);
    this.maxCommands = options.maxCommandsPerMatch ?? 10000;
    this.maxUnstartedLobbies = lobbyCapacity(options.maxUnstartedLobbies);
    if (!Number.isSafeInteger(this.maxCommands) || this.maxCommands < 0) throw new Error('Invalid storage bounds');
  }
  private async read<T>(sql: string, values: unknown[], map: (rows: any[]) => T): Promise<T> {
    try { return map((await this.pool.query(sql, values)).rows); } catch { throw databaseError(); }
  }
  async create(record: MatchRecord): Promise<void> {
    await transaction(this.pool, async client => {
      await this.insert(client, record, false);
    });
  }
  async createInvited(record: LobbyRecord): Promise<boolean> {
    if (!record.lobby?.inviteCode) throw new Error('Invalid private invite record');
    return transaction(this.pool, async client => {
      // Serialize admission across connections/processes; the count and insert
      // share this transaction. Lobby exits may only free capacity concurrently.
      // Refresh the count after a competing admission commits, even if an
      // operator changed the database's default transaction isolation level.
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`enochian-lobby-capacity:${this.options.schema}`]);
      const collision = await client.query(`SELECT 1 FROM ${this.schema}.matches WHERE invite_code=$1`, [record.lobby.inviteCode]);
      if (collision.rowCount) return false;
      if (record.phase === 'lobby') {
        const count = await client.query(`SELECT count(*)::integer AS count FROM ${this.schema}.matches WHERE phase='lobby'`);
        if (count.rows[0].count >= this.maxUnstartedLobbies) throw new LobbyCapacityError();
      }
      return this.insert(client, record, true);
    });
  }
  private async insert(client: PoolClient, record: MatchRecord, allowInviteCollision: boolean): Promise<boolean> {
    const metadata = lobby(record);
    const query = await client.query(`INSERT INTO ${this.schema}.matches(match_id,revision,phase,invite_code,room_id,record)
      VALUES ($1,$2,$3,$4,$5,$6) ${allowInviteCollision ? 'ON CONFLICT (invite_code) DO NOTHING' : ''} RETURNING match_id`,
    [record.matchId, record.revision, record.phase, metadata?.inviteCode ?? null, metadata?.roomId ?? null, JSON.stringify(record)]);
    if (!query.rowCount) return false;
    await reconcileRankedAdmission(client, this.schema, record, null, (this.options.clock ?? Date.now)());
    await this.saveSnapshot(client, record);
    await this.saveSeatsAndDeadlines(client, record);
    return true;
  }
  async load(matchId: string): Promise<MatchRecord | null> {
    return this.read(`SELECT record FROM ${this.schema}.matches WHERE match_id=$1`, [matchId], rows => rows[0]?.record ?? null);
  }
  async loadByInvite(code: string): Promise<LobbyRecord | null> {
    return this.read(`SELECT record FROM ${this.schema}.matches WHERE invite_code=$1`, [code], rows => rows[0]?.record ?? null);
  }
  async listRecoverable(): Promise<MatchRecord[]> {
    return this.read(`SELECT record FROM ${this.schema}.matches WHERE phase IN ('lobby','active','paused') ORDER BY match_id`, [], rows => rows.map(row => row.record));
  }
  async maintenanceHead(matchId: string): Promise<MaintenanceHead | null> {
    return this.read(`SELECT m.revision,m.phase,m.record#>>'{service,instanceId}' AS service_instance_id,
      LEAST((SELECT min(d.deadline) FROM ${this.schema}.deadlines d WHERE d.match_id=m.match_id AND
        ((m.phase='lobby' AND d.kind='lobby') OR (m.phase='paused' AND d.kind='recovery') OR
        (m.phase IN ('active','paused') AND d.kind IN ('seat:R','seat:B','seat:Y','seat:K')))),
        CASE WHEN m.phase='active' THEN (m.record#>>'{exchangeOffer,expiresAt}')::bigint ELSE NULL END) AS next_deadline
      FROM ${this.schema}.matches m WHERE m.match_id=$1`, [matchId], rows => rows[0] ? {
        revision: rows[0].revision, phase: rows[0].phase, serviceInstanceId: rows[0].service_instance_id,
        nextDeadline: rows[0].next_deadline === null ? null : Number(rows[0].next_deadline),
      } : null);
  }
  async listLifecycleDue(now: number, limit = 64, instanceId?: string): Promise<LifecycleDue[]> {
    maintenanceTime(now); maintenanceLimit(limit);
    return this.read(`SELECT d.match_id,d.kind,d.deadline FROM ${this.schema}.deadlines d
      JOIN ${this.schema}.matches m ON m.match_id=d.match_id
      WHERE d.deadline <= $1 AND ((d.kind='lobby' AND m.phase='lobby') OR (d.kind='recovery' AND m.phase='paused'))
        AND ($3::text IS NULL OR m.record#>>'{service,instanceId}'=$3)
      ORDER BY d.deadline,d.match_id,d.kind LIMIT $2`, [now, limit, instanceId ?? null], rows => rows.map(row => ({
        matchId: row.match_id, kind: row.kind, deadline: Number(row.deadline),
      })));
  }
  async findCommand(matchId: string, actorId: string, requestId: string): Promise<StoredCommand | null> {
    return this.read(`SELECT * FROM ${this.schema}.commands WHERE match_id=$1 AND actor_id=$2 AND request_id=$3`,
      [matchId, actorId, requestId], rows => rows[0] ? stored(rows[0]) : null);
  }
  async commit(input: MatchCommit): Promise<CommitResult> {
    const result = await transaction(this.pool, async client => {
      const locked = await client.query(`SELECT revision,record FROM ${this.schema}.matches WHERE match_id=$1 FOR UPDATE`, [input.matchId]);
      if (!locked.rowCount) return { status: 'conflict' } as const;
      const previous = await client.query(`SELECT * FROM ${this.schema}.commands WHERE match_id=$1 AND actor_id=$2 AND request_id=$3`,
        [input.matchId, input.command.actorId, input.command.requestId]);
      if (previous.rowCount) return { status: 'duplicate', command: stored(previous.rows[0]) } as const;
      if (locked.rows[0].revision !== input.expectedRevision) return { status: 'conflict' } as const;
      const count = await client.query(`SELECT count(*)::integer AS count FROM ${this.schema}.commands WHERE match_id=$1`, [input.matchId]);
      // This reserved actor is emitted only by the internal RecoveryCoordinator.
      // It preserves recovery at capacity without permitting another game move.
      if (input.command.actorId !== SERVICE_RECOVERY_ACTOR && count.rows[0].count >= this.maxCommands) return { status: 'capacity' } as const;
      if (input.next.matchId !== input.matchId || input.next.revision !== input.expectedRevision + 1) throw databaseError();
      await reconcileRankedAdmission(client, this.schema, input.next, locked.rows[0].record, (this.options.clock ?? Date.now)());
      const metadata = lobby(input.next);
      await client.query(`UPDATE ${this.schema}.matches SET revision=$2,phase=$3,invite_code=$4,room_id=$5,record=$6 WHERE match_id=$1`,
        [input.matchId, input.next.revision, input.next.phase, metadata?.inviteCode ?? null, metadata?.roomId ?? null, JSON.stringify(input.next)]);
      await this.saveSnapshot(client, input.next);
      await client.query(`INSERT INTO ${this.schema}.commands(match_id,actor_id,request_id,revision,fingerprint,result,committed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [input.matchId, input.command.actorId, input.command.requestId,
        input.next.revision, input.command.fingerprint, JSON.stringify(input.command.result), input.command.committedAt]);
      for (const [index, event] of input.events.entries()) await client.query(`INSERT INTO ${this.schema}.events(match_id,revision,event_index,event) VALUES ($1,$2,$3,$4)`,
        [input.matchId, input.next.revision, index, JSON.stringify(event)]);
      await this.saveSeatsAndDeadlines(client, input.next);
      await this.options.hooks?.beforeCommit?.(input);
      return { status: 'committed' } as const;
    });
    if (result.status === 'committed') {
      try { await this.options.hooks?.afterCommit?.(input); } catch { throw databaseError(); }
    }
    return result;
  }
  private async saveSnapshot(client: PoolClient, record: MatchRecord): Promise<void> {
    await client.query(`INSERT INTO ${this.schema}.snapshots(match_id,revision,record) VALUES ($1,$2,$3)`,
      [record.matchId, record.revision, JSON.stringify(record)]);
  }
  private async saveSeatsAndDeadlines(client: PoolClient, record: MatchRecord): Promise<void> {
    for (const color of COLORS) await client.query(`INSERT INTO ${this.schema}.seats(match_id,color,seat) VALUES ($1,$2,$3)
      ON CONFLICT (match_id,color) DO UPDATE SET seat=EXCLUDED.seat`, [record.matchId, color, JSON.stringify(record.seats[color])]);
    await client.query(`DELETE FROM ${this.schema}.deadlines WHERE match_id=$1`, [record.matchId]);
    const deadlines: Array<[string, number | null]> = [['lobby', record.lobbyDeadline], ['recovery', record.recoveryDeadline], ['retention', record.retainUntil],
      ...COLORS.map(color => [`seat:${color}`, record.seats[color].disconnectDeadline] as [string, number | null])];
    for (const [kind, deadline] of deadlines) if (deadline !== null) await client.query(`INSERT INTO ${this.schema}.deadlines(match_id,kind,deadline) VALUES ($1,$2,$3)`, [record.matchId, kind, deadline]);
  }
}
