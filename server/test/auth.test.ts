import { expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createSupabaseIdentity, readSupabaseIdentityConfig, type IdentityFetch } from '../src/identity/supabase.js';

const accountId = '12345678-1234-4123-8123-123456789abc';
const now = 2000000000000;
let sequence = 0;
function fixture(algorithm: 'ES256' | 'RS256' = 'ES256') {
  const keys = algorithm === 'ES256' ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) : generateKeyPairSync('rsa', { modulusLength: 2048 });
  const url = `https://test-${++sequence}.supabase.co`;
  const kid = `key-${sequence}`;
  const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid, alg: algorithm, use: 'sig' };
  const claims = { iss: `${url}/auth/v1`, sub: accountId, aud: 'authenticated', role: 'authenticated', exp: now / 1000 + 3600, iat: now / 1000 - 60, nbf: now / 1000 - 60, is_anonymous: false };
  let user: Record<string, unknown> = { id: accountId, aud: 'authenticated', role: 'authenticated', is_anonymous: false, created_at: '2020-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
  let unavailable = false;
  let oversized = false;
  let revoked = false;
  const requests: string[] = [];
  const fetcher: IdentityFetch = async (input, init) => {
    const target = String(input); requests.push(target);
    expect(init?.redirect).toBe('error');
    if (unavailable) throw new Error('private-provider-diagnostics');
    if (oversized) return new Response('x'.repeat(65537));
    if (target.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    if (target.endsWith('/user')) return revoked ? Response.json({ code: 'bad_jwt', msg: 'private-revocation-diagnostics' }, { status: 401 }) : Response.json(user);
    throw new Error('unexpected route');
  };
  const token = (changes: Record<string, unknown> = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: algorithm, kid, typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ ...claims, ...changes })).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${header}.${payload}.${signature}`;
  };
  const verify = createSupabaseIdentity({ url, publishableKey: 'sb_publishable_test_public_key', fetch: fetcher, clock: () => now, timeoutMs: 100 });
  return { verify, token, requests, setUser: (changes: Record<string, unknown>) => { user = { ...user, ...changes }; }, fail: () => { unavailable = true; }, revoke: () => { revoked = true; }, oversize: () => { oversized = true; } };
}

for (const algorithm of ['ES256', 'RS256'] as const) test(`${algorithm} real signature and fresh Auth user produce persistent project account identity`, async () => {
  const f = fixture(algorithm);
  expect(await f.verify(`Bearer ${f.token()}`)).toEqual({ accountId });
  expect(f.requests.some(path => path.endsWith('/.well-known/jwks.json'))).toBe(true);
  expect(f.requests.filter(path => path.endsWith('/user'))).toHaveLength(1);
});

test('missing authorization is casual-compatible; malformed and oversized supplied values fail closed', async () => {
  const f = fixture();
  expect(await f.verify(undefined)).toBeUndefined();
  for (const header of ['', 'Basic abc', 'Bearer abc', 'Bearer a.b.c\n', 'Bearer ' + 'x'.repeat(8192)]) await expect(f.verify(header)).rejects.toThrow('unauthorized');
  expect(f.requests).toHaveLength(0);
});

test('spoofed signature fails before fresh user lookup', async () => {
  const f = fixture();
  const token = f.token();
  const segments = token.split('.');
  const signature = Buffer.from(segments[2]!, 'base64url'); signature[0] = signature[0]! ^ 1;
  segments[2] = signature.toString('base64url');
  await expect(f.verify(`Bearer ${segments.join('.')}`)).rejects.toThrow('unauthorized');
  expect(f.requests.some(path => path.endsWith('/user'))).toBe(false);
});

test('signed tokens require exact project, audience, role, UUID and finite valid times', async () => {
  const f = fixture();
  for (const changes of [
    { iss: 'https://other.supabase.co/auth/v1' }, { aud: 'anon' }, { aud: ['authenticated'] }, { role: 'service_role' },
    { sub: 'arbitrary-account' }, { exp: now / 1000 }, { exp: '9999999999' }, { exp: null },
    { iat: now / 1000 + 1 }, { iat: null }, { nbf: now / 1000 + 1 }, { nbf: '0' }, { is_anonymous: true },
  ]) await expect(f.verify(`Bearer ${f.token(changes)}`)).rejects.toThrow('unauthorized');
  expect(f.requests.some(path => path.endsWith('/user'))).toBe(false);
});

test('fresh Auth response rejects anonymous, mismatched, banned and revoked/unavailable identities', async () => {
  for (const changes of [{ is_anonymous: true }, { is_anonymous: undefined }, { id: '87654321-1234-4123-8123-123456789abc' }, { banned_until: new Date(now + 10000).toISOString() }, { banned_until: 'invalid' }]) {
    const f = fixture(); f.setUser(changes);
    await expect(f.verify(`Bearer ${f.token()}`)).rejects.toThrow('unauthorized');
  }
  const f = fixture();
  expect(await f.verify(`Bearer ${f.token()}`)).toEqual({ accountId });
  f.fail();
  await expect(f.verify(`Bearer ${f.token()}`)).rejects.toThrow('unauthorized');
  const revoked = fixture(); revoked.revoke();
  await expect(revoked.verify(`Bearer ${revoked.token()}`)).rejects.toThrow('unauthorized');
});

test('provider response size and ignored-abort latency are bounded and diagnostics redacted', async () => {
  const f = fixture(); f.oversize();
  await expect(f.verify(`Bearer ${f.token()}`)).rejects.toThrow('unauthorized');
  const blocked = createSupabaseIdentity({ url: 'https://blocked.supabase.co', publishableKey: 'sb_publishable_test_public_key', timeoutMs: 20, clock: () => now, fetch: async () => new Promise<Response>(() => {}) });
  const started = Date.now();
  await expect(blocked(`Bearer ${f.token()}`)).rejects.toThrow('unauthorized');
  expect(Date.now() - started).toBeLessThan(500);
});

test('configuration accepts named public keys only and never exposes rejected configuration', () => {
  expect(readSupabaseIdentityConfig({})).toBeUndefined();
  expect(readSupabaseIdentityConfig({ SUPABASE_URL: 'https://project.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key' })).toEqual({ url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test_public_key' });
  for (const env of [
    { SUPABASE_URL: 'http://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'secret' },
    { SUPABASE_URL: 'https://user:secret@project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'secret' },
    { SUPABASE_URL: 'https://project.supabase.co/path', SUPABASE_PUBLISHABLE_KEY: 'secret' },
    { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' },
  ]) expect(() => readSupabaseIdentityConfig(env)).toThrow('identity_configuration_invalid');
});
