# Enochian AI and Colyseus Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two Base64 game payloads with readable HTML pages, repair Enochian AI and add authoritative Colyseus multiplayer on Railway, while preserving Chaturaji content/behavior and existing Enochian mechanics. Ship the three-page client as one platform ZIP, with optional generated single-HTML export.

**Architecture:** Readable `index.html` launcher plus `chaturaji.html` and `enochian.html`; lazily load same-origin relative iframe `src` once per game, keeping frames mounted when switching. One Colyseus Room per match and one backend process initially on Railway. Pinned Bun uses the official experimental transport after local compatibility acceptance; Node is the permitted fallback. Extract the canonical DOM-free engine from `enochian.html` for server use; embed the pinned browser SDK in that game page. A durable store records commands, snapshots, ownership, deadlines and settlement before acknowledgement. Existing Supabase PostgreSQL/Auth and the concrete Railway plan/budget are approved; deployed acceptance remains gated. No Cloudflare backend or dual live transports.

**Tech Stack:** Three readable HTML pages with inline CSS/JavaScript/assets; latest stable Bun package manager and preferred Bun backend runtime; TypeScript compiler for type checking/production compilation; approved compatible Colyseus server/schema/SDK/Bun transport; PostgreSQL adapter if approved. Runtime validation gate G9 selects Bun or a maintained compatible Node LTS fallback before full backend implementation. Use the chosen runtime's built-in backend test runner and shared scenario fixtures. No frontend framework, Redis or multi-process cluster initially.

---

## Status and scope

Implementation authorized, 2026-10-02. The user selected Colyseus, replacing the previous Cloudflare Workers + Durable Objects choice, then authorized executing all tasks without between-task approval pauses. Read the [execution ledger](2026-10-02-enochian-execution-ledger.md) for Tasks 0–12 commits, exact dependency/product approvals, Railway target/budget and remaining gates. Tasks 13–15 are implemented/in progress pending root checks/checkpoints; full Task 14 acceptance remains incomplete. Preserve unrelated work. Original task checkboxes are acceptance requirements, not a current checkpoint ledger.

Read the companion [design](../specs/2026-10-02-enochian-multiplayer-design.md) and [historical audit](../specs/2026-10-02-enochian-rule-audit.md). Preserve executable rules rather than filling historical gaps. Chaturaji gameplay/code changes remain out of scope: the only authorized migration is byte-preserving decoding into `chaturaji.html`. The launcher may change only as needed for lazy relative `src` loading, removal of payload constants/decoder and a separately generated export. Preserve navigation, styling, artwork, storage keys and the `window.parent.addGameSession` bridge. Keep embedded image assets in each game page. Update README to describe the three-page source layout. No mandatory CDN dependencies.

Read [stack and game engineering requirements](../specs/2026-10-02-stack-and-game-engineering.md). Use Exa for source discovery and Context7 for current library/API docs; use Superpowers for implementation/verification subject to the user's END ONLY review override below. Build game-specific policies around Colyseus rather than assuming the framework supplies them. Use the exact approved dependency list; confirm new dependencies before installing. Concrete Railway creation/deployment and saved budget controls are now authorized as recorded in the ledger. The Colyseus GitHub issue is canceled; do not publish it.

Confirmed policies:

- Private room creation with code/link; casual has 2–4 humans and bots in other seats.
- Ranked starts with four distinct authenticated humans; no ranked bots at any time.
- Casual departure immediately enables temporary AI. Reclaim allowed strictly before the 180-second deadline. At/after expiry AI permanently owns the seat for that match. Accepted bot moves stand.
- Ranked departure immediately pauses play. Resume only when all required players are connected. At/after a 300-second unresolved departure deadline, void the match and apply the approved departing-player rank consequence and 600-second ranked-entry restriction.
- Prisoner-king exchange is multiplayer-only and human-controlled for this phase. No diplomacy promises, truces or new alliances. No single-player/AI-captor negotiation.

### Policy gates: do not substitute guesses for decisions

Record each answer in the design and this file before its dependent implementation:

| Gate | Decision required | Work it blocks |
| --- | --- | --- |
| G1 | Approved Railway target/region/replica/sleep settings and saved budget; existing Supabase Auth/PostgreSQL. Ledger records exact IDs and snapshot state. | Deployed acceptance, schema/backup/recovery evidence still required. |
| G2 | Approved Supabase persistent identity without automatic platform linking; email currently enabled, social configuration later. | Live embedded-platform authentication/provider acceptance and ranked release. |
| G3 | Approved initial 1200, team-average Elo K32, common rounded teammate deltas; void offender -32 and 600-second restriction from settlement, others unchanged, no floor. | Exactly-once settlement/recovery release acceptance. |
| G4 | Approved connected human captors, rule 8.5 timing, 60-second offers, atomic safe restoration and deterministic ties; see decisions/ledger. | Exchange atomicity and client/device acceptance. |
| G5 | Approved cumulative per-player allowance, independent simultaneous clocks, intentional Leave and service grace; see decisions/ledger. | Disconnect/service-recovery release acceptance. |
| G6 | Approved final outcome remains final; return shows results. | Terminal reconnect acceptance. |
| G7 | Approved explicit Ready, available color, private code/link, 30-minute unstarted expiry, no spectators/public matchmaking. | Lobby release acceptance. |
| G8 | Confirm direct dependencies/tooling, exact latest compatible stable versions, purpose and tradeoffs before each installation. | Any dependency installation/scaffold requiring unapproved packages. |
| G9 | Verify latest Bun with the compatible official Colyseus Bun transport, schema, SDK, auth/routes and storage. Docs label Bun support experimental. Prefer Bun if local acceptance passes; use permitted Node fallback if not, record evidence and confirm changed packages under G8. Railway transport/restart validation is a separate later deployment acceptance check. | Full backend runtime/transport implementation after a local compatibility probe; production release also needs Railway acceptance. |

