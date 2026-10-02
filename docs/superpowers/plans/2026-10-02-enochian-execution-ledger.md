# Enochian implementation approval and execution ledger

Snapshot: 2026-10-02, Task 15 documentation commit. This ledger records subsequent user authorization and supersedes stale planning-only status statements in the companion handoff/specifications/plan. A committed implementation is not proof of every release acceptance gate. The final reviews found a sign-in request-method defect and are investigating completed-room cleanup; corrections and their verification will be appended to the same PR before it is marked ready.

## Execution and review authority

The user authorized continuing all tasks without between-task approval pauses, one commit per task and one final pull request to `main`. Work is on the explicitly confirmed `codex/task-0-readable-game-pages` branch of `khrollo963/Chess-Eternal-Blitz-`. The final PR has not been merged; switch Railway's source branch to `main` only after that merge.

The user's later **END ONLY** spec and quality review instruction overrides per-task review sequencing in the original plan and skills workflow. Tasks 0–6 already passed both reviews. Task 7 passed both before its final absence-normalization regression/fix; that delta and Tasks 8–15 require the final independent spec and quality reviews. Continue focused tests during implementation. Do not spawn interim reviewers or treat this ledger as a review verdict.

Approved workers: GPT-6.1 Sol Medium for bounded implementation, with the main agent GPT-6.1 Sol High. No model substitution is authorized by capacity errors.

## Task checkpoints

| Task | Implementation | Commit / current state |
| --- | --- | --- |
| 0 | Lossless readable pages and retained launcher frames | `97b6ce4` |
| 1 | AI and lifecycle regression harness | `ae47efb` |
| 2 | Immutable canonical engine and parity | `5f363a7` |
| 3 | AI evaluation and CPU lifecycle repair | `90db90d` |
| 4 | Pinned Bun/Colyseus transport compatibility | `19178d3` |
| 5 | Revisioned authoritative commands persisted before acknowledgement | `662b275` |
| 6 | Private invitation lobbies and seat ownership | `39d7074` |
| 7 | Durable matches and service recovery | `7c03972`; final absence-normalization delta included in end review |
| 8 | Casual server bots and cumulative reclaim allowance | `f0a307f` |
| 9 | Authoritative human prisoner exchanges | `95e173b` |
| 10 | Supabase identity verification and ranked admission locks | `ce6b46e` |
| 11 | Ranked pause and exactly-once rating settlement | `67c05e2` |
| 12 | Embedded browser SDKs, authoritative client and outside-frame sign-in handoff | `30464ee`; real two-browser acceptance passed, physical-device/platform gates pending |
| 13 | Security/operations and Railway configuration | `1c0f716`; deployed successfully, HTTPS/readiness and real WSS room play verified |
| 14 | Packaging and acceptance tooling | `807bbec`; tooling verified; full release acceptance **not complete** |
| 15 | Updated handoff/specifications/plan, READMEs and canceled draft | This documentation commit |

Keep one commit per task. Root supplies final verification evidence and checkpoint hashes; do not substitute task checkbox completion for the outstanding device/platform/deployment gates below.

### Latest root verification report

Root reported the fresh frontend suite at **82 passed** (including Task 14 packaging) and backend suite at **136 passed, 7 hosted tests skipped, 9,337 assertions** (including Task 13 security and same-origin website routes). Six focused security/website cases passed with 57 assertions. The separate approved hosted Supabase batch then passed **12 tests, 0 failures, 138 assertions across 7 files**, covering all seven default-skipped hosted cases. Those tests used isolated schemas and cleaned them up. Separately, the explicit operator command initialized the permanent private game schema and verified migration version 1.

Real two-browser Task 12 evidence passed: create/invite/join, both humans Ready, legal Red/Blue moves, Yellow/Black bot play and retained iframe state across the outer menu. This proves two-browser behavior, not separate physical devices. Runtime same-origin page serving injects the public endpoint only into responses and copies canonical pages explicitly into the Docker build; its focused tests passed. Root refreshes this report after subsequent changes/checks.

