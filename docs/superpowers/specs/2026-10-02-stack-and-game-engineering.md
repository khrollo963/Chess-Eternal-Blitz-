# Stack, Railway hosting and readable game-page engineering requirements

Date: 2026-10-02. Engineering requirements with subsequent implementation approvals. See the [execution ledger](../plans/2026-10-02-enochian-execution-ledger.md) for exact approved/pinned dependencies, committed Tasks 0–12 and pending acceptance. The inventory and hosting comparison below retain planning history rather than granting new dependency approval.

## Confirmed runtime and dependency policy

- Latest user preference supersedes Node-only execution: prefer Bun runtime and package manager if Colyseus compatibility is verified; Node is an explicitly permitted fallback. Bun transport exists officially but is experimental, so support is not evidence that the full stack already passes tests.
- Use latest stable Bun for package management and the preferred runtime. Official site observed 1.4.2 today; recheck at implementation. If G9 selects fallback, use latest compatible maintained Node LTS, observed 24.21.0 today, subject to approved engines/peer requirements.
- Keep TypeScript compiler checks/production build under either runtime. Validate Bun's official transport, schema/SDK, HTTP routes/auth, timers, graceful shutdown and storage transactions before choosing it under G9. Backend tests use the selected runtime's native runner with shared scenario fixtures; Node fallback uses compiled output and default Node WebSocket transport. No extra loader/test framework by default.
- For every new direct library or tooling dependency, first present its purpose, exact latest compatible stable version, source, compatibility requirements and alternatives to the user. Obtain confirmation before installing it. Framework selection alone does not approve its entire package ecosystem.
- Pin approved versions and commit `bun.lock`; use frozen installs in CI/builds. Record transitive dependencies and lifecycle scripts in the approval/build review. New direct dependencies and compatibility-driven downgrades require renewed confirmation; do not silently downgrade or adopt prereleases to make the stack work.
- Record the selected runtime in explicit scripts, runtime pins and smoke-test diagnostics (`process.versions.bun` for Bun). Do not accidentally run Node tests while claiming Bun runtime acceptance. Reuse portable domain logic rather than maintaining parallel backends.

### Candidate dependency inventory: proposals, not installation approval

| Candidate | Why it might be needed | Minimize alternatives |
| --- | --- | --- |
| Colyseus server entry package (`colyseus`, or approved minimal core composition) | Room lifecycle, matchmaking and state synchronization | Choose one entry arrangement; do not install every optional Colyseus module. |
| Compatible `@colyseus/schema` | Public state serialization | Prefer the installed version's documented schema builder; no deprecated definitions copied from old docs. |
| Compatible browser SDK (`@colyseus/sdk` or the verified current package) | Browser room connection/reconnection | Embed its official prebuilt browser bundle if available; no live CDN dependency. |
| Official `@colyseus/bun-websockets`, if approved and compatible; default Node transport for fallback | Selected runtime's WSS transport | Bun transport is experimental; validate before full backend work and confirm package version. No unnecessary alternative native transports. |
| `typescript`, selected runtime typings and only required test typings | Compiler/type checking and backend tests | Bun native runner for Bun backend or Node native runner for fallback; no Jest/Vitest/tsx/ts-node by default. |
| One PostgreSQL driver and needed typings, if G1 approves PostgreSQL | Durable transaction/snapshot/ranking ledger | No ORM, separate database framework or auth module unless justified and approved. |
| Browser bundler only if SDK lacks suitable self-contained distribution | Inline browser SDK build | Prefer official distribution; request approval before adding esbuild or another tool. |

This inventory intentionally omits exact versions until registry metadata, peer dependencies and chosen-runtime support are checked together. A docs selector is not proof that matching packages are published stable. A stable published version of an experimental transport still needs its status disclosed during confirmation. Approval must cover the exact list before installation; record it in `docs/multiplayer/dependencies.md` during implementation.

## What Colyseus supplies and what we implement

| Responsibility | Approach |
| --- | --- |
| Connections, rooms, transport/session lifecycle | Colyseus with installed-version lifecycle APIs. |
| Public state synchronization | Colyseus Schema; only committed state becomes visible. |
| Transport reconnect helper | Colyseus; application recovery remains separate for restarts/deadlines. |
| Enochian movement, freezing, promotion, turn/team outcomes | One canonical current-rules engine extracted from the HTML. |
| AI scoring/simulation and scheduling | Custom bounded evaluation, canonical successor simulation and stale-job guards. |
| Private room codes, durable seat ownership/recovery | Custom authenticated endpoints and storage; invite codes never authenticate occupied seats. |
| Three/five-minute disconnect policies | Custom serialized domain transitions and persisted absolute deadlines. |
| Multiplayer prisoner exchange | Custom captor ledger/offer/atomic restoration, based on approved rule 8.5 interpretation. |
| Ranked identity/admission/rating/cooldown | Approved identity integration plus custom transactional ledger and idempotent settlement. |
| Restart/outage recovery, backup/operations | Custom persistent snapshots/events and explicit outage policy. |