Ranked remains disabled in the public client until G1–G5 and ranked recovery/security tests pass. Prisoner exchange remains disabled until G4 is resolved. This is a phased plan, not approval to invent historical rules. Casual production release also requires its applicable gates, including G5–G7.

### Implementation decisions approved on 2026-10-02

- Execution: continue all tasks without between-task approval pauses; one commit per task and one final pull request to `main`. Deployment, spending and platform publication still require separate authorization.
- Later execution steering: run independent spec and quality reviews once at the end, covering every task not already passed by both reviews. Continue focused implementation tests per task. Tasks 0–6 passed both reviews; Task 7 passed both before the final absence-normalization regression/fix, so that delta remains in the final review scope. Tasks 8–15 remain in that scope.
- G8: approved `@colyseus/core@0.18.18`, `@colyseus/schema@5.0.35`, `@colyseus/sdk@0.18.4`, `@colyseus/bun-websockets@0.18.3`, `typescript@7.0.2`, `@types/bun@1.4.2`, `@types/node@24.19.1`, and a project-local Bun 1.4.2 runtime. G9 requires actual compatibility evidence.
- G7: private code/link rooms, explicit readiness by each human, selection of an available color, no spectators/public matchmaking, and 30-minute expiry for an unstarted room.
- G5: each player has a cumulative absence allowance per match (casual 180 seconds; ranked 300 seconds). Repeated drops consume the remaining allowance; simultaneous departures have independent clocks. Ranked resumes only with everyone returned; timeout penalties apply only to players whose allowance expired. Intentional Leave immediately gives permanent casual bot control or voids ranked with the leaving player's consequence. A service restart freezes absence clocks and gives 300 seconds after recovery to return; failed ranked recovery voids without outage penalties.
- G4: only the two connected human captors with active armies may negotiate. Offer timing follows rule 8.5: immediately after the qualifying capture or on the captor's later turns. Offers last 60 seconds and invalidate on any move, control change, pause or terminal result. Restore both kings atomically to empty safe thrones, otherwise nearest empty unthreatened squares by king-step distance, with fixed color order then row/column resolving ties. Assess safety with both armies thawed; reject without partial changes if no safe pair exists. Terminal results remain final (including casual completion during a reclaim allowance, G6); returning players see the result.

- G1 storage/G8: approved PostgreSQL with `pg@8.23.1` and `@types/pg@8.23.1`. Earlier approval of disposable loopback tests is historical and explicitly revoked below; do not use any local PostgreSQL installation or service.

- G1 online provider: existing Supabase project for PostgreSQL/Auth; Railway hosts the Colyseus process. Concrete Railway creation/deployment, region, one replica, sleeping disabled and saved $10 compute hard limit/$5 alert are authorized; exact project/service/domain/branch are in the execution ledger. Dedicated permanent schema application and deployment remain unperformed at that snapshot.
- Later user steering supersedes local database test authorization: do not use or repair the machine's existing PostgreSQL installation. Continue with memory-store tests; database-specific acceptance must use an explicitly configured isolated Supabase test target. A completed earlier disposable probe is historical evidence, not authorization to repeat it.
- G2: Supabase Auth with email/social sign-in. Persistent Supabase account identity is shared across game origins; platform account identities are not implicitly transferable. G8 explicitly approves `@supabase/supabase-js@2.117.2` for Task 10, including its locally embedded official browser bundle. Live provider configuration remains gated.
- G3: initial rating 1200; team Elo compares team-average ratings with K=32 and the same rounded delta for both teammates on normal completion. Void settlement leaves other players unchanged, deducts 32 from each approved abandoning player, and begins that player's 600-second restriction at settlement. No artificial rating floor.

These approved online policies extend prisoner exchange and connectivity only. Ordinary executable movement, promotion, check, freezing and victory rules remain protected. G9 deployed acceptance and production ranked authentication/persistence/recovery gates remain. Deployment authorization does not establish passing acceptance or authorize platform publication.

## Repository layout and engine contract

Original proposed layout (historical names; inspect current files and the execution ledger before continuing):

