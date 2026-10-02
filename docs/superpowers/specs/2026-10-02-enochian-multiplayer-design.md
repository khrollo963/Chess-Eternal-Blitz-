# Enochian AI and multiplayer design — planning record

Date: 2026-10-02. Status: implementation authorized and Tasks 0–12 committed. See the [execution ledger](../plans/2026-10-02-enochian-execution-ledger.md) for subsequent approvals, exact checkpoints, Railway target/budget and remaining release gates. Tasks 13–15 are pending root checks/checkpoints; full Task 14 acceptance is not complete. Historical planning statements below do not override later explicit authorization.

### Implementation decisions approved on 2026-10-02

- Execution: continue all tasks without between-task approval pauses; one commit per task and one final pull request to `main`. Deployment, spending and platform publication still require separate authorization.
- G8: approved `@colyseus/core@0.18.18`, `@colyseus/schema@5.0.35`, `@colyseus/sdk@0.18.4`, `@colyseus/bun-websockets@0.18.3`, `typescript@7.0.2`, `@types/bun@1.4.2`, `@types/node@24.19.1`, and a project-local Bun 1.4.2 runtime. G9 requires actual compatibility evidence.
- G7: private code/link rooms, explicit readiness by each human, selection of an available color, no spectators/public matchmaking, and 30-minute expiry for an unstarted room.
- G5: each player has a cumulative absence allowance per match (casual 180 seconds; ranked 300 seconds). Repeated drops consume the remaining allowance; simultaneous departures have independent clocks. Ranked resumes only with everyone returned; timeout penalties apply only to players whose allowance expired. Intentional Leave immediately gives permanent casual bot control or voids ranked with the leaving player's consequence. A service restart freezes absence clocks and gives 300 seconds after recovery to return; failed ranked recovery voids without outage penalties.
- G4: only the two connected human captors with active armies may negotiate. Offer timing follows rule 8.5: immediately after the qualifying capture or on the captor's later turns. Offers last 60 seconds and invalidate on any move, control change, pause or terminal result. Restore both kings atomically to empty safe thrones, otherwise nearest empty unthreatened squares by king-step distance, with fixed color order then row/column resolving ties. Assess safety with both armies thawed; reject without partial changes if no safe pair exists. Terminal results remain final (including casual completion during a reclaim allowance, G6); returning players see the result.

- G1 storage/G8: approved PostgreSQL with `pg@8.23.1` and `@types/pg@8.23.1`. Earlier approval of disposable loopback tests is historical and explicitly revoked below; do not use any local PostgreSQL installation or service. Current online target/budget authorization is in the execution ledger.

- G1 online provider: existing Supabase project for PostgreSQL/Auth; Railway hosts the Colyseus process. The user approved concrete Railway creation/deployment and the saved budget controls recorded in the execution ledger. Dedicated permanent schema application and deployment have not occurred at the ledger snapshot.
- Later user steering supersedes local database test authorization: do not use or repair the machine's existing PostgreSQL installation. Continue with memory-store tests; database-specific acceptance must use an explicitly configured isolated Supabase test target. A completed earlier disposable probe is historical evidence, not authorization to repeat it.
- G2: Supabase Auth with email/social sign-in. Persistent Supabase account identity is shared across game origins; platform account identities are not implicitly transferable. G8 explicitly approves `@supabase/supabase-js@2.117.2` for Task 10, including its locally embedded official browser bundle. Live provider configuration remains gated.
- G3: initial rating 1200; team Elo compares team-average ratings with K=32 and the same rounded delta for both teammates on normal completion. Void settlement leaves other players unchanged, deducts 32 from each approved abandoning player, and begins that player's 600-second restriction at settlement. No artificial rating floor.

These approved online policies extend prisoner exchange and connectivity only. Ordinary executable movement, promotion, check, freezing and victory rules remain protected. G9 deployed acceptance and ranked authentication/persistence/recovery release gates remain. The user's END ONLY review override covers Task 7's final delta and Tasks 8–15; Tasks 0–6 passed both reviews.

## Confirmed scope

