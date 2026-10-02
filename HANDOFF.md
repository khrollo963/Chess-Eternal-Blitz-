# Chess Eternal — next-agent handoff

Updated **2026-10-02** after PR #1 merged and the multiplayer server successfully deployed from `main`.

## Stop point and next-session authority

The user confirmed that multiplayer now works and explicitly asked to **stop here**, create this file on `main`, and leave the next session for tomorrow. This handoff is the only new repository change authorized at this stop point. Do not resume implementation, install packages, enable ranked, change Auth providers, upload platform builds, or redeploy merely because you read this file. Start tomorrow with read-only intake and the next user's actual request.

The completed implementation used GPT-6.1 Sol with High reasoning for the primary agent and approved GPT-6.1 Sol Medium subagents for bounded work and independent reviews. The user prefers normal subagent use when helpful, continuous implementation once authorized, and **spec/quality reviews at the end**, not after every task. Do not silently substitute models after a capacity error.

## Current repository and release state

- Repository: `khrollo963/Chess-Eternal-Blitz-`.
- Working branch at handoff: `main`, fast-forwarded to the user's latest changes before writing this file.
- [PR #1](https://github.com/khrollo963/Chess-Eternal-Blitz-/pull/1) is **merged**. Merge commit: `203d047f6f90cc6eeeba87175ae163dbd63ad1e1`.
- Last code checkpoint: `d2709e160e024a4241c7b57baa7145076291ba5b`.
- Main immediately before this handoff: `87d40b81869d1fbfbdab362762bab0e87fd0696c`, the user's README game-link update.
- [Live arcade](https://game-server-production-5449.up.railway.app/index.html) and [root URL](https://game-server-production-5449.up.railway.app/) serve the configured canonical client.
- Railway's source is **`main`**, with no fixed commit override. Successful main deployment: `92d12be7-6b05-4cd6-b7a0-aedca3e8603a`, built from `87d40b8`.
- Both project and server READMEs were updated in the merged PR. Preserve the user's subsequent README changes.
- All implementation subagents finished. Temporary previews on ports 41741/41742 were stopped or no longer running. The hosted game server is intentionally left running.

This file supersedes older deployment/branch/pending-review snapshots in the planning documents. Implementation completion does **not** mean all release acceptance gates below have passed.

## Read before further work

Read the original handoff and all its referenced plan/specifications, then the execution ledger and implemented protocol/operations documents. Historical planning-only statements are superseded by subsequent approvals and this release checkpoint.

1. `docs/superpowers/handoffs/2026-10-02-enochian-colyseus-agent-prompt.md`
2. `docs/superpowers/plans/2026-10-02-enochian-ai-multiplayer.md`
3. `docs/superpowers/specs/2026-10-02-enochian-multiplayer-design.md`
4. `docs/superpowers/specs/2026-10-02-stack-and-game-engineering.md`
5. `docs/superpowers/specs/2026-10-02-enochian-rule-audit.md`
6. `docs/superpowers/plans/2026-10-02-enochian-execution-ledger.md`
7. `README.md`, `server/README.md`, and `docs/multiplayer/` — particularly `operations.md`, `persistence.md`, `client-protocol.md`, `signin.md`, `ranked.md`, and `release-checklist.md`.

The Colyseus alternative issue draft is **canceled/superseded**; do not file it. AI/single-player captor negotiation remains deferred. The exhaustive merged PR description is also recorded in `docs/multiplayer/pull-request.md`, including post-merge procedures.

Follow repository instructions. Context7 is required for current library/cloud/API documentation questions; use TokenSave first for code exploration but check graph freshness. Its earlier graph was stale and on the wrong branch, so source reads were used rather than claiming graph accuracy. Do not update an index without applicable authorization. Relevant Superpowers development/debugging/verification and game/server skills were used; Exa exhausted its quota during this run, and official documentation/Context7 supplied the fallback. The Railway plugin was used for actual provider configuration/deployment verification.

## Implemented task checkpoints

Each planned Task 0–15 has one checkpoint commit. A separate final review correction commit preserves the already published task history.

| Task | Commit | Added or changed |
| --- | --- | --- |
| 0 | `97b6ce4` | Readable game pages; lazy retained launcher frames |
| 1 | `ae47efb` | Original AI/lifecycle regression harness |
| 2 | `5f363a7` | Immutable canonical Enochian engine and parity |
| 3 | `90db90d` | CPU evaluation and stale-turn lifecycle fixes |
| 4 | `19178d3` | Pinned Bun/Colyseus runtime and compatibility |
| 5 | `662b275` | Authoritative revisioned commands, CAS and durable deduplication |
| 6 | `39d7074` | Private invitations, lobbies, readiness and seat ownership |
| 7 | `7c03972` | Durable PostgreSQL storage, lease fencing and recovery |
| 8 | `f0a307f` | Casual server bots and cumulative seat reclaim |
| 9 | `95e173b` | Human prisoner offers and atomic safe exchanges |
| 10 | `ce6b46e` | Fresh Supabase identity verification and ranked admission locks |
| 11 | `67c05e2` | Ranked pause, penalties and exactly-once rating settlement |
| 12 | `30464ee` | Inline SDKs, authoritative browser client and outside-frame sign-in |
| 13 | `1c0f716` | Raw Bun transport security, Docker and Railway operations |
| 14 | `807bbec` | Deterministic three-page ZIP and optional literal standalone HTML |
| 15 | `c13b3ad` | Updated plans/specs, execution ledger, PR description and READMEs |
| Final review | `d2709e1` | Sign-in POST, correct root website dispatch and terminal room cleanup |

Tasks 0–6 had already passed spec and quality reviews. The final end-only reviews covered Task 7's final delta and Tasks 8–15. They found three concrete defects, all fixed and independently rechecked with no remaining actionable review finding:

- The sign-in button used GET for a POST-only handoff route. It now passes `{}`; a regression executes the actual button handler and verifies POST and the popup handoff.
- Colyseus's default root route shadowed the launcher. The supported Express callback enables correct root detection; real HTTP tests check exact canonical root/query HTML and origin handling.
- Finished/void transport rooms kept polling and remained registered after clients left. Terminal maintenance now stops, connected clients retain final snapshots, empty rooms dispose, and durable HTTP final-result recovery remains intact.

## Architecture and protected behavior

`index.html`, `chaturaji.html` and `enochian.html` are the canonical editable client sources. Chaturaji remains byte-identical to the original decoded game. The launcher loads each game once and retains its frame through menu/game switching. Original Enochian markup, artwork, CSS, storage keys and parent statistics bridge remain protected outside approved script/multiplayer islands.

The DOM-free engine is extracted from the protected Enochian block for server builds. Do not create a separately maintained rules implementation or edit generated copies. Canonical teams are **1 = Red/Yellow, 2 = Blue/Black**, never 0/1. Historical rule differences are documented; do not silently introduce concourses, check obligations, throne seizure or other audited omissions.

The server validates intent, derives actors from authenticated connections, persists before acknowledgement/broadcast, and uses actor-scoped request deduplication before revision rejection. Durable CAS serializes commands, bots, reclaim and exchanges. Public state excludes private credentials/ownership/capture ledgers. Stable application match IDs are distinct from disposable transport room/session IDs.

Pinned official Colyseus/Supabase browser bundles are embedded inline with hashes and MIT notices. No runtime CDN is needed. Canonical static pages/exports default to no backend endpoint; the hosted server injects only public endpoint configuration into responses. Secrets never belong in HTML, ZIPs, Git, handoffs or logs.

## Settled product policies

- Private code/link casual rooms; 2–4 humans, chosen available colors, every human explicitly Ready, bots for remaining seats; no public matchmaking or spectators; unstarted expiry 30 minutes.
- Casual absence allowance is **180 seconds total per player per match**; repeated drops consume the remainder. Temporary bot moves remain committed. Intentional Leave gives permanent bot control. Terminal results stay final.
- Ranked requires four distinct freshly verified human accounts, no bots, and is **disabled in deployed public configuration**. Absence pauses immediately, allowance is **300 seconds total per player**, separate concurrent clocks, resume only when everyone returns before their own deadline.
- Intentional ranked Leave voids with the leaving player's consequence; timeout penalizes only qualifying expired players. Service outage freezes observed player absence and supplies a separate 300-second recovery grace; failed recovery does not manufacture outage penalties.
- Exchanges require eligible connected human captors with active armies, immediate qualifying capture or later own turns, strict 60-second expiry, and invalidation on any move/control/pause/end. Both kings restore atomically on safe empty thrones or deterministically ordered safe alternatives, with both armies thawed during safety evaluation. No safe pair means no change.
- Ratings start at 1200, team-average Elo K=32, same rounded delta for teammates, no floor. Approved abandonment offenders lose 32 and receive a 600-second entry restriction from settlement; other players remain unchanged. Settlement/lock release is durable and idempotent.
- Supabase Auth provides persistent project-bound identities; email/social choice was approved, but live social-provider setup was not performed. No automatic platform-account linking. Outside-frame sign-in has a private one-time handoff and manual-code fallback.

## Railway and Supabase operations

| Setting | Current value |
| --- | --- |
| Railway project | `enochian-colyseus`, `8824efb5-55ea-49af-ba5a-83b2d5e84774` |
| Environment | `production`, `f154cf92-c4a5-4838-b047-75e1fe27d698` — staging release intent |
| Service | `game-server`, `6a756513-4fd8-4c76-b2d1-fdbcfcf4f5d0` |
| Source | `khrollo963/Chess-Eternal-Blitz-`, branch `main`, repository-root context |
| Host | `game-server-production-5449.up.railway.app`, port 3000 |
| Region/processes | US East Metal `us-east4-eqdc4a`, one replica/process, sleeping disabled |
| Build/start | Root `Dockerfile`, `bun dist/index.js`, non-root Bun user |
| Readiness | `/ready`, 300-second startup healthcheck; `/health` is liveness |
| Budget | Existing Hobby plan unchanged; saved workspace compute $10 hard cap / $5 alert |
| Database/Auth | Existing Supabase project `inxedkdsggcqmeexgyur` |
| Database schema | Dedicated private `enochian_chess`, migration version 1 explicitly initialized/verified |

The supplied Supabase **Session pooler** is required for the session advisory lease. Strict CA verification uses `server/certs/supabase-prod-ca-2021.crt`. Server environment contains the private connection; ignored `server/.env.local` also exists locally. Do not print, copy into this file, or retrieve credential values unnecessarily. The generic Supabase connector account previously pointed to unrelated projects; do not mutate them.

Startup verifies schema/hash and performs **no DDL**. The explicit operator migration only initialized the approved private schema with browser access revoked and RLS enabled. Database backups/PITR and isolated restoration are not yet validated.

**Do not use, repair, install, or start the user's local PostgreSQL.** The user revoked local testing authorization; approved hosted tests used uniquely named isolated Supabase schemas and cleaned them up.

### Critical deployment ownership constraint

An existing process holds the exclusive PostgreSQL advisory lease. A replacement launched while it is active can start with `multiplayerReady:false` and remain stuck at the readiness healthcheck; startup does not retry ownership. Railway's normal healthcheck-first overlap cannot complete this handoff.

Use controlled **stop old, verify stopped, start new** deployment until coordinated handoff has separately been implemented and accepted. Stop/cancel a replacement already stuck on the old lease before launching another. Remove/stop only the deployment instance, never the service/project/database or durable records. Keep strict readiness/lease checks. Do not enable uncontrolled automatic deployment. Branch source selection alone is not evidence that the new revision serves traffic.

During this cutover, main attempt `00a27312-2c9c-4a28-8aeb-58d98c28942c` stalled behind active feature deployment `f0cc7c01-06bf-41f9-b76f-d40d3c915bef`. Both were stopped/removed; fresh main deployment **`92d12be7-6b05-4cd6-b7a0-aedca3e8603a` succeeded**. Earlier `794a55b9` was also removed; provider history retains rollback/redeploy references. No durable game records were deleted.

New Railway services cannot opt into the deprecated legacy config-as-code path in the observed provider UI. `railway.json` is a legacy blueprint; actual explicit provider settings govern this service. Reverify current provider behavior before future changes.

## Verification actually performed

- Final full client batch: **83 passed, 0 failed**.
- Final full server batch: **138 passed, 7 hosted cases skipped, 0 failed, 9,378 assertions**, 145 cases across 31 files.
- Separate approved hosted Supabase batch: **12 passed, 0 failed, 138 assertions across seven files**, covering all seven default-skipped database cases plus five overlapping cases. Do not add overlapping batches into a synthetic total.
- Production build, test typecheck, client preservation, canonical extraction freshness and embedded SDK/hash/license checks passed.
- Engine parity: 120 positions / 1,745 successors, seed `73272346`.
- Real SDK tests covered casual and four-human ranked flows, exchange, transport limits, reconnect and terminal disposal; this is automated evidence, not physical-device acceptance.
- Real local browser tabs exercised create/join, readiness, moves/bots, outer-menu retained state, nested three-page packaging and standalone hidden-CPU cancellation. Independent ZIP inspection confirmed the three exact root HTML entries.
- Real hosted browser tabs played through the initial deployment and recovered their existing match after process replacement.
- **Final main smoke** at deployment `92d12be7`: readiness 200, create 201, available Blue join 200, two real WSS clients, both Ready, active phase, and one move confirmed to both clients. Test clients explicitly left and the smoke process exited.
- The user subsequently confirmed **“okay, it works now”** and requested this stopping point.

No live Auth email was sent or social provider registered. No itch.io/Newgrounds upload/publication was performed. No two-tab test was represented as separate physical devices.

## Known lobby usability issue for tomorrow

Both fresh pages default their color selector to **Red**. If the creator reserves Red, an invitation recipient who also submits Red gets HTTP 400 `{code:"color_unavailable"}`. Choosing Blue (or another free color) with the same code succeeds. The client currently hides that useful server code behind the generic “Unable to open the room” message. Occupied colors are disabled after a joined snapshot, not before joining.

This was reproduced independently with local HTTP and on the final main deployment. The user's specific failed request was not captured, so do not claim definitive attribution to their request; they confirmed joining worked after the cutover/advice. No code correction for this usability issue was authorized after the stopping request.

A reasonable future scoped improvement is to preserve allowlisted error codes and say “That color is taken; choose another color.” Pre-join availability hints need an explicit public projection/lookup design. Do not silently overwrite another seat or change the approved choose-color policy to automatic assignment.

## Remaining release acceptance and deferred work

These gates are documented, not quietly completed by merging/deploying:

- Casual acceptance on 2–4 physical devices, including real network drops, bots, reclaim, exchange and finality.
- Ranked live identity configuration and four distinct human/device acceptance, pause/resume, strict timeout, penalties, settlement and restart drills. Keep ranked disabled until accepted.
- Actual email/social sign-in and outside-frame/manual return flow on target origins. Provider changes and real email sends need applicable authorization.
- Authorized itch.io/Newgrounds draft embeds, real nested frame origins/storage restrictions, mobile/fullscreen/audio/statistics, and final platform publication. Do not permit opaque `Origin:null` or wildcard CORS to make embeds pass.
- Backup/PITR, isolated restore, retention, measured latency/resources/costs, and any coordinated deployment handoff.

## Local tooling and safe continuation

Approved exact runtime: ignored project-local **Bun 1.4.2** at `.tooling/bun-1.4.2/bun-windows-x64/bun.exe`; global tooling was not replaced. Exact packages are pinned in `server/package.json` and `server/bun.lock`: core 0.18.18, schema 5.0.35, SDK 0.18.4, experimental Bun transport 0.18.3, Supabase JS 2.117.2, pg/@types/pg 8.23.1, TypeScript 7.0.2, @types/bun 1.4.2, @types/node 24.19.1. No Redis, ORM, additional JWT library or frontend framework was added.

When relevant work is authorized, existing commands from repository root include:

```powershell
node --test tests/*.test.mjs
node scripts/check-client-preservation.mjs
node scripts/extract-enochian-engine.mjs --check
node scripts/embed-client-sdks.mjs --check
.\.tooling\bun-1.4.2\bun-windows-x64\bun.exe scripts/run-server.mjs build:test
.\.tooling\bun-1.4.2\bun-windows-x64\bun.exe scripts/run-server.mjs test
.\.tooling\bun-1.4.2\bun-windows-x64\bun.exe scripts/run-server.mjs build
node scripts/package-client.mjs --single-html
```

Generated exports are ignored under `dist/`; never edit them as source. Ignored `.tooling/run-hosted-test.mjs` and `.tooling/verify-main-smoke.ts` were local helpers, not a reason to rerun hosted mutations automatically. Do not print environment files. New dependencies or runtime/model downloads require their applicable user approval; reuse the existing approved tooling.

Git/network writes required sandbox escalation in this environment. The Windows credential-helper emitted a path warning despite successful pushes; verify the remote result rather than interpreting that warning alone as failure. Do not force-push published history. Preserve unrelated user changes; the earlier `readme-hero.png` deletion was excluded from agent commits, and any upstream user deletion is their own change.

**Next agent:** acknowledge this stop point, verify read-only facts that may have changed, and proceed only with tomorrow's request. There are no unfinished implementation agents to resume.
