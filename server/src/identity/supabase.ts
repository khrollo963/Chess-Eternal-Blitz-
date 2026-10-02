import { createClient } from '@supabase/supabase-js';
import type { VerifiedAuth } from '../storage/LobbyStore.js';

export interface SupabaseIdentityConfig { url: string; publishableKey: string }
export type IdentityFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;
export interface SupabaseIdentityOptions extends SupabaseIdentityConfig {
  fetch?: IdentityFetch;
  /** Milliseconds since epoch; injectable for deterministic policy tests. */
  clock?: () => number;
  timeoutMs?: number;
}
const unauthorized = (): never => { throw new Error('unauthorized'); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function configuration(input: SupabaseIdentityConfig): SupabaseIdentityConfig {
  try {
    const url = new URL(input.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error();
    const key = input.publishableKey;
    if (typeof key !== 'string' || key.length > 4096) throw new Error();
    // Public legacy anon keys are supported; never accept a privileged service-role key.
    if (!/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) {
      if (!tokenPattern.test(key)) throw new Error();
      const payload = JSON.parse(Buffer.from(key.split('.')[1]!, 'base64url').toString());
      if (payload.role !== 'anon') throw new Error();
    }
    return { url: url.origin, publishableKey: key };
  } catch { throw new Error('identity_configuration_invalid'); }
}

/** Reads named public configuration only; callers decide whether identity is enabled. */
export function readSupabaseIdentityConfig(env: Record<string, string | undefined>): SupabaseIdentityConfig | undefined {
  if (!env.SUPABASE_URL && !env.SUPABASE_PUBLISHABLE_KEY) return undefined;
  return configuration({ url: env.SUPABASE_URL ?? '', publishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? '' });
}

/** Every supplied token is signature-verified and rechecked against the Auth server. */
export function createSupabaseIdentity(options: SupabaseIdentityOptions): (authorization: string | undefined) => Promise<VerifiedAuth | undefined> {
  const config = configuration(options);
  const clock = options.clock ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error('identity_configuration_invalid');
  const transport = options.fetch ?? globalThis.fetch;
  return async authorization => {
    if (authorization === undefined) return undefined;
    if (typeof authorization !== 'string' || authorization.length > 8192) return unauthorized();
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!match) return unauthorized();
    const token = match[1]!;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const boundedFetch: IdentityFetch = async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : String(input));
      if (target.origin !== config.url || !['/auth/v1/.well-known/jwks.json', '/auth/v1/user'].includes(target.pathname)) return unauthorized();
      const response = await transport(input, { ...init, signal: controller.signal, redirect: 'error' });
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > 65536)) { await response.body?.cancel(); return unauthorized(); }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 65536) { await reader.cancel(); return unauthorized(); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
      }
      return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    const client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // Supabase invokes only the fetch callable; Bun adds an unrelated preconnect property to its ambient type.
      global: { fetch: boundedFetch as typeof fetch },
    });
    const verify = async (): Promise<VerifiedAuth> => {
      // Expiry is checked below against the injected clock, never skipped by policy.
      const verified = await client.auth.getClaims(token, { allowExpired: true });
      if (verified.error || !verified.data) return unauthorized();
      const claims = verified.data.claims;
      const now = clock() / 1000;
      if (!Number.isFinite(now) || claims.iss !== `${config.url}/auth/v1` || claims.aud !== 'authenticated' || claims.role !== 'authenticated' || typeof claims.sub !== 'string' || !uuid.test(claims.sub) || claims.is_anonymous === true) return unauthorized();
      if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > now || claims.iat >= claims.exp) return unauthorized();
      if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now || claims.nbf >= claims.exp)) return unauthorized();
      const current = await client.auth.getUser(token);
      if (current.error || !current.data.user || current.data.user.id !== claims.sub || current.data.user.is_anonymous !== false) return unauthorized();
      const banned = current.data.user.banned_until;
      if (banned && (!Number.isFinite(Date.parse(banned)) || Date.parse(banned) > clock())) return unauthorized();
      return { accountId: claims.sub.toLowerCase() };
    };
    try {
      return await Promise.race([verify(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('unauthorized')); }, timeoutMs); })]);
    } catch { return unauthorized(); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}
