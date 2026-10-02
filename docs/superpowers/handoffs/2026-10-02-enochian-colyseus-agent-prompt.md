# Fresh-context agent handoff prompt

Use this prompt in a fresh project chat in `J:\projects\personal-projects\Chess-Eternal-Blitz-`.

## Agent configuration

Primary agent: **GPT-6.1 Sol, High reasoning** (`gpt-6.1-sol`, `high`). You may delegate bounded tasks and reviews to subagents using **GPT-6.1 Sol, Medium reasoning** (`gpt-6.1-sol`, `medium`). This is explicit user authorization for subagents. Supply focused context and file ownership; avoid competing edits. Do not substitute another model without asking. If the agent API disallows overrides on a full-history fork, use a focused fork with the explicit model/effort settings.

## Read first

Work in the existing checkout. Read applicable AGENTS.md instructions and these four authoritative documents in order:

1. `J:/projects/personal-projects/Chess-Eternal-Blitz-/docs/superpowers/specs/2026-10-02-enochian-multiplayer-design.md`
2. `J:/projects/personal-projects/Chess-Eternal-Blitz-/docs/superpowers/specs/2026-10-02-stack-and-game-engineering.md`
3. `J:/projects/personal-projects/Chess-Eternal-Blitz-/docs/superpowers/specs/2026-10-02-enochian-rule-audit.md`
4. `J:/projects/personal-projects/Chess-Eternal-Blitz-/docs/superpowers/plans/2026-10-02-enochian-ai-multiplayer.md`

The implementation plan received independent Superpowers review as a gated plan. Subsequent user approvals and implementation checkpoints are recorded in the [execution ledger](../plans/2026-10-02-enochian-execution-ledger.md); read it after these references. Do not restart completed tasks or treat historical alternatives as current requirements.

## Current authorization

The earlier NO EXECUTION YET instruction was superseded by explicit implementation approval. Continue the authorized task sequence without between-task approval pauses, using one commit per task and one final PR to `main`. Tasks 0–12 are committed; Tasks 13–15 require the root's final checks/checkpoints and release acceptance remains gated. The user also authorized the concrete Railway creation/deployment target recorded in the execution ledger. Verify current progress before acting; do not repeat completed work or expose secrets.

Follow the existing plan and ledger, resolving only remaining gates. Do not ask again for permissions already given. G8's exact approved versions are recorded; new direct dependencies still require confirmation. Platform publication is not authorized by Railway deployment approval. Local PostgreSQL testing authorization is revoked; use memory tests or the expressly configured isolated Supabase target.

The user's END ONLY review override requires final independent spec and quality reviews for Task 7's last delta and Tasks 8–15; Tasks 0–6 already passed both. Do not spawn interim reviewers. Keep focused implementation tests running.

## Settled requirements: preserve these

- **CHATURAJI HAS NO GAMEPLAY ISSUES.** No Chaturaji logic, mechanics, styling, artwork or storage changes. The planned source-layout migration alone decodes its original game payload losslessly into byte-identical `chaturaji.html`.
- Preserve current executable Enochian mechanics; document historical gaps separately. Repair AI evaluation, simulation fidelity and stale timers without adding absent historical movement/check/promotion/draw rules.
- Replace the two whole-game Base64 constants with readable `chaturaji.html` and `enochian.html`. `index.html` lazily loads each through relative iframe `src` once and retains both browsing contexts when switching. Remove the constants/unused decoder. Retain inline image assets, existing storage keys, navigation/style/art and `window.parent.addGameSession` shared-statistics reporting.
- Maintain clear commented sections and encapsulated modules within each game page. Keep the canonical DOM-free Enochian engine in `enochian.html`; generate server engine code from it, avoiding separately maintained rules copies.
- Update README during implementation to describe the three-page source layout. Default platform delivery is **one ZIP containing the three HTML files**, root `index.html`. This differs from one standalone HTML. Retain the optional generated literal single-HTML export using safely serialized `srcdoc`, without whole-game Base64 or duplicated editable source.
- **Colyseus is the backend framework; Railway is the selected host.** Backend source remains in this repo under `server/`. Build context must include `enochian.html` and extraction scripts. Start with one process/replica, no Redis or cluster by default.
- Prefer latest stable **Bun runtime and package manager** if the official Colyseus Bun transport passes compatibility checks. Official docs currently label that transport experimental. Node LTS is the permitted fallback. Check current versions/peer constraints and confirm packages; do not silently downgrade. Bun remains the package manager in either case; type checking remains necessary.
- Separate-device rooms with code/link. Casual: 2–4 humans, bots filling other seats. Ranked: exactly four distinct authenticated humans, **no bots**.
- Casual disconnect: immediate temporary bot control; original owner may reclaim before 180 seconds. At expiry bot ownership is permanent for that match; no undo of accepted bot moves.
- Ranked disconnect: pause immediately. Resume only when all humans return within applicable 300-second windows. Timeout voids the match, applies the approved departing-player rank consequence and 600-second ranked-entry restriction. Persist deadlines/settlement and distinguish service outages from player abandonment.
- Negotiation means historical **prisoner-king exchange**, multiplayer human-controlled only for this phase. No non-binding diplomacy, truces or new alliances. AI-captor and single-player negotiation are deferred.
- Persist accepted moves/results before acknowledgements. Test duplicate commands, reconnection/bot races, crash recovery and exactly-once normal/void ranked settlement, including release of admission locks.
- The Colyseus GitHub issue is canceled. Its unpublished draft is historical, not an implementation directive. Do not file it.

## Tools and skills

Required: **Superpowers, Exa, Context7, Railway plugin**. Discover and use the Railway capabilities available in this fresh session; the planning session did not expose Railway-named tools, so access was never verified. Do not assume that means installation failed or that resources exist. Inspect existing target project/services read-only before authorized configuration; never print credentials.

Use Context7 resolve-library-id then query-docs for current library/framework/SDK/cloud documentation, even familiar APIs. Use Exa to discover primary sources and hosting best practices; cite sources when proposing decisions. Recheck installed-version lifecycle/schema APIs rather than mixing outdated examples. Prefer TokenSave exploration/search/read tools when available and check graph freshness first; the historical Base64 payloads have been extracted into readable pages. No unsolicited index sync during read-only intake.

Use Superpowers `using-superpowers`, `subagent-driven-development` or `executing-plans` for authorized implementation, `systematic-debugging` for AI failures, `verification-before-completion`, and independent code review. Use `brainstorming` for unresolved product policies without reopening settled choices. Use relevant game-development skills for authority, state transitions, lifecycle cleanup, input and persistence. Available Godot-oriented multiplayer/state-machine guidance is transferable only at the principle level; do not introduce Godot, ENet or continuous movement networking. If a specifically requested skill is missing, disclose that and use the best relevant available guidance.

## Continuation and remaining gates

Read G1–G9 and the execution ledger. G2–G8 policies and the concrete G1 target/budget are approved. Local Bun acceptance is distinct from deployed Railway acceptance. Physical-device/platform/auth/provider/backups and final review gates remain unverified until evidence is recorded. Ranked remains disabled until its release gates pass.

On continuation, report the current checkpoint and remaining acceptance work briefly, preserve the existing checkout and proceed within granted authorization. Refresh deployment/schema state and final hashes in the ledger before Task 15's commit. Do not report full Task 14 acceptance from tooling or two-tab tests alone.