- Preserve current executable Enochian mechanics. Document historical gaps rather than implementing them.
- Chaturaji mechanics/code changes are out of scope. The authorized future layout migration decodes its original payload into byte-identical `chaturaji.html`; no game logic, artwork or storage-key changes.
- Fix Enochian AI scoring, simulation fidelity and stale scheduling without changing legal moves.
- Readable client source becomes `index.html`, `chaturaji.html` and `enochian.html`. Default platform release is one ZIP containing these pages; optional generated single-HTML export remains available from the same canonical source.
- Backend code may live in this repository and be hosted separately.
- Prefer latest stable Bun as runtime and package manager if Colyseus compatibility tests pass; official Bun transport is currently experimental. Node.js is the user-permitted runtime fallback. Confirm exact added packages before installation.
- Every added direct library/tool dependency and its latest compatible stable version requires user confirmation before installation. A backend/framework choice does not approve an unreviewed package set.
- Railway is the approved backend host and concrete creation/deployment target; use the execution ledger's service, region, saved budget controls and existing Supabase database target.
- Organize `enochian.html` with clear comments, numbered sections and private modules. Launcher changes are limited to lossless extraction, lazy relative-`src` loading/removal of the decoder and generated export; retain styling, navigation, storage keys and shared statistics.
- Load each game iframe once, retain its browsing context when switching, keep image assets inline and preserve `window.parent.addGameSession` on same-origin hosting. README will describe the three-page source layout during implementation.
- Separate-device multiplayer with room creation and code/link invitations.
- Casual rooms support 2–4 humans, with AI filling the other armies.
- Ranked/competitive rooms require exactly four distinct humans and no AI.
- Negotiation means prisoner-king exchange only; no invented diplomacy or enforced truce.
- Exchanges involving AI captors and single-player AI negotiation are deferred.
- Casual disconnect: immediate temporary bot control; the original player can reclaim the same seat within 180 seconds. Afterward the seat stays AI-controlled for the remainder of that match. Existing bot moves remain part of the match.
- Ranked disconnect: pause immediately; allow return for up to 300 seconds. Resume when the required humans are all back. Expiry voids the match, incurs a departing-player rating consequence, and blocks new ranked entry for 600 seconds.
- Full backend timers, outcomes and penalties are server-authoritative; localStorage cannot enforce these across devices.

## Current backend decision

The user explicitly selected Colyseus on 2026-10-02, replacing the earlier Cloudflare Workers + Durable Objects decision. Colyseus is the active architecture, not a future alternative or a parallel backend. That initial selection authorized planning only; subsequent explicit implementation and Railway authorization is recorded above and in the execution ledger.

### Chosen architecture

Run one authoritative Colyseus Room per match on Railway; one process initially. Prefer Bun runtime through the official Bun transport after compatibility validation; use Node fallback if needed. Bun manages dependencies and a committed `bun.lock` in either case; the approved TypeScript compiler checks types. Backend source lives under `server/`, but the build context must also contain `enochian.html` and extraction scripts for the canonical rules. Redis/multi-process scaling is deferred. A PostgreSQL-backed durable match/account ledger is proposed; confirm Railway budget/database/driver before configuring resources.

Keep frontend UI/engine in readable `enochian.html`; embed the pinned browser SDK there. `index.html` lazily sets relative iframe `src` once for each game, preserving state when switching. No React or runtime CDN dependency. Upload the three pages together as one ZIP, with `index.html` at root; a literal single-HTML export is generated separately using safely serialized `srcdoc`, not whole-game Base64. The source launcher alone is no longer self-contained.

### Authority and recovery

Colyseus provides room lifecycle, schema synchronization and reconnect tooling. Application code validates legal moves, runs bots, implements prisoner exchange, authenticates ranked identities and enforces deadlines/penalties. Persist accepted events, snapshots and absolute deadlines before acknowledging them. Ordinary in-memory rooms and reconnect tokens alone do not provide process-restart recovery.

Use a stable application match ID and seat recovery credential independent of Colyseus transport room/session IDs. Pin compatible current server/client versions after the user approves the dependency list; verify their lifecycle APIs before implementation. Avoid mixing older `onLeave` reconnection examples with current `onDrop`/`onReconnect` behavior. The Colyseus GitHub issue is canceled at the user's request because this is the main plan. Its unpublished draft is retained as superseded history; do not retry publication.

## Shared architecture requirements

1. One canonical rules implementation supplies local Enochian play, authoritative multiplayer validation and bots. Avoid hand-maintained client/server forks of the rule engine.
2. Client commands carry match ID, request ID and expected revision. The server derives authenticated seat ownership from the connection; a client-supplied seat is never authority. Validate ownership, phase, turn and unchanged legal-move rules before applying any action.
3. Persist committed state before broadcasting an acknowledgement. Duplicate commands and recovery retries must not apply moves or penalties twice.
4. Version the rules/protocol; reject incompatible old clients with a clear update message.
5. Each human seat has a reconnect credential that is not the public room code. Never let possession of an invite reclaim another player's seat.
6. Reconnect-versus-bot-turn and reconnect-versus-timeout events are serialized. Expired seats cannot be reclaimed merely because timer processing was delayed.
7. Ranked identity, concurrent-match exclusion, rating settlement and cooldowns must survive browser changes and backend restart.
8. Distinguish an individual departure from service failure; infrastructure failure should not automatically penalize players.
9. Casual guest identity is distinct from ranked account identity. Do not expose auth credentials in invite URLs or public HTML.
10. Shared invite URLs need manual room-code entry as a fallback on platform iframe wrappers.