Task 14's packaged preview helper serves the exact nested package and optional generated standalone HTML locally on port 41742. Its availability is tooling evidence; browser/platform acceptance is recorded separately by root.

## Approved product policies

- **G7 lobby:** private code/link invitations; casual 2–4 humans with bots filling other seats; each human explicitly marks Ready and chooses an available color. No spectators or public matchmaking. Unstarted rooms expire after 30 minutes. Ranked requires four distinct verified human accounts and never uses bots; its public flag remains off until release gates pass.
- **G5 absence:** each player has a cumulative per-match allowance of 180,000ms casual or 300,000ms ranked. Repeated drops consume the remainder; simultaneous missing players have independent clocks. Casual drops immediately give temporary bot control; reclaim is strictly before expiry, accepted bot moves stand, and expiry permanently revokes that seat's reclaim. Ranked drops immediately persist a pause, retain human control and reject moves/exchanges; resume only when all four are connected strictly before their individual expiry. At the exact boundary a return fails even if timeout processing was delayed. Timeout voids ranked and charges only expired missing players. Intentional Leave gives permanent casual bot control or immediately voids ranked with the leaving player's consequence.
- **G5 service recovery:** freeze absence allowance at the last observed service timestamp and allow 300,000ms service recovery grace. Failed ranked recovery voids as `service_outage` without outage offenders. Historically expired departures remain abandonment offenders on normal recovery. Infrastructure downtime is not player abandonment.
- **G4 exchange:** only two connected human captors with active armies qualify; bots and disconnected captors cannot negotiate. Rule 8.5 timing is immediately after the qualifying capture or on either captor's later turn. Offers last 60,000ms and invalidate on any move, control change, pause or terminal result. Only the counterpart accepts/rejects. Restore both kings atomically on empty safe thrones, otherwise nearest empty unthreatened squares by king-step distance; fixed color order, then row/column breaks ties. Assess safety with both armies thawed. Reject without partial changes when no safe pair exists.
- **G6 finality:** terminal outcomes remain final, including casual completion within a reclaim allowance. Reconnection displays the final result and cannot reopen play.
- **G3 ratings:** initial 1200. Canonical teams are Red/Yellow and Blue/Black. Team Elo compares team-average ratings with K=32; normal winners receive the same rounded `32 * (1 - expected)` delta on each teammate and losers its opposite, preserving zero sum. No artificial floor. Void leaves other players unchanged; each approved offender loses 32 and receives a 600,000ms ranked restriction starting at settlement. Unstarted voids have no penalties. Match-ID settlement ledger and persisted pending settlement prevent double charges and admission before settlement recovery.
- **G2 identity:** Supabase Auth supplies persistent project-bound account UUIDs across game origins, with no automatic itch.io/Newgrounds account linking. Existing project configuration enables email only; social-provider configuration and live acceptance are future gates. Sign-in opens outside the embedded frame with a manual return-code fallback; supplied invalid identity fails closed. Casual guest credentials remain distinct from ranked identity and never enter public URLs or state.

Ordinary executable Enochian movement, check, promotion, freezing and victory rules remain protected. Preserve the canonical engine bytes across client integration. Chaturaji game/art/storage bytes and the established launcher lifecycle/statistics bridge remain protected.

## G8 dependency approvals and G9 runtime evidence

The user approved these exact direct versions and purposes:

| Dependency/runtime | Approved version | Purpose |
| --- | --- | --- |
| `@colyseus/core` | 0.18.18 | Authoritative rooms and lifecycle |
| `@colyseus/schema` | 5.0.35 | Public synchronized state |
| `@colyseus/sdk` | 0.18.4 | Browser/real-SDK transport tests and inline official browser bundle |
| `@colyseus/bun-websockets` | 0.18.3 | Official experimental Bun transport |
| `typescript` | 7.0.2 | Strict type checking and production compilation |
| `@types/bun` | 1.4.2 | Bun runtime types |
| `@types/node` | 24.19.1 | Required Node-compatible API types |
| Project-local Bun | 1.4.2 | Runtime and package manager |
| `pg` | 8.23.1 | PostgreSQL durable adapter |
| `@types/pg` | 8.23.1 | PostgreSQL driver types |
| `@supabase/supabase-js` | 2.117.2 | Server identity verification and inline official browser bundle |