```text
index.html                          readable launcher and shared statistics
chaturaji.html                      exact decoded Chaturaji source; protected
enochian.html                       readable Enochian source and canonical engine
scripts/extract-game-pages.mjs       one-time lossless extraction of both payloads
scripts/package-client.mjs           ZIP staging manifest; optional single-HTML export
scripts/extract-enochian-engine.mjs   extract the canonical marked engine
scripts/embed-colyseus-sdk.mjs        embed pinned browser bundle + license
scripts/check-client-preservation.mjs decoded Chaturaji hash + scoped launcher invariants
tests/fixtures/client-baseline.json  hashes, invariant fixtures, format/version
tests/enochian-engine.test.mjs       executable rules parity
tests/enochian-ai.test.mjs           scoring/simulation regression tests
tests/enochian-lifecycle.test.mjs    CPU timer/match identity regressions
server/package.json                 pinned backend dependencies/scripts
server/bun.lock                     committed Bun package-manager lockfile
server/tsconfig.json
server/tsconfig.test.json            runtime-specific backend test compilation if needed
server/src/generated/enochian-engine.mjs  derived file; never hand edit
server/src/index.ts                  server configuration/bootstrap
server/src/rooms/EnochianRoom.ts      lifecycle; delegates domain commands
server/src/rooms/EnochianState.ts     public schema/synchronization
server/src/domain/{commands,match,disconnects,exchange,ranking}.ts
server/src/storage/{MatchStore,MemoryMatchStore,PostgresMatchStore}.ts
server/src/auth/{identity,recovery}.ts
server/src/http/{invites,recover}.ts
server/src/config.ts
server/test/                         domain, persistence and SDK integration tests
server/migrations/                   approved database schema
server/.env.example                 placeholders only
docs/multiplayer/{protocol,operations,release-checklist}.md
docs/multiplayer/dependencies.md     approval/version/compatibility record
```

Keep the marked engine in `enochian.html` as the canonical source. Expose an immutable API such as `EnochianEngine.initialState()`, `legalMoves(state, from)`, `applyMove(state, move)`, `chooseAiMove(state, color, difficulty, random)` and `outcome(state)`. `applyMove` returns new state/events; it does not read the live UI's global `game`, play sounds or schedule timers. Domain state includes existing board/throne coordinates, alive/frozen flags, turn and promotion information. Multiplayer ownership, prisoners and connectivity are application metadata around that state. Extraction must not create a second independently maintained rules engine.

Within `enochian.html`, use commented numbered sections for styles, markup/templates, immutable constants, pure rules engine, AI evaluation, local session/timers, multiplayer transport, exchange/lobby UI, rendering, input, audio and bootstrap. Encapsulate private state in closures with small explicit APIs. Keep rendering, sound and animations separate from rule mutation; injected clock/RNG/transport permit deterministic tests. Annotate source/geometry invariants and why lifecycle guards exist. Human-authored code remains readable; only the SDK vendor block may be generated/minified. Do not reformat Chaturaji; keep launcher changes limited to the requested migration.

## Task 0: Decode game pages and migrate launcher loading

**Files:** Create `chaturaji.html`, `enochian.html`, extraction/preservation scripts and `tests/client-layout.test.mjs`; edit launcher `index.html` and README only after implementation authorization.

- [ ] Before any mutation, snapshot the original launcher, exact Base64 values and decoded UTF-8 bytes; save decoded SHA-256 hashes, storage-key inventory and statistics/navigation invariants in `tests/fixtures/client-baseline.json`. Do not normalize line endings, trim whitespace, reformat HTML or extract inline image assets.
- [ ] Decode `CHATURAJI_HTML_B64` directly to `chaturaji.html` and `ENOCHIAN_HTML_B64` to `enochian.html`, using the original decoder's UTF-8 semantics. Compare output bytes to the snapshot. Both pages must be identical to their original decoded content before any Enochian refactor.
- [ ] Update the launcher to set each iframe's relative `src` (`./chaturaji.html` / `./enochian.html`) on first selection only. Track loading/loaded status to prevent repeated assignments, retain both iframe elements and browsing contexts while switching, and show a retryable load failure without resetting a successfully loaded game.
- [ ] Remove both Base64 constants and the now-unused game decoder. Preserve `window.parent.addGameSession`, all existing storage keys, navigation, styling and artwork. Do not remove embedded image Base64 data URLs; the removal concerns the two whole-game payloads only.
- [ ] Update README layout/start/packaging sections to describe three HTML pages, same-origin local HTTP preview and one ZIP platform upload. Do not claim `index.html` alone is self-contained after this change. Existing saves/statistics are preserved on the same deployed origin; a different platform origin has its own storage and requires separate future account integration.
- [ ] Run `node --test tests/client-layout.test.mjs` and the preservation script. Expect byte-identical decoded Chaturaji/initial Enochian, no whole-game Base64 constants/decoder, allowed launcher diff only, unchanged storage keys and image assets.
- [ ] In a real browser served over HTTP, verify neither game loads before selection; first selection loads once; repeated switches preserve board/turn/settings and iframe identity; in-game/outer menu navigation works; completed results from both games call the shared statistics bridge exactly once and survive launcher reload. Do not use `file://` as proof of same-origin parent access. Review and checkpoint migration separately from AI changes.

## Client packaging contract

The default playable upload is **one ZIP containing three HTML files**, with `index.html`, `chaturaji.html` and `enochian.html` at its root and relative frame paths intact. This works with the documented multi-file HTML5 upload model on itch.io/Newgrounds, subject to draft-embed testing. The source launcher by itself is no longer a single-file artifact.

Retain an optional generated literal single-HTML export for consumers who require it. Read the three canonical files at build time and replace only the generated launcher's loader with safely escaped inline `srcdoc` content; no whole-game Base64 and no separately maintained game copies. Guard against `</script>`/HTML delimiter injection when serializing source, verify decoded game content matches canonical files, retain the parent statistics bridge, and test one-time frame creation/state retention in that export too. Keep generated output under `dist/`; never make it the editable source. Do not implement the optional export until its packaging task; the three-page ZIP is the default release. The backend stays on Railway and is excluded from all client uploads.

