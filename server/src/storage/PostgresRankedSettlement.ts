import type { Pool } from 'pg';
import { type Color, type MatchRecord } from '../domain/match.js';
import { isUnstartedVoid, rankedRoster } from '../domain/ranked-admission.js';
import { buildRankedSettlement, type RankedAccountRating, type RankedRecord, type RankedSettlementPlan } from '../domain/ranked.js';
import { databaseError, schemaIdentifier, transaction } from './postgres.js';

/** Private ledger output. Transport must use a separate public allowlist. */
export interface RankedSettlement extends RankedSettlementPlan { settlementId: string }
export interface PostgresRankedSettlementOptions {
  schema: string;
  /** Failure injection only; never supplied by production composition. */
  hooks?: { beforeCommit?: (plan: RankedSettlement) => void | Promise<void>; afterCommit?: (plan: RankedSettlement) => void | Promise<void> };
}

/** Match -> sorted account locks matches the ranked admission transaction order. */
export class PostgresRankedSettlement {
  private readonly schema: string;
  constructor(private readonly pool: Pool, private readonly options: PostgresRankedSettlementOptions) {
    this.schema = schemaIdentifier(options.schema);
  }
  async listPending(): Promise<string[]> {
    try {
      const result = await this.pool.query(`SELECT m.match_id FROM ${this.schema}.matches m
        WHERE m.phase IN ('finished','void') AND m.record->>'mode'='ranked'
        AND NOT EXISTS (SELECT 1 FROM ${this.schema}.settlements s WHERE s.match_id=m.match_id)
        ORDER BY m.match_id`);
      return result.rows.map(row => row.match_id as string);
    } catch { throw databaseError(); }
  }
  async settle(matchId: string, now: number): Promise<RankedSettlement | null> {
    let inserted = false;
    try {
      const result = await transaction(this.pool, async client => {
        const match = await client.query(`SELECT record FROM ${this.schema}.matches WHERE match_id=$1 FOR UPDATE`, [matchId]);
        if (!match.rowCount) return null;
        const existing = await client.query(`SELECT details FROM ${this.schema}.settlements WHERE match_id=$1`, [matchId]);
        if (existing.rowCount) return existing.rows[0].details as RankedSettlement;
        const record = match.rows[0].record as RankedRecord;
        if (record.mode !== 'ranked' || !['finished', 'void'].includes(record.phase)) return null;
        if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + 600000) || !record.terminalResult ||
          (record.phase === 'finished' ? record.terminalResult.kind !== 'victory' : record.terminalResult.kind !== 'void')) throw databaseError();
        const roster = rankedRoster(record as MatchRecord), unstarted = isUnstartedVoid(record);
        if (!unstarted && roster.length !== 4) throw databaseError();
        const ids = roster.map(seat => seat.accountId).sort();
        const locked = await client.query(`SELECT account_id,rating,restricted_until FROM ${this.schema}.accounts
          WHERE account_id=ANY($1::text[]) ORDER BY account_id FOR UPDATE`, [ids]);
        const ratings = new Map(locked.rows.map(row => [row.account_id as string, Number(row.rating)]));
        // Admission creates accounts. A missing started account is corrupt state, never a new 1200 rating.
        if (ratings.size !== roster.length || ids.some(id => !ratings.has(id))) throw databaseError();
        const accounts = Object.fromEntries(roster.map(seat => [seat.color, { accountId: seat.accountId, rating: ratings.get(seat.accountId) }])) as Record<Color, RankedAccountRating>;
        const proposal = buildRankedSettlement(record, accounts, now);
        const plan: RankedSettlement = { ...proposal, settlementId: `ranked:${matchId}` };
        await client.query(`INSERT INTO ${this.schema}.settlements(match_id,settlement_id,kind,settled_at,details) VALUES ($1,$2,$3,$4,$5)`,
          [matchId, plan.settlementId, plan.kind, now, JSON.stringify(plan)]);
        for (const entry of plan.entries) {
          await client.query(`INSERT INTO ${this.schema}.rating_entries(settlement_id,account_id,delta) VALUES ($1,$2,$3)`,
            [plan.settlementId, entry.accountId, entry.delta]);
          await client.query(`UPDATE ${this.schema}.accounts SET rating=$2,
            restricted_until=CASE WHEN $3::bigint IS NULL THEN restricted_until ELSE GREATEST(restricted_until,$3::bigint) END
            WHERE account_id=$1`, [entry.accountId, entry.rating, entry.restrictionUntil]);
        }
        await client.query(`DELETE FROM ${this.schema}.admission_locks WHERE match_id=$1`, [matchId]);
        await this.options.hooks?.beforeCommit?.(structuredClone(plan));
        inserted = true; return plan;
      });
      // Simulates a committed transaction whose acknowledgement was lost. Replays do not invoke it.
      if (result && inserted) await this.options.hooks?.afterCommit?.(structuredClone(result));
      return result;
    } catch { throw databaseError(); }
  }
}
