import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { root } from '../scripts/client-baseline.mjs';
import { createHarness } from './helpers/enochian-harness.mjs';
import { auditProbes, corpus } from './fixtures/enochian-parity.mjs';
import { engineBlock, generatedEngine } from '../scripts/extract-enochian-engine.mjs';
import { sha256 } from '../scripts/client-baseline.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
function domain(state) { return plain({ board: state.board, alive: state.alive, turnIndex: state.turnIndex, over: state.over, moveCount: state.moveCount }); }
const sorted = moves => plain(moves).sort((a,b) => a.fr-b.fr || a.fc-b.fc || a.tr-b.tr || a.tc-b.tc);

function engine() {
  const html = readFileSync(`${root}/enochian.html`, 'utf8');
  const match = html.match(/\/\/ ENOCHIAN_ENGINE_START\n([\s\S]*?)\/\/ ENOCHIAN_ENGINE_END/);
  assert.ok(match, 'The canonical engine has a marked DOM-free boundary');
  return vm.runInNewContext(`${match[1]}\nEnochianEngine;`);
}

test('canonical engine exposes immutable state transitions without browser globals', () => {
  const e = engine();
  for (const name of ['initialState', 'legalMoves', 'applyMove', 'chooseAiMove', 'outcome']) assert.equal(typeof e[name], 'function', name);
  const state = e.initialState();
  assert.equal(Object.keys(state.board).length, 36);
  for (const piece of Object.values(state.board)) Object.freeze(piece);
  Object.freeze(state.board); Object.freeze(state.alive); Object.freeze(state);
  const before = JSON.stringify(state);
  const move = e.legalMoves(state, { r: 6, c: 4 })[0];
  const result = e.applyMove(state, { fr: 6, fc: 4, tr: move.r, tc: move.c });
  assert.equal(JSON.stringify(state), before);
  assert.notEqual(result.state, state);
  assert.notEqual(result.state.board, state.board);
  assert.equal(result.state.moveCount, 1);
  assert.ok(result.events.some(event => event.type === 'turn'));
  assert.equal(e.advanceTurn(state), result.state.turnIndex, 'Turn helper is pure too');
  const candidate = e.chooseAiMove(state, 'R', 'hard', () => 0);
  assert.deepEqual(plain(e.chooseAiMove(state, 'R', 'hard', () => 0)), plain(candidate), 'Injected randomness is deterministic');
  assert.equal(JSON.stringify(state), before, 'AI and turn helpers preserve frozen input');
});

test('exported rule constants cannot change geometry, legal sets or team rules', () => {
  const e = engine(), state = e.initialState();
  const before = JSON.stringify(e.legalMoves(state, { r: 6, c: 4 }));
  assert.ok(Object.isFrozen(e.TURN_ORDER), 'Turn order is frozen');
  assert.ok(Object.isFrozen(e.TEAM), 'Team mapping is frozen');
  assert.ok(Object.isFrozen(e.FORWARD), 'Direction mapping is frozen');
  for (const direction of Object.values(e.FORWARD)) assert.ok(Object.isFrozen(direction), 'Nested directions are frozen');
  assert.equal(Reflect.set(e.FORWARD.R, '0', 1), false);
  assert.equal(Reflect.set(e.TURN_ORDER, '0', 'B'), false);
  assert.equal(Reflect.set(e.TEAM, 'R', 2), false);
  assert.equal(Reflect.set(e.FORWARD, 'R', [1, 0]), false);
  assert.equal(JSON.stringify(e.legalMoves(state, { r: 6, c: 4 })), before, 'Mutation attempts cannot alter legal sets for unchanged state');
  assert.equal(e.isEnemyColor('R','Y'), false);
  assert.equal(e.initialState().turnIndex, 0);
});

