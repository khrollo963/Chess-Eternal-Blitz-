# Chess Eternal changelog

Current arcade version: **2.1.0**. Both games share this version.

One arcade release version. Major: incompatible rules or public contracts. Minor: compatible features. Patch: fixes, presentation, documentation and internal maintenance. Historical versions are reconstructed from git, not previously published tags. Related commits are grouped; merges are credited without double-counting their changes.

History reviewed through [ee92685](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/ee9268572a274ede059b08cf12d3e5635f9c112a). Contributors are credited using the author names recorded in git; this does not infer who operated a coding assistant.

## 2.1.0 — Changelogs in both games (2026-10-02)

MINOR

- **Shared arcade:** Added a themed Changelog tab to both games, with semantic release versions, dated notes and contributor/commit links.
- **Shared arcade:** Reconstructed the complete available main-branch history, including Kenny’s original uploads and README edits, Jon’s asset removal, play-link update and PR merges. Chaturaji gameplay is unchanged.

## 2.0.0 — Automatic draw endings (2026-10-02)

MAJOR · reconstructed historical release

- **Enochian:** Added bare-kings draws and global stalemate, ending Ken’s two-bot king loop; stopped CPU scheduling, showed draw results and recorded each local result once.
- **Enochian:** Added durable online draw results and half-point team Elo settlement without abandonment penalties; preserved final king-capture victory.
- **Enochian:** Updated the playing guide and recovered qualifying unfinished v1 games without erasing their boards or histories.
- **Enochian:** Breaking compatibility change: rules version 2 and database migration 2 are required. Old active clients must refresh; completed v1 results remain readable.

Commits and contributors:

- [ee92685](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/ee9268572a274ede059b08cf12d3e5635f9c112a) — Jonathan Marien: Add automatic Enochian draws and ranked settlement

## 1.3.2 — Elemental text colors (2026-10-02)

PATCH · reconstructed historical release

- **Enochian:** Colored elemental piece headings and names with their corresponding Spirit, Fire, Water, Air and Earth colors.

Commits and contributors:

- [da5c233](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/da5c23323b5daeae496b913b50d65387288238d6) — Jonathan Marien: Color Enochian piece meanings by element

## 1.3.1 — Readable playing and history guides (2026-10-02)

PATCH · reconstructed historical release

- **Enochian:** Reorganized How to Play, Piece Meanings and History & Lore into themed sections, cards and source links; corrected misleading descriptions to match the actual game rules.

Commits and contributors:

- [8c9f66b](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/8c9f66beab947cb31978341ac6e27f8403f1b306) — Jonathan Marien: Improve Enochian guides and correct rule descriptions

## 1.3.0 — GitHub sign-in and startup recovery (2026-10-02)

MINOR · reconstructed historical release

- **Enochian:** Added configurable GitHub-only sign-in so players can sign in without relying on email delivery.
- **Enochian:** Restored startup and recovery for matches at the command cap and added safe startup diagnostics.

Commits and contributors:

- [e0768f2](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/e0768f2cc63d465e13f56489d2834a28054096b8) — Jonathan Marien: Restore capped-match startup and wire GitHub sign-in

## 1.2.0 — Ranked activation and visible notifications (2026-10-02)

MINOR · reconstructed historical release

- **Enochian:** Added ranked activation configuration and prominent toast notifications; room/color conflicts now provide actionable feedback.
- **Enochian:** Stopped repeated rejected bot commands and full-record idle polling that drove excess database egress; added bounded capacity, metadata maintenance and failure diagnostics.
- **Enochian:** Documented security and scenario audits, remaining live acceptance checks and the email-code template.
- **Shared arcade:** Jon Marien merged PR #2 into main.

Commits and contributors:

- [9d202e3](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/9d202e3f95e4b06e748a1703930ae6480d3d0fa4) — Jonathan Marien: Fix multiplayer egress loops and add ranked notifications
- [a6b8455](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/a6b8455cc3504e859fe214e5289ab2f01378af45) — Jon Marien: Merge pull request #2 from khrollo963/codex/ranked-lobby-notifications

