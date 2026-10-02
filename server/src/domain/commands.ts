import { canonicalEngine, COLORS, PROTOCOL_VERSION, RULES_VERSION, publicSnapshot, type Color, type Controller, type Move, type PublicSnapshot, type RulesEngine } from './match.js';
import type { CommandCode, CommandResult, MatchStore } from '../storage/MatchStore.js';
import { invalidateExchange, recordKingCaptures } from './exchange.js';

export interface CommandEnvelope {
  requestId: string; matchId: string; expectedRevision: number;
  protocolVersion: number; rulesVersion: string; action: Move & { type: 'move' };
}
/** Populated exclusively by server authentication/controller scheduling, never by payload. */
export interface ActorContext { actorId: string; seat: Color; controller: Controller }
const identifier = /^[A-Za-z0-9_-]{1,96}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const coordinate = (r: unknown, c: unknown) => Number.isInteger(r) && Number.isInteger(c) && ((Number(r) >= 0 && Number(r) <= 7 && Number(c) >= 0 && Number(c) <= 7) || [[0, -1], [-1, 7], [7, 8], [8, 0]].some(([row, col]) => row === r && col === c));
const reject = (code: CommandCode, requestId?: string): CommandResult => ({ ok: false, code, retryable: code === 'storage_unavailable' || code === 'stale_revision', ...(requestId ? { requestId } : {}) });

export function parseCommand(input: unknown): { ok: true; command: CommandEnvelope } | { ok: false; result: CommandResult } {
  try {
    // Transport must also enforce a byte cap before deserialization. This caps decoded input.
    if (!object(input) || JSON.stringify(input).length > 2048 || !keys(input, ['requestId', 'matchId', 'expectedRevision', 'protocolVersion', 'rulesVersion', 'action'])) return { ok: false, result: reject('invalid_command') };
    if (typeof input.requestId !== 'string' || !identifier.test(input.requestId) || typeof input.matchId !== 'string' || !identifier.test(input.matchId) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) return { ok: false, result: reject('invalid_command') };
    if (input.protocolVersion !== PROTOCOL_VERSION || input.rulesVersion !== RULES_VERSION) return { ok: false, result: reject('incompatible_version', input.requestId) };
    const action = input.action;
    if (!object(action) || !keys(action, ['type', 'fr', 'fc', 'tr', 'tc']) || action.type !== 'move' || !coordinate(action.fr, action.fc) || !coordinate(action.tr, action.tc)) return { ok: false, result: reject('invalid_command', input.requestId) };
    // Reconstruct rather than retaining mutable caller objects or injected properties.
    return { ok: true, command: { requestId: input.requestId, matchId: input.matchId, expectedRevision: Number(input.expectedRevision), protocolVersion: PROTOCOL_VERSION, rulesVersion: RULES_VERSION,
      action: { type: 'move', fr: Number(action.fr), fc: Number(action.fc), tr: Number(action.tr), tc: Number(action.tc) } } };
  } catch { return { ok: false, result: reject('invalid_command') }; }
}

