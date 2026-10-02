# GitHub issue draft: chosen Colyseus multiplayer architecture

**CANCELLED / SUPERSEDED — DO NOT FILE.** The body below is historical draft text, not current requirements or execution authority. Its mandatory single-HTML and Node assumptions are superseded by the approved three-page ZIP, optional generated export and pinned Bun implementation. See the [execution ledger](../plans/2026-10-02-enochian-execution-ledger.md). AI/single-player captor negotiation is deferred; no separate issue publication is authorized.

Status: superseded, publication canceled by the user on 2026-10-02 because Colyseus is now the main plan. Retain this draft only as planning history; do not retry publication. No issue number exists. Earlier creation failed with HTTP 403 (Resource not accessible by integration); nothing was published.

Proposed title: Implement authoritative Enochian multiplayer with Colyseus and a single-HTML client release

## Purpose

Plan a Colyseus-based Enochian multiplayer implementation in this repository. The user selected Colyseus as the active architecture, replacing Cloudflare Workers + Durable Objects. A separate alternative branch is no longer the purpose of this issue; no branch has been created.

The goal is authoritative rooms, reconnect support and ranked enforcement, suitable for eventual Newgrounds and itch.io releases. Chaturaji must remain untouched. Follow the accompanying Superpowers specification and implementation plan.

## Important clarification

Colyseus does not require abandoning a single HTML client. A Node backend under `server/` and one self-contained HTML browser client coexist. Embed the pinned browser SDK in the Enochian payload; the playable release must remain one `index.html`. Backend and tooling source can be multi-file.

## Confirmed requirements

- Separate-device play with create-room and join-by-code/link.
- Casual: 2–4 human players; AI fills empty armies.
- Ranked: four authenticated, distinct human players in the lobby; no bots.
- Casual disconnect: immediate temporary bot control; original player may reclaim the seat for three minutes. After the deadline, AI owns that seat for the rest of that match. No undo of bot moves.
- Ranked disconnect: pause immediately, with a five-minute return allowance; resume only when all required humans are back. If not recovered, void the match, apply a rating consequence to the departing account and block new ranked entry for ten minutes.
- Rating formula/penalty and account provider require approval before implementation.
- Negotiation means prisoner-king exchange only. No invented diplomacy, alliances or enforced truces.
- Exchanges involving AI captors are deferred. Single-player AI negotiation is deferred.
- Preserve current executable Enochian mechanics; document historical discrepancies separately. Do not silently introduce absent Zalewski rules.

## Planned work

### 1. Baseline and rule parity

- [ ] Capture hashes of the complete Chaturaji payload and launcher before changing anything.
- [ ] Map the embedded Enochian engine, AI and rendering boundaries.
- [ ] Add meaningful fixtures for legal moves, frozen armies, existing promotion behavior, turn order and team win conditions.
- [ ] Explicitly distinguish the current playable rules from unimplemented items in the Rules tab.
- [ ] Require the server and local client to use one canonical rule engine with identical fixtures.

### 2. Colyseus room design

- [ ] Evaluate an authoritative Room implementation, not a relay-only room.
- [ ] Set room capacity to four armies; define stable account/session-to-seat ownership.
- [ ] Create a readable room-code mapping with collision handling, expiry and invite links.
- [ ] Use explicit ready states; prohibit a ranked start with fewer than four humans or any bot.
- [ ] Handle duplicate connections and prevent one account claiming multiple ranked seats.
- [ ] Pin a compatible server/client SDK version and document how the browser SDK is embedded into the HTML artifact.
- [ ] Reject illegal, stale, out-of-turn and wrong-seat commands on the server.
- [ ] Version commands and snapshots; deduplicate retried commands by ID.

### 3. Disconnect and persistence

