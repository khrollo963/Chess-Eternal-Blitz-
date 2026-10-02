# Enochian multiplayer protocol v1

The server accepts intent commands and publishes committed snapshots. `matchId` is the stable application ID, independent of the transport room/session ID. The current executable movement rules are identified by `enochian-current-1`; AI changes do not change that legal-rules version. Incompatible clients receive `incompatible_version` and must update.

## Public snapshot

`publicSnapshot` is an explicit allowlist. It contains `matchId`, `protocolVersion`, `rulesVersion`, monotonic `revision`, `mode`, `phase`, `board`, `alive`, `turn`, `moveCount`, exactly four `seats`, `lobbyDeadline`, `recoveryDeadline`, and `terminalResult`. A board key is `row,column`; each value contains only piece color/type. Colors and turn order are `R`, `B`, `Y`, `K`.

Every public seat contains `color`, display-only `displayName`, `controller` (`human`, `temporary_bot`, `bot`), `connected`, `ready`, and nullable absolute `disconnectDeadline`. Army alive/frozen status is independent of connection/controller status. Human account subjects, email addresses, seat recovery credentials/hashes, admission/settlement data and private ownership IDs remain private storage fields. They must never enter Schema, room metadata, invites, logs or public snapshots. Display names must be approved display labels, never automatically copied from an auth email or account subject.

Phases are `lobby`, `active`, `paused`, `finished`, and `void`. This command module permits ordinary moves only in `active`; a canonical engine victory transitions atomically to `finished`. Lobby/readiness, departure/recovery, exchange and ranked settlement transitions are implemented by later lifecycle modules. `terminalResult` is null until final; victory is `{kind: "victory", winningTeam: 1|2, reason: null}`. Voids use `kind: "void"` with no winning team and a public reason. Terminal results are final. The contract can represent ranked matches; production ranked remains disabled pending admission, settlement and recovery acceptance.

## Move command

```json
{
  "requestId": "move_001",
  "matchId": "match_001",
  "expectedRevision": 0,
  "protocolVersion": 1,
  "rulesVersion": "enochian-current-1",
  "action": {"type": "move", "fr": 6, "fc": 7, "tr": 5, "tc": 7}
}
```

Only the displayed keys and action are accepted. IDs are 1–96 ASCII letters/digits/underscores/hyphens; revision is a nonnegative safe integer. Coordinates must be integers within the 8×8 grid or the four existing external throne cells `(0,-1)`, `(-1,7)`, `(7,8)`, `(8,0)`. Geometry validation never substitutes for canonical legal-move validation. Decoded JSON is capped at 2,048 characters; transport additionally caps raw message bytes before parsing and later applies rate limits. Unknown actions/keys, fractions, invalid coordinates and oversized messages are rejected before queueing. Commands cannot supply seat, actor, controller or account identity. The transport injects authenticated `ActorContext`; bot scheduling injects its independently trusted controller context.

## Atomic acceptance and retries

`CommandProcessor.execute` copies parsed input and actor context, then serializes operations per logical match. It checks the stored `(matchId, authenticated actorId, requestId)` result before revision/phase checks. An identical duplicate replays the original acknowledgement, including its original revision, without applying or publishing another move. Reusing that accepted ID for another payload—including a changed expected revision—returns `request_conflict`. Clients must ignore a duplicate acknowledgement snapshot older than the newest observed revision. Rejected or persistence-failed commands do not reserve request IDs.

The processor loads committed state, checks version/revision, seat ownership/controller/connection, phase, current deadline, ranked human-only restrictions, source ownership, alive status, turn and canonical legality. It computes a successor from a defensive clone. The store transaction saves successor snapshot, absolute deadlines, canonical events and the dedup acknowledgement under expected-revision compare-and-swap. Only successful commit permits publication and acknowledgement. Concurrent processors also rely on the store transaction's dedup uniqueness and revision constraint; an in-process queue alone is insufficient.

Success is `{ok: true, code: "accepted", retryable: false, requestId, snapshot}`. Rejections include `invalid_command`, `incompatible_version`, `unauthorized`, `not_found`, `request_conflict`, `stale_revision`, `invalid_phase`, `wrong_seat`, `out_of_turn`, `frozen_army`, `illegal_move`, `deadline_expired`, `command_capacity`, and `storage_unavailable`. Responses never include private database errors. Storage failure leaves committed state unchanged and is retryable with the same request. A stale revision requires resynchronization and a new request ID for a changed envelope. A publication failure after commit remains accepted; clients recover from persisted state or replay the request.

## Storage contract and retention

`MatchStore` provides create/load, actor-scoped command lookup and atomic `commit`. Every implementation must check duplicate command first, compare the expected revision, require successor revision exactly one greater, and save state/events/dedup result in one transaction. PostgreSQL must enforce uniqueness across workers; memory is a test adapter only. Future admission and settlement work extends this transaction boundary or persists a pending settlement atomically with the terminal move before opening new admission.

The memory adapter defaults to 1,000 matches and 10,000 accepted commands per match. Capacity rejects new work rather than evicting valid duplicate results. Returned/accepted values are defensive clones. Active and paused matches are never pruned. Terminal pruning requires an explicit finite `retainUntil` and waits until the latest of that retention deadline, recovery deadline and every seat's disconnect deadline; null retention preserves data indefinitely. Lifecycle/recovery code must choose retention beyond its complete application recovery window. A production store needs equivalent retention and capacity policy with enough space for active play. No timer or room disposal is the only persistence point.

Task 5 tests exercise canonical moves, authorization, revision/phase/turn/frozen guards, strict geometry, duplicates/altered duplicates, cross-processor revision races, delayed and failed persistence, recovery replay, publication failure, terminal atomicity, secret projection and recovery-window retention using only in-memory stores.