Commands below run from repository root unless marked otherwise. Keep one checkpoint commit per task and stage only that task's files. The user's END ONLY override supersedes per-task independent review instructions throughout the checklists: final reviews cover Task 7's last delta and Tasks 8–15. Run focused tests during implementation. Do not deploy as a side effect of tests.

## Task 1: Protect the client and reproduce the AI failures

**Files:** Extend Task 0 baseline/preservation fixtures; create AI and lifecycle tests reading `enochian.html` and the saved original engine.

- [ ] Check Task 0's saved decoded Chaturaji hash and original Enochian baseline. The original encoded Chaturaji text hash was `f89cc4631d1db964b254becfdd89529abfed1b057b029e26aab184163d24fd60`; this is historical extraction evidence, not the new file's expected hash. Investigate legitimate baseline drift rather than replacing it.
- [ ] Confirm all subsequent game edits target `enochian.html` only; launcher changes require a migration/export justification and Chaturaji decoded bytes remain protected.
- [ ] Turn the audit's typed-pawn NaN and zero-valued king examples into deterministic regressions against the decoded script. Assert AI always returns an existing legal move when one exists, capture scores are finite, and a king capture freezes the correct army in a simulated successor.
- [ ] Use an injected clock/timer harness to reproduce duplicate CPU scheduling and old callbacks after reset, internal menu, return to the outer launcher and reopening Enochian. Assert one pending turn job, no hidden/obsolete session advance, and no mutation of a reopened match. Observe parent-frame visibility from Enochian without extra launcher changes; prove this in the real relative-`src` same-origin frame, not just a timer stub. Repeat against the optional `srcdoc` export in Task 14 once that artifact exists.
- [ ] Run `node --test tests/enochian-ai.test.mjs tests/enochian-lifecycle.test.mjs`. Expected: the specific old scoring/simulation/scheduling cases fail for the documented reasons, not harness setup errors.
- [ ] Run `node scripts/check-client-preservation.mjs`. Expected: baseline passes; no game edits yet. Review and checkpoint the regression harness.

## Task 2: Extract the unchanged engine boundary

**Files:** Edit `enochian.html`; create extraction script, generated engine and engine fixtures.

- [ ] Add the marked DOM-free engine block. Pass state explicitly; retain the existing board setup, external thrones, movement, team captures, freezing, turn order, promotion and win checks.
- [ ] Build fixtures from the 14 audit probes: starting armies, fixed teams, queen leap, friendly-capture prohibition, frozen blocking, throne geometry, occupancy, current unchecked-king behavior, non-king move under attack, bare kings, captured king freezing, current concourse behavior, current promotion and legal AI move availability.
- [ ] Compare canonical sorted legal-move sets and full successor states against the original decoded engine for fixtures and a seeded corpus of reachable positions. Run until a fixed corpus of at least 100 positions is compared; preserve seed/count in fixture metadata.
- [ ] Adapt existing rendering/event handlers to call the engine while preserving UI behavior. Keep local state, narration, audio and animation outside the engine.
- [ ] Generate `server/src/generated/enochian-engine.mjs` from the exact marked block. Include source hash and an extraction freshness check; re-extraction must produce identical bytes.
- [ ] Run `node scripts/extract-enochian-engine.mjs --check` and `node --test tests/enochian-engine.test.mjs`. Expected: extraction current, all parity fixtures pass. Run the preservation script; review and checkpoint.

## Task 3: Repair Enochian AI and local turn scheduling

**Files:** Enochian engine/UI in `enochian.html`; AI and lifecycle tests; regenerated engine.

- [ ] Replace partial piece lookup with an exhaustive value function: typed pawns map to pawn value; every legal piece type produces a finite score. Treat king capture through resulting frozen-army/team outcome, rather than an arbitrary material value alone.
- [ ] Simulate by calling the same `applyMove` as real play, including capture, alive flags, existing promotion and turn consequences. Never use the UI global `alive` for hypothetical boards.
- [ ] Score immediate team wins and enemy threats consistently with the current team rules. Include a fixture where capturing an opposing king is preferred to an ordinary material gain, and one where moving the AI king exposes its army to capture. Avoid adding check restrictions or new draw rules.
- [ ] Retain difficulty names and an explicit bounded search budget; use seeded randomness in tests. Guarantee a legal fallback if a search budget expires. Do not require a historical promotion rule absent from the current game.
- [ ] Add one cancelable local CPU job with match-generation and turn/revision guards. Cancel on reset, menu, end, changed player configuration and return to the outer launcher. Use an Enochian-side lifecycle observer of the existing frame/parent visibility, with teardown, so reopening cannot execute hidden or obsolete jobs; do not alter the launcher. Recheck legality/session activity when executing.
- [ ] Rerun the Task 1 regressions, engine parity and extraction checks. Expected: original failures now pass, no baseline rule differences or Chaturaji/launcher changes. Review and checkpoint.

## Task 4: Pin and scaffold the Colyseus server

**Files:** `server/package.json`, `server/bun.lock`, TypeScript/test config, config/bootstrap, initial Room/Schema files, `server/test/room-smoke.test.ts`, SDK embedding script, dependency approval record.

