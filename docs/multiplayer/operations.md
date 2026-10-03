# Multiplayer operations

Updated 2026-10-02. The user approved Railway creation and deployment using the recommended setup. Deployment `794a55b9-7014-4135-9ec9-cabc0958a684` succeeded from `807bbec`; external health/readiness returned 200 with Bun 1.4.2. The [hosted arcade](https://game-server-production-5449.up.railway.app/index.html) loaded over HTTPS, and two browser tabs completed real WSS room creation/join, readiness, Red/Blue moves and server bot turns. The dedicated private `enochian_chess` schema was explicitly initialized and migration version 1 verified. Physical-device/platform play, live account-provider flows and backup restoration remain unverified.

## Approved target and budget

| Item | Approved or configured value |
| --- | --- |
| Railway project | `enochian-colyseus` — `8824efb5-55ea-49af-ba5a-83b2d5e84774` |
| Environment | `production` — `f154cf92-c4a5-4838-b047-75e1fe27d698` |
| Service | `game-server` — `6a756513-4fd8-4c76-b2d1-fdbcfcf4f5d0` |
| Public endpoint | [Hosted arcade](https://game-server-production-5449.up.railway.app/index.html), target port `3000`; real HTTPS/WSS smoke verified |
| Region | US East Metal, Virginia, `us-east4-eqdc4a` |
| Runtime | One process, one replica; sleeping disabled; no Redis or autoscaling |
| Plan | Existing Hobby plan, unchanged |
| Spending controls | Workspace compute hard cap **$10**, alert threshold **$5**, saved and verified in the Railway usage dialog |
| Attached source | `khrollo963/Chess-Eternal-Blitz-`, branch `codex/task-0-readable-game-pages`; user switches to `main` after the PR merges |
| Database | Existing privately configured Supabase PostgreSQL **Session pooler**, dedicated schema `enochian_chess`, strict TLS certificate validation |

Region, replica count and sleeping settings are applied through explicit service settings. The exact repository source and branch were verified from provider configuration and deployment metadata. The Railway UI reports automatic deployment unavailable for this connection; use controlled manual deployment. No Railway PostgreSQL substitute is part of this setup.

The saved thresholds bound approved workspace compute spending; they are not measured application usage or proof of continuous availability. Reaching the hard cap can interrupt service. Actual utilization, external egress and database-plan costs still need observation. The region choice is geographical, not a measured latency result; privately verify the selected database's actual region and latency during launch checks. Railway's [pricing](https://docs.railway.com/pricing/plans), [spending behavior](https://docs.railway.com/pricing/understanding-your-bill) and [region reference](https://docs.railway.com/deployments/regions) remain operator references.

## Docker, client serving and Railway settings

`Dockerfile` uses the official `oven/bun:1.4.2` tag, frozen development/build and production dependency installs, canonical engine extraction and compilation, and the non-root `bun` runtime user. Build context is the **repository root**, not `server/`: the canonical `enochian.html`, extraction scripts and baseline helper are build inputs. Explicit copies exclude environment files, Git metadata and developer runtime directories. Runtime includes `server/migrations`, the public trusted CA in `server/certs`, and the three canonical client HTML pages copied under `/app/`. No credential is a Docker build argument or image layer. See the [Bun Docker guide](https://bun.com/docs/guides/ecosystem/docker).

`server/src/http/client-pages.ts` serves the canonical three pages. The public multiplayer endpoint is added to served responses only; no alternate game HTML or private database configuration is generated. Production startup wires this serving adapter alongside the configured security boundary. The online pages are deployment preparation, not evidence that the existing platform ZIP or nested iframe is live or compatible.

Railway supplies `PORT`; the application validates it and binds `HOST=0.0.0.0`. The working directory is `/app/server`, and the start command is `bun dist/index.js`. `/health` reports process liveness. `/ready` remains HTTP 503 until schema verification, durable lease ownership, rehydration and pending settlement recovery finish. Missing database configuration never makes multiplayer ready. Configure `/ready` as the healthcheck with a 300-second startup window and bounded restart attempts; no automatic pre-deploy DDL command is configured.

Railway's UI confirmed that new services cannot opt in to legacy config files after **2026-08-28**; existing legacy use ends **2026-12-01**. `railway.json` is retained only as a legacy blueprint. This new service uses explicit settings rather than assuming that file applies. Keep one `us-east4-eqdc4a` replica, `sleepApplication=false`, repository-root build context and the reviewed Docker/start/healthcheck settings. See the [Config as Code reference](https://docs.railway.com/config-as-code/reference). Do not enable uncontrolled automatic deployment while production acceptance checks remain open.

One PostgreSQL advisory session lease permits one active process. A replacement deployment can start while the old process still owns that lease. Startup fails readiness if ownership cannot be obtained; it does not automatically retry becoming owner. `overlapSeconds=0` concerns overlap after healthcheck success and does not prove a stop-old/start-new lease cutover. Use the approved maintenance drain/stop-old/start-new procedure, or validate coordinated ownership handoff before claiming seamless rollout. Keep readiness and lease enforcement intact. Container build/run and live Railway cutover remain unverified.

## Implemented transport security boundary

Production `startServer` requires explicit security configuration and selects `SecureBunWebSockets` through the game-server factory. Merely importing a helper is no longer the integration mechanism. Required deployment values are:

```text
NODE_ENV=production
MULTIPLAYER_PUBLIC_ENDPOINT=https://game-server-production-5449.up.railway.app
MULTIPLAYER_ALLOWED_ORIGINS=https://game-server-production-5449.up.railway.app
MULTIPLAYER_INGRESS_POLICY=railway-edge-only
MULTIPLAYER_ALLOW_MISSING_ORIGIN=true
```

Add only individually verified canonical HTTPS browser origins to the comma-separated allowlist when necessary. Production fails before acquiring the durable runtime if the endpoint, origin list or ingress policy is absent or invalid. The public endpoint must be included in the allowlist. Missing-Origin permission is explicit for top-level sign-in navigation and native SDK requests; it does not grant identity. Opaque `Origin: null` remains denied.

Installed `@colyseus/bun-websockets@0.18.3` dispatches its router and OPTIONS before Express, and reads fallback bodies before Express middleware. The implemented subclass replaces that raw dispatch boundary while reusing protected connection and client-wrapper behavior. It does not rely on Express middleware to cover these paths or access the transport's runtime-private state.

- Every raw HTTP request, including `/matchmake`, invitation and identity routes, is checked before routing or body reading. OPTIONS is checked before preflight is returned. Unsupported HTTP methods are rejected. `/health` and `/ready` GET/HEAD retain their probe bypass and their real route status.
- Bun's `maxRequestBodySize=2048` provides a native request-body ceiling. POST bodies also pass through `readBoundedJson` before router/Express allocation: actual streamed UTF-8 bytes are counted, overflow is cancelled, and only a plain JSON object is accepted. Domain handlers retain their own exact shape validation.
- WebSocket origin, ingress and source quotas run before `server.upgrade`. The installed optional `beforeUpgrade` hook is preserved. WebSocket messages have `maxPayloadLength=4096`.
- Response CORS replaces permissive transport defaults with the exact accepted origin and `Vary: Origin`. Wildcard, lookalike, malformed and opaque origins are rejected.
- Known move, lobby and exchange handlers call `allowAction` before mutation. Budget keys use server-established connection and authenticated actor IDs, never fields selected by the action payload. Existing domain authentication and parsers remain authoritative.

Fixed-window defaults are 120 HTTP requests/minute/source, 30 invitation attempts/minute/source, 120 authentication/matchmaking/identity attempts/minute/source, 30 WebSocket upgrades/minute/source, and 60 actions/10 seconds/actor or connection. Sign-in polls every five seconds so four users behind a shared trusted edge peer fit these budgets. A shared 2,000-request/minute aggregate cap supplements network scopes. Network maps contain at most 2,048 keys per category; the combined action map contains at most 4,096 keys. Saturation rejects new keys instead of evicting live buckets, and rejected attempts do not extend windows. These are staging limits, not measured production sizing.

Source identity comes only from Bun's native `server.requestIP(request)`. Railway edge peers can share quotas; that conservative grouping is intentional. Unknown peers share a safe bucket. `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Proto` and Colyseus `context.ip` are never quota keys or TLS proof. The fixed `railway-edge-only` policy trusts the approved deployment boundary rather than a client header. Real HTTPS pages and WSS multiplayer were observed through the configured Railway domain. The explicit `local-fixture` adapter requires a loopback listener and an actual loopback peer, and makes no external TLS claim.

## Verified local coverage and remaining launch checks

The fresh security regression batch passed **26 tests, 1,219 assertions**, covering raw security integration, transport helpers, sign-in handoffs, lobby SDK behavior and transport compatibility. Full test typechecking passed. Actual local HTTP/SDK integration proves denied-origin handling on matchmaking, OPTIONS and invitations; exact preflight CORS; authenticated SDK joining; pre-handshake WebSocket rejection; chunked oversized bodies without Content-Length rejected on router and Express paths before handlers run; quota resistance to rotated forwarded headers; action spam stopped before state mutation; and production configuration failure without an approved HTTPS ingress boundary.

These results do not establish deployed Railway behavior. Verify external HTTPS/WSS, source routing, probe readiness, deployed payload limits and rate limits after deployment. Observe the actual Origin from the launched relative-source or platform `srcdoc` game frame; the outer launcher origin does not prove the frame's network origin. Keep opaque frames denied and use a secure serving/frame arrangement rather than permitting `null` or wildcard CORS. Independent physical devices and the actual distribution platform still need casual/ranked match, disconnect, timeout, restart and settlement checks.

All public failures use short constant codes and bounded Retry-After responses. No driver messages, exception causes, complete URLs, request headers, payload values, passwords or connection strings belong in public errors or logs. Infrastructure loss must continue cancelling jobs and rejecting mutations.

## Database migration, recovery and rollback

The draw-ending release adds migration 2 (`002-draw-settlements.sql`) and rules version `enochian-current-2`. Stop and verify removal of the old Railway deployment first. From `server/`, the explicit operator command `bun --env-file=.env.local scripts/migrate-private-schema.ts --create enochian_chess` now upgrades a verified managed v1 schema to v2 as well as creating a new schema. Startup requires both known hashes and never migrates automatically. Then deploy matching code and refresh clients. The old binary cannot run against migration 2; retain a compatible rollback build and all existing ledgers. See [draw endings](../superpowers/specs/2026-10-02-enochian-draw-endings.md). This paragraph describes the release procedure, not evidence that production migration has been performed.

The approved target is dedicated `enochian_chess` on the existing Supabase Session pooler. Operator command `bun --env-file=.env.local scripts/migrate-private-schema.ts --create enochian_chess`, run from `server/`, initialized and verified migration version 1 using strict CA validation. It creates only the dedicated schema, revokes browser access and enables RLS; shared/public schemas remain outside the command. Startup verifies the known migration/hash and never runs DDL. See the [persistence procedure](persistence.md).

Use server-only `DATABASE_URL`, `DATABASE_SCHEMA`, and a trusted CA file when overriding the checked-in public CA. Keep the pool within its configured maximum of five connections and TLS `rejectUnauthorized=true`. Session pooling is required for the persistent advisory lease; transaction pooling cannot preserve it. Do not expose database/schema administration, service keys, guest recovery credentials or account tokens through public endpoint configuration.

Verify Supabase plan backup/PITR coverage and rehearse restoration into an isolated target before claiming production recovery readiness. Preserve private snapshots/events, request deduplication, absolute deadlines, account admission locks and settlement ledgers. Service recovery must obtain ownership, freeze outage time, clear obsolete sessions/transport IDs, restore mappings and settle pending ranked outcomes before readiness. Roll back only to code compatible with the existing migration hash while retaining the ledger. A restore that loses committed commands or settlement state requires an explicit incident decision.

Railway creation and deployment are authorized, but the checks above remain pending. Ranked stays disabled in public configuration until production account/provider configuration, live email/social flows, independent-device/platform matches and restart/timeout/settlement drills pass. No real email was sent during implementation tests. Deployment, live provider behavior, external TLS and backup restoration must be reported from their own evidence. Independent reviews run only at the end of implementation work, as requested. Ordinary offline play remains available independently of online readiness.
