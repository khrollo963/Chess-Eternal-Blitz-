import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { VerifiedAuth } from '../storage/LobbyStore.js';

export const HANDOFF_TTL_MS = 300000;
export class HandoffError extends Error {
  constructor(readonly code: 'unauthorized' | 'handoff_expired' | 'handoff_completed' | 'handoff_capacity') { super(code); }
}
interface Entry {
  expiresAt: number; pollHash: Buffer; completionHash: Buffer;
  completed?: { accessToken: string; accountId: string; returnHash: Buffer };
}
const hash = (value: string) => createHash('sha256').update(value).digest();
const token = (bytes: number) => randomBytes(bytes).toString('base64url');
const secretMatches = (value: unknown, expected: Buffer, length: number): boolean => typeof value === 'string' &&
  new RegExp(`^[A-Za-z0-9_-]{${length}}$`).test(value) && timingSafeEqual(hash(value), expected);
/** Ephemeral top-level sign-in bridge. No refresh token or credential is persisted. */
export class AuthHandoff {
  private readonly entries = new Map<string, Entry>();
  private readonly capacity: number;
  constructor(private options: { verifyAuth: (authorization: string | undefined) => Promise<VerifiedAuth | undefined>; clock?: () => number; capacity?: number }) {
    this.capacity = options.capacity ?? 1000;
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1 || this.capacity > 1000) throw new Error('handoff_configuration_invalid');
  }
  private now() { return (this.options.clock ?? Date.now)(); }
  private purge() { const now = this.now(); for (const [id, entry] of this.entries) if (now >= entry.expiresAt) this.entries.delete(id); }
  create() {
    this.purge();
    if (this.entries.size >= this.capacity) throw new HandoffError('handoff_capacity');
    const handoffId = token(32), pollSecret = token(32), completionSecret = token(32), expiresAt = this.now() + HANDOFF_TTL_MS;
    this.entries.set(handoffId, { expiresAt, pollHash: hash(pollSecret), completionHash: hash(completionSecret) });
    return { handoffId, pollSecret, completionSecret, expiresAt };
  }
  private entry(id: unknown): Entry {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw new HandoffError('unauthorized');
    const entry = this.entries.get(id);
    if (!entry) throw new HandoffError('unauthorized');
    if (this.now() >= entry.expiresAt) { this.entries.delete(id); throw new HandoffError('handoff_expired'); }
    return entry;
  }
  async complete(id: unknown, secret: unknown, authorization: string | undefined) {
    const entry = this.entry(id);
    if (!secretMatches(secret, entry.completionHash, 43)) throw new HandoffError('unauthorized');
    if (entry.completed) throw new HandoffError('handoff_completed');
    const supplied = typeof authorization === 'string' && authorization.length <= 8192 ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization) : null;
    if (!supplied) throw new HandoffError('unauthorized');
    let identity: VerifiedAuth | undefined;
    try { identity = await this.options.verifyAuth(authorization); } catch { throw new HandoffError('unauthorized'); }
    if (!identity || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(identity.accountId)) throw new HandoffError('unauthorized');
    // Verification can yield: recheck expiry and completion before retaining a token.
    if (this.entry(id) !== entry) throw new HandoffError('unauthorized');
    if (entry.completed) throw new HandoffError('handoff_completed');
    const returnCode = token(16);
    entry.completed = { accessToken: supplied[1]!, accountId: identity.accountId.toLowerCase(), returnHash: hash(returnCode) };
    return { returnCode };
  }
  consume(id: unknown, pollSecret: unknown, returnCode?: unknown): { pending: true } | { authorization: string; accountId: string } {
    const entry = this.entry(id);
    if (!secretMatches(pollSecret, entry.pollHash, 43)) throw new HandoffError('unauthorized');
    if (!entry.completed) {
      if (returnCode !== undefined) throw new HandoffError('unauthorized');
      return { pending: true };
    }
    if (returnCode !== undefined && !secretMatches(returnCode, entry.completed.returnHash, 22)) throw new HandoffError('unauthorized');
    this.entries.delete(id as string);
    return { authorization: `Bearer ${entry.completed.accessToken}`, accountId: entry.completed.accountId };
  }
}
