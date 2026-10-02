# Multiplayer security audit — 2026-10-02

Scope: current `main` plus this session's local fixes. Source review covered HTTP
and WebSocket authentication, ranked identity binding, connection ownership,
command validation, deduplication/CAS, origin enforcement, payload/rate limits,
sign-in handoffs/CSP, PostgreSQL transactions/TLS and pinned dependencies.
TokenSave reported one stale commit; findings were checked against current
source bytes. No secrets were printed, packages installed, hosted data changed,
Auth providers changed, or local PostgreSQL discovered/started.

## Findings and disposition

### Live egress incident — active investigation

The user's Supabase screenshot showed **14.443 GB / 5 GB (289%)** egress. Read-only statistics from the verified Chess project at approximately 2026-10-02 19:32 UTC found over **5.08 million** `SELECT record ... WHERE match_id` calls returning the same number of full JSON records, about **450,000** commit-count attempts, and only about **34,300** retained committed commands. There were nine matches: one active, one lobby, four finished, three void. The active match's revision was **10,000**; all four seats were bots with no connected humans. Its current record was 2,604 bytes; the lobby record was 2,683 bytes.

Source investigation found two concrete amplification paths:

- `BotScheduler.run` ignored rejected command results and called `afterJob` unconditionally. At the durable 10,000-command limit, `command_capacity` rejects without advancing revision, but room maintenance schedules the same bot turn again after 25 ms. This creates repeated full-record loads, row locks and command-count queries without progress. Ordinary periodic scheduling must also suppress the blocked revision after that nonretryable rejection.
- Room maintenance performs six full-record loads each second before an ordinary idle check completes; global maintenance fetches all recoverable JSON records and then reloads each twice. That is roughly nine full-record copies per recoverable match per second before extra bot retries.

Multiplying the observed full-record reads by the **current** ~2.6 KB record size gives a rough 13 GB payload estimate, before other reads and protocol overhead. This is consistent with the reported magnitude, but is not an exact historical byte measurement or the provider's service-by-service billing breakdown. Supabase counts responses through its Session pooler as [Shared Pooler Egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress). Query statistics cover their own reset window and are not a per-billing-period byte ledger.

The five-second server heartbeat updates a timestamp and returns no match JSON; it is not the identified full-record traffic source. These findings show application traffic inefficiency, not evidence of unauthorized data exposure. The bot, room and global polling fixes passed final regression and independent reviews: 168 server tests passed, seven hosted cases skipped. A requested temporary stop was initially blocked pending permission. The user then approved downtime; the Railway agent incorrectly restarted the deployment and removed its region, resulting in US West fallback/one replica. Further agent actions were blocked; manual deployment removal and original US East/one-replica restoration were requested. Full-read counters remained 5,152,476 over an 87-second sample afterward. This demonstrates a pause in sampled traffic, not a verified deployment of the fixes. No durable records were deleted.

### P1 — unauthenticated unstarted-lobby amplification: bounded locally

Before the fix, a guest could create 30 casual lobbies per minute indefinitely.
A deterministic memory probe created 90 recoverable lobbies over three simulated
minutes without violating transport quotas. Each accepted invitation creates
private records and a transport room with a one-second maintenance timer;
global maintenance also scans every recoverable match every second. Request
rate limits alone did not bound concurrent polling/database work.

The storage adapters now enforce `MULTIPLAYER_MAX_UNSTARTED_LOBBIES`, default
**64**, configurable as an integer **1–256**. Invalid configuration fails before
database acquisition. Every persisted `phase='lobby'` record counts, including
expired records until lifecycle maintenance commits their terminal transition.
New creation at capacity returns `lobby_capacity` with HTTP 429. Existing
matches and joining/recovering their seats remain accessible.

PostgreSQL admission uses a schema-scoped `pg_advisory_xact_lock`, followed by
collision detection, lobby count and insertion in the same transaction under
explicit READ COMMITTED isolation. Concurrent creates from different pool
connections cannot both claim the final slot. The memory adapter counts and
inserts synchronously before yielding. Starting or voiding a lobby releases its
slot without deleting retained records. No schema migration is required.