for (const [label, expression] of auditProbes) {
  test(`${label === 'Bare kings do not cause a draw' ? 'approved draw rule replaces baseline' : 'audit parity'}: ${label}`, () => {
    const harnesses = [];
    for (const version of ['original', 'current']) {
      const h = createHarness({ version });
      h.run(`function fresh(board){ Object.assign(game, {board, alive:{R:true,B:true,Y:true,K:true},turnIndex:0,over:false,playerColor:null,moveCount:0,moveLog:[]}); }`);
      assert.equal(h.run(expression), version !== 'current' || label !== 'Bare kings do not cause a draw', version);
      harnesses.push(h);
    }
    if(label === 'Bare kings do not cause a draw') {
      assert.equal(harnesses[1].snapshot().over,true,'The explicitly approved bare-kings rule ends this position');
      return;
    }
    const [original, current] = harnesses, state = domain(original.snapshot()), e = engine();
    assert.deepEqual(domain(current.snapshot()), state, 'Full audit state matches original');
    for (const color of ['R','B','Y','K']) assert.deepEqual(sorted(current.legalMoves(color)), sorted(original.legalMoves(color)), 'Full audit legal set');
    if (!state.over) for (const move of original.legalMoves(['R','B','Y','K'][state.turnIndex])) {
      original.setState(state.board, state);
      original.run(`makeMove(${move.fr},${move.fc},${move.tr},${move.tc})`);
      assert.deepEqual(domain(e.applyMove(state,move).state), domain(original.snapshot()), 'Full audit successor');
    }
  });
}

test(`original legal sets and full successors across ${corpus.count} reachable positions (seed ${corpus.seed})`, t => {
  const e = engine(), oracle = createHarness({ version: 'original' }), client = createHarness();
  oracle.run('Object.assign(game,{board:setupBoard(),alive:{Y:true,B:true,R:true,K:true},turnIndex:0,over:false,moveCount:0,moveLog:[]})');
  let state = domain(oracle.snapshot()), seed = corpus.seed, successors = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let position = 0; position < corpus.count; position++) {
    if (state.over) state = plain(e.initialState());
    oracle.setState(state.board, state);
    client.setState(state.board, state);
    for (const color of ['R','B','Y','K']) {
      const expected = sorted(oracle.legalMoves(color));
      const actual = sorted(Object.entries(state.board).flatMap(([k,p]) => {
        if (p.color !== color) return [];
        const [fr,fc] = k.split(',').map(Number);
        return e.legalMoves(state, k).map(m => ({fr,fc,tr:m.r,tc:m.c}));
      }));
      assert.deepEqual(actual, expected, `Position ${position}: ${color} legal set`);
      assert.deepEqual(sorted(client.legalMoves(color)), expected, `Position ${position}: UI legal adapter`);
    }
    const moves = sorted(oracle.legalMoves(['R','B','Y','K'][state.turnIndex]));
    assert.ok(moves.length, `Reachable position ${position} has a legal move`);
    for (const move of moves) {
      oracle.setState(state.board, state);
      client.setState(state.board, state);
      const before = JSON.stringify(state);
      const result = e.applyMove(state, move);
      oracle.run(`makeMove(${move.fr},${move.fc},${move.tr},${move.tc})`);
      client.run(`makeMove(${move.fr},${move.fc},${move.tr},${move.tc})`);
      assert.equal(JSON.stringify(state), before, 'Every candidate preserves its input');
      assert.deepEqual(domain(result.state), domain(oracle.snapshot()), `Position ${position} successor ${JSON.stringify(move)}`);
      assert.deepEqual(domain(client.snapshot()), domain(oracle.snapshot()), 'UI uses the same transition');
      assert.deepEqual(client.snapshot().moveLog, oracle.snapshot().moveLog, 'Move narration remains unchanged');
      successors++;
    }
    state = plain(e.applyMove(state, moves[Math.floor(random() * moves.length)]).state);
  }
  assert.ok(successors >= corpus.count, 'Compared all legal successors, not only selected trajectories');
  t.diagnostic(`${corpus.count} positions, ${successors} full legal successors, seed ${corpus.seed}, original ${corpus.baselineRevision}`);
});

