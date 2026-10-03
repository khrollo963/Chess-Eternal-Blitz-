// Generated from the canonical marked block in enochian.html. Do not edit.
// Source SHA-256: dd813905f93cabbe40440cc70e7cc6b645a5d3b73ea9da50b223989ada0ef111
// 1. Canonical rules. This closure uses only explicit domain state and RNG.
// Geometry and historical gaps deliberately match the original executable game.
const EnochianEngine = (() => {
const TURN_ORDER = Object.freeze(['R', 'B', 'Y', 'K']);

const FORWARD = Object.freeze({
  Y: Object.freeze([1, 0]),   // top-left army advances downward
  B: Object.freeze([0, -1]),  // top-right army advances leftward
  R: Object.freeze([-1, 0]),  // bottom-right army advances upward
  K: Object.freeze([0, 1])    // bottom-left army advances rightward
});

const TEAM = Object.freeze({ Y: 1, R: 1, B: 2, K: 2 });

function isOnBoard(r, c){
  if(r >= 0 && r <= 7 && c >= 0 && c <= 7) return true;
  if(r === 0 && c === -1) return true;
  if(r === -1 && c === 7) return true;
  if(r === 7 && c === 8) return true;
  if(r === 8 && c === 0) return true;
  return false;
}
const PIECE_VALUE = Object.freeze({ KING: 0, QUEEN: 9, ROOK: 5, BISHOP: 3, KNIGHT: 3, PAWN: 1,
  PAWN_ROOK: 1, PAWN_QUEEN: 1, PAWN_BISHOP: 1, PAWN_KNIGHT: 1 });
function isEnemyColor(colorA, colorB){
  return TEAM[colorA] !== TEAM[colorB];
}
function canCapture(state, moverColor, occupant){
  return isEnemyColor(moverColor, occupant.color) && state.alive[occupant.color];
}
function key(r,c){ return r + ',' + c; }
function setupBoard(){
  const board = {};
  const put = (r,c,color,type) => { board[r+','+c] = { color, type }; };

  function placeArmy(color, king, backDir, pawnDir){
    put(king[0], king[1], color, 'KING');
    const order = ['KNIGHT','QUEEN','BISHOP','ROOK'];
    for(let i = 0; i < 4; i++){
      const r = king[0] + backDir[0]*(i+1);
      const c = king[1] + backDir[1]*(i+1);
      put(r, c, color, order[i]);
      // Pawn type tied to backing piece
      put(r + pawnDir[0], c + pawnDir[1], color, 'PAWN_'+order[i]);
    }
  }

  placeArmy('Y', [0,-1], [0,1], [1,0]);
  placeArmy('B', [-1,7], [1,0], [0,-1]);
  placeArmy('R', [7,8], [0,-1], [-1,0]);
  placeArmy('K', [8,0], [-1,0], [0,1]);

  return board;
}
const ORTHO = [[1,0],[-1,0],[0,1],[0,-1]];
const DIAG = [[1,1],[1,-1],[-1,1],[-1,-1]];
const ALL8 = ORTHO.concat(DIAG);
const KNIGHT_OFFSETS = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];

function slideMoves(state, r, c, color, dirs, board){
  board = board || state.board;
  const moves = [];
  for(const [dr,dc] of dirs){
    let nr = r + dr, nc = c + dc;
    while(isOnBoard(nr,nc)){
      const occupant = board[key(nr,nc)];
      if(!occupant){
        moves.push({ r: nr, c: nc, capture: false });
      } else {
        if(canCapture(state, color, occupant)) moves.push({ r: nr, c: nc, capture: true });
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return moves;
}

function stepMoves(state, r, c, color, offsets, board){
  board = board || state.board;
  const moves = [];
  for(const [dr,dc] of offsets){
    const nr = r + dr, nc = c + dc;
    if(!isOnBoard(nr,nc)) continue;
    const occupant = board[key(nr,nc)];
    if(!occupant) moves.push({ r: nr, c: nc, capture: false });
    else if(canCapture(state, color, occupant)) moves.push({ r: nr, c: nc, capture: true });
  }
  return moves;
}

function pawnMoves(state, r, c, color, board){
  board = board || state.board;
  const moves = [];
  const [fr, fc] = FORWARD[color];
  const fwdR = r + fr, fwdC = c + fc;
  if(isOnBoard(fwdR, fwdC) && !board[key(fwdR, fwdC)]){
    moves.push({ r: fwdR, c: fwdC, capture: false });
  }
  // Diag captures
  const diag1 = [r + fr + fc, c + fc - fr];
  const diag2 = [r + fr - fc, c + fc + fr];
  for(const [dr,dc] of [diag1, diag2]){
    if(!isOnBoard(dr,dc)) continue;
    const occupant = board[key(dr,dc)];
    if(occupant && canCapture(state, color, occupant)) moves.push({ r: dr, c: dc, capture: true });
  }
  return moves;
}

function getLegalMoves(state, r, c, board){
  board = board || state.board;
  const piece = board[key(r,c)];
  if(!piece) return [];
  if(!state.alive[piece.color]) return []; // frozen army cannot move or attack

  const pieceType = piece.type.startsWith('PAWN_') ? 'PAWN' : piece.type;

  switch(pieceType){
    case 'KING':   return stepMoves(state, r, c, piece.color, ALL8, board);
    case 'QUEEN':
      const queenLeaps = [[2,0],[0,2],[-2,0],[0,-2], [2,2],[2,-2],[-2,2],[-2,-2]];
      return stepMoves(state, r, c, piece.color, queenLeaps, board);
    case 'ROOK':   return slideMoves(state, r, c, piece.color, ORTHO, board);
    case 'BISHOP': return slideMoves(state, r, c, piece.color, DIAG, board);
    case 'KNIGHT': return stepMoves(state, r, c, piece.color, KNIGHT_OFFSETS, board);
    case 'PAWN':   return pawnMoves(state, r, c, piece.color, board);
    default: return [];
  }
}

function armyHasAnyMove(state, color){
  for(const k in state.board){
    const piece = state.board[k];
    if(piece.color !== color) continue;
    const [r,c] = k.split(',').map(Number);
    if(getLegalMoves(state, r,c).length > 0) return true;
  }
  return false;
}

function cloneBoard(board){
  const nb = {};
  for(const k in board) nb[k] = { color: board[k].color, type: board[k].type };
  return nb;
}

function isSquareAttacked(state, board, r, c, byColors){
  for(const k in board){
    const p = board[k];
    if(!byColors.has(p.color)) continue;
    const [pr,pc] = k.split(',').map(Number);
    const moves = getLegalMoves(state, pr, pc, board);
    if(moves.some(m => m.r === r && m.c === c)) return true;
  }
  return false;
}

function advanceTurn(state){
  let turnIndex = state.turnIndex;
  for(let i = 0; i < TURN_ORDER.length; i++){
    turnIndex = (turnIndex + 1) % TURN_ORDER.length;
    const color = TURN_ORDER[turnIndex];
    if(state.alive[color] && armyHasAnyMove(state, color)) return turnIndex;
    if(state.alive[color] && !armyHasAnyMove(state, color)) continue;
  }
  return turnIndex;
}

function colorHasPieceType(state, color, type){
  for(const k in state.board){
    const p = state.board[k];
    if(p.color === color && p.type === type) return true;
  }
  return false;
}

function teamAlive(state, team){
  return Object.keys(TEAM).some(c => TEAM[c] === team && state.alive[c]);
}

// 2. Bounded AI policy. King value follows active armies and team survival;
// safety is a preference, never a new restriction on executable legal moves.
const AI_POLICY = Object.freeze({
  easy: Object.freeze({ nodes: 64, risk: 4, noise: 3 }),
  medium: Object.freeze({ nodes: 128, risk: 6, noise: 2 }),
  hard: Object.freeze({ nodes: 256, risk: 10, noise: 1 }),
  grandmaster: Object.freeze({ nodes: 512, risk: 12, noise: 0.4 })
});
function pieceValue(type){ return PIECE_VALUE[type] ?? 0; }
function armyValue(state, color){
  return Object.values(state.board).reduce((sum,p) => sum + (p.color === color ? pieceValue(p.type) : 0), 0);
}
function teamValue(state, team){
  // A living king keeps its entire army usable, including a bare king's team.
  return Object.keys(TEAM).reduce((sum,c) => sum + (TEAM[c] === team && state.alive[c] ? 50 + armyValue(state,c) : 0), 0);
}
function chooseAiMove(state, color, difficulty, random = Math.random, options = {}){
  if(state.over || !state.alive[color]) return null;
  const board = state.board;
  const allMoves = [];
  for(const k in board){
    const p = board[k];
    if(p.color !== color) continue;
    const [r,c] = k.split(',').map(Number);
    for(const m of getLegalMoves(state, r,c,board)){
      allMoves.push({ fr: r, fc: c, tr: m.r, tc: m.c });
    }
  }
  if(allMoves.length === 0) return null;
  // Examine king captures before quiet candidates so even the smallest normal
  // difficulty budget sees an available immediate win or army freeze.
  allMoves.sort((a,b) => Number(board[key(b.tr,b.tc)]?.type === 'KING') - Number(board[key(a.tr,a.tc)]?.type === 'KING'));

  const policy = AI_POLICY[difficulty] || AI_POLICY.easy;
  const budget = Number.isFinite(options.maxNodes) ? Math.max(0, Math.min(policy.nodes, Math.floor(options.maxNodes))) : policy.nodes;
  const team = TEAM[color], otherTeam = team === 1 ? 2 : 1;
  const baseline = teamValue(state,team) - teamValue(state,otherTeam);
  // Explicit actor turn lets server callers evaluate a seat without mutating
  // live turn state. All hypothetical effects still use the canonical transition.
  const actingState = { ...state, turnIndex: TURN_ORDER.indexOf(color) };
  let best = allMoves[0], bestScore = -Infinity, nodes = 0;
  for(const m of allMoves){
    if(nodes++ >= budget) break; // Legal fallback survives even a zero budget.
    const next = applyMove(actingState,m).state;
    const nonTeam = new Set(Object.keys(TEAM).filter(c => TEAM[c] !== team && next.alive[c]));
    const mover = next.board[key(m.tr,m.tc)];
    const attacked = isSquareAttacked(next,next.board,m.tr,m.tc,nonTeam);
    let score = (teamValue(next,team) - teamValue(next,otherTeam) - baseline) * 10;
    const result = outcome(next);
    if(result) score = result.kind === 'draw' ? 0 : result.winningTeam === team ? 1000000 : -1000000;
    else {
      if(attacked) score -= pieceValue(mover.type) * policy.risk;
      for(const [square,p] of Object.entries(next.board)){
        if(p.type !== 'KING' || TEAM[p.color] !== team || !next.alive[p.color]) continue;
        const [r,c] = square.split(',').map(Number);
        if(isSquareAttacked(next,next.board,r,c,nonTeam)){
          // Capturing this king freezes this army; losing the final allied
          // king ends the team. Both consequences outweigh ordinary material.
          const lastKing = !Object.keys(TEAM).some(c => c !== p.color && TEAM[c] === team && next.alive[c]);
          score -= lastKing ? 100000 : (50 + armyValue(next,p.color)) * policy.risk;
        }
      }
    }

    if(difficulty === 'hard' || difficulty === 'grandmaster'){
      score += (4 - (Math.abs(m.tr - 3.5) + Math.abs(m.tc - 3.5)) / 2) * 0.3;
    }

    score += random() * policy.noise;
    if(options.observe) options.observe({ move: m, score, state: next, attacked });

    if(score > bestScore){ bestScore = score; best = m; }
  }
  return best;
}

function initialState(){
  return { board: setupBoard(), turnIndex: 0, alive: { Y: true, B: true, R: true, K: true }, over: false, moveCount: 0 };
}

function legalMoves(state, from){
  const [r,c] = typeof from === 'string' ? from.split(',').map(Number) : Array.isArray(from) ? from : [from.r, from.c];
  return getLegalMoves(state, r, c);
}

function outcome(state){
  const team1 = teamAlive(state, 1), team2 = teamAlive(state, 2);
  if(!team1 || !team2) return { winningTeam: team1 ? 1 : 2 };
  const living = TURN_ORDER.filter(color => state.alive[color]);
  if(living.every(color => !armyHasAnyMove(state, color))) return { kind: 'draw', winningTeam: null, reason: 'stalemate' };
  if(living.every(color => {
    const pieces = Object.values(state.board).filter(piece => piece.color === color);
    return pieces.length === 1 && pieces[0].type === 'KING';
  })) return { kind: 'draw', winningTeam: null, reason: 'bare_kings' };
  return null;
}

function applyMove(state, move){
  const { fr, fc, tr, tc } = move;
  const original = state.board[key(fr,fc)];
  if(state.over || !original || original.color !== TURN_ORDER[state.turnIndex] || !legalMoves(state, {r:fr,c:fc}).some(m => m.r === tr && m.c === tc)){
    throw new Error('Illegal Enochian move');
  }
  const next = { board: cloneBoard(state.board), alive: { ...state.alive }, turnIndex: state.turnIndex, over: state.over, moveCount: state.moveCount + 1 };
  const piece = next.board[key(fr,fc)], target = next.board[key(tr,tc)];
  const events = [{ type: 'move', move: {fr,fc,tr,tc}, piece: {...piece} }];
  delete next.board[key(fr,fc)];
  next.board[key(tr,tc)] = piece;
  if(target){
    events.push({ type: 'capture', piece: {...target}, byColor: piece.color });
    if(target.type === 'KING'){
      next.alive[target.color] = false;
      events.push({ type: 'freeze', color: target.color });
    }
  }
  if(piece.type.startsWith('PAWN_')){
    const [fwr,fwc] = FORWARD[piece.color];
    if(!isOnBoard(tr+fwr,tc+fwc)){
      const type = piece.type.substring(5);
      if(!colorHasPieceType(next,piece.color,type)){
        piece.type = type;
        events.push({ type: 'promotion', color: piece.color, toType: type });
      }
    }
  }
  const result = outcome(next);
  if(result){ next.over = true; events.push({ type: 'outcome', ...result }); }
  else { next.turnIndex = advanceTurn(next); events.push({ type: 'turn', color: TURN_ORDER[next.turnIndex], turnIndex: next.turnIndex }); }
  return { state: next, events };
}

return Object.freeze({ initialState, legalMoves, applyMove, chooseAiMove, outcome,
  isOnBoard, isEnemyColor, key, advanceTurn, colorHasPieceType, teamAlive,
  getLegalMoves, isSquareAttacked, cloneBoard, TURN_ORDER, FORWARD, TEAM });
})();

export { EnochianEngine };
export default EnochianEngine;