- [ ] Fetch current Colyseus/Node/Bun/Railway docs through Context7 and latest registry metadata through official sources discovered with Exa. Verify latest stable Bun, compatible server/schema/SDK/Bun transport versions and experimental status; retain a maintained Node LTS fallback. Submit exact packages/versions under G8 before installation. No floating CDN examples or automatic generator installs.
- [ ] Resolve local G9 with a minimal compatibility probe before building the full room system: real SDK connections, Schema synchronization, drop/reconnect, representative HTTP auth/invite handlers, graceful shutdown and approved storage-driver transactions under Bun. Database-specific probes wait for driver/database approval; unapproved storage must not be declared verified. Test long idle WebSocket/heartbeat behavior locally; defer Railway WSS/restart acceptance to Tasks 13–14 after deployment authorization. Prefer Bun if compatible; record failures for Node fallback. Change only transport/runtime adapters, not domain rules; do not maintain two live backends.
- [ ] Define scripts `test`, `typecheck`, `build`, `build:test`, `dev`, `start`, `test:integration` for the selected runtime. Always run the approved TypeScript compiler for type checks; Bun executing TypeScript does not prove type correctness. Use `bun test` for a Bun backend, or compiled tests with `node --test` for Node fallback. Shared fixtures/scenarios remain runtime-neutral. Set production `start` explicitly to `bun dist/index.js` or `node dist/index.js`; include generated `.mjs` engine files in build output. Enforce exact runtime pins and record `process.versions.bun`/Node diagnostics; metadata alone is insufficient.
- [ ] Use `bun install` for approved resolution and `bun install --frozen-lockfile` for CI/Railway builds in either runtime. Do not use `npm install`. Explicit start/test scripts must match G9's choice; no accidental switch of runtime through script launching.
- [ ] Configure one process, four seats, one Room per match. Keep domains pure with injected clock, RNG, engine and store. No Redis/cluster setup.
- [ ] Add a local smoke test that starts on a test port, connects two real browser-SDK clients, exchanges a harmless lobby message and disposes clients/server without leaving resources running.
- [ ] Define current-version `onAuth`, join/drop/reconnect/leave hooks as thin delegates. Confirm intentional leave versus unexpected drop semantics with integration tests. Colyseus reconnect windows are transport helpers; the persisted application deadlines remain authority.
- [ ] Run `bun --cwd server run typecheck`, `bun --cwd server run test`, `bun --cwd server run test:integration`. Expected: selected-runtime local smoke passes, processes close, no hosting calls. Review and checkpoint.

## Task 5: Define protocol and persistence before accepting moves

**Files:** Commands/match domain, store interface/memory adapter, protocol doc, domain tests.

- [ ] Specify public state: stable match ID, rules/protocol version, revision, board, alive flags, turn, four seat records, phase, readiness, visible disconnect deadlines and terminal result. Never synchronize secrets, recovery credentials or private account data in Schema/metadata.
- [ ] Define command envelopes with request ID, match ID, expected revision and action payload. Derive player/seat from server authentication; reject unknown actions, malformed coordinates, oversized messages and incompatible versions.
- [ ] Implement a per-match serialized command queue. Validate ownership/phase/turn/legal move; compute successor without mutating committed state; persist it and dedup result; only then publish the new revision. Database failure leaves live state unchanged and reports retryable failure.
- [ ] Use a store contract supporting atomic commit with expected revision, command idempotency, deadlines and snapshots. Dedup key includes authenticated actor and request ID; check a duplicate's stored result before rejecting its now-stale expected revision. Retain dedup results at least through the match/recovery window; bound request storage and input sizes.
- [ ] Test wrong seat, stale revision, out-of-turn move, illegal coordinate, frozen army, duplicate ID, duplicate ID with altered payload, concurrent moves and store failure. Expected: one accepted mutation at most, no secret leakage, no broadcast of uncommitted state.
- [ ] Run backend tests/typecheck and client preservation. Review protocol/state examples and checkpoint.

## Task 6: Rooms, invitations and ownership

**Files:** Invite/recovery HTTP handlers, identity helpers, Room lobby delegates, lobby/invite tests.

- [ ] After G7 approval, implement create/join/readiness/color assignment. Casual start requires 2–4 humans; fill remaining armies with server bots. Ranked start checks four distinct authenticated humans and no bots again at the instant of start.
- [ ] Generate unpredictable public room codes with collision-safe unique storage and approved expiry. Map code to stable match ID/current transport room; never use code possession to reclaim an occupied seat.
- [ ] Issue a private casual seat-recovery credential and server-verified ranked identity. Store recovery credential hashes, redact logs, rotate/revoke on approved ownership changes. Join/recovery endpoints authenticate before returning private match data.
- [ ] Reject duplicate active connections or replace them using an explicit tested policy without accidentally firing a departure for the retained connection. One ranked account may occupy one seat only.
- [ ] Test code collision, expired/full rooms, unauthorized seat reclamation, pre-start departure and bot/human readiness changes. Assert no post-start replacement by a new human except the original owner's permitted reclaim.
- [ ] Run backend tests and smoke integration; review and checkpoint. Production ranked auth waits for G2.

## Task 7: Approved durable database and restart recovery

**Files:** PostgreSQL adapter/migrations if G1 approves, recovery handler, persistence tests, operations doc.