- [ ] Evaluate allowReconnection and SDK reconnect tokens against the required 180/300 second windows.
- [ ] Do not assume a reconnect token or in-memory room survives process restart.
- [ ] Persist snapshots, seat ownership, absolute deadlines and unresolved outcomes.
- [ ] Distinguish a disconnected human seat from a frozen army whose king was captured.
- [ ] Resolve reconnect-versus-bot-move and reconnect-versus-expiry races atomically.
- [ ] Protect rating/cooldown settlement with a durable idempotent result ledger.
- [ ] Treat backend outages separately from individual departures; prevent unfair abandonment penalties.
- [ ] Define room cleanup and restore behavior across deployments.

### 4. Prisoner exchange

- [ ] Track which army captured each king and whether each negotiating captor is still eligible.
- [ ] Permit only approved human-controlled captors to offer/respond.
- [ ] Process an exchange as one validated, atomic server event.
- [ ] Restore both kings and thaw armies consistently across all clients.
- [ ] Resolve equal-distance placement and offer lifetime/timing before implementing them.
- [ ] Preserve the existing throne geometry for this branch unless a historical-rules change is separately approved.

### 5. Ranking and identity

- [ ] Require server-verified persistent identity for ranked play; localStorage is not an authority.
- [ ] Choose and document the rating system and abandonment penalty.
- [ ] Record voided matches separately from wins/losses.
- [ ] Obtain approval for the proposal that non-departing players receive no rating changes in an abandonment void.
- [ ] Enforce ten-minute ranked cooldown on the backend across browsers and devices.
- [ ] Prevent entry to another ranked match while an account still has an unresolved active ranked match.

### 6. Hosting comparison

- [ ] Compare Colyseus Cloud with a continuously running Node service on a suitable host.
- [ ] Verify current WebSocket support, process lifetime, deploy/restart behavior, persistent database support and costs from official docs.
- [ ] Assess whether one process is sufficient initially; avoid Redis/multi-process scaling until demand justifies it.
- [ ] Start with Colyseus directly; there is no implemented Cloudflare backend or live ranking pool to migrate.
- [ ] Keep secrets and private configuration outside public HTML. The public WSS endpoint necessarily belongs in client configuration.
- [ ] Define a rollback plan and a protocol-version compatibility policy.

### 7. Platform validation

- [ ] Produce the required single HTML release artifact; package index.html at ZIP root for Newgrounds.
- [ ] Test itch.io and Newgrounds draft embeds, not just a top-level localhost tab.
- [ ] Use HTTPS/WSS.
- [ ] Test origin restrictions, nested srcdoc frame behavior, login popups and blocked third-party storage.
- [ ] Provide manual room-code entry when platform wrappers do not forward invite URL parameters.
- [ ] Verify mobile resizing, fullscreen, user-gesture audio and cross-device reconnects.
- [ ] Keep offline/local play available when the multiplayer backend is unavailable.

## Acceptance criteria

1. Four real devices can complete an authoritative match without client divergence.
2. Casual bot takeover and 180-second seat reclamation work, including process restart tests.
3. Ranked 300-second timeout and 600-second cooldown are enforced server-side exactly once.
4. Human-only prisoner exchanges synchronize atomically and cannot be performed by AI captors.
5. Historical gaps are documented; no unintended rule changes are included.
6. Chaturaji's embedded payload remains byte-for-byte identical.
7. A release artifact works in draft platform embeds.
8. Colyseus hosting, persistence costs and operations are approved before deployment; no Cloudflare migration is planned.

## References

- [Colyseus documentation](https://docs.colyseus.io/)
- [Reconnection documentation](https://docs.colyseus.io/server/room/)
- [itch.io HTML5 upload documentation](https://itch.io/docs/creators/html5)
- [Newgrounds HTML5 submission documentation](https://www.newgrounds.com/wiki/help-information/content-submission/games-and-movies)
- [Chess Variant Pages: Enochian Chess](https://www.chessvariants.com/historic.dir/enochian.html)
- Chris Zalewski, Enochian Chess of the Golden Dawn (1994), especially rule 8.5 for prisoner exchange.

## Scope boundary

This issue records the chosen architecture and planned work. Filing it does not authorize implementation, hosting purchase, deployment, release or a change to Chaturaji. No new branch is being created as part of filing this issue.
