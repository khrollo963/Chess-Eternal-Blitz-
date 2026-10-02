import { canonicalEngine } from '../engine.js';
import { COLORS, type MatchRecord } from './match.js';
import type { CommandProcessor } from './commands.js';
import type { MatchStore } from '../storage/MatchStore.js';

export interface BotTimer {
  set(callback: () => Promise<void>, delayMs: number): unknown;
  clear(handle: unknown): void;
}
const timers: BotTimer = {
  set: (callback, delayMs) => setTimeout(() => { void callback(); }, delayMs),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
interface Job { key: string; generation: number; handle: unknown; running: boolean }
/** Server only. No transport payload may construct actor context or invoke this adapter. */
export class BotScheduler {
  private job: Job | null = null;
  private generation = 0;
  private disposed = false;
  private blockedKey: string | null = null;
  private retryKey: string | null = null;
  private retryAttempts = 0;
  private timer: BotTimer;
  constructor(private options: {
    store: MatchStore; processor: Pick<CommandProcessor, 'execute'>; scheduler?: BotTimer;
    clock?: () => number; random?: () => number; maxNodes?: number; delayMs?: number;
    /** Room invokes a persisted expiry check before scheduling replacement work. */
    afterJob?: () => void | Promise<void>;
    onError?: (error: unknown) => void;
  }) { this.timer = options.scheduler ?? timers; }
  private eligible(record: MatchRecord): boolean {
    const color = COLORS[record.engine.turnIndex];
    if (!color || record.mode !== 'casual' || record.phase !== 'active' || record.terminalResult || record.engine.over || !record.engine.alive[color]) return false;
    const seat = record.seats[color], now = (this.options.clock ?? Date.now)();
    return seat.controller !== 'human' && !!seat.ownerId &&
      (record.recoveryDeadline === null || now < record.recoveryDeadline) &&
      (seat.disconnectDeadline === null || now < seat.disconnectDeadline);
  }
  private key(record: MatchRecord): string {
    const color = COLORS[record.engine.turnIndex]!;
    return JSON.stringify([record.matchId, record.revision, color, record.seats[color].controller, record.seats[color].ownerId]);
  }
  schedule(record: MatchRecord): void {
    if (this.disposed) return;
    if (!this.eligible(record)) { this.cancel(); return; }
    const key = this.key(record);
    // A permanent rejection cannot become another 25ms job or be rearmed by
    // periodic maintenance until the durable revision/controller really changes.
    if (this.blockedKey === key) return;
    if (this.job?.key === key) return;
    if (this.retryKey !== key) { this.retryKey = null; this.retryAttempts = 0; }
    this.blockedKey = null;
    this.cancel();
    const job: Job = { key, generation: this.generation, handle: undefined, running: false };
    this.job = job;
    const delay = this.retryKey === key ? Math.min(30000, 1000 * 2 ** Math.min(this.retryAttempts - 1, 5)) : this.options.delayMs ?? 25;
    job.handle = this.timer.set(() => this.run(job, record), delay);
  }
  cancel(): void {
    this.generation++;
    if (this.job) this.timer.clear(this.job.handle);
    this.job = null;
  }
  dispose(): void { this.disposed = true; this.cancel(); }
  private current(job: Job): boolean { return !this.disposed && this.job === job && this.generation === job.generation; }
  private async run(job: Job, scheduledRecord: MatchRecord): Promise<void> {
    if (!this.current(job) || job.running) return;
    job.running = true;
    let retryRecord: MatchRecord | null = null;
    try {
      const matchId = scheduledRecord.matchId;
      const record = await this.options.store.load(matchId);
      if (!this.current(job) || !record || !this.eligible(record) || this.key(record) !== job.key) return;
      const color = COLORS[record.engine.turnIndex]!, seat = record.seats[color];
      const move = canonicalEngine.chooseAiMove(structuredClone(record.engine), color, 'medium', this.options.random ?? Math.random,
        { maxNodes: this.options.maxNodes ?? 128 });
      if (!this.current(job)) return;
      if (!move) { this.blockedKey = job.key; return; }
      // Processor rechecks controller/owner/deadline and revision on the commit path.
      // A reclaim/terminal transition may win CAS after the initial read.
      const result = await this.options.processor.execute({ actorId: seat.ownerId!, seat: color, controller: seat.controller }, {
        requestId: `bot-${record.revision}-${color}`, matchId, expectedRevision: record.revision,
        protocolVersion: record.protocolVersion, rulesVersion: record.rulesVersion, action: { type: 'move', ...move },
      });
      if (this.current(job)) {
        if (!result.ok && !result.retryable) this.blockedKey = job.key;
        else if (!result.ok) {
          this.retryKey = job.key; this.retryAttempts++;
          retryRecord = record;
        } else { this.retryKey = null; this.retryAttempts = 0; }
      }
    } catch (error) {
      if (this.current(job)) { this.retryKey = job.key; this.retryAttempts++; retryRecord = scheduledRecord; }
      this.options.onError?.(error);
    }
    finally {
      if (this.current(job)) {
        this.job = null;
        // Permanent failure is unchanged state, so neither maintenance nor a
        // repeated timer should refetch/resubmit it. Retryable failures reconcile
        // once, then retry slowly even if idle maintenance skips this revision.
        if (this.blockedKey !== job.key) {
          try { await this.options.afterJob?.(); } catch (error) { this.options.onError?.(error); }
          if (retryRecord && !this.disposed && !this.job && this.generation === job.generation) this.schedule(retryRecord);
        }
      }
    }
  }
}