export class CommandProcessor {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly store: MatchStore;
  private readonly engine: RulesEngine;
  private readonly clock: () => number;
  private readonly publish?: (snapshot: PublicSnapshot) => void | Promise<void>;
  constructor(options: { store: MatchStore; engine?: RulesEngine; clock?: () => number; publish?: (snapshot: PublicSnapshot) => void | Promise<void> }) {
    this.store = options.store; this.engine = options.engine ?? canonicalEngine; this.clock = options.clock ?? Date.now; this.publish = options.publish;
  }
  execute(actor: ActorContext, input: unknown): Promise<CommandResult> {
    const parsed = parseCommand(input);
    if (!parsed.ok) return Promise.resolve(parsed.result);
    const command = parsed.command;
    // Capture auth context at receipt; a mutable connection object cannot switch a queued actor.
    const auth = { actorId: actor.actorId, seat: actor.seat, controller: actor.controller };
    const previous = this.tails.get(command.matchId) ?? Promise.resolve();
    const work = previous.then(() => this.process(auth, command));
    const tail = work.then(() => undefined, () => undefined);
    this.tails.set(command.matchId, tail);
    void tail.then(() => { if (this.tails.get(command.matchId) === tail) this.tails.delete(command.matchId); });
    return work;
  }
  private async process(actor: ActorContext, command: CommandEnvelope): Promise<CommandResult> {
    const { requestId, matchId } = command;
    if (!actor.actorId || !COLORS.includes(actor.seat)) return reject('unauthorized', requestId);
    const fingerprint = JSON.stringify(command);
    let snapshot: PublicSnapshot;
    let result: CommandResult;
    try {
      // Duplicate replay precedes revision/phase/ownership changes, but remains actor scoped.
      const duplicate = await this.store.findCommand(matchId, actor.actorId, requestId);
      if (duplicate) return duplicate.fingerprint === fingerprint ? duplicate.result : reject('request_conflict', requestId);
      const record = await this.store.load(matchId);
      if (!record) return reject('not_found', requestId);
      if (record.protocolVersion !== command.protocolVersion || record.rulesVersion !== command.rulesVersion) return reject('incompatible_version', requestId);
      if (record.revision !== command.expectedRevision) return reject('stale_revision', requestId);
      const seat = record.seats[actor.seat];
      if (seat.ownerId !== actor.actorId || seat.controller !== actor.controller || (actor.controller === 'human' && !seat.connected)) return reject('unauthorized', requestId);
      if (record.phase !== 'active' || record.terminalResult || record.engine.over) return reject('invalid_phase', requestId);
      const now = this.clock();
      if ((record.recoveryDeadline !== null && now >= record.recoveryDeadline) || (seat.disconnectDeadline !== null && now >= seat.disconnectDeadline)) return reject('deadline_expired', requestId);
      if (record.mode === 'ranked' && (actor.controller !== 'human' || COLORS.some(color => record.seats[color].controller !== 'human' || !record.seats[color].connected))) return reject('invalid_phase', requestId);
      const move = command.action, piece = record.engine.board[`${move.fr},${move.fc}`];
      if (!piece || piece.color !== actor.seat) return reject('wrong_seat', requestId);
      if (!record.engine.alive[actor.seat]) return reject('frozen_army', requestId);
      if (COLORS[record.engine.turnIndex] !== actor.seat) return reject('out_of_turn', requestId);
      if (!this.engine.legalMoves(structuredClone(record.engine), { r: move.fr, c: move.fc }).some(to => to.r === move.tr && to.c === move.tc)) return reject('illegal_move', requestId);
      const successor = this.engine.applyMove(structuredClone(record.engine), move);
      const next = structuredClone(record);
      next.engine = successor.state; next.revision++;
      invalidateExchange(next, 'move');
      recordKingCaptures(next, successor.events);
      const outcome = this.engine.outcome(next.engine);
      if (outcome) {
        next.phase = 'finished'; next.terminalResult = { kind: 'victory', winningTeam: outcome.winningTeam, reason: null };
        if (next.mode === 'ranked') (next as typeof next & { pendingSettlement?: boolean }).pendingSettlement = true;
      }
      snapshot = publicSnapshot(next);
      result = { ok: true, code: 'accepted', retryable: false, requestId, snapshot };
      const commit = await this.store.commit({ matchId, expectedRevision: record.revision, next, events: successor.events,
        command: { actorId: actor.actorId, requestId, fingerprint, result, committedAt: now } });
      if (commit.status === 'duplicate') return commit.command.fingerprint === fingerprint ? commit.command.result : reject('request_conflict', requestId);
      if (commit.status === 'conflict') return reject('stale_revision', requestId);
      if (commit.status === 'capacity') return reject('command_capacity', requestId);
    } catch { return reject('storage_unavailable', requestId); }
    // Delivery failure cannot turn a durable accepted command into a failed command.
    // Reconnecting clients load the snapshot; retrying the request replays its durable ack.
    try { await this.publish?.(structuredClone(snapshot)); } catch { /* transport resync */ }
    return result;
  }
}
