import { EnochianEngine } from '../generated/enochian-engine.mjs';
import { publicExchange, publicExchangeAvailable, type PublicExchangeOffer, type Prisoner, type ExchangeOffer } from './exchange.js';

export const PROTOCOL_VERSION = 1;
export const RULES_VERSION = 'enochian-current-1';
export const COLORS = ['R', 'B', 'Y', 'K'] as const;
export type Color = typeof COLORS[number];
export type Phase = 'lobby' | 'active' | 'paused' | 'finished' | 'void';
export type Controller = 'human' | 'temporary_bot' | 'bot';
export interface Piece { color: Color; type: string }
export interface EngineState {
  board: Record<string, Piece>; alive: Record<Color, boolean>; turnIndex: number;
  over: boolean; moveCount: number;
}
export interface Seat {
  color: Color; displayName: string; ownerId: string | null; controller: Controller;
  connected: boolean; ready: boolean; disconnectDeadline: number | null;
}
export interface TerminalResult { kind: 'victory' | 'void'; winningTeam: number | null; reason: string | null }
export interface MatchRecord {
  /** Private application metadata, persisted in full JSON and never spread into public state. */
  prisoners?: Partial<Record<Color, Prisoner>>; exchangeOffer?: ExchangeOffer | null;
  matchId: string; protocolVersion: number; rulesVersion: string; revision: number;
  mode: 'casual' | 'ranked'; phase: Phase; engine: EngineState;
  seats: Record<Color, Seat>; lobbyDeadline: number | null; recoveryDeadline: number | null;
  terminalResult: TerminalResult | null;
  /** No pruning of an active match. Terminal retention is set by the lifecycle owner. */
  retainUntil: number | null;
}
export interface PublicSnapshot {
  exchangeOffer: PublicExchangeOffer | null;
  exchangeAvailable: Partial<Record<Color, Color>>;
  matchId: string; protocolVersion: number; rulesVersion: string; revision: number;
  mode: 'casual' | 'ranked'; phase: Phase; board: Record<string, Piece>;
  alive: Record<Color, boolean>; turn: Color; moveCount: number;
  seats: Record<Color, Omit<Seat, 'ownerId'>>;
  lobbyDeadline: number | null; recoveryDeadline: number | null; terminalResult: TerminalResult | null;
}
export interface RulesEngine {
  initialState(): EngineState;
  legalMoves(state: EngineState, from: { r: number; c: number }): Array<{ r: number; c: number }>;
  applyMove(state: EngineState, move: Move): { state: EngineState; events: unknown[] };
  outcome(state: EngineState): { winningTeam: number } | null;
}
export interface Move { fr: number; fc: number; tr: number; tc: number }
export const canonicalEngine = EnochianEngine as unknown as RulesEngine;

export function createMatch(matchId: string, mode: MatchRecord['mode'] = 'casual', engine = canonicalEngine): MatchRecord {
  return {
    matchId, mode, protocolVersion: PROTOCOL_VERSION, rulesVersion: RULES_VERSION, revision: 0,
    phase: 'lobby', engine: engine.initialState(),
    seats: Object.fromEntries(COLORS.map(color => [color, { color, displayName: '', ownerId: null,
      controller: 'bot', connected: false, ready: false, disconnectDeadline: null }])) as Record<Color, Seat>,
    lobbyDeadline: null, recoveryDeadline: null, terminalResult: null, retainUntil: null,
  };
}

/** Explicit allowlist: spreading a private record into synchronized state is forbidden. */
export function publicSnapshot(record: MatchRecord): PublicSnapshot {
  const board = Object.fromEntries(Object.entries(record.engine.board).map(([key, piece]) => [key, { color: piece.color, type: piece.type }]));
  const seats = Object.fromEntries(COLORS.map(color => {
    const seat = record.seats[color];
    return [color, { color, displayName: seat.displayName, controller: seat.controller,
      connected: seat.connected, ready: seat.ready, disconnectDeadline: seat.disconnectDeadline }];
  })) as PublicSnapshot['seats'];
  const result = record.terminalResult;
  return {
    matchId: record.matchId, protocolVersion: record.protocolVersion, rulesVersion: record.rulesVersion,
    revision: record.revision, mode: record.mode, phase: record.phase, board,
    alive: Object.fromEntries(COLORS.map(color => [color, record.engine.alive[color]])) as Record<Color, boolean>,
    turn: COLORS[record.engine.turnIndex]!, moveCount: record.engine.moveCount, seats,
    lobbyDeadline: record.lobbyDeadline, recoveryDeadline: record.recoveryDeadline,
    terminalResult: result ? { kind: result.kind, winningTeam: result.winningTeam, reason: result.reason } : null,
    exchangeOffer: publicExchange(record),
    exchangeAvailable: publicExchangeAvailable(record),
  };
}
