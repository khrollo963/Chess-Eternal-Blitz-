import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/enochian-harness.mjs';
import { typedPawnTrap, kingCapture, typedPawnCapture } from './fixtures/enochian-ai.mjs';

for (const version of ['current', 'original']) {
  for (const difficulty of ['easy', 'medium', 'hard', 'grandmaster']) {
    test(`${version}: ${difficulty} AI returns a legal move when typed pawns can move`, () => {
      const h = createHarness({ version });
      h.setState(typedPawnTrap);
      const legal = h.legalMoves('R');
      assert.equal(legal.length, 2, 'Fixture must have the two audited legal pawn moves');
      const before = h.snapshot();
      const move = h.choose('R', difficulty);
      assert.deepEqual(h.snapshot(), before, 'AI search must not mutate live state');
      assert.ok(legal.some(candidate => JSON.stringify(candidate) === JSON.stringify(move)), `Expected an existing legal move, received ${JSON.stringify(move)}`);
    });
  }

  for (const [label, board] of [['pawn risk', typedPawnTrap], ['typed-pawn capture', typedPawnCapture]]) {
    test(`${version}: every evaluated ${label} score is finite`, () => {
      const h = createHarness({ version, observeAI: true });
      h.setState(board);
      h.choose();
      assert.equal(h.scores.length, h.legalMoves('R').length, 'Observe every real candidate score');
      assert.ok(h.scores.every(({ score }) => Number.isFinite(score)), `Non-finite candidate scores: ${h.scores.map(({ score }) => String(score)).join(', ')}`);
    });
  }

  test(`${version}: live king capture freezes the captured army and keeps its pieces`, () => {
    const h = createHarness({ version });
    h.setState(kingCapture);
    h.run('makeMove(4,4,4,5)');
    assert.equal(h.snapshot().alive.B, false);
    assert.deepEqual(h.snapshot().board['3,5'], { color: 'B', type: 'ROOK' });
    assert.deepEqual(h.legalMoves('B'), [], 'Frozen B army must not move');
    assert.equal(h.snapshot().alive.R, true);
  });

  test(`${version}: capturing an enemy king is valued above a quiet move`, () => {
    const h = createHarness({ version, observeAI: true });
    h.setState({ '4,4': kingCapture['4,4'], '4,5': kingCapture['4,5'] });
    h.choose();
    const capture = h.scores.find(({ move }) => move.tr === 4 && move.tc === 5);
    const quiet = h.scores.filter(({ move }) => !(move.tr === 4 && move.tc === 5));
    assert.ok(capture, 'King capture must be an evaluated legal candidate');
    assert.ok(capture.score > Math.max(...quiet.map(({ score }) => score)), `King capture scored ${capture.score}; a quiet move scored ${Math.max(...quiet.map(({ score }) => score))}`);
  });

  test(`${version}: simulated king capture freezes only its army without mutating live state`, () => {
    const h = createHarness({ version, observeAI: true });
    h.setState(kingCapture);
    const before = h.snapshot();
    h.choose();
    assert.deepEqual(h.snapshot(), before, 'Search must preserve the live board and alive flags');
    const successor = h.successors.find(({ board }) => board['4,5']?.color === 'R' && !board['4,4']);
    assert.ok(successor, 'Observe the actual cloned-board king-capture candidate');
    assert.equal(successor.alive.B, false, 'Captured king army must be frozen in the simulated successor');
    assert.deepEqual({ R: successor.alive.R, Y: successor.alive.Y, K: successor.alive.K }, { R: true, Y: true, K: true });
    assert.equal(successor.attacked, false, 'The frozen B rook cannot attack the capturing rook');
  });
}
