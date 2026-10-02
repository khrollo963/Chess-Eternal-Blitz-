import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/enochian-harness.mjs';
import { typedPawnTrap, kingCapture, typedPawnCapture, kingOrMaterial, exposedKing, promotion } from './fixtures/enochian-ai.mjs';

// Set ENOCHIAN_ORIGINAL_DIAGNOSTIC=1 to replay Task 1's unchanged failing
// assertions against the immutable original, alongside repaired current tests.
for (const version of process.env.ENOCHIAN_ORIGINAL_DIAGNOSTIC ? ['current', 'original'] : ['current']) {
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

function seeded(h, seed = 73272346){
  h.run(`let aiTestSeed = ${seed}; Math.random = () => { aiTestSeed = (Math.imul(aiTestSeed,1664525) + 1013904223) >>> 0; return aiTestSeed / 4294967296; }`);
}

test('every typed pawn has finite capture and risk evaluation', () => {
  for(const type of ['PAWN_ROOK','PAWN_QUEEN','PAWN_BISHOP','PAWN_KNIGHT']){
    const h = createHarness({observeAI:true}); seeded(h);
    h.setState({ ...typedPawnTrap, '4,4':{color:'R',type}, '3,5':{color:'B',type} });
    assert.ok(h.choose());
    assert.equal(h.scores.length,h.legalMoves('R').length);
    assert.ok(h.scores.every(s => Number.isFinite(s.score)),type);
  }
});

test('king freeze is preferred to ordinary enemy queen material', () => {
  const h = createHarness({observeAI:true}); seeded(h);
  h.setState(kingOrMaterial);
  assert.deepEqual(h.choose(),{fr:4,fc:4,tr:4,tc:5});
  const king = h.scores.find(s => s.move.tc === 5 && s.move.tr === 4);
  const queen = h.scores.find(s => s.move.tc === 3 && s.move.tr === 4);
  assert.ok(king.score > queen.score);
});

test('AI avoids a legal king capture that exposes its whole army', () => {
  const h = createHarness({observeAI:true}); seeded(h);
  h.setState(exposedKing);
  const risky = {fr:4,fc:4,tr:3,tc:4};
  assert.ok(h.legalMoves('R').some(m => JSON.stringify(m) === JSON.stringify(risky)));
  const move = h.choose();
  assert.notDeepEqual(move,risky);
  const candidate = h.successors[h.scores.findIndex(s => JSON.stringify(s.move) === JSON.stringify(risky))];
  h.setState(candidate.board,candidate.state);
  h.run('makeMove(3,0,3,4)');
  assert.equal(h.snapshot().alive.R,false);
  assert.deepEqual(h.snapshot().board['6,7'],{color:'R',type:'ROOK'});
});

test('immediate team victory wins despite attack geometry', () => {
  const h = createHarness({observeAI:true}); seeded(h);
  h.setState(kingOrMaterial,{alive:{R:true,Y:true,B:true,K:false}});
  assert.deepEqual(h.choose(),{fr:4,fc:4,tr:4,tc:5});
  const win = h.successors.find(s => s.state.over);
  assert.ok(win);
  assert.equal(win.alive.B,false);
});

test('search uses actual promotion and next-turn consequences', () => {
  const h = createHarness({observeAI:true}); seeded(h);
  h.setState(promotion);
  const before = h.snapshot();
  h.choose();
  const next = h.successors.find(s => s.board['0,4']);
  assert.equal(next.board['0,4'].type,'ROOK');
  assert.equal(next.state.moveCount,1);
  assert.equal(next.state.turnIndex,1);
  assert.deepEqual(h.snapshot(),before);
});

test('all difficulty budgets guarantee a legal fallback and seeded reproducibility', () => {
  for(const difficulty of ['easy','medium','hard','grandmaster']){
    for(const maxNodes of [0,1]){
      const h = createHarness({observeAI:true}); seeded(h);
      h.setState(kingOrMaterial);
      const before = h.snapshot(), move = h.choose('R',difficulty,{maxNodes});
      assert.ok(h.legalMoves('R').some(m => JSON.stringify(m) === JSON.stringify(move)));
      assert.equal(h.scores.length,maxNodes);
      assert.deepEqual(h.snapshot(),before);
    }
    const a = createHarness(), b = createHarness(); seeded(a); seeded(b);
    a.setState(exposedKing); b.setState(exposedKing);
    assert.deepEqual(a.choose('R',difficulty),b.choose('R',difficulty));
  }
});

test('immutable original retains the typed-pawn and king simulation defects', () => {
  const h = createHarness({version:'original',observeAI:true});
  h.setState(typedPawnTrap);
  assert.equal(h.choose(),null);
  assert.ok(h.scores.some(s => !Number.isFinite(s.score)));
  h.setState(kingCapture); h.successors.length = 0; h.choose();
  const next = h.successors.find(s => s.board['4,5']?.color === 'R' && !s.board['4,4']);
  assert.equal(next.alive.B,true);
  assert.equal(next.attacked,true);
});