test('terminal capture, promotion, frozen blocking and turn skips have full original successor parity', () => {
  const e = engine(), original = createHarness({ version: 'original' });
  const scenarios = [
    { board: {'4,4':{color:'R',type:'ROOK'},'4,5':{color:'B',type:'KING'},'1,1':{color:'B',type:'ROOK'}}, alive:{R:true,Y:true,B:true,K:false}, move:{fr:4,fc:4,tr:4,tc:5} },
    { board: {'1,2':{color:'R',type:'PAWN_ROOK'},'4,4':{color:'B',type:'ROOK'}}, move:{fr:1,fc:2,tr:0,tc:2} },
    { board: {'1,2':{color:'R',type:'PAWN_ROOK'},'7,4':{color:'R',type:'ROOK'},'4,4':{color:'B',type:'ROOK'}}, move:{fr:1,fc:2,tr:0,tc:2} },
    { board: {'4,4':{color:'R',type:'ROOK'},'0,0':{color:'B',type:'PAWN_ROOK'},'2,2':{color:'Y',type:'KNIGHT'},'4,5':{color:'K',type:'ROOK'}}, alive:{R:true,Y:true,B:true,K:false}, move:{fr:4,fc:4,tr:3,tc:4} },
  ];
  for (const scenario of scenarios) {
    original.setState(scenario.board, scenario.alive ? {alive:scenario.alive} : {});
    const before = domain(original.snapshot()), result = e.applyMove(before, scenario.move);
    original.run(`makeMove(${scenario.move.fr},${scenario.move.fc},${scenario.move.tr},${scenario.move.tc})`);
    assert.deepEqual(domain(result.state), domain(original.snapshot()));
    if (result.state.over) assert.ok(result.events.some(event => event.type === 'outcome'));
    if (result.state.board['0,2']?.type === 'ROOK') assert.ok(result.events.some(event => event.type === 'promotion'));
  }
});

test('invalid, frozen, out-of-turn and post-outcome moves cannot mutate state', () => {
  const e = engine();
  for (const overrides of [{}, {over:true}, {turnIndex:1}, {alive:{Y:true,R:false,B:true,K:true}}]) {
    const state = {...plain(e.initialState()), ...overrides};
    const before = JSON.stringify(state);
    const move = overrides.over || overrides.turnIndex || overrides.alive ? {fr:6,fc:4,tr:5,tc:4} : {fr:6,fc:4,tr:2,tc:4};
    assert.throws(() => e.applyMove(state, move), /Illegal Enochian move/);
    assert.equal(JSON.stringify(state), before);
  }
});

test('generated module is exact, fresh and idempotent', () => {
  assert.ok(existsSync(`${root}/scripts/extract-enochian-engine.mjs`), 'Engine extraction tool exists');
  execFileSync(process.execPath, ['scripts/extract-enochian-engine.mjs', '--check'], { cwd: root });
  const before = readFileSync(`${root}/server/src/generated/enochian-engine.mjs`);
  execFileSync(process.execPath, ['scripts/extract-enochian-engine.mjs'], { cwd: root });
  assert.deepEqual(readFileSync(`${root}/server/src/generated/enochian-engine.mjs`), before);
});

test('extraction preserves exact canonical source and hashes it; malformed boundaries fail', async () => {
  const html = readFileSync(`${root}/enochian.html`, 'utf8'), block = engineBlock(html);
  assert.match(generatedEngine(html), new RegExp(`Source SHA-256: ${sha256(block)}`));
  assert.ok(generatedEngine(html).includes(block), 'Canonical block appears unmodified');
  assert.notEqual(generatedEngine(html.replace('function initialState()', 'function initialState(/* changed */)')), generatedEngine(html), 'Source changes invalidate generated bytes and hash');
  assert.throws(() => engineBlock(html + '// ENOCHIAN_ENGINE_START\n'), /Exactly one/);
  assert.throws(() => engineBlock(html.replace('// ENOCHIAN_ENGINE_END', '')), /Exactly one/);
  const exported = (await import('../server/src/generated/enochian-engine.mjs')).default;
  assert.deepEqual(plain(exported.initialState()), plain(engine().initialState()), 'Native exported module and browser block agree');
});