Relevant files: `server/src/storage/lobby-capacity.ts`, `MemoryLobbyStore.ts`,
`PostgresMatchStore.ts`, `postgres.ts`, `server/src/recovery/DurableRuntime.ts`,
`start-server.ts`, and `server/src/http/invitations.ts`.

The concurrency regression first failed: all 12 competing creates succeeded
against a requested capacity of two. It now admits exactly two and rejects ten.
PostgreSQL unit coverage checks lock-before-count ordering, capacity rollback,
safe error propagation and the absence of insert on rejection. This is a
deterministic query-contract test, **not a live PostgreSQL concurrency test**.
Database acceptance remains unverified in this session; the existing opt-in
isolated PostgreSQL case was skipped.

The cap bounds unstarted amplification. It is not a total active-match limit or
a replacement for operational load/abuse controls. Raising it requires measured
database/polling capacity rather than assuming the upper bound is safe.

### P2 — shared Railway ingress quotas: unresolved deployment risk

`SecureBunWebSockets.ts` uses Bun's native socket peer as the source key, never
raw forwarded headers. With Railway edge ingress, distinct users may share that
peer and its HTTP 120/minute and upgrade 30/minute quotas. A deterministic probe
sent 120 permitted requests to an unknown route; the next legitimate identity
request using the same peer returned 429. A native caller can provide an
allowlisted Origin; Origin enforcement is a browser boundary, not identity.

The shared quota is explicit in the current implementation. Changing it safely
requires a verified ingress-only client identification contract, origin-server
network isolation and abuse limits at the trusted edge, or carefully designed
fair authenticated credential/account scopes combined with aggregate bounds.
Do not use arbitrary `X-Forwarded-For`, `X-Forwarded-Proto` or `context.ip` as
trusted identity/TLS evidence. No provider or ingress configuration changed.

### P2 — historical durable retention growth: unresolved policy requirement

`retainUntil` is persisted, but production has no purge consuming it. Snapshots,
commands, events and terminal matches therefore accumulate across successive
admitted lobbies. The new concurrent cap bounds live unstarted work, not total
storage growth. Active matches also retain their command/snapshot ledgers.

No records were deleted. A future cleanup policy must define final-result
availability, recovery/deduplication windows, ranked settlement/admission-lock
dependencies, backups and bounded deletion batches before deleting private
ledgers. Monitor storage until that policy and its tests are accepted.

## Supabase egress incident — measured data and source explanation

The user's Chess-project usage screenshot reported **14.443 GB of 5 GB egress
(289%)** after approximately one day. The root session obtained read-only
statistics from that exact project; no hosted records were changed:

| Observation | Measured value |
| --- | --- |
| Full match-record SELECT by match ID | 5,070,780 calls/rows |
| Command lookup | 898,151 calls, zero returned rows |
| Revision/full-record SELECT FOR UPDATE | 449,115 calls |
| Command-count query during commit | 449,109 calls |
| Current matches | Nine: one active, one lobby, four finished, three void |
| Active match | Revision 10,000, four bot seats, no clients, record 2,604 bytes |
| Current lobby record | 2,683 bytes |
| Finished match revisions | 5,555; 6,396; 8,801; 3,562; records about 2,947 bytes |
| Durable commands | 34,317 rows, 69.8 MB |
| Durable snapshots | 34,320 rows, 51.1 MB |
| Durable events | 68,782 rows, 21.9 MB |

`pg_stat_statements` reset time was 2026-09-29, preceding the reported Oct 2
project creation; it is not a precise one-day metering window. Counts describe
database work accumulated since reset, not a provider egress attribution trace.

**P1 — exhausted bot commands continuously resubmitted unchanged state.**
The deployed scheduler ignored `CommandProcessor.execute()` results. At the
10,000-command bound, a bot received nonretryable `command_capacity`, then
`afterJob` invoked room maintenance, which scheduled the same unchanged
revision again after 25 ms. Periodic room maintenance could also rearm it.
Hundreds of thousands of commit attempts against only 34,317 durable commands,
an active all-bot match at revision 10,000, and millions of full-record reads
strongly support this loop as a major cause of the observed egress.

