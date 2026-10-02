import { schema, t } from "@colyseus/schema";
import type { PublicSnapshot } from '../domain/match.js';

const PublicPiece = schema({ color: t.string(), type: t.string() }, 'PublicPiece');
const PublicArmy = schema({ alive: t.boolean() }, 'PublicArmy');
const PublicSeat = schema({ color: t.string(), displayName: t.string(), controller: t.string(), connected: t.boolean(), ready: t.boolean(), disconnectDeadline: t.number() }, 'PublicSeat');

// Only public committed fields belong in Schema. Domain state arrives in Task 5.
export const EnochianState = schema({
  phase: t.string(),
  revision: t.number(),
  connected: t.number(),
  lastLobbyMessage: t.string(),
  matchId: t.string(), protocolVersion: t.number(), rulesVersion: t.string(), mode: t.string(),
  board: t.map(PublicPiece), seats: t.map(PublicSeat), alive: t.map(PublicArmy),
  turn: t.string(), moveCount: t.number(), lobbyDeadline: t.number(), recoveryDeadline: t.number(),
  terminalKind: t.string(), winningTeam: t.number(), terminalReason: t.string(),
}, "EnochianState");
export type PublicState = InstanceType<typeof EnochianState>;

/** Only explicit public projection fields cross the transport boundary. Null deadlines use -1. */
export function applySnapshot(state: PublicState, snapshot: PublicSnapshot) {
  state.matchId = snapshot.matchId; state.protocolVersion = snapshot.protocolVersion; state.rulesVersion = snapshot.rulesVersion;
  state.phase = snapshot.phase; state.revision = snapshot.revision; state.mode = snapshot.mode;
  state.turn = snapshot.turn; state.moveCount = snapshot.moveCount;
  state.lobbyDeadline = snapshot.lobbyDeadline ?? -1; state.recoveryDeadline = snapshot.recoveryDeadline ?? -1;
  state.terminalKind = snapshot.terminalResult?.kind ?? ''; state.winningTeam = snapshot.terminalResult?.winningTeam ?? -1;
  state.terminalReason = snapshot.terminalResult?.reason ?? '';
  state.board.clear(); for (const [key, piece] of Object.entries(snapshot.board)) state.board.set(key, new PublicPiece(piece));
  state.seats.clear(); for (const [key, seat] of Object.entries(snapshot.seats)) state.seats.set(key, new PublicSeat({ ...seat, disconnectDeadline: seat.disconnectDeadline ?? -1 }));
  state.alive.clear(); for (const [key, alive] of Object.entries(snapshot.alive)) state.alive.set(key, new PublicArmy({ alive }));
  state.connected = Object.values(snapshot.seats).filter(seat => seat.connected).length;
}
