# Enochian executable-rule audit

Date: 2026-10-02. Historical read-only investigation completed; no gameplay changes were made by this audit. Subsequent implementation and approved G4 exchange policy are recorded in the [execution ledger](../plans/2026-10-02-enochian-execution-ledger.md). Preserve these original probes as baseline evidence, not current implementation status.

## Scope and evidence

The user has chosen to preserve executable Enochian mechanics and document historical gaps. Chaturaji is explicitly excluded from changes. Multiplayer prisoner exchange is the only approved new board-affecting feature; its detailed G4 placement/consent policy was subsequently approved and implemented. Final end-only review remains pending as recorded in the ledger.

At the audit snapshot the repository contained a launcher in `index.html` and two Base64-encoded HTML games. Enochian was decoded into an iframe through `loadEnochianGame`. The graph index recorded the outer HTML but not embedded JavaScript relationships; live decoded source was inspected instead. No graph sync was performed. Source offsets below refer to that decoded Enochian HTML, not current source line numbers. Task 0 subsequently extracted readable pages losslessly.

Fourteen focused Node VM probes were run against the actual embedded script. Rendering, sound and persistence were stubbed for engine probes; the repository file was never modified. These probes verify current behavior, including historical gaps; they are not fourteen claims of historical compliance.

## Working core

| Feature | Executable evidence | Finding |
| --- | --- | --- |
| Four armies with five major pieces and four typed pawns each | `setupBoard`, decoded lines 796–817 | Implemented: 36 pieces total. |
| Fixed diagonal alliances | `TEAM`, line 743; `isEnemyColor`, 757 | Red/Yellow versus Blue/Black. |
| Queen's two-square orthogonal/diagonal leap | `getLegalMoves`, 1029–1048 | Implemented; jumps over blockers. |
| King, rook, bishop and knight movement | Same switch and `slideMoves`/`stepMoves`, 973–1007 | Implemented geometric movement. King safety restrictions are a separate gap below. |
| Directional pawns, single forward step, diagonal captures | `FORWARD`, 736–741; `pawnMoves`, 1010–1027 | Implemented; no initial double-step. |
| Ordinary friendly capture prohibition | `canCapture`, 764–766 | Implemented. Historical exceptions are absent. |
| Captured king freezes its army | `makeMove`, 1338–1343; `eliminate`, 1162–1166 | Implemented: pieces stay in place. |
| Frozen armies cannot move, attack or be captured | `getLegalMoves`, 1033; `canCapture`, 765 | Implemented; they block sliding moves. The contrary comment in `eliminate` is stale, not the executable behavior. |
| Victory when both enemy kings have fallen | `teamAlive`, 1168–1170; `checkWin`, 1236–1263 | Implemented through alive flags and fixed teams. |
| Separate color turns and skipping frozen/immobile armies | `TURN_ORDER`, 734; `advanceTurn`, 1145–1152 | Implemented geometrical-move skipping, not historical check-based stalemate. |
| Promotion tied to a pawn's starting major piece | `makeMove`, 1354–1366 | Implemented with a different eligibility condition, described below. |
| Single-player CPU and local four-color hotseat | `isColorCpu`, 1078; `onBoardClick`, 1421 | Implemented; no separate-device room support. |

## Partial, different, or documentation-only behavior