- [ ] Resolve G1. For PostgreSQL, create matches/snapshots/events/commands/seats/deadlines, account admission locks and settlement tables with unique keys and revision constraints. Use transactions for accepted actions and settlement. No production credentials in tests or `.env.example`.
- [ ] Implement migration/version validation and a disposable database test harness. Match event/snapshot persistence precedes client acknowledgement; `onDispose` is cleanup, not the sole save point.
- [ ] Rehydrate active matches, reconstruct absolute deadlines and publish a new transport room mapping under the same logical match ID. Authenticate application recovery credentials; do not assume an old Colyseus token survives a restarted process.
- [ ] Resolve G5 outage policy. Record server instance/recovery information and distinguish unexpected service restart from individually observed departures. Never automatically turn a service outage into rank penalties. Preserve existing player-disconnect records with auditable recovery handling.
- [ ] Test abrupt termination after commit/before acknowledgement, interrupted transaction, stale snapshot, expired reconnect while offline and recovery with an old transport ID. Assert accepted moves remain, duplicates replay once and unauthorized identities cannot recover seats.
- [ ] Test database unavailable on startup/commit: fail closed for multiplayer; offline play remains available. Run integration tests with the disposable database. Review migration rollback/backup notes and checkpoint.

## Task 8: Casual bot control and three-minute reclaim

**Files:** Disconnect domain, Room hooks, server bot scheduling, recovery tests.

- [ ] Resolve G5/G6. Persist departure time/deadline and set controller to temporary AI immediately. Do not conflate disconnected human ownership with army alive/frozen status.
- [ ] Run bots only on server, using the canonical engine. A frozen army still cannot move. Schedule one job per turn with match ID/revision/controller guards, and serialize bot commits with human reclaim.
- [ ] Accept original-owner reclaim strictly before deadline; cancel stale bot jobs and resume human control without undoing bot moves. At/after expiry set permanent AI control and revoke reclaim permission for this match.
- [ ] Process deadlines using injected absolute clock and scheduled checks; every incoming command/recovery also checks expiry. Delayed timers cannot extend the allowance.
- [ ] Fake-clock tests cover 179,999ms, 180,000ms, late callbacks, simultaneous bot/reclaim orderings, captured king during absence, approved repeated drops, completion while absent and restart. Expected: one owner/controller outcome, no late reclaim.
- [ ] Run integration with two clients and two bots through a full match and a disconnect. Review and checkpoint.

## Task 9: Multiplayer human-only prisoner exchange

**Files:** Exchange domain, prisoner ledger, Enochian exchange UI, exchange tests.

- [ ] Resolve G4 against Zalewski rule 8.5 and document the exact adopted multiplayer extension on existing geometry. Distinguish source-backed behavior from decisions filling ambiguities; do not change ordinary move/promotion/check/concourse rules.
- [ ] Record captor and imprisoned king when the canonical engine emits a king capture. A frozen army cannot negotiate. Verify both captors' current human eligibility at offer and acceptance; prohibit AI-captor and single-player commands.
- [ ] Implement approved offer timing, acceptance/rejection/lifetime and invalidation after state/controller changes. Bind offers to both prisoners and authorized counterpart, not arbitrary player names.
- [ ] Compute both restoration placements from one snapshot, reserving squares atomically. Apply approved throne/nearest empty unthreatened placement and tie handling. If either placement is impossible, commit no partial exchange; communicate why.
- [ ] Restore both kings, thaw their armies and invalidate affected offers in one persisted revision. Do not resurrect removed pieces. Explicitly test exchange-versus-terminal-outcome timing under the approved policy.
- [ ] Tests: wrong captor, dead/frozen captor, AI control, stale offer, duplicate acceptance, occupied/threatened throne, equal-distance candidates, two kings competing for one square, no legal placement and local-mode rejection. Run engine parity too; review and checkpoint.

## Task 10: Ranked identity and admission

**Files:** Approved identity adapter, ranked domain/admission storage, auth/admission tests, client sign-in controls.

- [ ] Resolve G2/G3 before production ranked code. Use server-verified persistent accounts and secure credential/provider handling; never adopt plaintext-password documentation examples. Casual guest sessions do not qualify as ranked identity.
- [ ] Enforce four distinct accounts, one unresolved ranked match per account and the durable cooldown check transactionally at admission/start. Browser changes or a second device cannot bypass a lock.
- [ ] Lock ranked room roster after start; controller remains human. Reject bot scheduling and bot seats in every ranked path, including restart and reconnect.
- [ ] Test token spoofing, expired authentication, same account in two seats, simultaneous admission to two matches, active-match locks, cooldown persistence and fourth-player drop racing start.
- [ ] Run auth/admission tests and real SDK integration. Keep public ranked launch flag off; review and checkpoint.

## Task 11: Ranked pause, voiding and rank consequence

**Files:** Ranked disconnect/settlement domain, durable settlement adapter, ranked timeline tests.

