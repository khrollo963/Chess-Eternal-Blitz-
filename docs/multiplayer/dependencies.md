# Approved dependencies and runtime

G8 approval received from the user on 2026-10-02 for the exact initial list below,
including project-local Bun 1.4.2. A later same-day approval added PostgreSQL and
its typings plus isolated disposable local database testing. No deployment,
online resources, global runtime update, ORM, Redis or generator is authorized.

| Direct package | Pin | Purpose |
| --- | --- | --- |
| `@colyseus/core` | 0.18.18 | Minimal server, matchmaking and room lifecycle |
| `@colyseus/schema` | 5.0.35 | Public state serialization with functional `schema`/`t` builders |
| `@colyseus/sdk` | 0.18.4 | Real SDK integration tests and later local browser bundle embedding |
| `@colyseus/bun-websockets` | 0.18.3 | Official experimental Bun transport |
| `typescript` | 7.0.2 | Native TypeScript compiler for type checking and compiled production output |
| `@types/bun` | 1.4.2 | Bun native runtime/test typings |
| `@types/node` | 24.19.1 | Explicit maintained Node 24 typings; avoids Bun wildcard drift |
| `pg` | 8.23.1 | PostgreSQL transactional driver, future durable adapter |
| `@types/pg` | 8.23.1 | PostgreSQL driver typings |

Additional approval received: `@supabase/supabase-js` 2.117.2 for Task 10 Supabase Auth
email/social identity; not installed by Task 4. Supabase PostgreSQL is the
selected online database and Railway the Colyseus host. Neither online resource
has been configured here. The earlier local PostgreSQL 18.3 probe was disposable
only. The user subsequently withdrew use of the machine's installation; no
future tests discover, start or repair local PostgreSQL. Production needs a
maintained patched database runtime.

## Reproducible runtime and dependency resolution

The official Windows x64 Bun 1.4.2 archive was downloaded into ignored
`.tooling/bun-1.4.2/`; no global installation changed. It reports version 1.4.2
(build 744846f84). Existing global Bun 1.3.14 and Node 25.6.0 are not the selected
backend runtime. Maintained Node LTS is the permitted fallback; installing it
and any changed direct transport package requires approval first.

`server/bun.lock` records all resolved transitive packages and integrity hashes.
The installation used the approved local Bun binary and exact direct pins.
Builds/CI must use `bun install --frozen-lockfile` under Bun 1.4.2. No direct
Express/tools/auth/Redis/bundler package was added. The Bun transport supplies
`bun-serve-express` transitively. Core requires Schema ^5.0.8 and Node >=22
compatibility; SDK requires Schema ^5.0.8 and optional Core 0.18.x; Bun transport
requires Core ^0.18.16. The installed pins satisfy those constraints. The lock
also contains TypeScript's optional platform compiler packages, `msgpackr` and
its optional extraction packages, and the `pg` dependency tree. Native optional
packages are dependencies of approved packages, not separately selected tools.
`bun pm untrusted` under the selected runtime reported zero untrusted packages
with lifecycle scripts. No additional `trustedDependencies` entry or trust
command was used; the default Bun lifecycle policy was retained.

Scripts use `scripts/run-server.mjs`, which selects the approved project-local
binary when present, checks exact version before every operation, and invokes
it directly. This avoids Windows package scripts accidentally resolving the
older global `bun`. On a host without the local Windows binary, invoke the
launcher with Bun 1.4.2. `start` dispatches exactly `bun dist/index.js`; tests use
the selected Bun native runner and compiler operations invoke approved
TypeScript 7.0.2. No extra TypeScript loader or test framework is installed.
Production `build` checks the canonical extraction against `enochian.html`
before compilation and includes the generated `.mjs` in output. It requires
repository-wide context with the canonical HTML and extraction scripts.

## Local G9 evidence and limitations

The real SDK integration probe runs on an ephemeral loopback port. It verifies
two connections, rejected/accepted fixture authentication, representative
HTTP auth/invite routes, functional Schema synchronization, a lobby message,
unexpected drop with automatic same-session reconnection, intentional leave
without a drop event, room disposal and closed HTTP listener after graceful
shutdown. It waits 6.5 seconds without application messages against a two-second
idle timeout (over three idle windows) to exercise Bun ping/pong. This is a local
transport compatibility probe, not a multi-hour soak or Railway WSS proof.

