import type { PoolClient } from 'pg';
import type { MatchRecord } from '../domain/match.js';
import { AdmissionError, isUnstartedVoid, rankedRoster } from '../domain/ranked-admission.js';

/** Runs inside the same match transaction, with its match row already locked.
 * Account locks use sorted order across every admission/settlement transaction.
 */
export async function reconcileRankedAdmission(client: PoolClient, schema: string, next: MatchRecord,
  previous: MatchRecord | null, now: number): Promise<void> {
  if (next.mode !== 'ranked') return;
  const roster = rankedRoster(next, previous);
  const prior = previous ? rankedRoster(previous) : [];
  const ids = [...new Set([...roster, ...prior].map(seat => seat.accountId))].sort();
  for (const accountId of ids) await client.query(`INSERT INTO ${schema}.accounts(account_id) VALUES ($1) ON CONFLICT DO NOTHING`, [accountId]);
  const accounts = await client.query(`SELECT account_id,restricted_until FROM ${schema}.accounts
    WHERE account_id=ANY($1::text[]) ORDER BY account_id FOR UPDATE`, [ids]);
  const settled = await client.query(`SELECT 1 FROM ${schema}.settlements WHERE match_id=$1`, [next.matchId]);
  if (settled.rowCount) {
    if (!['finished', 'void'].includes(next.phase)) throw new AdmissionError('invalid_phase');
    await client.query(`DELETE FROM ${schema}.admission_locks WHERE match_id=$1`, [next.matchId]);
    return;
  }
  const restrictions = new Map(accounts.rows.map(row => [row.account_id as string, Number(row.restricted_until)]));
  const entering = new Set(roster.filter(seat => !prior.some(old => old.accountId === seat.accountId)).map(seat => seat.accountId));
  const checking = previous?.phase === 'lobby' && next.phase === 'active' ? roster.map(seat => seat.accountId) : entering;
  for (const accountId of checking) if ((restrictions.get(accountId) ?? Infinity) > now) throw new AdmissionError('ranked_cooldown');
  const locks = await client.query(`SELECT account_id,match_id FROM ${schema}.admission_locks WHERE account_id=ANY($1::text[])`, [ids]);
  if (locks.rows.some(row => row.match_id !== next.matchId && roster.some(seat => seat.accountId === row.account_id))) throw new AdmissionError('ranked_match_locked');
  // Terminal started matches retain all locks until the idempotent settlement.
  // Removing an unstarted seat or voiding an unstarted room releases admission.
  await client.query(`DELETE FROM ${schema}.admission_locks WHERE match_id=$1`, [next.matchId]);
  if (isUnstartedVoid(next, previous)) return;
  for (const seat of roster) await client.query(`INSERT INTO ${schema}.admission_locks(account_id,match_id,color) VALUES ($1,$2,$3)`,
    [seat.accountId, next.matchId, seat.color]);
}
