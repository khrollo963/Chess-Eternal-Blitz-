# Ranked timeline and settlement contract

Ranked matches retain four distinct human owners and never assign bot control. A departure pauses play immediately. Each color has a cumulative 300,000 ms player-absence budget; repeated departures use the remaining budget, and simultaneous departures have independent absolute deadlines. A return must occur strictly before every currently expired departure deadline. The match resumes only after all four humans are connected. Moves and prisoner exchange remain unavailable while paused. Intentional Leave immediately voids the match with the leaving color as offender. Ordinary timeout records only missing players whose individual deadlines have expired.

`departRanked`, `reclaimRanked` and `expireRanked` modify candidate records only. They perform no I/O, timers, acknowledgement or revision changes. Callers must clone the persisted record, apply a helper, invalidate any exchange offer on pause or terminal transition, and atomically persist the snapshot and event with revision compare-and-swap before publishing. Ownership credentials and connection bindings remain the service layer's responsibility. Terminal results remain final.

Service recovery uses the existing `RecoveryCoordinator`. `freezeRankedAbsence` consumes only time through the last durable service observation; `returnedRankedOwner` clears any frozen running clock. Service recovery returns must use the coordinator rather than ordinary `reclaimRanked`. Its 300,000 ms service grace is independent of player budgets. A failed service grace voids with `service_outage` and no offenders. Departures already expired before the outage retain the coordinator's `abandonment` result and private `expiredDepartures` list. Outage time never consumes a player's allowance.

`buildRankedSettlement(record, ratingsByColor, now)` returns a pure settlement proposal keyed by stable `matchId`, with account entries, previous/new ratings, deltas and optional new restrictions. Started matches require all four verified accounts; an unstarted `lobby_expired` or `transport_creation_failed` void includes only admitted accounts with zero deltas and no new restrictions. The input accounts must match the private verified ranked roster, including every admitted account. Missing ratings begin at 1200. Canonical team 1 is R/Y and team 2 is B/K. Normal results compare team-average Elo with K=32, round the winning team's delta once, apply that same delta to both winners, and its opposite to both losers. This preserves zero sum. There is no rating floor.

For an abandonment void, each color in `expiredDepartures` loses 32 and receives a restriction through `settledAt + 600000`; other players receive zero change. Other void reasons, including `service_outage`, have no offenders. A null restriction proposal means no new restriction, not removal of an existing restriction. `rankedEntryAllowed` rejects entry before the deadline and allows it at the deadline. Durable unique settlement, atomic rating writes and admission-lock release belong to the integrating store, which must persist each match's settlement exactly once.

Local tests cover strict 299,999/300,000 ms return boundaries, repeated and simultaneous departures, all-human resume, terminal finality, paused move/exchange rejection, service-outage separation, equal and unequal team formulas, rounding, negative ratings and 599,999/600,000 ms restriction boundaries. They use memory storage and no provider or database.

## Durable integration and acceptance

`RankedService` persists departure/return/expiry through bounded revision-CAS
retries, rechecking the current private connection after contention. Room
preflight and scheduled maintenance use the absolute clock. Service draining
is not an intentional player departure; an explicit Leave during service
recovery still has the approved individual consequence.

Terminal moves and voids persist `pendingSettlement` with their accepted
snapshot. Account admission locks remain until settlement. The terminal match
and absence of a unique settlement row also form the durable recovery queue;
startup completes that queue before readiness, and maintenance retries it.
`PostgresRankedSettlement` locks the match followed by sorted account rows,
then atomically writes the immutable settlement, rating entries, restrictions
and admission-lock release. Existing settlement details replay without moving
the cooldown start. Settlement never changes the public terminal result or
rewrites its snapshot/revision.

Real SDK tests completed a canonical initial-board match with four human
controllers, replayed its final command once, and exercised drop, strict
return and delayed timeout with only the expired player recorded as offender.
Hosted Supabase settlement and pending-recovery checks passed three tests /
55 assertions in disposable schemas: competing settlers, transaction rollback,
lost acknowledgement, outage without penalties and startup after an accepted
terminal move before settlement. Created schemas were removed. These checks
do not satisfy separate physical-device/platform or Railway restart acceptance.
Production ranked entry remains disabled.