Use the committed frozen Bun lockfile. Official SDK bundles/licenses are embedded locally, without CDN dependencies. No extra JWT dependency, ORM, Redis, cluster or browser bundler was approved or needed. New direct dependencies still require approval. Task 4 established local Bun transport acceptance; the transport remains officially experimental. Railway WSS/restart acceptance is a separate pending gate, not supplied by local compatibility evidence. Node LTS remains the permitted fallback if needed, with changed dependencies subject to approval.

## G1 authorized infrastructure and present state

The user approved Supabase Auth and PostgreSQL in the existing Supabase project. The explicit operator command initialized the dedicated private `enochian_chess` schema and verified migration version 1. Earlier authorization for isolated loopback PostgreSQL tests is revoked: do not use or repair any local PostgreSQL installation or service. Use memory tests or an explicitly configured isolated Supabase test target. Earlier disposable local test evidence is historical only.

The user expressly authorized Railway project/service creation and deployment using the recommended options. Created target:

- Project `enochian-colyseus`, ID `8824efb5-55ea-49af-ba5a-83b2d5e84774`.
- Environment `production`, with staging release intent; this name does not establish production acceptance.
- Service `game-server`, ID `6a756513-4fd8-4c76-b2d1-fdbcfcf4f5d0`.
- Public domain `https://game-server-production-5449.up.railway.app`.
- US-East Metal region `us-east4-eqdc4a`, one replica and sleeping disabled. Explicit service settings are applied.
- Hobby plan unchanged. Workspace Usage UI confirmed the **saved** $10 monthly compute hard limit and $5 usage alert.
- Source repository/branch as above; switch source to `main` after PR merge.

Deployment `794a55b9-7014-4135-9ec9-cabc0958a684` succeeded from `807bbec`. External `/health` and `/ready` returned 200, reporting Bun 1.4.2. The canonical arcade at `/index.html` loaded over HTTPS. Two real browser tabs created/joined a hosted casual room, both readied, and synchronized Red/Blue moves over WSS with server bots advancing subsequent turns. This is hosted two-tab evidence, not physical-device acceptance. Root-route dispatch, controlled restart and final review corrections are still being verified. Keep secrets only in ignored local files or authorized provider variables; never copy their values into this ledger, public HTML, logs or PR text.

## Remaining release gates and deferred scope

Root must record final focused/full suite results, client byte preservation, generated-engine freshness, packaged artifact contents, local two-tab evidence, final end-only reviews, isolated hosted database acceptance, deployment/readiness/WSS and restart/settlement drills. Passing local tests is not physical-device or platform acceptance.

Task 14 remains incomplete until separately verified: casual play on 2–4 physical devices; four-human ranked acceptance and restart drill; authorized itch.io/Newgrounds draft embeds; mobile/fullscreen/audio; outside-frame email sign-in/manual fallback and configured social-provider behavior; real platform origins/storage restrictions; recovery/backups/restore and measured resource/cost behavior. Provider configuration and platform publication require their applicable authorization. Ranked stays disabled until its documented gates pass.

Default client delivery is one ZIP with the three canonical HTML pages at root. The optional generated single-HTML export uses safe `srcdoc` serialization from those pages; neither artifact includes backend source or secrets. Tooling implementation does not establish platform acceptance.

The [Colyseus issue draft](../issues/2026-10-02-colyseus-multiplayer-alternative.md) is **CANCELLED / SUPERSEDED** and must not be filed; no issue was published. AI/single-player captor negotiation remains future deferred work, with no issue publication authorized. Do not create an alternative architecture branch from that historical draft.
