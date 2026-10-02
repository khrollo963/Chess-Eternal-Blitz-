import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/enochian-harness.mjs';

function startCpuGame(options) {
  const h = createHarness(options);
  h.run("game.playerColor = 'B'; game.difficulty = 'hard'; startGame()");
  assert.equal(h.clock.jobs.size, 1, 'Starting on a CPU turn must schedule one job');
  return h;
}

test('configuration changes cancel and replace the job at a fresh deadline', () => {
  const h = startCpuGame();
  h.clock.tick(1000);
  const button = h.ui.element('difficulty-hard'); button.dataset.diff = 'grandmaster';
  h.ui.element('difficultyPicker').dispatchEvent({type:'click',target:{closest:()=>button}});
  assert.equal(h.snapshot().difficulty,'grandmaster');
  assert.equal(h.clock.jobs.size,1);
  h.clock.tick(400); assert.equal(h.snapshot().moveCount,0);
  h.clock.tick(1000); assert.equal(h.snapshot().moveCount,1);
});

test('changing the human seat or entering hotseat cancels pending CPU control', () => {
  for(const color of ['R','B']){
    const h = startCpuGame();
    const button = h.ui.element('color-choice'); button.dataset.color = color;
    h.ui.element('colorPicker').dispatchEvent({type:'click',target:{closest:()=>button}});
    assert.equal(h.clock.jobs.size,0);
    const before = h.snapshot(); h.clock.tick(1400); assert.deepEqual(h.snapshot(),before);
  }
});

test('terminal outcome cancels pending CPU work immediately', () => {
  const h = startCpuGame();
  h.run('game.alive.B = false; game.alive.K = false; checkWin()');
  assert.equal(h.snapshot().over,true);
  assert.equal(h.clock.jobs.size,0);
  const before = h.snapshot(); h.clock.tick(1400); assert.deepEqual(h.snapshot(),before);
});

test('saved obsolete callbacks cannot bypass generation and job identity', () => {
  const h = startCpuGame();
  const old = [...h.clock.jobs.values()][0].fn;
  h.run('resetGame()'); const before = h.snapshot();
  old(); old();
  assert.deepEqual(h.snapshot(),before);
  assert.equal(h.clock.jobs.size,1);
});

test('CPU callback rejects changed configuration, turn and move revision', () => {
  for(const change of ["game.difficulty = 'easy'", "game.playerColor = 'R'", 'game.turnIndex = 2', 'game.moveCount += 4']){
    const h = startCpuGame(); h.run(change);
    const before = h.snapshot(); h.clock.tick(1400);
    assert.deepEqual(h.snapshot(),before,change);
    assert.equal(h.clock.jobs.size,0);
  }
});

test('fast-forward replaces the existing job with the 200ms deadline', () => {
  const h = startCpuGame(); h.clock.tick(1000);
  h.ui.element('speedToggleBtn').dispatchEvent({type:'click'});
  assert.equal(h.clock.jobs.size,1);
  h.clock.tick(199); assert.equal(h.snapshot().moveCount,0);
  h.clock.tick(1); assert.equal(h.snapshot().moveCount,1);
  h.clock.tick(200); assert.equal(h.snapshot().moveCount,1);
});

for(const parent of [false,true]) test(`${parent ? 'parent' : 'game'} document hiding pauses and resumes with a fresh deadline`, () => {
  const h = startCpuGame({launched:parent}); h.clock.tick(1000);
  const doc = parent ? h.launcher.document : h.ui.document;
  doc.hidden = true; doc.dispatchEvent({type:'visibilitychange'});
  assert.equal(h.clock.jobs.size,0);
  const before = h.snapshot(); h.clock.tick(10000); assert.deepEqual(h.snapshot(),before);
  doc.hidden = false; doc.dispatchEvent({type:'visibilitychange'});
  assert.equal(h.clock.jobs.size,1);
  h.clock.tick(1399); assert.deepEqual(h.snapshot(),before);
  h.clock.tick(1); assert.equal(h.snapshot().moveCount,1);
});

test('parent mutations are delivered through the observer and teardown disconnects it', () => {
  const h = startCpuGame({launched:true});
  assert.equal(h.mutations.activeCount,1);
  h.launcher.wrapper.style.display = 'none';
  assert.equal(h.clock.jobs.size,1,'Mutation delivery is asynchronous');
  h.mutations.flush(); assert.equal(h.clock.jobs.size,0);
  h.launcher.wrapper.style.display = 'block'; h.mutations.flush(); assert.equal(h.clock.jobs.size,1);
  h.run("window.dispatchEvent({type:'pagehide'})");
  assert.equal(h.mutations.activeCount,0); assert.equal(h.clock.jobs.size,0);
  h.clock.tick(1400); assert.equal(h.snapshot().moveCount,0);
  h.run("window.dispatchEvent({type:'pageshow'})");
  assert.equal(h.mutations.activeCount,1); assert.equal(h.clock.jobs.size,1);
});

test('immutable original still queues duplicate jobs and moves behind its menu', () => {
  const h = startCpuGame({version:'original'});
  h.run('maybeRunCpuTurn()'); assert.equal(h.clock.jobs.size,2);
  h.run('backToMainMenu()'); h.clock.tick(1400);
  assert.equal(h.snapshot().moveCount,1);
});

for (const version of process.env.ENOCHIAN_ORIGINAL_DIAGNOSTIC ? ['current', 'original'] : ['current']) {
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