Use Exa for research/source discovery, Context7 for current SDK/API/cloud docs, and Superpowers for design, implementation planning and independent review. Research each remaining policy against primary sources before proposing an implementation. Do not reinvent transport/state serialization supplied by Colyseus, and do not mistake those features for automatic anti-cheat or durable game policy.

## Hosting comparison

Railway creation/deployment is authorized for the concrete project/service/domain in the execution ledger, with US-East Metal, one replica and sleeping disabled. Hobby is unchanged; the $10 monthly compute hard limit and $5 alert were saved and confirmed in Workspace Usage. Existing Supabase supplies Auth/PostgreSQL. At the ledger snapshot resources exist, explicit settings are staged, but deployment and permanent dedicated schema application have not occurred. Root records later results. Local PostgreSQL testing authorization is revoked.

Client source is now planned as three static HTML pages on GitHub Pages and later platform ZIP embeds, with an optional generated single-HTML export. The historical comparison below remains background; it no longer represents an open provider choice.

| Option | Fit for this backend | Free-plan/budget reality | Planning recommendation |
| --- | --- | --- | --- |
| Self-host Node/Colyseus | Direct fit for a persistent process and durable store. Requires reachable HTTPS/WSS, backups, updates and reliable uptime. | Existing hardware may avoid a new hosting subscription; power, connectivity and administration still matter. | Preferred if an appropriate always-on machine is available. |
| Railway | Selected provider; supports Bun or Node process deployment and WSS. Redeploy/restart still interrupts live rooms. | Official pricing currently offers a 30-day $5 trial then $1/month free credit. Hobby is $5/month including $5 usage, with overages. Server plus database must fit total resource budget. | Chosen. Decide budget/persistence before resources; disable optional sleeping initially and test recovery. |
| Fly.io | Direct fit using one Machine and explicit persistent volume/database. Configure one initial machine; verify routing and disable autostop for live-room service. | Free trial is limited, not permanent free hosting for new accounts. Running Machines, storage and networking are billed; database adds cost. | Strong alternative when VM/container control is desired; more operational decisions than Railway. |
| Render Free | Supports WSS and Node process deployment, but can sleep/restart. | Sleeps after 15 minutes without incoming HTTP/WebSocket messages; ephemeral local filesystem, no free disks; free Postgres expires after 30 days. | Prototype candidate only; not the default durable ranked deployment. |
| Vercel | Static client hosting is straightforward. Current Functions now support WebSockets in public beta with Fluid compute, but connections follow function duration limits and instances are ephemeral. | A free frontend plan is not an always-running Colyseus room server. Persistent rooms require external coordination/recovery and compatibility work beyond this initial architecture. | Suitable for optional static client hosting; do not choose it for the current one-process Colyseus backend. Revisit only with a separate verified architectural prototype. |
| Colyseus Cloud | Framework-specific managed hosting candidate. | Paid option; not presumed to meet the user's free/self-host preference. | Keep as optional comparison rather than the active hosting assumption. |

Railway build/install/start configuration must honor G9's runtime choice, use frozen Bun installs, bind injected `PORT` on `0.0.0.0`, and expose a readiness endpoint. Because the server engine is generated from `enochian.html`, use repository-wide build context or explicit inclusion of the client/engine extraction inputs, not a server-only context that omits them. Keep one replica initially. A persistent process still requires crash/restart recovery.

For Railway, explicitly disable optional Serverless/sleeping for the first live-room service unless tested recovery and budget policy approve it. For Fly, configure one Machine and prevent idle autostop during active rooms. Provider restarts/deployments are service interruptions under G5, not player abandonment. Do not add Redis or multiple replicas merely because the host offers them.

Before resolving the remaining G1 budget/database decisions, measure idle/active memory, CPU, database footprint and expected hours; include storage/egress/backup. Verify Railway plan eligibility, limits, storage, region and shutdown behavior. Finite credits are not proof that the full service runs free indefinitely.

## Readable source layout and platform packaging

Latest requested source layout is `index.html`, `chaturaji.html`, `enochian.html`. Decode both original game constants losslessly, preserving original UTF-8 bytes and embedded image assets. Chaturaji is then protected byte-for-byte. Change only the launcher loading/payload-removal code; preserve styling, artwork, navigation, storage keys and `window.parent.addGameSession`.

Each game frame gets relative `src` on first selection only. Retain iframe elements/documents when switching; never reset `src` on every click. Handle initial load errors without replacing a successfully loaded frame. Same-origin HTTP serving keeps the existing direct parent statistics bridge; do not add sandbox/origin isolation that breaks it. `file://` browser behavior is not proof of platform behavior.

Default platform artifact is one ZIP with the three HTML pages at root. Both itch.io and Newgrounds document multi-file HTML5 ZIP uploads with root `index.html`. The source `index.html` alone is not self-contained. Retain optional generated `dist/index.html` with safely serialized inline `srcdoc` game content for literal one-HTML delivery; no whole-game Base64, manual duplicate source or game logic rewrite. Verify serialization preserves game bytes and guards closing-script delimiters. Keep backend/credentials out of both exports; multiplayer still connects to Railway.

