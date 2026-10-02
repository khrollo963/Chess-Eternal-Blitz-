import { COLORS, type MatchRecord } from '../domain/match.js';
import type { CommitResult, MatchCommit, MatchStore, StoredCommand } from './MatchStore.js';

interface Entry { record: MatchRecord; commands: Map<string, StoredCommand>; events: unknown[] }
const key = (actorId: string, requestId: string) => JSON.stringify([actorId, requestId]);

/** Test adapter, not durable production persistence. No eviction inside a recovery window. */
export class MemoryMatchStore implements MatchStore {
  private readonly matches = new Map<string, Entry>();
  private readonly maxCommands: number;
  private readonly maxMatches: number;
  constructor(options: { maxCommandsPerMatch?: number; maxMatches?: number } = {}) {
    this.maxCommands = options.maxCommandsPerMatch ?? 10000;
    this.maxMatches = options.maxMatches ?? 1000;
    if (!Number.isSafeInteger(this.maxCommands) || this.maxCommands < 0 || !Number.isSafeInteger(this.maxMatches) || this.maxMatches < 1) throw new Error('Invalid storage bounds');
  }
  async create(record: MatchRecord): Promise<void> {
    if (this.matches.has(record.matchId)) throw new Error('Match already exists');
    if (this.matches.size >= this.maxMatches) throw new Error('Match capacity reached');
    this.matches.set(record.matchId, { record: structuredClone(record), commands: new Map(), events: [] });
  }
  async load(matchId: string): Promise<MatchRecord | null> {
    const entry = this.matches.get(matchId);
    return entry ? structuredClone(entry.record) : null;
  }
  async findCommand(matchId: string, actorId: string, requestId: string): Promise<StoredCommand | null> {
    const command = this.matches.get(matchId)?.commands.get(key(actorId, requestId));
    return command ? structuredClone(command) : null;
  }
  async commit(input: MatchCommit): Promise<CommitResult> {
    const entry = this.matches.get(input.matchId);
    if (!entry) return { status: 'conflict' };
    const commandKey = key(input.command.actorId, input.command.requestId);
    const previous = entry.commands.get(commandKey);
    if (previous) return { status: 'duplicate', command: structuredClone(previous) };
    if (entry.record.revision !== input.expectedRevision) return { status: 'conflict' };
    if (entry.commands.size >= this.maxCommands) return { status: 'capacity' };
    if (input.next.matchId !== input.matchId || input.next.revision !== input.expectedRevision + 1) throw new Error('Invalid commit revision');
    // Prepare every clone before mutation: clone failures cannot leave a partial transaction.
    const next = structuredClone(input.next), command = structuredClone(input.command);
    const events = structuredClone(input.events);
    entry.record = next;
    entry.commands.set(commandKey, command);
    entry.events.push(...events);
    return { status: 'committed' };
  }
  /** Lifecycle code must persist a terminal retainUntil beyond all allowed recovery windows. */
  prune(now: number): number {
    let count = 0;
    for (const [matchId, entry] of this.matches) {
      const record = entry.record;
      const protectedUntil = Math.max(record.retainUntil ?? Infinity, record.recoveryDeadline ?? 0,
        ...COLORS.map(color => record.seats[color].disconnectDeadline ?? 0));
      if ((record.phase === 'finished' || record.phase === 'void') && now >= protectedUntil) {
        this.matches.delete(matchId); count++;
      }
    }
    return count;
  }
}
