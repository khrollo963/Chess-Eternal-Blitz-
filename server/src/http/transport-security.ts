import type { AuthContext, BeforeUpgradeHandler } from '@colyseus/core';
import type { RequestHandler } from 'express';

export const HTTP_PAYLOAD_BYTES = 2048;
export const WEBSOCKET_PAYLOAD_BYTES = 4096;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function publicEndpoint(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || value !== url.origin) throw new Error();
    return url.origin;
  } catch { throw new Error('Invalid public endpoint'); }
}
export class OriginPolicy {
  private readonly origins: Set<string>;
  constructor(origins: readonly string[], private options: { allowMissingOrigin?: boolean } = {}) {
    if (origins.length > 32) throw new Error('Invalid allowed origin');
    this.origins = new Set(origins.map(origin => {
      try { return publicEndpoint(origin); } catch { throw new Error('Invalid allowed origin'); }
    }));
  }
  allows(origin: string | null): boolean {
    return origin === null ? this.options.allowMissingOrigin === true : origin.length <= 512 && this.origins.has(origin);
  }
}
export function decodedPayloadFits(payload: unknown, maxBytes = HTTP_PAYLOAD_BYTES): boolean {
  try { return plain(payload) && Buffer.byteLength(JSON.stringify(payload), 'utf8') <= maxBytes; } catch { return false; }
}
/** Use at the raw Request boundary, BEFORE a transport reads its entire body. */
export async function readBoundedJson(request: Request, maxBytes = HTTP_PAYLOAD_BYTES): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > WEBSOCKET_PAYLOAD_BYTES) throw new Error('Invalid payload cap');
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new Error('invalid_command');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error('payload_too_large');
  if (!request.body) throw new Error('invalid_command');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('payload_too_large'); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    if (!plain(value)) throw new Error(); return value;
  } catch { throw new Error('invalid_command'); }
}
export interface RateOptions { limit: number; windowMs: number; maxBuckets: number }
export interface RateResult { allowed: boolean; retryAfterMs: number }
/** Fixed windows, bounded keys/maps, no per-request timers and no live-bucket eviction. */
export class BoundedRateLimiter {
  private buckets = new Map<string, { used: number; expiresAt: number }>();
  constructor(private options: RateOptions) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100000 ||
      !Number.isSafeInteger(options.windowMs) || options.windowMs < 1 || options.windowMs > 3600000 ||
      !Number.isSafeInteger(options.maxBuckets) || options.maxBuckets < 1 || options.maxBuckets > 10000) throw new Error('Invalid rate limits');
  }
  get size() { return this.buckets.size; }
  consume(key: string, now: number): RateResult {
    if (typeof key !== 'string' || key.length < 1 || key.length > 256 || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + this.options.windowMs)) return { allowed: false, retryAfterMs: this.options.windowMs };
    let bucket = this.buckets.get(key);
    if (bucket && now >= bucket.expiresAt) { this.buckets.delete(key); bucket = undefined; }
    if (!bucket) {
      if (this.buckets.size >= this.options.maxBuckets) {
        for (const [existing, value] of this.buckets) if (now >= value.expiresAt) this.buckets.delete(existing);
        if (this.buckets.size >= this.options.maxBuckets) return { allowed: false, retryAfterMs: Math.min(...Array.from(this.buckets.values(), value => value.expiresAt - now)) };
      }
      bucket = { used: 0, expiresAt: now + this.options.windowMs }; this.buckets.set(key, bucket);
    }
    if (bucket.used >= this.options.limit) return { allowed: false, retryAfterMs: Math.max(1, bucket.expiresAt - now) };
    bucket.used++; return { allowed: true, retryAfterMs: 0 };
  }
}
export interface TrustedTransport {
  /** Actual peer or server-established identity. Never copy a raw forwarded header/context.ip. */
  sourceKey?: string;
  /** TLS directly observed or verified trusted edge-only ingress. Never raw x-forwarded-proto. */
  secure?: boolean;
}
type Scope = 'http' | 'invitation' | 'auth' | 'upgrade' | 'action';
const defaultLimits: Record<Scope, RateOptions> = {
  http: { limit: 120, windowMs: 60000, maxBuckets: 2048 },
  invitation: { limit: 30, windowMs: 60000, maxBuckets: 2048 },
  // Four sign-in handoffs may poll behind the same trusted Railway edge peer.
  auth: { limit: 120, windowMs: 60000, maxBuckets: 2048 },
  upgrade: { limit: 30, windowMs: 60000, maxBuckets: 2048 },
  action: { limit: 60, windowMs: 10000, maxBuckets: 4096 },
};
const denied = (status: number, code: string, retryAfterMs?: number): Response => new Response(JSON.stringify({ code }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
    ...(retryAfterMs ? { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } : {}) },
});
export class TransportSecurity {
  readonly originPolicy: OriginPolicy;
  private readonly rates: Record<Scope, BoundedRateLimiter>;
  private readonly global = new BoundedRateLimiter({ limit: 2000, windowMs: 60000, maxBuckets: 1 });
  constructor(options: { allowedOrigins: readonly string[]; allowMissingOrigin?: boolean; limits?: Partial<Record<Scope, RateOptions>> }) {
    this.originPolicy = new OriginPolicy(options.allowedOrigins, { allowMissingOrigin: options.allowMissingOrigin });
    this.rates = Object.fromEntries(Object.entries(defaultLimits).map(([scope, defaults]) => [scope, new BoundedRateLimiter(options.limits?.[scope as Scope] ?? defaults)])) as Record<Scope, BoundedRateLimiter>;
  }
  corsHeaders(origin: string | null): Record<string, string> {
    if (!origin || !this.originPolicy.allows(origin)) return { Vary: 'Origin' };
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' };
  }
  private rate(scope: Scope, sourceKey: string | undefined, now: number): Response | undefined {
    // Unknown peers share one fail-closed bucket; spoofed headers do not create buckets.
    const key = sourceKey ?? 'unknown-peer';
    const global = this.global.consume('all', now); if (!global.allowed) return denied(429, 'rate_limited', global.retryAfterMs);
    const result = this.rates[scope].consume(key, now);
    return result.allowed ? undefined : denied(429, 'rate_limited', result.retryAfterMs);
  }
  guard(request: Request, trusted: TrustedTransport, now: number, scope?: 'upgrade'): Response | undefined {
    let path: string;
    try { path = new URL(request.url).pathname; } catch { return denied(400, 'invalid_command'); }
    // Readiness is still handled by its real route. This helper never reports ready.
    if ((path === '/health' || path === '/ready') && ['GET', 'HEAD'].includes(request.method)) return;
    if (!this.originPolicy.allows(request.headers.get('origin'))) return denied(403, 'origin_denied');
    if (trusted.secure !== true) return denied(426, 'https_required');
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > HTTP_PAYLOAD_BYTES)) return denied(413, 'payload_too_large');
    const limited = this.rate(scope ?? 'http', trusted.sourceKey, now); if (limited) return limited;
    if (!scope && path.startsWith('/invitations')) return this.rate(path === '/invitations/recover' ? 'auth' : 'invitation', trusted.sourceKey, now);
    if (!scope && (path.startsWith('/matchmake') || path.startsWith('/identity/'))) return this.rate('auth', trusted.sourceKey, now);
    return;
  }
  beforeUpgrade(options: { trusted: (request: Request, context: Readonly<AuthContext>) => TrustedTransport; clock?: () => number }): BeforeUpgradeHandler {
    return (request, context) => {
      try { return this.guard(request, options.trusted(request, context), (options.clock ?? Date.now)(), 'upgrade'); }
      catch { return denied(503, 'storage_unavailable'); }
    };
  }
  /** Install before application routes; see operations.md for transport routing/body limitations. */
  middleware(options: { trusted: (request: Parameters<RequestHandler>[0]) => TrustedTransport; clock?: () => number }): RequestHandler {
    return (req, res, next) => {
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const request = new Request(new URL(req.originalUrl || req.url, 'http://internal'), { method: req.method, headers });
        let rejection = this.guard(request, options.trusted(req), (options.clock ?? Date.now)());
        if (!rejection && req.body !== undefined && (typeof req.body !== 'string' || Buffer.byteLength(req.body) > HTTP_PAYLOAD_BYTES)) rejection = denied(413, 'payload_too_large');
        if (rejection) {
          rejection.headers.forEach((value, key) => res.setHeader(key, value));
          void rejection.text().then(body => res.status(rejection!.status).send(body)); return;
        }
        for (const [key, value] of Object.entries(this.corsHeaders(headers.get('origin')))) res.setHeader(key, value);
        res.setHeader('Cache-Control', 'no-store');
        next();
      } catch { res.status(503).json({ code: 'storage_unavailable' }); }
    };
  }
  /** Server-established connection/actor IDs only. Domain parsers still validate exact action keys. */
  allowAction(input: { connectionId: string; actorId?: string; payload: unknown }, now: number): Response | undefined {
    if (!decodedPayloadFits(input.payload)) return denied(413, 'payload_too_large');
    if (input.actorId) {
      const actor = this.rates.action.consume(`actor:${input.actorId}`, now);
      if (!actor.allowed) return denied(429, 'rate_limited', actor.retryAfterMs);
    }
    const connection = this.rates.action.consume(`connection:${input.connectionId}`, now);
    return connection.allowed ? undefined : denied(429, 'rate_limited', connection.retryAfterMs);
  }
}