Canonical-engine integration also passed under Bun 1.4.2: native named/default
imports reference the same generated API; initial state has 36 pieces; a
deterministic legal successor matches the compiled production `.mjs`; the
source hash is retained; freshness is checked; and the input/generated source
remain unchanged. The server bootstrap loads this API through `src/engine.ts`,
ready for later domain delegates, without a second rules implementation.

Historical local evidence: the initially approved disposable PostgreSQL 18.3
probe passed under Bun 1.4.2, demonstrating rollback leaves state/event rows
unchanged, competing expected-revision updates admit exactly one commit, and
a duplicate unique command ID cannot produce a second event. That temporary
cluster was stopped and removed; no installed data/service was changed. After
the user's steering, the local cluster helper was removed entirely. This prior
driver evidence does not establish Supabase or production database acceptance.

The current DB probe is explicitly opt-in: `TEST_DATABASE_URL` plus
`TEST_DATABASE_ISOLATED=1`, against the user-selected isolated external test
target only after connectivity approval. Otherwise it reports skipped. It
creates a unique `enochian_probe_<uuid>` schema with qualified tables and removes
only that schema, uses at most three connections, never uses existing public
schema/data, and redacts raw driver errors. TLS uses the explicit trusted CA
from `TEST_DATABASE_CA_FILE` or `DATABASE_CA_FILE` with `rejectUnauthorized: true`;
URI SSL options cannot override that verification. Credentials stay in ignored
`server/.env.local` or environment variables and are never logged or committed.
Durable domain storage and process recovery are Task 7; actual Supabase Auth
tokens are Task 10. No local PostgreSQL discovery/start remains.

External acceptance on 2026-10-02: after the user supplied and authorized the
Supabase Session pooler target and read-only connectivity was verified, the
single selected transaction probe passed under Bun 1.4.2: 1 test, 11 assertions.
It verified encrypted/authorized TLS, rollback, competing revision commits,
unique command IDs, and that its unique schema no longer existed after cleanup.
The pooler uses session mode on port 5432; the selected server was PostgreSQL
17.11 in the preceding read-only check. The official Supabase public CA is kept
in ignored project tooling. The credential was sourced in memory from ignored
configuration, never included in command text/logs. No existing schema/data was
modified and no database/service was provisioned. This supersedes local-only
driver evidence for the G9 database compatibility primitive; production domain
transactions, restart recovery and Auth remain separate later tasks.

Production authentication and ranked policies are not fixture-token behavior.
The scaffold denies joins without an injected authenticated domain delegate and
reports `/ready` as 503 until durable storage/readiness is implemented. Neither
Colyseus reconnection tokens nor the room's short probe reservation implement
the application's persisted 180/300-second deadlines. All live game command,
seat, exchange, ranking and restart behavior belongs to subsequent tasks.

The SDK embedding script reads the pinned package's official self-contained
`dist/colyseus.js`, adds MIT license/version/SHA-256, and escapes closing-script
sequences. It requires explicit vendor markers before touching `enochian.html`;
Task 4 does not embed it. No mandatory runtime CDN or bundler is needed.

## Primary documentation

API documentation was fetched using Context7 `/colyseus/docs`; Exa discovered
the official transport page. Installed 0.18 package types/source were checked
for actual exports, `getExpressApp`, `onAuth`/`onDrop`/`onReconnect`/`onLeave`,
functional Schema 5 builders and SDK reconnect close codes, rather than relying
on older examples.

- [Colyseus Bun transport (experimental)](https://docs.colyseus.io/server/transport/bun-websockets)
- [Colyseus Room lifecycle](https://docs.colyseus.io/server/room)
- [Colyseus Schema](https://docs.colyseus.io/state/schema)
- [Colyseus SDK connection](https://docs.colyseus.io/sdk/connection)
- [Official Bun 1.4.2 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)
- [Bun frozen installations](https://bun.com/docs/pm/cli/install)
- [TypeScript source](https://github.com/microsoft/TypeScript)
- [node-postgres transactions](https://node-postgres.com/features/transactions)
- [PostgreSQL version support](https://www.postgresql.org/support/versioning/)

Railway transport/restart acceptance, external Auth integration, maintained
production database version, separate devices and platform embeds remain
separate release acceptance work. No hosting or publication occurred.
