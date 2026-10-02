# Ranked activation and notification follow-up

The user requested ranked activation, the handoff's lobby usability correction, prominent toast notifications, and agent-led issue/security/scenario testing on 2026-10-02. Work began at `main` commit `3f3641d`; branch `codex/ranked-lobby-notifications` preserves the previous release checkpoint.

## Resulting behavior

- Production startup now forwards `MULTIPLAYER_RANKED_ENABLED=true` to ranked admission and the public identity configuration. Missing/false keeps it off; malformed flags and missing identity configuration fail before database acquisition. Auth, four distinct human owners, no bots, account locks, cooldowns, persisted pause/recovery and settlement remain enforced.
- A rejected taken-color join or color command now displays “That color is taken; choose another color.” The client retains only allowlisted codes, with a safe fallback for unknown bodies. No provider text, markup, credentials or stack traces are rendered.
- Multiplayer failures, lost connections, delayed confirmations, sign-in errors, match pause/finality and useful successes appear in a fixed notification stack. Errors/warnings stay until dismissed; transient notices expire after six seconds and pause while hovered/focused. The stack holds at most three items, suppresses duplicate notices, uses text-only rendering, supports keyboard dismissal and reduced motion, and leaves persistent inline feedback. Routine command acknowledgements do not generate a toast for every move.
- Malformed invitation JSON returns HTTP 400 rather than a misleading storage outage. Atomic admission limits simultaneous unstarted lobbies to 64 by default; the validated operator setting permits 1–256. Saturation returns HTTP 429 and a useful client message. No retained game records are deleted.

## Verification and limits

- Final client suite: 87 passed, zero failed. Engine extraction, client preservation, embedded SDK checks, packaging, test typecheck and production build passed.
- Final server suite after startup and GitHub follow-up: 176 passed, seven hosted database cases skipped, zero failed, 9,611 assertions across 183 tests. Independent final reviews found no actionable defects.
- Egress fixes stop bots retrying permanent failures at an unchanged revision and back off temporary failures by 1–30 seconds. Room polling uses scalar revision/deadline metadata and coalesces overlapping callbacks. Global polling selects at most 64 owned due lifecycle IDs; idle ticks download no full records. Startup drains bounded settlement batches. Regression checks demonstrate 40 to zero room full-record reads over ten idle ticks and 60 to zero global full-record reads over twenty idle ticks.
- Agents exercised casual HTTP and SDK joins, wrong codes/credentials, no mutation after rejection, exact expiry, three-human readiness, full casual match/bots/reclaim/finality, four-controller ranked completion/replay, strict pause/return/timeout penalties, identity signatures and memory recovery.
- Desktop and 390×844 browser fixture checks verified the actual canonical client showing a taken-color error toast. Dismissal removed the toast and kept inline feedback. The fixture's error response is synthetic, not hosted gameplay evidence. Screenshots were saved outside the repository.
- The PostgreSQL cap check is a deterministic transaction/rollback contract test. Live hosted concurrency and the seven opt-in database cases were not rerun. No local PostgreSQL was used. No runtime/dependency downloads occurred.
- New source and ranked flag activation are not live merely because local tests pass. Deployment requires the established stop-old/verify-stopped/start-new lease cutover. The user approved temporary downtime to halt runaway egress. The Railway agent erroneously restarted old deployment `92d12be7-6b05-4cd6-b7a0-aedca3e8603a`, then removed its region, causing a fallback to US West/one replica and old-source deployment `30089f92-ce79-4cf9-9bce-e8e5276b2619`. Further agent use was blocked by automatic review; manual removal of the deployment and restoration of original US East (`us-east4-eqdc4a`)/one replica were requested. No service or durable records were deleted. Read counters stayed at 5,152,476 between 19:42:41 and 19:44:07 UTC; this indicates traffic paused over that sample, not a verified successful cutover.
- The authorized live email check delivered a magic link to localhost rather than an OTP. The user corrected the production Site URL and exact /signin redirect, then chose GitHub sign-in instead of SMTP. Supabase public settings confirmed GitHub enabled. `MULTIPLAYER_SIGNIN_PROVIDERS=github` selects a GitHub-only page, preserving default email for other configurations. No email address or authentication secret is retained here. Live GitHub authorization/handoff acceptance remains distinct from passing callback fixtures.
- Four separate physical devices/accounts, platform authentication, hosted restart/settlement acceptance and backup restoration remain distinct evidence gaps. The user's current activation request supersedes the older stop/default-disabled instruction; it does not turn local fixture tests into real-device acceptance.

## Audit

## Startup recovery and main follow-up

The exhausted active match had exactly 10,000 persisted commands. Rehydration
also hit the gameplay capacity guard, causing both old and new containers to
fail startup. A regression filled a real memory ledger to 10,000 commands and
reproduced the failure. Only the reserved internal `service_recovery` actor may
now claim, bind and expire preserved matches above capacity. Ordinary player,
bot, exchange and spoofed actors remain rejected. Ownership, phases, exact
deadlines, duplicate handling and CAS still apply. No gameplay cap was raised,
and no durable record was deleted. Startup failure logs now expose fixed
stage/code diagnostics without SQL, tokens, provider messages or stack causes.

The user merged PR #2 as `a6b8455` and requested direct work on `main`. The
follow-up is based on that merge. Railway was authorized to return its source
branch to `main`, preserving US East (`us-east4-eqdc4a`), one replica, strict
lease readiness and both `MULTIPLAYER_RANKED_ENABLED=true` and
`MULTIPLAYER_SIGNIN_PROVIDERS=github`. Confirm the subsequent deployed revision
and readiness separately; configuration alone is not successful live evidence.

See [security audit](2026-10-02-security-audit.md). The official npm bulk advisory response reported no known advisories for the 152 locked dependency names/versions checked. The open-lobby amplification is bounded by the new admission cap. Shared Railway ingress-peer quotas and historical record retention remain documented availability risks; arbitrary forwarded IP headers remain untrusted, and no automatic destructive purge was introduced.
