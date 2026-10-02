import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/enochian-harness.mjs';

function startCpuGame(options) {
  const h = createHarness(options);
  h.run("game.playerColor = 'B'; game.difficulty = 'hard'; startGame()");
  assert.equal(h.clock.jobs.size, 1, 'Starting on a CPU turn must schedule one job');
  return h;
}

for (const version of ['current', 'original']) {
  test(`${version}: one visible CPU job executes once at the real delay`, () => {
    const h = startCpuGame({ version });
    h.clock.tick(1399);
    assert.equal(h.snapshot().moveCount, 0);
    h.clock.tick(1);
    assert.equal(h.snapshot().moveCount, 1);
    assert.equal(h.snapshot().turnIndex, 1, 'Blue human follows Red CPU');
    assert.equal(h.clock.jobs.size, 0);
  });

  test(`${version}: repeated CPU scheduling keeps one pending job`, () => {
    const h = startCpuGame({ version });
    h.run('maybeRunCpuTurn(); maybeRunCpuTurn()');
    assert.equal(h.clock.jobs.size, 1, 'Repeated scheduling must not queue duplicate CPU callbacks');
  });

  test(`${version}: a previous game callback cannot advance a reset game`, () => {
    const h = startCpuGame({ version });
    h.clock.tick(1000);
    h.run('resetGame()');
    const reset = h.snapshot();
    h.clock.tick(400); // Old callback deadline; fresh game's job is due at 2400.
    assert.deepEqual(h.snapshot(), reset, 'Obsolete callback moved the freshly reset board before its own deadline');
    assert.equal(h.clock.jobs.size, 1, 'Only the fresh game job should remain');
    h.clock.tick(1000);
    assert.equal(h.snapshot().moveCount, 1, 'Fresh CPU job should still execute once');
  });

  test(`${version}: returning to the internal menu prevents hidden CPU moves`, () => {
    const h = startCpuGame({ version });
    h.run('backToMainMenu()');
    assert.equal(h.ui.element('gamePlayArea').style.display, 'none', 'Exercise the actual menu action');
    const hidden = h.snapshot();
    h.clock.tick(1400);
    assert.deepEqual(h.snapshot(), hidden, 'CPU callback mutated the game behind its internal menu');
    assert.equal(h.clock.jobs.size, 0, 'Internal menu must leave no CPU job');
  });

  test(`${version}: reopening after internal menu cannot revive an obsolete callback`, () => {
    const h = startCpuGame({ version });
    h.clock.tick(1000);
    h.run('backToMainMenu(); startGame()');
    const reopened = h.snapshot();
    h.clock.tick(400);
    assert.deepEqual(h.snapshot(), reopened, 'A callback from before the menu mutated the reopened game');
    assert.equal(h.clock.jobs.size, 1, 'Reopened game must have just its fresh job');
  });

  test(`${version}: the actual outer launcher menu prevents hidden CPU moves`, () => {
    const h = startCpuGame({ version, launched: true });
    h.launcher.hide();
    assert.equal(h.launcher.wrapper.classList.contains('active'), false, 'Exercise real launcher visibility');
    const hidden = h.snapshot();
    h.clock.tick(1400);
    assert.deepEqual(h.snapshot(), hidden, 'CPU callback mutated the hidden launcher frame');
    assert.equal(h.clock.jobs.size, 0, 'Hidden launcher frame must have no CPU job');
  });

  test(`${version}: launcher reopening schedules one fresh job without an old deadline mutation`, () => {
    const h = startCpuGame({ version, launched: true });
    h.clock.tick(1000);
    h.launcher.hide(); h.launcher.reopen();
    assert.equal(h.launcher.wrapper.classList.contains('active'), true);
    const reopened = h.snapshot();
    h.clock.tick(400);
    assert.deepEqual(h.snapshot(), reopened, 'Pre-hide callback mutated the reopened frame at its obsolete deadline');
    assert.equal(h.clock.jobs.size, 1, 'Reopened launcher frame must schedule exactly one fresh job');
    h.clock.tick(1000);
    assert.equal(h.snapshot().moveCount, 1, 'Fresh callback should move exactly once after reopening');
  });
}
