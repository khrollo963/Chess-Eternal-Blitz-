# Task 1 regression evidence

The Task 1 checkpoint deliberately has failing regressions. Run:

```text
node --test tests/enochian-ai.test.mjs tests/enochian-lifecycle.test.mjs
node scripts/check-client-preservation.mjs
```

On the original engine and the unchanged extracted page, 4 controls pass and
28 assertions fail. Each source exhibits the same 14 failing cases: four AI
difficulties return `null` for a fixture with two legal moves; pawn-risk and
typed-pawn-capture scores are non-finite; an enemy king capture scores below a
quiet move; the simulated captured army remains active; repeated scheduling
queues duplicate jobs; and obsolete callbacks advance games after reset,
internal menu, reopening, outer menu, and outer-menu reopening.

Controls confirm that an actual king capture freezes its army, retaining its
other pieces, and that a visible CPU turn executes once at the existing delay.
The immutable original is read from the baseline Git commit, not from an
editable copy of the rules. Score and attack probes observe the original
algorithm; each source observation anchor must match exactly once.

## Real relative-src browser reproduction

Start `node tests/helpers/serve-enochian-browser-probe.mjs` and open its local
HTTP URL. Select Enochian, select **Prepare CPU lifecycle probe**, then return
to the outer menu. The test-only server appends diagnostics and stretches the
existing CPU timeout to four seconds; it leaves the callback logic unchanged.
No diagnostics are added to the canonical HTML pages or release artifacts.

Observed on 2026-10-02 in the real same-origin iframe:

| Observation | Pending CPU jobs | Executed callbacks | Move count | Turn index | Launcher visible |
| --- | ---: | ---: | ---: | ---: | --- |
| Prepared | 2 | 0 | 0 | 0 | true |
| Outer menu | 2 | 0 | 0 | 0 | false |
| After timeouts | 0 | 3 | 2 | 2 | false |

The hidden iframe advanced from Red through Blue to Yellow. Reopening showed
both accepted moves on the retained board. **Stop lifecycle probe** cleared
the test jobs and returned to the internal menu.

Task 3 turns the current-page assertions green while retaining positive
historical characterization of the immutable original defects. To rerun the
original failing assertions, set `ENOCHIAN_ORIGINAL_DIAGNOSTIC=1` and run the
same two test files. That diagnostic intentionally has 14 original-source
failures; the default regression suite is green. Task 14 must repeat visibility
verification against the optional generated srcdoc export.

## Task 3 real-browser correction

The same relative-src HTTP probe now reports one pending CPU job after two
scheduling requests. Returning to the outer menu immediately removes that
job. After its original deadline, callbacks, moves and turn remain at zero
while the launcher wrapper is hidden. Reopening the retained iframe schedules
one fresh job with no immediate move. This uses the actual Enochian-side
visibility observer and the unchanged launcher.

The fresh chain then executes exactly Red and Blue once each and stops at the
Yellow human turn (two callbacks, two accepted moves). A second preparation
followed by the game's internal **Main Menu** cancels its job immediately;
after the stretched deadline there is no additional callback or move, and the
actual game area has `display: none`. Starting again queues one fresh job and
again advances exactly twice to Yellow. The probe's synchronous cancellation
report can precede the internal menu's final style change, so that visibility
assertion uses the rendered menu and DOM style rather than the stale report.
