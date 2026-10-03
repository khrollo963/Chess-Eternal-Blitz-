# Private PostgreSQL persistence

The server uses the approved `pg@8.23.1` driver. The full private match record,
snapshot history, accepted event sequence, actor/request deduplication result,
seat state and absolute deadlines commit in one transaction on one pool client.
Commands acquire the match row lock, check deduplication before the expected
revision, and then enforce the configured command limit. A committed command
that loses its acknowledgement is recovered by retrying the same actor/request.
Public acknowledgements are stored separately from private records; only the
existing explicit public projection may be sent to a browser.

`PostgresMatchStore` implements `LobbyStore`: invitations are unique, private
transport IDs remain in the record, and recoverable records are loaded in stable
match-ID order. `createInvited` returns false for an invite collision; other
storage failures throw a redacted error. No record is silently evicted. Ranked
account, admission-lock and settlement tables establish unique ledger boundaries
for later ranked implementation; creating them does not enable ranked play.

## Connection configuration

Call `createPostgresPool` with a server-only connection URL and trusted CA text.
The pool caps connections at five (default three), validates TLS with
`rejectUnauthorized: true`, and strips URL SSL options so they cannot override
verification. Connection, idle, statement, lock and query timeouts are bounded.
The checked-in certificate is the public Supabase production root CA obtained
from the official download URL used by its dashboard. Its SHA-256 certificate
fingerprint is `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
A custom provider needs its own verified CA. Never place
database credentials in HTML, invite links, logs or a committed environment file.
Driver details and original exception causes are deliberately omitted from errors.

## Explicit migration procedure

Production startup must call `verifyPrivateSchema` before serving rooms. It
checks the known migration version and SHA-256 without mutating the database.
A missing schema, unknown version, missing history or different hash fails
closed. Startup never creates tables or repairs a history mismatch.

For an explicitly authorized initial production migration, an operator reviews
`server/migrations/001-initial.sql`, selects a previously unused dedicated schema
matching `enochian_[a-z0-9_]{1,48}`, and invokes
`migratePrivateSchema(pool, { schema, allowCreate: true })` using the privileged
server connection. This is a separate operator action, never application startup.
Existing managed schemas can be checked with `allowCreate` omitted. Existing
unmanaged schemas are rejected. An advisory transaction lock serializes migration
attempts, and SQL plus history are committed together.

The current migration sequence is immutable `001-initial.sql` followed by
`002-draw-settlements.sql`, which permits the `draw` settlement classification.
An explicit migration upgrades a recognized v1 history once; repeated calls do
not reapply DDL. Startup requires both hashes and rejects v1 without writing.
The operator CLI reports migration version 2. Old code requiring only migration
1 is not a compatible rollback target after the upgrade.

Every table is schema-qualified. Schema/table access is revoked from PUBLIC and
from `anon`/`authenticated` when those roles exist; RLS is enabled on every table
with no browser policies. No existing public table, role, exposed-schema setting
or global default privilege is changed. The private runtime connection must be
the table owner or an explicitly authorized server role; browser roles cannot
access the ledger. Rollback of application code must retain durable records and
use a compatible migration hash; never repair a hash by editing history.

## Disposable acceptance tests

Database tests skip unless `TEST_DATABASE_URL` and `TEST_DATABASE_ISOLATED=1`
are explicitly supplied, with `TEST_DATABASE_CA_FILE` pointing to the trusted CA.
They create only a random `enochian_test_<uuid>` schema and drop only that schema
afterward. They never discover, start, repair or use a local PostgreSQL installation.
The configured URL must be the user's authorized isolated hosted test target.
Run the selected Bun runtime test suite with these variables injected privately;
never echo the URL or source an ignored environment file into tool output.

Coverage includes competing adapters, duplicate replay before CAS, full rollback
before commit, loss of acknowledgement after commit, command capacity, private
invite mapping, normalized deadlines, event uniqueness, RLS and migration hash
rejection. Default local tests verify TLS and pool configuration but do not prove
hosted durability. Production release also requires the service-recovery and
ranked settlement scenarios from the implementation plan.

## Service ownership and restart recovery

Startup without a configured, valid managed schema fails closed for multiplayer;
health remains available and local HTML games remain independent. Startup does
not apply migrations. Readiness remains false until the single-process lease
is held and every recoverable match has been rehydrated.

The Session pooler connection holds a PostgreSQL advisory lease for the selected
schema. A second runtime cannot take ownership while that session is alive.
Heartbeats persist every five seconds in `server_instances`. A lost lease closes
multiplayer and rejects new commands. Private instance ownership plus revision
CAS also prevents an obsolete process from committing after a recovery claim.
Graceful service draining is treated as infrastructure interruption, never an
intentional player Leave.

Recovery keeps the logical match ID and canonical position, clears obsolete
connection IDs, and persists a new transport mapping before reopening admission.
Application credentials work independently of old Colyseus reconnection tokens.
Terminal recovery returns the authenticated public result without requiring an
old transport room to exist.

For active matches, recovery freezes absence at the last durable service
observation, conservatively bounded by the individual departure timestamp and
remaining cumulative allowance. The exact crash instant is unknowable between
heartbeats; this may favor the absent player by at most one heartbeat interval.
Players receive 300 seconds after recovery to return, with ranked resuming only
after everyone returns. An allowance already expired at the last observation
retains its individual departure consequence; an unsuccessful service recovery
voids ranked with reason `service_outage` and no abandonment offenders. Casual
missing owners resume their saved allowance after that grace window. Repeated
outages keep frozen budgets. Ranked ledger settlement and ordinary casual bot
integration are the following tasks; ranked remains disabled.

Acceptance on 2026-10-02: hosted storage/lease/crash suites passed **5 tests,
56 assertions** using unique disposable schemas on the user-selected Supabase
Session pooler, with verified TLS. The crash drill held a real SDK move after
its PostgreSQL commit, forcibly terminated only the test server, started a new
runtime, recovered both owners into a new room, and replayed the original
request exactly once. All created schemas were removed and checked absent.
Twelve memory recovery scenarios passed 80 assertions, including simultaneous
departure, strict grace expiry, frozen budgets and unchanged terminal results.
No installed local PostgreSQL, existing public data, online service provisioning,
permanent schema migration or deployment was used. Review regressions also
verify that final results remain readable after restart, an expiry race does
not stop the service, and old process ownership cannot be overwritten to commit.
Consumed absence is persisted before an early recovery return can discard the
frozen recovery budget. Time spent in service recovery does not consume it.