## Historical decision checklist

The following was the original planning checklist. G1–G8 answers now appear above and in the execution ledger; do not reopen them or treat the historical proposals below as unresolved. Remaining work is verified release acceptance, not guessed product policy.

1. Railway target/provider is confirmed. Select account/project/service, region, plan/budget and durable database; current plugin access is not verified because no Railway-named tools were exposed in this session. No resources are created during planning.
2. Choose ranked account sign-in and account linking across GitHub Pages, itch.io and Newgrounds. Platform identity is optional integration, not assumed transferable.
3. Choose rating formula, initial rating, abandonment penalty and the starting point of the ten-minute cooldown. Proposed: unaffected players receive no rating change when the match is voided; server applies a separate abandonment ledger entry.
4. Choose multiplayer prisoner-exchange timing and offer lifetime, exact eligibility for disconnected/bot-controlled captors, and placement tie handling using the existing external throne geometry.
5. Define repeated disconnect windows, simultaneous departures and intentional leave handling; ensure players cannot indefinitely extend a pause by reconnecting and dropping again.
6. Define what happens if a casual match completes within a departed player's three-minute allowance. Proposed: completion is final; reconnect returns a result/spectator view, not a reopened match.
7. Define lobby readiness, color assignment, room expiry, and whether spectators are deferred. Proposed: private code rooms first; public matchmaking and spectators are later phases.
8. Decide whether ranked launches alongside casual or remains disabled until identity, penalties and recovery have passed integration testing.
9. Approve a concrete dependency list with exact latest compatible stable versions and alternatives. See [stack and game engineering](2026-10-02-stack-and-game-engineering.md); this gate applies before each added library, not only initial scaffolding.
10. Validate Bun runtime/transport compatibility under real SDK/auth/schema/storage/reconnect tests; use the permitted Node fallback if it fails and document evidence. Exact experimental transport package/version still requires confirmation.

## Intended plan sequence

1. Snapshot original encoded/decoded hashes and bridge/storage/navigation invariants; losslessly extract both pages and migrate lazy launcher loading, then verify both games/shared statistics. Preserve Chaturaji decoded bytes thereafter.
2. Repair and verify Enochian AI without expanding rule scope.
3. Isolate a DOM-free engine boundary in `enochian.html` while preserving legal-move parity and inline page assets.
4. Add the selected server transport, authoritative room/lobby flow and revisioned messages.
5. Add casual bots and atomic reconnect seat reclamation.
6. Implement multiplayer human-only prisoner exchange with approved placement policy.
7. Add ranked identity, human-only readiness, immediate pause, timeout voiding and durable penalty settlement.
8. Verify restart/reconnect races, old-client compatibility and duplicate-event handling.
9. Package/validate the three-page ZIP and optional generated single-HTML export in draft platform embeds and on real separate devices.
10. Keep future AI/single-player captor negotiation deferred. Do not file the canceled Colyseus draft or publish an AI-negotiation issue without new authorization.

Each implementation task should include exact files, failing regression tests where appropriate, commands and expected results, rollback checks and a completion checkpoint. Follow `writing-plans` to create `docs/superpowers/plans/2026-10-02-enochian-ai-multiplayer.md`, then obtain the skill's independent plan review. Do not start implementation merely because that file exists.

## Sources

- [Rule audit](2026-10-02-enochian-rule-audit.md).
- [Colyseus official documentation](https://docs.colyseus.io/): authoritative rooms, schema synchronization, browser SDK, lifecycle and reconnection. Pin server/client versions during implementation; do not mix old and current lifecycle examples.
- [Colyseus Cloud pricing](https://colyseus.io/pricing/): starts at $15/month when checked; self-hosting is another option, not cost-free infrastructure.
- [itch.io HTML5 uploads](https://itch.io/docs/creators/html5): supports direct single HTML uploads or ZIPs and iframe play; use HTTPS for external APIs.
- [Newgrounds submission documentation](https://www.newgrounds.com/wiki/help-information/content-submission/games-and-movies): HTML5 ZIP with `index.html` at root, loaded in an iframe.

Packaging compatibility is documented; actual external endpoint, login and reconnect behavior on platform draft embeds still requires testing. No platform publication is authorized yet.
