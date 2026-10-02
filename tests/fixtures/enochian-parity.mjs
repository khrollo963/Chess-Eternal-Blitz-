// Reproducible corpus: reset only after a terminal state; select from sorted
// original legal moves with this fixed LCG. The oracle is the immutable Git blob.
export const corpus = Object.freeze({ seed: 0x45e0c1a, count: 120, baselineRevision: '9d7a62a0407f6fcf34da3975312be1a757c020e5' });

export const auditProbes = [
  ['Fixed diagonal teams', `TEAM.R===TEAM.Y && TEAM.B===TEAM.K && TEAM.R!==TEAM.B`],
  ['Queen leaps over blockers', `fresh({'4,4':{color:'R',type:'QUEEN'},'4,5':{color:'Y',type:'ROOK'}}); getLegalMoves(4,4).some(m=>m.r===4&&m.c===6)`],
  ['Friendly capture prohibited', `fresh({'4,4':{color:'R',type:'ROOK'},'4,5':{color:'Y',type:'KNIGHT'}}); !getLegalMoves(4,4).some(m=>m.r===4&&m.c>=5)`],
  ['Frozen armies cannot move or be captured', `fresh({'4,4':{color:'R',type:'ROOK'},'4,5':{color:'B',type:'KNIGHT'}}); game.alive.B=false; getLegalMoves(4,5).length===0 && !getLegalMoves(4,4).some(m=>m.r===4&&m.c>=5)`],
  ['Kings start on external thrones', `fresh(setupBoard());Object.entries(game.board).filter(([k,p])=>p.type==='KING').every(([k])=>k.split(',').some(n=>+n<0||+n>7))`],
  ['Single piece occupancy and 36 starting pieces', `Object.values(setupBoard()).length===36 && Object.values(setupBoard()).every(p=>!Array.isArray(p))`],
  ['Unsafe king moves remain legal', `fresh({'4,4':{color:'R',type:'KING'},'3,7':{color:'B',type:'ROOK'}}); getLegalMoves(4,4).some(m=>m.r===3&&m.c===4)`],
  ['Other pieces may move under check', `fresh({'4,4':{color:'R',type:'KING'},'4,7':{color:'B',type:'ROOK'},'6,0':{color:'R',type:'ROOK'}}); getLegalMoves(6,0).some(m=>m.r===5&&m.c===0)`],
  ['Bare kings do not cause a draw', `fresh({'7,8':{color:'R',type:'KING'},'0,-1':{color:'Y',type:'KING'},'-1,7':{color:'B',type:'KING'},'8,0':{color:'K',type:'KING'}}); checkWin()===false && game.over===false`],
  ['Live king capture freezes remaining army', `fresh({'4,4':{color:'R',type:'ROOK'},'4,5':{color:'B',type:'KING'},'1,1':{color:'B',type:'KNIGHT'}}); makeMove(4,4,4,5); !game.alive.B && game.board['1,1'].type==='KNIGHT' && getLegalMoves(1,1).length===0`],
  // The temporary audit moved through the allied bishop at 3,3 using the old
  // unchecked makeMove helper. This legal approach tests the same central square.
  ['Concourse does not capture extra bishops', `fresh({'2,0':{color:'R',type:'BISHOP'},'3,2':{color:'B',type:'BISHOP'},'3,3':{color:'Y',type:'BISHOP'},'4,3':{color:'K',type:'BISHOP'}}); getLegalMoves(2,0).some(m=>m.r===4&&m.c===2) && (makeMove(2,0,4,2), Object.keys(game.board).length===4)`],
  ['All four pawns can promote with missing backing piece', `fresh({'1,2':{color:'R',type:'PAWN_ROOK'},'6,3':{color:'R',type:'PAWN_QUEEN'},'6,4':{color:'R',type:'PAWN_KNIGHT'},'6,5':{color:'R',type:'PAWN_BISHOP'}}); makeMove(1,2,0,2); game.board['0,2'].type==='ROOK'`],
  ['Backing piece blocks promotion despite pawn loss', `fresh({'1,2':{color:'R',type:'PAWN_ROOK'},'6,3':{color:'R',type:'PAWN_QUEEN'},'6,4':{color:'R',type:'PAWN_KNIGHT'},'7,4':{color:'R',type:'ROOK'}}); makeMove(1,2,0,2); game.board['0,2'].type==='PAWN_ROOK'`],
  // The null decision is a Task 1 regression, not a rule to preserve in Task 3.
  ['Audited pawn trap has two existing legal moves', `fresh({'4,4':{color:'R',type:'PAWN_ROOK'},'3,5':{color:'B',type:'PAWN_BISHOP'},'3,0':{color:'K',type:'ROOK'}}); getLegalMoves(4,4).length===2`],
];
