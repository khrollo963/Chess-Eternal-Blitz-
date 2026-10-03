import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { gameSource, createHarness } from './helpers/enochian-harness.mjs';
import { engineBlock } from '../scripts/extract-enochian-engine.mjs';

const engine = () => vm.runInNewContext(`${engineBlock(gameSource())}\nEnochianEngine;`);
const plain = value => JSON.parse(JSON.stringify(value));
const bareKings = () => ({board:{'2,3':{color:'Y',type:'KING'},'4,3':{color:'K',type:'KING'},'0,0':{color:'R',type:'ROOK'}},alive:{R:false,B:false,Y:true,K:true},turnIndex:2,over:false,moveCount:413});

test('Ken’s two surviving kings produce a bare-kings draw despite frozen material', () => {
  const e = engine(), state = bareKings();
  assert.deepEqual(plain(e.outcome(state)), {kind:'draw',winningTeam:null,reason:'bare_kings'});
  assert.equal(state.over,false,'Outcome evaluation is pure');
});

test('usable non-king material keeps play open and a final king capture still wins', () => {
  const e = engine(), state = bareKings();
  state.board['3,4'] = {color:'Y',type:'ROOK'};
  assert.equal(e.outcome(state),null);
  state.board = {'2,3':{color:'Y',type:'KING'},'2,4':{color:'K',type:'KING'}};
  const result = e.applyMove(state,{fr:2,fc:3,tr:2,tc:4});
  assert.equal(result.state.over,true);
  assert.deepEqual(plain(e.outcome(result.state)),{winningTeam:1});
});

const blocked = () => ({board:{
  '0,0':{color:'Y',type:'KING'},'7,7':{color:'K',type:'KING'},'3,3':{color:'Y',type:'PAWN_ROOK'},
  ...Object.fromEntries(['0,1','1,0','1,1','0,-1','6,6','6,7','7,6','7,8','4,3'].map(key => [key,{color:'R',type:'ROOK'}])),
},alive:{R:false,B:false,Y:true,K:true},turnIndex:2,over:false,moveCount:100});

test('all living armies blocked by frozen pieces end in stalemate, while one blocked army does not', () => {
  const e = engine(), state = blocked();
  assert.equal(e.legalMoves(state,'0,0').length,0);
  assert.equal(e.legalMoves(state,'7,7').length,0);
  assert.equal(e.legalMoves(state,'3,3').length,0);
  assert.deepEqual(plain(e.outcome(state)), {kind:'draw',winningTeam:null,reason:'stalemate'});
  delete state.board['7,6'];
  assert.equal(e.outcome(state),null,'The other team can still move');
});

test('local two-bot ending records one draw and cancels every subsequent CPU turn', () => {
  const h = createHarness(), state = bareKings();
  h.setState(state.board,{...state,playerColor:'R'});
  h.run("document.getElementById('gamePlayArea').style.display='block';localCpu.reset();maybeRunCpuTurn();");
  assert.equal(h.snapshot().over,true);
  assert.equal(h.ui.element('gameOverTitle').textContent,'☯ DRAW');
  assert.match(h.ui.element('gameOverMessage').textContent,/only kings/i);
  assert.equal(h.run('sessionLog.length'),1);
  assert.equal(h.run('sessionLog[0].result'),'DRAW');
  assert.equal(h.run('sessionLog[0].winningTeam'),'None');
  h.run('maybeRunCpuTurn();checkWin();');
  h.clock.tick(60000);
  assert.equal(h.snapshot().moveCount,413);
  assert.equal(h.run('sessionLog.length'),1);
});
