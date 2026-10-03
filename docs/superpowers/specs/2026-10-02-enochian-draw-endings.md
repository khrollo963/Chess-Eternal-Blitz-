# Enochian automatic draw endings

Requested by the user after Ken reported two surviving bot kings wandering indefinitely, with the supplied screenshot showing moves beyond 400.

## Approved app behavior

Victory takes precedence when a team loses its last king. Otherwise:

- **Bare kings:** every surviving army has exactly one piece, its king. Frozen pieces belonging to captured armies do not count. This closes Ken's ending automatically.
- **Global stalemate:** none of the surviving armies has a legal geometric move. A single blocked army is still skipped when another living army can move.

These are explicit app rules. They do not introduce check, checkmate, repetition or a fifty-move rule, and do not claim to reproduce every historical Golden Dawn draw convention. Chaturaji remains unchanged.

Both endings stop CPU scheduling, mark the canonical state as over and preserve the final board and move history. Local play shows a draw overlay and records one session result. Online snapshots carry `kind: draw`, `winningTeam: null` and reason `bare_kings` or `stalemate`. Ranked settlement uses a half-point team Elo score, zero-sum rounded deltas, no abandonment penalties and the existing immutable/idempotent ledger.

## Compatibility and release

Rules version is `enochian-current-2`; protocol version remains 1. Old clients are rejected and must refresh. Recovery upgrades known v1 unfinished records without erasing their board, captures or move count, and completes qualifying draw positions. Completed historical results are preserved and the new client can still display v1 finished/void snapshots; active v1 snapshots remain incompatible. Departure penalties that already expired before an outage retain their existing precedence.

`002-draw-settlements.sql` extends the private settlement constraint to allow draws. Migration 1 is unchanged. Explicit migration accepts only a recognized contiguous migration history, applies migration 2 transactionally and records its SHA-256. Startup is read-only and requires migration 2; it will refuse an unmigrated database.

Release requires stopping the previous Railway deployment and verifying it is removed, then explicitly migrating the dedicated schema and deploying the matching new code on `main`. Never run overlapping servers against the exclusive lease. Review [operations](../../multiplayer/operations.md) and [persistence](../../multiplayer/persistence.md). Keep credentials private. A rollback requires code that accepts migration 2 and draw records; the old v1 binary is not compatible. Do not delete results or edit migration history to force a rollback.

## Validation scope

Regression fixtures cover Ken's position, frozen material, globally blocked armies, one blocked army with continued play, final king-capture victory, local CPU cancellation, exactly-once session reporting, durable terminal commands/replay, recovery of v1 games, public draw projection, team Elo and durable draw settlement. Real SDK tests exercise full initial-state casual and ranked games. Migration contract tests cover v1 upgrade, idempotence, read-only startup, unknown hashes and rollback.

Default tests use isolated memory stores and controlled database-query doubles. Real PostgreSQL acceptance requires the explicitly configured isolated test database; passing contract tests alone does not prove hosted migration or production rollout.

Local validation: 94 client tests and 183 server tests pass, with seven opt-in hosted database tests skipped. Bun 1.4.2 typechecking and production build pass. Chaturaji, the launcher and migration 1 remain byte-identical to HEAD. Production migration, browser acceptance and rollout have not been performed for this feature.
