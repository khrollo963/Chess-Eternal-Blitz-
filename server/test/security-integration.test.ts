import { expect, test } from 'bun:test';
import { request as httpRequest } from 'node:http';
import { Client, type Room } from '@colyseus/sdk';
import { createGameServer } from '../src/index.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { TransportSecurity } from '../src/http/transport-security.js';
import { SecureBunWebSockets } from '../src/http/SecureBunWebSockets.js';
import { startServer } from '../src/recovery/start-server.js';

const origin = 'https://games.example';
async function waitFor(predicate: () => boolean) { const until = Date.now() + 5000; while (!predicate()) { if (Date.now() >= until) throw new Error('Security integration timed out'); await Bun.sleep(2); } }
async function fixture(security = new TransportSecurity({ allowedOrigins: [origin], allowMissingOrigin: true }), clock?: () => number) {
  const store = new MemoryLobbyStore();
  const app = createGameServer({ store, transportSecurity: security, ingressPolicy: 'local-fixture', clock, botOptions: { delayMs: 10000 } });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true); await app.server.listen(port, '127.0.0.1');
  const endpoint = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body) });
  return { ...app, store, endpoint, post };
}
test('raw guard covers matchmaking, OPTIONS, invites and WebSocket upgrades while preserving real SDK joins', async () => {
  const f = await fixture(); let joined: Room | undefined;
  try {
    expect(f.transport).toBeInstanceOf(SecureBunWebSockets);
    expect((await fetch(f.endpoint + '/health')).status).toBe(200); expect((await fetch(f.endpoint + '/ready')).status).toBe(503);
    for (const denied of ['null', 'https://games.example.evil', 'https://games.example/']) {
      const preflight = await fetch(f.endpoint + '/matchmake/joinById/private', { method: 'OPTIONS', headers: { Origin: denied, 'Access-Control-Request-Method': 'POST' } });
      expect(preflight.status).toBe(403); expect(preflight.headers.has('access-control-allow-origin')).toBe(false);
      expect((await f.post('/matchmake/joinById/private', {}, { Origin: denied })).status).toBe(403);
      expect((await f.post('/invitations', { mode: 'casual', name: 'Denied', color: 'R' }, { Origin: denied })).status).toBe(403);
    }
    const allowed = await fetch(f.endpoint + '/matchmake/joinById/private', { method: 'OPTIONS', headers: { Origin: origin } });
    expect(allowed.status).toBe(204); expect(allowed.headers.get('access-control-allow-origin')).toBe(origin); expect(allowed.headers.get('vary')).toBe('Origin');
    const response = await f.post('/invitations', { mode: 'casual', name: 'Alice', color: 'R' }); expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin); const ticket = await response.json();
    joined = await new Client(f.endpoint).joinById(ticket.roomId, { credential: ticket.credential }); joined.onMessage('ack', () => {});
    expect((await f.store.load(ticket.matchId))!.seats.R.connected).toBe(true);
    const rejectedUpgrade = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(f.endpoint + '/private/private?sessionId=invalid', { headers: { Origin: 'null', Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'MDEyMzQ1Njc4OWFiY2RlZg==' } }, response => { response.resume(); resolve(response.statusCode!); });
      request.on('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Denied origin unexpectedly upgraded')); });
      request.on('error', reject); request.end();
    });
    expect(rejectedUpgrade).toBe(403);
  } finally { await f.server.gracefullyShutdown(false); }
}, 15000);
test('chunked bodies without Content-Length are capped before router or Express allocation', async () => {
  const f = await fixture(); let echoed = 0;
  f.app.post('/bounded-echo', (_req, res) => { echoed++; res.json({ ok: true }); });
  const chunked = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(f.endpoint + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode!, body }));
    });
    request.on('error', reject); request.write('{"text":"'); request.write('PRIVATE_BODY_SENTINEL'.repeat(180)); request.end('"}');
  });
  try {
    for (const path of ['/bounded-echo', '/invitations', '/matchmake/create/enochian']) {
      const result = await chunked(path); expect(result.status).toBe(413); expect(result.body).not.toContain('PRIVATE_BODY_SENTINEL');
    }
    expect(echoed).toBe(0);
    expect((await f.post('/bounded-echo', { text: 'small' })).status).toBe(200); expect(echoed).toBe(1);
    expect((await f.post('/matchmake/create/enochian', ['invalid'])).status).toBe(400);
  } finally { await f.server.gracefullyShutdown(false); }
}, 15000);
test('native peer quotas cannot be reset by forwarded headers and probes keep real status', async () => {
  const f = await fixture(new TransportSecurity({ allowedOrigins: [origin], allowMissingOrigin: true, limits: { http: { limit: 2, windowMs: 1000, maxBuckets: 2 } } }), () => 0);
  try {
    expect((await fetch(f.endpoint + '/identity/config', { headers: { Origin: origin, 'X-Forwarded-For': 'a', 'X-Forwarded-Proto': 'https' } })).status).toBe(503);
    expect((await fetch(f.endpoint + '/identity/config', { headers: { Origin: origin, 'X-Forwarded-For': 'b', 'X-Real-IP': 'b' } })).status).toBe(503);
    const limited = await fetch(f.endpoint + '/identity/config', { headers: { Origin: origin, 'X-Forwarded-For': 'c' } });
    expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('1');
    expect((await fetch(f.endpoint + '/health')).status).toBe(200); expect((await fetch(f.endpoint + '/ready')).status).toBe(503);
  } finally { await f.server.gracefullyShutdown(false); }
}, 15000);
test('authenticated SDK action spam is rejected before state mutation across known message handlers', async () => {
  const f = await fixture(new TransportSecurity({ allowedOrigins: [origin], allowMissingOrigin: true, limits: { action: { limit: 2, windowMs: 1000, maxBuckets: 8 } } }), () => 0);
  try {
    const ticket = await (await f.post('/invitations', { mode: 'casual', name: 'Alice', color: 'R' })).json();
    const room = await new Client(f.endpoint).joinById(ticket.roomId, { credential: ticket.credential });
    const acks: Array<{ code: string }> = []; room.onMessage('ack', ack => acks.push(ack));
    const before = (await f.store.load(ticket.matchId))!.revision;
    room.send('command', {}); room.send('lobby_command', {}); room.send('exchange_command', {});
    await waitFor(() => acks.length === 3);
    expect(acks.map(ack => ack.code)).toEqual(['invalid_command', 'invalid_command', 'rate_limited']);
    expect((await f.store.load(ticket.matchId))!.revision).toBe(before);
  } finally { await f.server.gracefullyShutdown(false); }
}, 15000);
test('production start cannot fail open without explicit validated HTTPS ingress configuration', async () => {
  await expect(startServer({ NODE_ENV: 'production', PORT: '9999', HOST: '127.0.0.1' }, { signals: false })).rejects.toThrow('Invalid ingress policy');
  await expect(startServer({ NODE_ENV: 'production', MULTIPLAYER_INGRESS_POLICY: 'railway-edge-only', MULTIPLAYER_PUBLIC_ENDPOINT: 'http://unsafe.example', MULTIPLAYER_ALLOWED_ORIGINS: 'https://games.example' }, { signals: false })).rejects.toThrow('Invalid public endpoint');
  expect(() => new SecureBunWebSockets({}, { security: new TransportSecurity({ allowedOrigins: [origin] }), ingressPolicy: 'local-fixture' }).listen(9999, '0.0.0.0')).toThrow('Local fixture must bind loopback');
});