- [ ] On an individually detected ranked drop, persist `paused` and departure deadline immediately. Reject move/exchange/bot commits while paused. No offline catch-up moves on return.
- [ ] Under approved G5 policy, track each missing human's deadline and resume only when all return before applicable expiry. Late return cannot bypass expiry even if timer processing is delayed.
- [ ] At timeout, atomically mark terminal `void`, record approved offender(s), apply G3's rank consequence and 600-second entry restriction, and release all four active-match locks. Unique settlement IDs prevent duplicate charges/cooldowns; retain match history as void rather than win/loss.
- [ ] On ordinary team victory, atomically persist the canonical engine's result, apply G3's approved four-player/team rating formula and release all four active-match locks. Route normal completion and voiding through one idempotent settlement boundary; mutually exclusive terminal outcomes cannot both charge the match. If move acceptance and settlement use separate transactions, persist a pending-settlement record with the terminal move and block new ranked admission until recovery finishes settlement.
- [ ] Test 299,999ms return, 300,000ms expiry, all humans returning, one of several still absent, intentional/repeated leaves, concurrent timeout/return, two workers attempting settlement and crash during settlement. Test cooldown at 599,999ms and 600,000ms from the approved start point.
- [ ] Test ordinary ranked victory, replayed final move, retry after settlement, process crash between terminal move and settlement, and victory-versus-timeout races. Assert exactly one terminal result, the approved rating changes once per account, no void penalties on ordinary victory, and every admission lock released after successful settlement.
- [ ] Confirm infrastructure interruption follows G5 and never silently charges all players. Run real-SDK drop/reconnect tests plus durable restart/settlement tests. Review and checkpoint; ranked stays disabled until Task 14 gates pass.

## Task 12: Connect the readable Enochian client

**Files:** `enochian.html`, SDK embed script, client integration tests, protocol doc; generated single-HTML export only during packaging.

- [ ] Embed the pinned compatible browser SDK and license into `enochian.html`. Preserve `chaturaji.html` exactly and the Task 0 launcher behavior. Regenerate optional exports from canonical pages; never hand-edit a generated payload or duplicate game source.
- [ ] Add Enochian local/multiplayer selection, create/join/code entry, approved ready flow and connection status. Provide copyable code/link plus manual entry for platform wrappers. Endpoint is public configuration; secrets stay on server.
- [ ] In multiplayer, dispatch intent commands; render acknowledged authoritative state. Disable local turn mutation/CPU jobs and show pending/rejected commands without presenting an unaccepted move as final.
- [ ] Handle monotonic revisions, reconnect/resync, obsolete protocol, terminal results, casual reclaim deadline and ranked pause. Do not store guest/recovery credentials in public URLs; tolerate iframe storage restrictions through approved account/session flow.
- [ ] Show exchange controls only for eligible multiplayer humans under G4. Hide ranked entry until release gate enabled. Keep ordinary offline play available without a backend connection.
- [ ] Run client tests with two tabs, then separate devices against staging. Run preservation/extraction checks; relative game-page requests are expected, but no mandatory CDN assets/scripts. Test load-once frames, navigation, storage keys and shared statistics after multiplayer integration. Review and checkpoint.

## Task 13: Transport security and operations

**Files:** Server config/handlers, operations doc, abuse tests, staging configuration after deployment authorization.

- [ ] Configure Railway HTTPS/WSS and documented allowed origins. Any tooling requires confirmation before adding it. Observe actual relative-`src` nested game frame/platform origins and optional `srcdoc` export rather than assuming they equal the outer platform page. Origin checks supplement authentication; never treat them as identity.
- [ ] Rate-limit join/recovery/commands, cap message sizes and reject unrecognized actions. Authorize all commands by authenticated seat. Redact credentials; expose minimal room metadata.
- [ ] Document backups, database migrations, graceful draining, process health, recovery/void audit logs and protocol compatibility. No in-memory timer may be the only record of a deadline.
- [ ] Prepare Railway configuration for the selected runtime: repository build context must include canonical `enochian.html` and extraction scripts, even though service source lives in `server/`. Do not set a `server/`-only build root that hides those inputs. Use frozen Bun install, explicit build/start, injected `PORT` with `0.0.0.0` binding, readiness endpoint, one replica and application/database secrets in Railway variables. Plan graceful draining/recovery on deploy; disable optional Serverless sleeping for initial live rooms. Obtain approval for project/service/budget/database and deployment before applying configuration.
- [ ] Use Railway plugin tools when exposed in the implementation session; inspect existing project/service read-only before configuring anything. No Railway-named callable tools were exposed during this planning update despite the user's plugin installation, so access is not yet verified. Recheck availability then; use an approved CLI fallback only if needed. Do not deploy, create resources or inspect secrets during this planning-only turn.
- [ ] Test malformed/spam input, invite enumeration controls, credential leakage, old clients and an unavailable database. Review recovery drill and rollback: disable multiplayer entry without affecting local Enochian or Chaturaji; preserve persisted records for recovery. Checkpoint.

## Task 14: Release acceptance and platform packaging

**Files:** Release checklist, packaging/preservation scripts, `index.html`, `chaturaji.html`, `enochian.html`; generated `dist/` ZIP and optional self-contained HTML.