The local fix retains the failed match/revision/controller/owner key and blocks
nonretryable retries even when periodic scheduling or cancellation occurs.
Only a real state-key change permits new work. Retryable failures self-schedule
with backoff of 1, 2, 4, 8, 16, then at most one retry every 30 seconds; they do
not depend on repeatedly reading unchanged state in room maintenance. No active
match was deleted or voided. An existing command-cap-bound match remains
stranded pending an explicit terminal/recovery policy; blocking the runaway
does not invent additional command capacity or fabricate a final result.

A real regression using the bounded memory store first failed because the
unchanged rejected revision scheduled a second job. It now executes once and
remains blocked across ten repeated maintenance-style schedule attempts.
Separate tests verify backoff and reopening after a genuine revision change.

Post-fix bot verification ran `server/test/bot.test.ts`,
`server/test/casual-lifecycle.test.ts` and the real SDK casual full-game test:
**12 passed, zero failed, 2,301 assertions**. Typecheck passed after the
concurrent room/storage metadata changes were available.
An additional canonical no-move guard then passed the bot-only batch: eight
tests, zero failures, sixteen assertions. An unchanged board with no available
bot move likewise remains dormant until its durable state changes.

**P1 — idle maintenance unnecessarily repeatedly fetched complete records.**
Before the local optimizations, a nonterminal room's one-second maintenance did
six full-record loads: lobby expiry, service recovery expiry, casual expiry,
ranked expiry even for casual, exchange expiry, and the final publication load.
The global one-second maintenance additionally fetched every recoverable record
and loaded each twice for lobby/recovery checks. This is approximately **nine
full-record copies per second per recoverable match**, excluding bot commands,
client commands, commit fencing, deduplication and startup reads.

A local probe invoking the actual maintenance/services with a counting memory
adapter confirmed **six loads per room-maintenance invocation**. The production
global-query multiplier is derived from PostgreSQL SQL and call paths; the
memory adapter's list operation internally loads records and is not a literal
PostgreSQL wire-volume measurement.

At a 2,604-byte record, nine copies/second imply about **2.025 GB per match per
24 hours** of JSON payload alone. Multiplying the measured 5,070,780 full-record
rows by current record sizes gives roughly **13.2–14.9 GB** of payload; the
449,115 additional locked full-record rows could add approximately **1.17 GB**.
These are estimates, not exact billed bytes: historical record lengths,
PostgreSQL framing/TLS, project metering periods and other traffic differ.
Nevertheless, the magnitudes explain how modest gameplay can consume the
observed allowance. Database table sizes alone do not measure egress; the same
record was repeatedly transferred from Supabase to Railway.

The concurrent global/room fixes replace idle full-record polling with compact
revision/deadline metadata and fetch full records only after revision changes
or due lifecycle transitions. They preserve fresh command-time validation,
CAS/fencing, recovery and settlement semantics. Their tests and rollout status
are recorded by the root session. Deploying the corrected code is required
before these changes affect the hosted service.

The five-second process heartbeat updates only `server_instances` and does
**not** create match snapshots. Snapshot accumulation follows accepted commits,
not idle heartbeat ticks. No automatic quota increase, billing-plan change or
data deletion was performed.

## Live database security checks

The root session inspected the exact Chess project's advisors and grants using
read-only queries. Both browser roles, `anon` and `authenticated`, had schema
usage **false** and **zero accessible private tables**. The twelve informational
RLS-without-policy findings are consistent with this private server-only schema:
browser roles intentionally have no table access and no policy granting it.

The advisor warned about `public.rls_auto_enable`, a SECURITY DEFINER function
with execute grants. Its inspected definition returns `event_trigger`, uses
`search_path=pg_catalog`, consumes PostgreSQL DDL event commands for CREATE
TABLE, quotes object identifiers and enables RLS only for public-schema tables.
It contains no other mutation. Its event-trigger return type is not an ordinary
client RPC function; the warning alone does not establish browser exploitability.
No function or ACL was altered merely to clear the advisor warning.

