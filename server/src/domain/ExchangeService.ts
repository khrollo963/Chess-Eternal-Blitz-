import { COLORS, PROTOCOL_VERSION, RULES_VERSION, publicSnapshot, type Color, type PublicSnapshot } from './match.js';
import type { ActorContext } from './commands.js';
import { acceptExchange, expireExchange, offerExchange, rejectExchange, type ExchangeRecord, type ExchangeStatus } from './exchange.js';
import { opaqueToken } from '../identity/guest.js';
import type { CommandCode, CommandResult, MatchStore } from '../storage/MatchStore.js';

export type ExchangeAction = { type: 'offer'; counterpart: Color } | { type: 'accept' | 'reject'; offerId: string };
export interface ExchangeEnvelope {
  requestId: string; matchId: string; expectedRevision: number; protocolVersion: number; rulesVersion: string; action: ExchangeAction;
}
const identifier = /^[A-Za-z0-9_-]{1,96}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const reject = (code: CommandCode, requestId?: string): CommandResult => ({ ok: false, code, retryable: code === 'storage_unavailable' || code === 'stale_revision', ...(requestId ? { requestId } : {}) });
export function parseExchangeCommand(input: unknown): { ok: true; command: ExchangeEnvelope } | { ok: false; result: CommandResult } {
  try {
    if (!object(input) || JSON.stringify(input).length > 2048 || !keys(input, ['requestId', 'matchId', 'expectedRevision', 'protocolVersion', 'rulesVersion', 'action'])) return { ok: false, result: reject('invalid_command') };
    if (typeof input.requestId !== 'string' || !identifier.test(input.requestId) || typeof input.matchId !== 'string' || !identifier.test(input.matchId) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) return { ok: false, result: reject('invalid_command') };
    if (input.protocolVersion !== PROTOCOL_VERSION || input.rulesVersion !== RULES_VERSION) return { ok: false, result: reject('incompatible_version', input.requestId) };
    const action = input.action; let parsed: ExchangeAction;
    if (!object(action)) return { ok: false, result: reject('invalid_command', input.requestId) };
    if (action.type === 'offer' && keys(action, ['type', 'counterpart']) && COLORS.includes(action.counterpart as Color)) parsed = { type: 'offer', counterpart: action.counterpart as Color };
    else if ((action.type === 'accept' || action.type === 'reject') && keys(action, ['type', 'offerId']) && typeof action.offerId === 'string' && identifier.test(action.offerId)) parsed = { type: action.type, offerId: action.offerId };
    else return { ok: false, result: reject('invalid_command', input.requestId) };
    return { ok: true, command: { requestId: input.requestId, matchId: input.matchId, expectedRevision: Number(input.expectedRevision), protocolVersion: PROTOCOL_VERSION, rulesVersion: RULES_VERSION, action: parsed } };
  } catch { return { ok: false, result: reject('invalid_command') }; }
}
function statusCode(status: ExchangeStatus): CommandCode {
  switch (status) {
    case 'stale_revision': case 'stale_offer': return 'stale_revision';
    case 'expired': return 'deadline_expired';
    case 'frozen_captor': return 'frozen_army';
    case 'placement_failed': return 'placement_failed';
    case 'no_offer': case 'invalid_prisoners': return 'no_offer';
    case 'offer_pending': return 'offer_pending';
    case 'out_of_turn': return 'out_of_turn';
    case 'invalid_phase': case 'local_mode': return 'invalid_phase';
    case 'invalid_offer': return 'invalid_command';
    default: return 'unauthorized';
  }
}
/** Pure domain candidates are persisted through the same durable CAS/dedup contract as moves. */
export class ExchangeService {
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(private options: { store: MatchStore; clock?: () => number; publish?: (snapshot: PublicSnapshot) => void | Promise<void> }) {}
  private now() { return (this.options.clock ?? Date.now)(); }
  execute(actor: ActorContext, input: unknown): Promise<CommandResult> {
    const parsed = parseExchangeCommand(input); if (!parsed.ok) return Promise.resolve(parsed.result);
    const auth = { actorId: actor.actorId, seat: actor.seat, controller: actor.controller }, command = parsed.command;
    const previous = this.tails.get(command.matchId) ?? Promise.resolve();
    const work = previous.then(() => this.process(auth, command));
    const tail = work.then(() => undefined, () => undefined); this.tails.set(command.matchId, tail);
    void tail.then(() => { if (this.tails.get(command.matchId) === tail) this.tails.delete(command.matchId); });
    return work;
  }
  private async publish(snapshot: PublicSnapshot) {
    try { await this.options.publish?.(structuredClone(snapshot)); } catch { /* durable commit remains authoritative */ }
  }
  async expire(matchId: string): Promise<void> {
    for (let attempt = 0; attempt < 16; attempt++) {
      const record = await this.options.store.load(matchId) as ExchangeRecord | null, now = this.now();
      if (!record || !expireExchange(record, now)) return;
      const expectedRevision = record.revision; record.revision++;
      const requestId = opaqueToken(), snapshot = publicSnapshot(record);
      const commit = await this.options.store.commit({ matchId, expectedRevision, next: record,
        events: [{ type: 'exchange_expired' }], command: { actorId: 'exchange_lifecycle', requestId, fingerprint: requestId,
          result: { ok: true, code: 'accepted', retryable: false, snapshot }, committedAt: now } });
      if (commit.status === 'conflict') continue;
      if (commit.status !== 'committed') throw new Error('storage_unavailable');
      await this.publish(snapshot); return;
    }
    throw new Error('storage_unavailable');
  }
  private async process(actor: ActorContext, command: ExchangeEnvelope): Promise<CommandResult> {
    const { matchId, requestId } = command;
    if (!actor.actorId || !COLORS.includes(actor.seat)) return reject('unauthorized', requestId);
    const fingerprint = JSON.stringify(command);
    try {
      const duplicate = await this.options.store.findCommand(matchId, actor.actorId, requestId);
      if (duplicate) return duplicate.fingerprint === fingerprint ? duplicate.result : reject('request_conflict', requestId);
      // Request replay is resolved before maintenance or revision changes. New requests
      // always observe absolute offer expiry, even if the room timer has been delayed.
      await this.expire(matchId);
      const record = await this.options.store.load(matchId) as ExchangeRecord | null;
      if (!record) return reject('not_found', requestId);
      if (record.protocolVersion !== command.protocolVersion || record.rulesVersion !== command.rulesVersion) return reject('incompatible_version', requestId);
      if (record.revision !== command.expectedRevision) return reject('stale_revision', requestId);
      const now = this.now(), seat = record.seats[actor.seat];
      if (actor.controller !== 'human' || seat.ownerId !== actor.actorId || seat.controller !== 'human' || !seat.connected) return reject('unauthorized', requestId);
      if ((record.recoveryDeadline !== null && now >= record.recoveryDeadline) || (seat.disconnectDeadline !== null && now >= seat.disconnectDeadline)) return reject('deadline_expired', requestId);
      if (record.mode === 'ranked' && COLORS.some(color => record.seats[color].controller !== 'human' || !record.seats[color].connected)) return reject('invalid_phase', requestId);
      const next = structuredClone(record), context = { ...actor, expectedRevision: command.expectedRevision, now, multiplayer: true }, action = command.action;
      const outcome = action.type === 'offer' ? offerExchange(next, context, { offerId: requestId, counterpart: action.counterpart })
        : action.type === 'accept' ? acceptExchange(next, context, action.offerId) : rejectExchange(next, context, action.offerId);
      if (!['offered', 'accepted', 'rejected'].includes(outcome.status)) return { ...reject(statusCode(outcome.status), requestId), ...(outcome.reason ? { reason: outcome.reason } : {}) };
      next.revision++;
      const snapshot = publicSnapshot(next), result: CommandResult = { ok: true, code: 'accepted', retryable: false, requestId, snapshot };
      const events = [{ type: `exchange_${outcome.status}`, proposer: action.type === 'offer' ? actor.seat : record.exchangeOffer!.proposer,
        counterpart: action.type === 'offer' ? action.counterpart : actor.seat, offerId: action.type === 'offer' ? requestId : action.offerId,
        ...(outcome.placements ? { placements: outcome.placements } : {}) }];
      const commit = await this.options.store.commit({ matchId, expectedRevision: record.revision, next, events,
        command: { actorId: actor.actorId, requestId, fingerprint, result, committedAt: now } });
      if (commit.status === 'duplicate') return commit.command.fingerprint === fingerprint ? commit.command.result : reject('request_conflict', requestId);
      if (commit.status === 'conflict') return reject('stale_revision', requestId);
      if (commit.status === 'capacity') return reject('command_capacity', requestId);
      await this.publish(snapshot); return result;
    } catch { return reject('storage_unavailable', requestId); }
  }
}