- [ ] Run `node --test tests/*.test.mjs`, extraction/preservation checks and selected-runtime backend suites against disposable resources. Confirm Enochian rule fixtures match, decoded Chaturaji hash is identical and launcher diff is limited to approved lazy loading/removal/export changes.
- [ ] Complete casual matches on 2–4 real devices, including bots, reclaim/expiry, captured king and approved exchange. Complete a four-human ranked staging match, pause/resume, timeout/penalty and restart drill. Two tabs alone do not satisfy separate-device acceptance.
- [ ] Package the default three-page client as one ZIP with all three HTML files at root, exact-case relative paths and no backend files. Test from an HTTP subdirectory, then authorized itch.io/Newgrounds draft embeds: lazy frame loads/state retention, both menu paths, shared-statistics result recording, inline artwork, WSS, auth/recovery, manual room code, mobile/fullscreen/audio. Draft uploads require authorization; record unverified platform behavior if unavailable.
- [ ] Implement/test the optional generated single-HTML export from canonical sources as described above. Check no game-page/CDN requests occur, safe source serialization, game-content parity and parent statistics. Keep SDK license/protocol/engine hashes in both packaging forms. Do not claim the three-page source works offline by opening only `index.html`; preview over same-origin HTTP. Backend sources, credentials and private tests never enter either client artifact.
- [ ] Enable ranked only after G1–G5, all human-only admission/timeout/settlement/recovery tests and platform authentication tests pass. Enable exchange only after G4 and its atomicity tests pass. Casual production needs G5–G7 too.
- [ ] Review final diff and release checklist with the user. Deployment/platform publication is a separate authorized action; do not interpret a passing suite as permission to publish.

## Task 15: Planning handoff and deferred scope

**Files:** Plan/specifications, dependency decision record and superseded issue draft.

- [ ] Mark the Colyseus issue draft superseded and canceled; do not file it. There is no published issue to close.
- [ ] Keep single-player/AI-captor negotiation documented as future deferred work, historical prisoner exchange only. No issue publication is authorized.
- [ ] Record exact dependency/product/infrastructure approvals, committed checkpoints and remaining release gates in the execution ledger. Do not create an alternative branch from the canceled draft. Root refreshes final hashes/checks/deployment state before the Task 15 commit.

## Historical and technical sources

- Source/version/provider observations below belong to the original 2026-10-02 planning research; exact subsequent approvals are in the execution ledger. Do not use historical unapproved-provider wording to revoke the later G1 authorization.
- [Chess Variant Pages: Jeff Rients, Enochian Chess](https://www.chessvariants.com/historic.dir/enochian.html): the user's supplied reconstruction; not proof of a single complete Victorian rulebook.
- [Chris Zalewski, Enochian Chess of the Golden Dawn, 1994](https://www.labirintoermetico.com/06Numerologia_Cabala/Zalewski-Enochian-Chess-of-the-Golden-Dawn.pdf): numbered rules printed pp.87–100; prisoner exchange rule 8.5 printed p.96 (PDF p.126). Compare the [audit](../specs/2026-10-02-enochian-rule-audit.md) for differences and source limitations.
- [Colyseus official docs](https://docs.colyseus.io/) fetched through Context7 `/colyseus/docs`: room lifecycle, authentication, synchronization, browser SDK, reconnection and persistence. Verify exact installed-version APIs before coding; these are application features to implement, not promises of automatic ranked rules or crash recovery.
- [Railway networking](https://docs.railway.com/networking/public-networking/specs-and-limits), [pricing](https://railway.com/pricing): selected provider; plan/budget/database still unapproved. [Colyseus Bun transport](https://docs.colyseus.io/server/transport/bun-websockets): official support exists but is labeled experimental; validation and Node fallback are required.
- [Node.js downloads](https://nodejs.org/en/download): latest LTS observed 24.21.0; verify the latest compatible maintained LTS again before implementation. [Node TypeScript support](https://nodejs.org/api/typescript.html): native type stripping is not type checking and does not transform decorators; compiled production JavaScript avoids relying on those limitations.
- [Bun](https://bun.com/): latest stable observed 1.4.2 on 2026-10-02. [Bun installation/lockfile docs](https://bun.com/docs/pm/cli/install): package manager and preferred runtime after G9; CI uses the frozen lockfile. Recheck before setup; no automatic stack updates.
- [Render Free limits](https://render.com/docs/free): inbound HTTP/WebSocket inactivity triggers 15-minute sleep; local files are ephemeral, no free persistent disks, free Postgres expires after 30 days. Use for a prototype only unless an approved deployment satisfies recovery/storage requirements.
- [itch.io HTML5 uploads](https://itch.io/docs/creators/html5) and [Newgrounds submission guidance](https://www.newgrounds.com/wiki/help-information/content-submission/games-and-movies): packaging/embed guidance. A compatible upload does not prove authentication or multiplayer behavior until tested.

## Plan review record

Independent Superpowers review of this revision completed on 2026-10-02: **approved as a gated plan**, with no blocking gaps. Reviewed Railway selection, lossless three-page migration, retained iframe state/statistics, optional generated single-HTML packaging, Bun compatibility/Node fallback, dependency approval and mechanics preservation. Two advisory sequencing clarifications were applied: export tests wait for Task 14, and local Bun acceptance is distinct from later authorized Railway restart testing. Previous review fixes for normal ranked settlement/lock release and launcher lifecycle remain included. Prior launcher-byte-identical and Node-only constraints are superseded only where expressly described above.

The paragraph above records the original gated-plan review, not final implementation acceptance. Subsequent explicit user authorization supersedes the original planning-only restriction; exact approvals and checkpoint status are in the execution ledger. Root must complete the end-only reviews and remaining release gates. Full Task 14 acceptance is not established by this documentation update.
