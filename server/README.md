<div align="center">

<h1>⚡ Chess Eternal — Enochian Multiplayer Server</h1>

**Four armies. One authoritative board. Durable seats, moves and recovery.**

![Bun](https://img.shields.io/badge/Bun-1.4.2-f7df1e?style=flat-square&logo=bun)
![Colyseus](https://img.shields.io/badge/Colyseus-authoritative%20rooms-5bca81?style=flat-square)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-private%20ledger-336791?style=flat-square&logo=postgresql&logoColor=white)

[The arcade](../README.md) · [Development](#-development) · [Configuration](#-configuration) · [Operations](#-operations)

</div>

---

## 💡 What is this?

The Bun/Colyseus backend for Enochian's private casual and ranked rooms. The browser sends intent; the server authenticates the seat, validates through the canonical engine, commits state, and then acknowledges it. Chaturaji and local Enochian play remain in the three-page arcade client and need no backend account.

```text
enochian.html                 canonical rules + inline multiplayer client
scripts/                     engine extraction, SDK embedding, builds, packaging
server/
  src/domain/                rooms, commands, bots, exchange, ranked policies
  src/rooms/                 Colyseus Room and explicit public Schema
  src/http/                  invitations, identity/handoff, raw Bun protection
  src/identity/              fresh Supabase account verification
  src/storage/               PostgreSQL CAS, dedup, admission and settlement
  src/recovery/              lease ownership, startup and durable recovery
  migrations/                reviewed private-schema SQL
  certs/                     public trusted CA certificate
  test/                      domain, SDK, transport and isolated database checks
```

Commands include match/request IDs and expected revision; actors come from authenticated connections. Durable actor/request deduplication precedes revision rejection, compare-and-swap serializes competing actions, and persistence precedes public acknowledgement. Public projections exclude credentials, owner hashes, private ledgers and unknown fields. The engine is extracted from `../enochian.html`, rather than maintained as a separate rules fork.

Casual guests use room codes, readiness and server bots, with a cumulative **180-second** seat-reclaim allowance. Human-only king exchanges bind both captors/prisoners and restore both safely or neither; offers expire at **60 seconds** and invalidate on play/control changes. Ranked requires four distinct verified humans, pauses on departure, and has a cumulative **300-second** player allowance. Team Elo uses **K=32**; abandonment applies **-32** and a **600-second** restriction to qualifying offenders. Settlement and admission-lock release are durable and idempotent. Service outages have an independent **300-second** recovery grace, without silently charging player absence. Ranked is disabled by default and requires release acceptance before enablement.

See [protocol](../docs/multiplayer/protocol.md), [client/sign-in handoff](../docs/multiplayer/client-protocol.md), [exchange](../docs/multiplayer/exchange.md), [ranked](../docs/multiplayer/ranked.md) and [persistence/recovery](../docs/multiplayer/persistence.md) for exact policies.

## 🧰 Development

Use the already approved **Bun 1.4.2** runtime and committed `bun.lock`. The Bun transport is experimental; local acceptance does not establish deployed compatibility. Reuse the ignored project-local Windows runtime or an already approved Bun 1.4.2 installation. Do not automatically install or upgrade tooling. With separately approved dependency installation, run `bun install --frozen-lockfile` from `server/`; do not regenerate pins casually.

From the repository root on Windows:

```powershell
.\.tooling\bun-1.4.2\bun-windows-x64\bun.exe scripts/run-server.mjs typecheck
.\.tooling\bun-1.4.2\bun-windows-x64\bun.exe scripts/run-server.mjs build:test
.\.tooling\bun-1.4.2\bun-windows-x64\bun.exe scripts/run-server.mjs test
.\.tooling\bun-1.4.2\bun-windows-x64\bun.exe scripts/run-server.mjs build
.\.tooling\bun-1.4.2\bun-windows-x64\bun.exe scripts/run-server.mjs dev
```

On a platform with approved Bun 1.4.2 already available:

```sh
bun scripts/run-server.mjs typecheck
bun scripts/run-server.mjs build:test
bun scripts/run-server.mjs test
bun scripts/run-server.mjs build
bun scripts/run-server.mjs start
```

The runner validates the version, uses `server/` as the working directory, checks canonical engine freshness before build, and starts compiled `dist/index.js`. `dev` watches TypeScript source; `test:integration` runs the transport compatibility file. Client/preservation tests and packaging use the root README commands. Hosted database checks require an explicitly isolated target and opt-in configuration; they do not discover or start local PostgreSQL. Never point disposable test setup at production records.

| Runtime dependency | Exact pin |
| --- | --- |
| Bun | 1.4.2 |
| `@colyseus/core` | 0.18.18 |
| `@colyseus/bun-websockets` | 0.18.3 |
| `@colyseus/schema` | 5.0.35 |
| `@colyseus/sdk` | 0.18.4 |
| `@supabase/supabase-js` | 2.117.2 |
| `pg` | 8.23.1 |

TypeScript is pinned to `7.0.2`; typings are `@types/bun@1.4.2`, `@types/node@24.19.1` and `@types/pg@8.23.1`. [Dependency decisions](../docs/multiplayer/dependencies.md) explain package purposes and runtime acceptance. The browser bundles include MIT notices and source hashes; retain them when regenerating SDKs or client exports.

## 🔐 Configuration

Use `.env.example` as the field reference and keep real values in an ignored `server/.env.local` or the host's private environment. The runner executes inside `server/`. Set `HOST=127.0.0.1` for local work; production binds `0.0.0.0` on Railway's injected `PORT`.

Private configuration requires `DATABASE_URL`, `DATABASE_CA_FILE` and `DATABASE_SCHEMA`, plus `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for account verification. Use the selected Supabase PostgreSQL **Session pooler** and a verified CA file; TLS verification cannot be disabled through URL SSL options. `DATABASE_URL` belongs only on the server. A publishable Auth key is not a database password or service-role secret.

Production public configuration has this shape (illustrative values, not a live endpoint):

```dotenv
NODE_ENV=production
HOST=0.0.0.0
DATABASE_SCHEMA=enochian_chess
MULTIPLAYER_PUBLIC_ENDPOINT=https://game.example.com
MULTIPLAYER_ALLOWED_ORIGINS=https://game.example.com
MULTIPLAYER_INGRESS_POLICY=railway-edge-only
MULTIPLAYER_ALLOW_MISSING_ORIGIN=true
```

`NODE_ENV=production` requires a canonical HTTPS endpoint, a nonempty exact HTTPS origin allowlist containing that endpoint, and the approved ingress policy. Invalid production configuration fails before durable startup. Missing-Origin permission is explicit for native SDK/top-level sign-in flows and grants no identity; `Origin: null` remains denied. Do not use wildcard CORS or infer identity/TLS from spoofable forwarded headers. Verify actual nested platform-frame origins before adding them. The hosted page routes inject only public endpoint configuration into the response, leaving canonical sources untouched.

Auth uses fresh Supabase verification. Embedded sign-in navigates to a separate top-level page through a one-time handoff with PKCE/return-code fallback; bearer credentials never become invitation URLs. Live email/social provider setup and actual platform return flows need separate acceptance. There is no documented environment switch that bypasses ranked release gates; the application defaults to ranked disabled.

### Explicit private-schema initialization

Review `migrations/001-initial.sql`, obtain operator authorization, select a dedicated private schema, and configure the private connection and trusted CA before running any migration. From `server/`, with the approved runtime:

```sh
bun --env-file=.env.local scripts/migrate-private-schema.ts --create enochian_chess
```

Windows uses `..\.tooling\bun-1.4.2\bun-windows-x64\bun.exe` in place of `bun` from that directory. This is an operator action, never startup DDL. It establishes/verifies the known migration, revokes browser access and enables RLS without browser policies. Existing unmanaged schemas or incompatible history are rejected. Startup only verifies the version/hash. Preserve existing ledger data and never edit history to make a mismatch disappear. Detailed prerequisites, permissions and recovery are in [persistence](../docs/multiplayer/persistence.md).

## 🚦 Operations

Build Docker from the **repository root**, not `server/`: canonical HTML, extraction scripts and baseline helpers are required build inputs. The image uses `oven/bun:1.4.2`, frozen installs, explicit copies and the non-root Bun user; it runs `bun dist/index.js` from `/app/server`. No credential belongs in a build argument, image layer or client ZIP.

Railway is the selected host. Keep **one process/replica**, sleeping disabled, and no Redis or automatic multi-process scaling. `/health` is liveness; `/ready` stays 503 until schema verification, durable advisory-lease ownership and recovery finish. Missing database configuration cannot create a ready memory-only multiplayer service. Lease loss/draining removes readiness.

Use a controlled **drain, stop old, start new** cutover for the advisory lease. A replacement started while the old process owns the lease can remain unready; ordinary deployment overlap is not a validated ownership handoff. Preserve durable commands, snapshots, deadlines, account locks and settlements through deployment and rollback. Roll back only to a compatible migration/protocol/engine version. Verify backups/PITR and isolated restore procedures before claiming recovery readiness.

Raw Bun request protection runs before matchmaking, OPTIONS and body allocation. HTTP bodies are capped at 2,048 bytes, WebSocket messages at 4,096 bytes, and bounded fixed-window quotas supplement strict action parsers and server authorization. Source buckets use native transport peers, not client-supplied forwarded headers. Hosted HTTPS edge behavior and platform origins still require observation; do not weaken readiness, TLS, ownership or origin controls to get a deployment green.

The [operations guide](../docs/multiplayer/operations.md) is the authoritative deployment/configuration record. The [release checklist](../docs/multiplayer/release-checklist.md) tracks HTTPS/WSS, real recovery/restart, 2–4 physical-device casual play, four-human ranked acceptance, provider configuration, and authorized platform draft embeds. Two local tabs and a configured Railway domain do not prove those gates. Deployment, provider changes and publication remain distinct operator actions.

---

*The client draws the board. The server owns the match. The ledger remembers it.*
