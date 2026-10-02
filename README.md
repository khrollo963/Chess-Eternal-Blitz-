<div align="center">

<h1><a href="https://khrollo963.github.io/Chess-Eternal-Blitz-/">⚔️ Chess Eternal: Four Kings &amp; Golden Dawn — PLAY HERE ⚡</a></h1>

<a href="https://khrollo963.github.io/Chess-Eternal-Blitz-/"><img src="readme-hero-v2.png" alt="Wide Chess Eternal arcade scene with Chaturaji and Enochian Chess side by side, including a green stag banner" width="920" /></a>

**Two forgotten chess variants. One pixel-perfect arcade cabinet. Zero dependencies.**

[![Play online](https://img.shields.io/badge/PLAY-ONLINE-ff9d00?style=for-the-badge)](https://khrollo963.github.io/Chess-Eternal-Blitz-/)
![HTML](https://img.shields.io/badge/HTML-three%20pages-e34f26?style=flat-square&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS-retro%20arcade-1572b6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-f7df1e?style=flat-square&logo=javascript&logoColor=black)
![Dependencies](https://img.shields.io/badge/dependencies-zero-5bca81?style=flat-square)

[Quick start](#-quick-start) · [What's inside](#-whats-inside) · [Why it's fun](#-why-its-fun) · [Built with](#-built-with) · [Credits](#-credits)

</div>

---

## 💡 What is this?

Three readable HTML pages that resurrect two of history's strangest chess offshoots — a dice-driven four-king battle royale and a Victorian occult team variant — and skins them both in glowing, scanline-soaked retro-arcade style. No installs, no build step, no backend. Serve the pages over HTTP and you're playing.

## 📋 Table of contents

- [Quick start](#-quick-start)
- [What's inside](#-whats-inside)
  - [Chaturaji — Four Kings Arcade](#-chaturaji--four-kings-arcade)
  - [Enochian Chess — 2v2 Mystical Warfare](#-enochian-chess--2v2-mystical-warfare)
  - [One shared launcher](#-one-shared-launcher)
- [Why it's fun](#-why-its-fun)
- [Built with](#-built-with)
- [Credits](#-credits)
- [License](#-license)

## 🚀 Quick start

**[Play Chess Eternal in your browser](https://khrollo963.github.io/Chess-Eternal-Blitz-/)** on desktop or mobile. For a local preview, serve the repository root with a static HTTP server and open its `index.html` URL. Keep all three pages on the same origin so the games can share the launcher's navigation and statistics bridge. There are no project dependencies to install.

The source is now three pages: [`index.html`](index.html) is the launcher, [`chaturaji.html`](chaturaji.html) is Four Kings Arcade, and [`enochian.html`](enochian.html) is Golden Dawn Chess. The launcher loads each game once and keeps it mounted when you return to the menu or switch games. The source `index.html` is no longer self-contained; opening it alone or through `file://` is not the supported preview path.

For a portable ZIP, put `index.html`, `chaturaji.html`, and `enochian.html` together at the ZIP root. Extract them together and serve that folder over HTTP. Inline game artwork remains embedded in its game page; the README images are optional for play. A generated single-HTML export is planned for Task 14 and is not implemented yet.

To check this migration with an existing Node.js installation, run `node --test tests/client-layout.test.mjs` and `node scripts/check-client-preservation.mjs`. `node scripts/extract-game-pages.mjs` retrieves the original game payloads from the recorded Git revision; it is safe to rerun on identical pages and refuses to overwrite edited game source.

---

## 🕹️ What's Inside

### 🎲 CHATURAJI — Four Kings Arcade
The ancient four-player ancestor of chess, dice and all.

- **4 armies, 1 board, dice-driven turns** — roll two four-sided dice and move whatever piece they call
- **Free-for-all survival** — no check, no checkmate, just outright capture; last king standing wins
- **Scoring & king-fall bonuses** — wipe out a kingdom and scoop every point still on it
- **Pawn resurrection** — march a pawn to the far edge and call a fallen Elephant, Horse, or Boat back into the fight
- **4 CPU difficulty tiers**, from *Easy* to *Grand Master*
- **Geomancy collectibles** — every finished game casts one of 16 classical geomantic figures based on the final standings
- **Achievements, session history, swappable board & piece themes** (Classic, Poker, Kamea, Mystical, Egyptian Gods, Hebrew Letters, and more)

### ⚡ ENOCHIAN CHESS — 2v2 Mystical Warfare
Chess reimagined by 19th-century occultists — now a genuine team game.

- **True 2v2 teams** — Red & Yellow vs. Blue & Black, zero friendly fire, your CPU teammate fights *with* you
- **King capture ≠ elimination** — a fallen king freezes their whole army in place as living obstacles, not empty squares
- **Faithful fairy-chess movement** — the Queen leaps like a true Alibaba, pawns are permanently bound to the piece behind them and can only be promoted once that piece has fallen
- **Chunky 8-bit piece sprites**, a live move log, hover/tap tooltips for every piece, and a full game-over screen
- **Fast-forward mode** once you're eliminated, so you're never stuck watching the CPUs play it out at normal speed

### 🌐 One Shared Launcher
A single retro arcade menu ties both games together, complete with a **Cross-Game Statistics** dashboard tracking your total games, wins, win rate, and geomantic figures cast — across both titles, in one place.

---

## ✨ Why It's Fun

- 🎨 **Pixel-art, CRT-scanline aesthetic** throughout — this isn't a spreadsheet with chess rules bolted on, it *feels* like a cabinet you'd find in an arcade's forgotten back corner
- 🧠 **Smart, tunable AI** on every difficulty, so solo play never feels like a coin flip
- 🔊 **Full retro sound design** — chiptune blips for every move, capture, promotion, and king-fall
- 📱 **Responsive** — plays on desktop and mobile alike
- 🏆 **Persistent progress** — achievements, collectibles, and session history are saved locally, no account required
- 🥚 A few secrets are tucked away for the curious

---

## 🛠️ Built With

Just the essentials — **HTML, CSS, and vanilla JavaScript**. No frameworks, no package manager, no build pipeline. The entire experience — two full games, an AI opponent for each, sound synthesis, and a shared stats system — lives in three readable HTML pages, with the original inline artwork retained.

---

## 🙏 Credits

Built by **Uthman Ken**, writing and publishing as **Mufti Khrollo**.

Rules and history adapted from Al-Biruni's 11th-century account of Chaturaji, H.J.R. Murray's *A History of Chess*, Golden Dawn source material, Chris Zalewski's reconstructions, and Israel Regardie's writings. All code, pixel art, and sound are original to this project.

**Support the project:**
- 📝 [Substack](https://muftikhrollo.substack.com)
- 🎵 [TikTok](https://www.tiktok.com/@thegnosticmuslim)
- 📸 [Instagram](https://www.instagram.com/khrollo963)
- 💻 [GitHub](https://github.com/khrollo963)
- 📚 [Books on Amazon](https://www.amazon.com/Kabbalistic-Sufism-Synthesis-Hermetic-mysticism-ebook/dp/B0F6VWBY94)
- ☕ [Donate (PayPal)](https://paypal.me/everythingken)

---

## 📜 License

All code, artwork, and sound in this project are original and © their creator. If you'd like to use, remix, or build on this project commercially, please reach out via the links above.

---

*Four kingdoms. Two teams. One board, over and over again. Roll the dice, walk with the mystics, and see who's still standing.*
