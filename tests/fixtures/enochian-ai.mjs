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
