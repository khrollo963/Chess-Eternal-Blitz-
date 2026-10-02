export const typedPawnTrap = {
  '4,4': { color: 'R', type: 'PAWN_ROOK' },
  '3,5': { color: 'B', type: 'PAWN_BISHOP' },
  '3,0': { color: 'K', type: 'ROOK' },
};

// Capturing B's king also freezes the adjacent B rook. That rook must not
// threaten the capturing piece in the AI's hypothetical successor.
export const kingCapture = {
  '4,4': { color: 'R', type: 'ROOK' },
  '4,5': { color: 'B', type: 'KING' },
  '3,5': { color: 'B', type: 'ROOK' },
};

export const typedPawnCapture = {
  '4,4': { color: 'R', type: 'ROOK' },
  '4,5': { color: 'B', type: 'PAWN_BISHOP' },
};

export const kingOrMaterial = {
  '4,4': { color: 'R', type: 'ROOK' },
  '4,5': { color: 'B', type: 'KING' },
  '4,3': { color: 'K', type: 'QUEEN' },
  '3,5': { color: 'B', type: 'ROOK' },
};

// R may legally take the queen with its king, but B's rook can then capture
// that king and freeze R's rook too. Safety must remain policy, not legality.
export const exposedKing = {
  '4,4': { color: 'R', type: 'KING' },
  '6,7': { color: 'R', type: 'ROOK' },
  '3,4': { color: 'B', type: 'QUEEN' },
  '3,0': { color: 'B', type: 'ROOK' },
};

export const promotion = {
  '1,4': { color: 'R', type: 'PAWN_ROOK' },
  '0,-1': { color: 'Y', type: 'KING' },
  '-1,7': { color: 'B', type: 'KING' },
  '8,0': { color: 'K', type: 'KING' },
};