Leaked-password protection was disabled. This app uses email OTP rather than
password login, so this warning does not explain the egress or expose the OTP
flow to leaked-password reuse. Reassess it if password authentication is added.
Performance advisors also listed an unindexed `rating_entries.account_id`
foreign key and an unused `deadlines_due` index. These observations do not
account for the millions of repeated record reads; no index/migration changes
were made from advisor suggestions alone.

These checks establish observed browser-role isolation and inspected function
behavior at this point in time, not a guarantee against later grant drift or
all database vulnerabilities.

## Dependency advisories

The npm public bulk advisory endpoint was queried with the **152 resolved
package names and versions** in `server/bun.lock`, including optional platform
packages. On 2026-10-02 it returned **HTTP 200** with **`advisories: {}`**.
This means no matching known advisories were returned by that database at the
time of the check; it does not establish absence of undisclosed vulnerabilities
or validate package provenance.

Primary-source spot checks confirmed locked `ws 8.22.0` is outside the affected
range of [GHSA-3h5v-q93c-6h6q](https://github.com/websockets/ws/security/advisories/GHSA-3h5v-q93c-6h6q),
and locked `qs 6.16.0` includes the patch for
[GHSA-4mjr-xmp4-gh2g](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g).
Reviewed upstream advisory pages:
[Supabase JS](https://github.com/supabase/supabase-js/security/advisories),
[Colyseus](https://github.com/colyseus/colyseus/security/advisories),
[Bun](https://github.com/oven-sh/bun/security/advisories), and
[Express](https://github.com/expressjs/express/security/advisories).

PostgreSQL lock/isolation semantics were fetched through Context7 and verified
against the official [advisory locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
and [READ COMMITTED documentation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).

## Reproduction and verification

From repository root, using the approved existing runtime:

```powershell
.tooling/bun-1.4.2/bun-windows-x64/bun.exe test server/test/lobby-capacity.test.ts server/test/postgres-store.test.ts server/test/lobby.test.ts server/test/casual-failure-scenarios.test.ts
.tooling/bun-1.4.2/bun-windows-x64/bun.exe scripts/run-server.mjs typecheck
git diff --check
```

Recorded focused batch: **26 passed, one isolated database case skipped, zero
failed, 122 assertions**. Typecheck and whitespace validation passed. The six
capacity tests also passed separately after explicitly setting PostgreSQL
admission isolation. Broader root-session verification is recorded separately.

Re-run the read-only dependency query from PowerShell with network access:

```powershell
@'
import { readFileSync } from 'node:fs';
const packages = {};
for (const line of readFileSync('server/bun.lock', 'utf8').split('\n')) {
  const match = line.match(/^\s*"[^"]+": \["([^"]+)@([^@"]+)",/);
  if (match) (packages[match[1]] ??= []).push(match[2]);
}
const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packages)
});
console.log(JSON.stringify({ status: response.status, packages: Object.keys(packages).length,
  advisories: await response.json() }, null, 2));
'@ | node --input-type=module
```

Reproduce shared-peer quota interference without network/database activity:

```powershell
.tooling/bun-1.4.2/bun-windows-x64/bun.exe -e 'import { TransportSecurity } from "./server/src/http/transport-security.ts"; const s=new TransportSecurity({allowedOrigins:["https://example.com"]}); for(let i=0;i<120;i++) s.guard(new Request("https://example.com/unknown",{headers:{origin:"https://example.com"}}),{sourceKey:"edge",secure:true},0); console.log(s.guard(new Request("https://example.com/identity/config",{headers:{origin:"https://example.com"}}),{sourceKey:"edge",secure:true},0)?.status);'
```

Expected result: `429`.

## Coverage limits

No concrete authentication bypass, SQL injection, credential disclosure or
client-controlled actor/seat mutation was identified. Fresh ranked account
verification, ownership checks, exact command keys, bounded raw bodies,
transactional CAS/deduplication, strict database TLS, sign-in nonce CSP and
one-time handoff secrets were reviewed.

There was no hosted load test, production proxy identification verification,
multi-device browser exploit test, package
provenance verification or live PostgreSQL admission contention test. The
unstarted cap is implemented locally and requires deployment before it protects
the hosted service. No claim of complete security or production acceptance is
made from these checks.