| Item | Source reference | Current executable behavior | Planning treatment |
| --- | --- | --- | --- |
| Throne setup and occupancy | Zalewski rules 1–2, 7; Rients Setup | `isOnBoard` adds four extra throne cells outside the 8×8 grid. `setupBoard` stores one piece per key, with kings on those extra cells. No double occupancy. | Preserve geometry and setup. Do not move kings to ordinary corner squares as a side effect of networking. |
| Alternative arrays and starting procedure | Zalewski rules 2, 4; Rients appendices | One fixed setup, fixed Red start and fixed color sequence. | Preserve. Zalewski allows direction selection before play, so counterclockwise is not by itself proof of an error. |
| Check handling | Zalewski rules 8.1, 8.6 | `getLegalMoves` has no check obligation or safety filter. A king can enter attack from an unchecked position; other pieces can move while its king is attacked. | Preserve legal move set; AI may prefer safety without banning moves. |
| Pawn promotion eligibility | Zalewski rule 10.1; Rients Pieces | Promotion depends on absence of the backing major-piece type, not prior pawn loss. A four-pawn army can promote if that backing piece is missing; losing a pawn does not unlock promotion while the backing piece remains. | Preserve existing eligibility and edge handling. |
| Privileged pawns and demotion | Zalewski rule 10.3 | No implementation in the script. | Documentation-only; outside implementation scope. |
| Bishop/queen concourses | Zalewski rules 5.10–5.11; Rients concourse sections | No concourse state or capture resolution. A legal move completing the central bishop square leaves all other bishops in place. | Do not introduce concourses. Sources also disagree on the allied piece's treatment. |
| Throne seizure and allied control | Zalewski rules 7.7, 8.9, 11.3 | No army-owner mapping or control transfer. Team-friendly occupancy blocks ordinary moves. | Outside scope; multiplayer player identity must not accidentally implement this rule. |
| Prisoner exchange | Zalewski rule 8.5; Rients Exchange of Prisoners | At audit time, rules-tab text existed but no proposal, captor ledger, king restoration or thaw operation. | Multiplayer-only human negotiation subsequently implemented under G4. AI/single-player captor behavior stays deferred; no issue publication authorized. |
| Bare-king draw | Zalewski rule 8.10; Rients Bare King | `checkWin` tests team alive flags only. Four bare kings are not declared a draw. | Document; do not add a draw rule without approval. |
| Historical stalemate and related draw | Zalewski rule 8.11 | No check-aware stalemate detection. `advanceTurn` merely skips geometrically immobile armies. | Document; do not disguise a new stalemate rule as an AI fix. |
| Voluntary withdrawal | Zalewski rule 9 | No withdrawal operation or teammate control transfer. | Disconnect bot policy is a separate online policy, not this historical rule. |

## AI defects and lifecycle risks

1. `PIECE_VALUE` at line 755 values `KING` at zero. Capturing or risking a king contributes zero to the current material score.
2. Typed pawns are named `PAWN_ROOK`, `PAWN_QUEEN`, etc., but the value table only defines `PAWN`. Direct lookups at lines 1100 and 1108 produce undefined values and `NaN` scores.
3. With deterministic randomness, a rook passed up a directly available enemy pawn capture and an enemy king capture. In another fixture a pawn had two legal moves but `aiSelectMove` returned null, causing the turn-flow caller to pass.
4. Simulations clone the board only; legal move generation and capture eligibility still read `game.alive`. Capturing a king in simulation does not freeze that color there, and simulated promotion is absent. This is an AI evaluation defect, not evidence that live king freezing is absent.
5. `maybeRunCpuTurn` does not retain or cancel its timeout. Repeated scheduling can create two pending callbacks; resets, Enochian menu return and launcher visibility changes need lifecycle guards. The old-color guard does not identify a new match.
6. Easy and Hard share the same risk multiplier; Hard/Grand Master mainly change small positional and random terms. Improve tiers only within the unchanged legal move set and with a bounded compute budget.

## Reproduction coverage

The fourteen probes checked: fixed alliances; queen leap over a blocker; friendly capture rejection; frozen movement/capture rejection; external throne locations; single piece occupancy; unsafe king move availability; non-king movement under check; absence of bare-king draw; live king capture freezing; absence of central bishop concourse; both promotion-condition discrepancies; and AI returning null despite legal moves.

A temporary investigative harness was saved outside the repository at `C:/Users/nucle/AppData/Local/Temp/chess-enochian-rules-audit.cjs`. During implementation, convert these observations into checked-in fixtures, separating behavior-preservation tests from intentionally failing AI regressions.

## Sources and evidence limits

- [Chris Zalewski, Enochian Chess of the Golden Dawn (1994), book scan](https://www.labirintoermetico.com/06Numerologia_Cabala/Zalewski-Enochian-Chess-of-the-Golden-Dawn.pdf): numbered gameplay rules, printed pages 87–100.
- [Jeff Rients, Chess Variant Pages: Enochian Chess](https://www.chessvariants.com/historic.dir/enochian.html): secondary playable reconstruction summary and historical bibliography; does not always reproduce the book precisely.
- [Golden Dawn Official Ritual, modern transcription attributed to Mathers](https://hermetic.com/_media/invisible-college/misc/enochess.txt): earlier movement and divinatory material, not a complete authenticated Victorian ruleset.
- [Regardie chess material, modern transcription](https://hermetic.com/_media/invisible-college/misc/chess.txt): historical equipment and incomplete practical knowledge.

The game meaningfully implements the reconstruction's core, but the existence of rules-tab paragraphs does not establish executable support. No missing historical rule is authorized for implementation by this audit.
