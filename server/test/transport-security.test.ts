import { expect, test } from 'bun:test';
import { BoundedRateLimiter, OriginPolicy, TransportSecurity, decodedPayloadFits, readBoundedJson, publicEndpoint } from '../src/http/transport-security.js';

const request = (origin: string | null = 'https://games.example', headers: Record<string, string> = {}, path = '/invitations') => new Request(`http://internal${path}`, { headers: { ...(origin === null ? {} : { Origin: origin }), ...headers } });
test('exact browser origins reject lookalikes, wildcard, opaque null and malformed origins', () => {
  const policy = new OriginPolicy(['https://games.example', 'https://embed.example:8443']);
  expect(policy.allows('https://games.example')).toBe(true); expect(policy.allows('https://embed.example:8443')).toBe(true);
  for (const origin of [null, 'null', '*', 'https://games.example/', 'https://games.example.evil', 'https://games.example@evil', 'http://games.example', 'https://embed.example', 'https://games.example, https://evil.example']) expect(policy.allows(origin)).toBe(false);
  for (const origins of [['*'], ['null'], ['https://example/path'], ['https://user:password@example'], ['http://example']]) expect(() => new OriginPolicy(origins)).toThrow('Invalid allowed origin');
});
test('absent native SDK origin is an explicit policy and never permits null origin', () => {
  const native = new OriginPolicy(['https://games.example'], { allowMissingOrigin: true });
  expect(native.allows(null)).toBe(true); expect(native.allows('null')).toBe(false);
});
test('rate limits expire at fixed boundary and repeated rejected attempts never extend timers', () => {
  const limiter = new BoundedRateLimiter({ limit: 2, windowMs: 1000, maxBuckets: 2 });
  expect(limiter.consume('peer', 0).allowed).toBe(true); expect(limiter.consume('peer', 100).allowed).toBe(true);
  expect(limiter.consume('peer', 999)).toMatchObject({ allowed: false, retryAfterMs: 1 });
  expect(limiter.consume('peer', 1000).allowed).toBe(true); expect(limiter.size).toBe(1);
});
test('bucket flooding is memory bounded and never evicts live buckets to reset their quota', () => {
  const limiter = new BoundedRateLimiter({ limit: 1, windowMs: 1000, maxBuckets: 2 });
  expect(limiter.consume('a', 0).allowed).toBe(true); expect(limiter.consume('b', 0).allowed).toBe(true);
  for (let i = 0; i < 1000; i++) expect(limiter.consume(`new-${i}`, 10).allowed).toBe(false);
  expect(limiter.size).toBe(2); expect(limiter.consume('a', 999).allowed).toBe(false);
  expect(limiter.consume('new', 1000).allowed).toBe(true); expect(limiter.size).toBeLessThanOrEqual(2);
});
test('UTF-8 byte cap and streaming body cap reject before parsing oversized or malformed data', async () => {
  expect(decodedPayloadFits({ text: 'é'.repeat(1020) })).toBe(false); expect(decodedPayloadFits({ action: { type: 'offer' } })).toBe(true);
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic; expect(decodedPayloadFits(cyclic)).toBe(false);
  expect(decodedPayloadFits(null)).toBe(false);
  await expect(readBoundedJson(new Request('https://api.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(2048) }) }))).rejects.toThrow('payload_too_large');
  await expect(readBoundedJson(new Request('https://api.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1]' }))).rejects.toThrow('invalid_command');
  await expect(readBoundedJson(new Request('https://api.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad}' }))).rejects.toThrow('invalid_command');
  expect(await readBoundedJson(new Request('https://api.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Chess"}' }))).toEqual({ name: 'Chess' });
});
test('spoofed forwarded IP and proto headers cannot change rate bucket or prove TLS', () => {
  const security = new TransportSecurity({ allowedOrigins: ['https://games.example'], limits: { http: { limit: 1, windowMs: 1000, maxBuckets: 2 } } });
  expect(security.guard(request('https://games.example', { 'X-Forwarded-Proto': 'https' }), { sourceKey: 'real-peer', secure: false }, 0)?.status).toBe(426);
  expect(security.guard(request('https://games.example', { 'X-Forwarded-For': 'first' }), { sourceKey: 'real-peer', secure: true }, 0)).toBeUndefined();
  expect(security.guard(request('https://games.example', { 'X-Forwarded-For': 'rotated', 'X-Real-IP': 'other' }), { sourceKey: 'real-peer', secure: true }, 1)?.status).toBe(429);
});
test('origin and size rejections redact headers/body/query; health does not bypass readiness route logic', () => {
  const security = new TransportSecurity({ allowedOrigins: ['https://games.example'] });
  expect(security.guard(request('null'), { secure: true }, 0)?.status).toBe(403);
  const denied = security.guard(request('https://evil.example', { Authorization: 'secret' }, '/invitations?token=secret'), { secure: true }, 0)!;
  expect(denied.status).toBe(403); expect(denied.headers.has('Access-Control-Allow-Origin')).toBe(false);
  expect(security.guard(request(null, {}, '/ready'), {}, 0)).toBeUndefined();
  expect(security.guard(new Request('http://internal/ready', { method: 'POST' }), {}, 0)?.status).toBe(403);
  expect(security.guard(request('https://games.example', { 'Content-Length': '2049' }), { secure: true }, 0)?.status).toBe(413);
  const headers = security.corsHeaders('https://games.example'); expect(headers['Access-Control-Allow-Origin']).toBe('https://games.example'); expect(headers.Vary).toBe('Origin');
});
test('beforeUpgrade uses explicit trusted source/TLS rather than Colyseus context.ip', async () => {
  const security = new TransportSecurity({ allowedOrigins: ['https://games.example'], limits: { upgrade: { limit: 1, windowMs: 1000, maxBuckets: 2 } } });
  const hook = security.beforeUpgrade({ trusted: () => ({ sourceKey: 'trusted-peer', secure: true }), clock: () => 0 });
  const context = { ip: 'spoofed-ip', headers: new Headers({ 'x-forwarded-for': 'spoofed-ip' }), token: 'private-token' };
  expect(await hook(request(), context)).toBeUndefined();
  expect((await hook(request('https://games.example', { 'x-forwarded-for': 'rotated' }), { ...context, ip: 'rotated' }) as Response).status).toBe(429);
});
test('actor and connection action budgets are bounded separately and cannot reset through reconnect', () => {
  const security = new TransportSecurity({ allowedOrigins: ['https://games.example'], limits: { action: { limit: 1, windowMs: 1000, maxBuckets: 4 } } });
  expect(security.allowAction({ connectionId: 'one', actorId: 'owner', payload: { action: 'move' } }, 0)).toBeUndefined();
  expect(security.allowAction({ connectionId: 'two', actorId: 'owner', payload: { action: 'move' } }, 1)?.status).toBe(429);
  expect(security.allowAction({ connectionId: 'two', actorId: 'owner', payload: { action: 'move' } }, 1000)).toBeUndefined();
});
test('public endpoint exposes only a canonical HTTPS origin and rejects credentials/insecure targets', () => {
  expect(publicEndpoint('https://game.example')).toBe('https://game.example');
  for (const value of ['http://game.example', 'https://secret@game.example', 'https://game.example/path', 'https://game.example?secret=x', 'wss://game.example']) expect(() => publicEndpoint(value)).toThrow('Invalid public endpoint');
});