## 1.1.0 — Authoritative online play (2026-10-02)

MINOR · reconstructed historical release

- **Enochian:** Added versioned authoritative commands, revision checks, duplicate-request replay, private invitations and seat ownership over the pinned Bun/Colyseus transport.
- **Enochian:** Persisted matches, events, snapshots and recovery credentials in a private PostgreSQL schema; added exclusive server ownership and restart recovery.
- **Enochian:** Added casual server bots and cumulative seat-reclaim allowances, plus negotiated human prisoner exchanges that restore both kings atomically.
- **Enochian:** Implemented verified identities, four-human ranked admission, account locks, disconnect pauses, rating settlement and abandonment cooldowns. Ranked activation followed in a later release.
- **Enochian:** Connected the online lobby and sign-in handoff outside the game frame; secured origins, message sizes, rate limits, TLS ingress and redacted failures.
- **Shared arcade:** Added reproducible client ZIP and standalone HTML packaging, serving and deployment configuration, documentation and an operational handoff.
- **Enochian:** Fixed final sign-in and website routing issues; terminal rooms retain final snapshots and stop idle polling before disposal.
- **Shared arcade:** Jon Marien merged PR #1 and updated the README play link to the Railway server. Chaturaji remained local play.

Commits and contributors:

- [19178d3](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/19178d3c40cbc74175c62980a6d3afe98033ca6f) — Jonathan Marien: feat(server): validate pinned Bun Colyseus transport
- [662b275](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/662b275753d7eb258db30fde2e34ba02398fe7eb) — Jonathan Marien: feat(server): persist revisioned authoritative commands
- [39d7074](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/39d7074a9b3c6983f3990c1cad49ed5a5aa9bbbf) — Jonathan Marien: feat(server): add private invitation lobbies and seat ownership
- [7c03972](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/7c0397299a53b701136d1958626e9b003a62b96a) — Jonathan Marien: feat: persist multiplayer matches and recover service restarts
- [f0a307f](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/f0a307f93898ddfb9d849251a7cf2b234dbf74bb) — Jonathan Marien: feat: run casual server bots and enforce cumulative reclaim allowance
- [95e173b](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/95e173bed15152db60cf33d021e2641a2689b0ae) — Jonathan Marien: feat: add authoritative human prisoner exchanges
- [ce6b46e](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/ce6b46e2aff0f0e0a1083f5cdd8eeeed8e4428e3) — Jonathan Marien: feat: verify Supabase identities and lock ranked admission
- [67c05e2](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/67c05e28d95e1518d3533e13dda99ab5683be268) — Jonathan Marien: feat: pause ranked matches and settle ratings exactly once
- [30464ee](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/30464eebdfd160e9b993ae4d0a068cd07346c638) — Jonathan Marien: feat: connect multiplayer client and outside-frame Supabase sign-in
- [1c0f716](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/1c0f716732eed493a57a582653da172d502e938c) — Jonathan Marien: feat: secure Bun ingress and prepare approved Railway deployment
- [807bbec](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/807bbec98bbe365ded71a1539cdf51c7b7ce70ca) — Jonathan Marien: feat: package canonical client ZIP and safe standalone HTML
- [c13b3ad](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/c13b3ad393f38af7cca40f2aaf24cf7e429635f3) — Jonathan Marien: docs: record multiplayer implementation and update arcade/server READMEs
- [d2709e1](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/d2709e160e024a4241c7b57baa7145076291ba5b) — Jonathan Marien: fix: resolve final sign-in, website routing, and terminal room review findings
- [203d047](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/203d047f6f90cc6eeeba87175ae163dbd63ad1e1) — Jon Marien: Merge pull request #1 from khrollo963/codex/task-0-readable-game-pages
- [87d40b8](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/87d40b81869d1fbfbdab362762bab0e87fd0696c) — Jon Marien: Change game link to new server URL
- [3f3641d](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/3f3641d1a53f1450dde25af7f2da0c05a8d91a8f) — Jonathan Marien: docs: hand off merged multiplayer and verified main deployment