README changes are planned for implementation: describe source layout, HTTP preview, same-origin statistics/storage and ZIP versus optional single-HTML export. Existing local storage keys stay unchanged; data does not automatically transfer between different hosting origins.

Inside `enochian.html`:

1. Add a short section map and numbered comments for CSS, markup/templates and JavaScript modules.
2. Separate constants/geometry, pure engine, AI, local session/lifecycle, transport/recovery, lobby/exchange controls, rendering, input, audio and bootstrap.
3. Use closures/private state with explicit APIs and dependency injection, avoiding unscoped globals and circular dependencies. Expose only the APIs needed by adjacent sections and extraction/build tooling.
4. Keep canonical rules DOM-free. Renderers read state; input produces intents; only local engine application or authoritative server acknowledgement commits a move.
5. Keep one clearly bounded generated vendor SDK block with pinned version/hash/license. Handwritten code stays readable and commented; do not bury new logic in the vendor bundle.
6. Preserve the game's current UX and mechanics. Comments explain source-backed rules, invariant coordinates and concurrency/lifecycle reasons rather than narrating obvious syntax.

## Game-development skill guidance

Available [multiplayer-basics](C:/Users/nucle/.agents/skills/multiplayer-basics/SKILL.md) and [state-machine](C:/Users/nucle/.agents/skills/state-machine/SKILL.md) target Godot. Apply only their engine-independent principles: explicit authority, named transitions, one owner of state, validated inputs and cleanup on exit. Do not introduce Godot APIs, ENet, scenes or continuous movement synchronization into a turn-based HTML game.

- Define `lobby`, `active`, `paused`, `finished`, `void` phases and allowed transitions in one table, with entry/exit effects and tests. Keep connectivity/control states distinct from alive/frozen army state.
- Make both local and multiplayer state mutation explicit. No renderer/audio callback owns game rules; no timer can advance an obsolete session.
- Returning to the launcher cancels Enochian CPU callbacks using an Enochian-side lifecycle observer; reopening resumes with a fresh guard and preserved board. Verify relative-`src` frames and optional `srcdoc` export; launcher changes remain limited to the approved migration.
- Test deterministic engine and AI behavior with injected clock/RNG; test races, duplicate input and canonical server state over real SDK connections.
- Use reliable ordered turn commands and versioned snapshots. No speculative board mutation, continuous high-frequency movement stream or new gameplay timing is necessary.
- Keep input locking tied to acknowledged game phase/turn; provide clear pending, disconnected and paused feedback. Test keyboard/touch controls and user-gesture audio without broad UI redesign.
- Verify separate-device behavior and platform frames. Backend outages must leave local play available and cannot automatically penalize ranked players.

## Evidence and sources

Checked through Exa, Context7 and official pages on 2026-10-02. Recheck prices/versions before installation or deployment.

- [Node downloads](https://nodejs.org/en/download), [Node TypeScript support](https://nodejs.org/api/typescript.html), [Bun](https://bun.com/) and [Bun frozen installs](https://bun.com/docs/pm/cli/install).
- [Colyseus transport](https://docs.colyseus.io/server/transport), [Bun transport](https://docs.colyseus.io/server/transport/bun-websockets), [Schema](https://docs.colyseus.io/state/schema), [deployment](https://docs.colyseus.io/deployment). Bun support exists but is experimental; use the approved TypeScript compiler and tested selected runtime. Old examples may target incompatible schema/lifecycle versions.
- [itch.io HTML5 uploads](https://itch.io/docs/creators/html5) and [Newgrounds submissions](https://www.newgrounds.com/wiki/help-information/content-submission/games-and-movies): one ZIP upload can contain multiple client files; a literal single-HTML upload must include the entire client.
- [Railway pricing](https://railway.com/pricing), [network specifications](https://docs.railway.com/networking/public-networking/specs-and-limits), [Serverless](https://docs.railway.com/deployments/serverless). Current published pricing takes precedence over older indexed plan tables.
- [Fly free trial](https://fly.io/docs/about/free-trial/), [Fly autostop](https://fly.io/docs/launch/autostop-autostart/), [Fly volumes](https://fly.io/docs/volumes/overview/).
- [Render Free](https://render.com/docs/free) and [Render WebSockets](https://render.com/docs/websocket).
- [Vercel WebSocket beta](https://vercel.com/changelog/websocket-support-is-now-in-public-beta), [WebSocket backend guidance](https://vercel.com/docs/frameworks/backend#websockets), [function duration limits](https://vercel.com/docs/functions/configuring-functions/duration). Older claims that Vercel cannot serve any WebSockets are obsolete; the remaining mismatch here is process/room lifetime and coordination.

Historical source citations and executable-rule discrepancies remain in the companion rule audit; engineering advice does not authorize new game mechanics.