## 1.0.4 — Reliable Enochian CPUs (2026-10-02)

PATCH · reconstructed historical release

- **Enochian:** Repaired pawn and king evaluation, capture scoring and CPU turn scheduling; cancelled stale jobs and prevented duplicate or post-reset bot moves.

Commits and contributors:

- [90db90d](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/90db90dc7391ef79ac45a299c42fbb59dc894e43) — Jonathan Marien: fix(enochian): repair AI evaluation and CPU lifecycle

## 1.0.3 — Readable sources and regression coverage (2026-10-02)

PATCH · reconstructed historical release

- **Shared arcade:** Extracted both games into readable HTML files and loaded them through relative iframe sources, preserving saved progress, mounted game state and the shared statistics bridge.
- **Enochian:** Extracted the canonical engine with rule parity and added reproducible AI, lifecycle, movement and preservation regressions.

Commits and contributors:

- [97b6ce4](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/97b6ce4cd9e984c4eb9dd2c98b292a04245dc242) — Jonathan Marien: Extract readable game pages and preserve launcher state
- [ae47efb](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/ae47efbccba9f500890fac06479b61b543ddce05) — Jonathan Marien: Add reproducible Enochian AI and lifecycle regressions
- [5f363a7](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/5f363a75dcf2b4b42c7483c2b66f7c9c6a0c4835) — Jonathan Marien: Extract immutable canonical Enochian engine with rule parity

## 1.0.2 — Arcade presentation (2026-10-02)

PATCH · reconstructed historical release

- **Shared arcade:** Refreshed the README layout while retaining its content and prominent play link; added the poster and landscape hero, then refined the green stag.
- **Shared arcade:** Jon Marien removed the superseded readme-hero.png asset after the replacement hero was added.

Commits and contributors:

- [23f1719](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/23f17193e38b34871a92e224116e10a9a1dcd625) — Jonathan Marien: docs: refresh Chess Eternal README presentation
- [36aa585](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/36aa585a00e8c548a486b0341f26448bedf91dd8) — Jonathan Marien: docs: add landscape README hero
- [9d7a62a](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/9d7a62a0407f6fcf34da3975312be1a757c020e5) — Jonathan Marien: docs: refine green stag on README hero
- [b0a7676](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/b0a76766e7656468ad148ce8e2686f00fa7abf4c) — Jon Marien: Delete readme-hero.png

## 1.0.1 — The original play link (2026-09-17)

PATCH · reconstructed historical release

- **Shared arcade:** Kenny "Khrollo" Badat placed the GitHub Pages play link prominently in the README heading.

Commits and contributors:

- [d591ce3](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/d591ce30dadf28608ae2ac1eff02443808b41fbb) — Kenny "Khrollo" Badat: Update README.md

## 1.0.0 — The original arcade (2026-09-17)

INITIAL · reconstructed historical release

- **Shared arcade:** Kenny "Khrollo" Badat created the repository, wrote and formatted the README, and uploaded the original two-game arcade.
- **Chaturaji:** Four-army dice play, CPU opponents, king-capture scoring, pawn resurrection, themes, achievements, geomancy collectibles and local session history.
- **Enochian:** Local Red/Yellow versus Blue/Black teams, CPU play, frozen captured armies, piece-bound promotion, move history and fast-forward after elimination.
- **Shared arcade:** One launcher with cross-game statistics, retro artwork and sound, plus both games’ original playing and history guides.

Commits and contributors:

- [2858d56](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/2858d56c4fcfafe9428014551828b08a8d462a63) — Kenny "Khrollo" Badat: Initial commit
- [34891df](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/34891df7de5e2aa2757a75a49b8cdd6ce1ee918b) — Kenny "Khrollo" Badat: Update README.md
- [687ee72](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/687ee72d56061576efa2a464b813d07abd686968) — Kenny "Khrollo" Badat: Update README.md
- [a7023f4](https://github.com/khrollo963/Chess-Eternal-Blitz-/commit/a7023f48b23acda229980bb5f95eff5661d1a560) — Kenny "Khrollo" Badat: Add files via upload
