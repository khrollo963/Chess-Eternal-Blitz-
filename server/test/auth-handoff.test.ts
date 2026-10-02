import { expect, test } from 'bun:test';
import { AuthHandoff } from '../src/identity/AuthHandoff.js';
import { registerSignIn } from '../src/http/signin.js';
import { createGameServer } from '../src/index.js';

const accountId = '01a00000-0000-4000-8000-000000000001', authorization = 'Bearer header.payload.signature';
const verified = async () => ({ accountId });
test('handoff secrets are distinct, bounded and never retained as cleartext', () => {
  const handoffs = new AuthHandoff({ verifyAuth: verified, clock: () => 0 });
  const created = handoffs.create();
  expect(created.handoffId).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(created.pollSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(created.completionSecret).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(created.expiresAt).toBe(300000);
  expect(new Set([created.handoffId, created.pollSecret, created.completionSecret]).size).toBe(3);
  const internals = JSON.stringify([...Reflect.get(handoffs, 'entries').values()]);
  expect(internals).not.toContain(created.pollSecret); expect(internals).not.toContain(created.completionSecret);
  expect(() => new AuthHandoff({ verifyAuth: verified, capacity: 1001 })).toThrow('handoff_configuration_invalid');
});
test('public ID alone, swapped secrets and wrong manual code cannot consume a handoff', async () => {
  const h = new AuthHandoff({ verifyAuth: verified }), x = h.create();
  expect(() => h.consume(x.handoffId, undefined)).toThrow('unauthorized');
  expect(() => h.consume(x.handoffId, x.completionSecret)).toThrow('unauthorized');
  await expect(h.complete(x.handoffId, x.pollSecret, authorization)).rejects.toThrow('unauthorized');
  expect(h.consume(x.handoffId, x.pollSecret)).toEqual({ pending: true });
  const completed = await h.complete(x.handoffId, x.completionSecret, authorization);
  expect(completed.returnCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(() => h.consume(x.handoffId, x.pollSecret, 'a'.repeat(22))).toThrow('unauthorized');
  expect(h.consume(x.handoffId, x.pollSecret, completed.returnCode)).toEqual({ authorization, accountId });
  expect(() => h.consume(x.handoffId, x.pollSecret)).toThrow('unauthorized');
});
test('verified account is authoritative, provider errors are redacted and no unverified token is retained', async () => {
  let calls = 0, allowed = false;
  const h = new AuthHandoff({ verifyAuth: async value => { calls++; expect(value).toBe(authorization); if (!allowed) throw new Error('PRIVATE_PROVIDER_SENTINEL'); return { accountId }; } }), x = h.create();
  await expect(h.complete(x.handoffId, x.completionSecret, 'Bearer unverified')).rejects.toThrow('unauthorized');
  expect(calls).toBe(0);
  await expect(h.complete(x.handoffId, x.completionSecret, authorization)).rejects.toThrow('unauthorized');
  expect(h.consume(x.handoffId, x.pollSecret)).toEqual({ pending: true });
  allowed = true; await h.complete(x.handoffId, x.completionSecret, authorization);
  expect(h.consume(x.handoffId, x.pollSecret)).toEqual({ authorization, accountId }); expect(calls).toBe(2);
});
test('completion and consumption races allow exactly one successful operation', async () => {
  const h = new AuthHandoff({ verifyAuth: verified }), x = h.create();
  const completion = await Promise.allSettled([h.complete(x.handoffId, x.completionSecret, authorization), h.complete(x.handoffId, x.completionSecret, authorization)]);
  expect(completion.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(completion.filter(result => result.status === 'rejected')).toHaveLength(1);
  await expect(h.complete(x.handoffId, x.completionSecret, authorization)).rejects.toThrow('handoff_completed');
  const consumed = await Promise.allSettled([Promise.resolve().then(() => h.consume(x.handoffId, x.pollSecret)), Promise.resolve().then(() => h.consume(x.handoffId, x.pollSecret))]);
  expect(consumed.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(consumed.filter(result => result.status === 'rejected')).toHaveLength(1);
});
test('expiry is strict at 300000, purges bounded capacity and applies across a yielding verifier', async () => {
  let now = 0;
  const h = new AuthHandoff({ verifyAuth: verified, clock: () => now, capacity: 2 });
  const first = h.create(), second = h.create(); expect(() => h.create()).toThrow('handoff_capacity');
  now = 299999; expect(h.consume(first.handoffId, first.pollSecret)).toEqual({ pending: true });
  await h.complete(second.handoffId, second.completionSecret, authorization);
  now = 300000; expect(() => h.consume(first.handoffId, first.pollSecret)).toThrow('handoff_expired');
  expect(() => h.consume(second.handoffId, second.pollSecret)).toThrow('handoff_expired');
  expect(h.create().expiresAt).toBe(600000);
  const slow = new AuthHandoff({ verifyAuth: async () => { now = 900000; return { accountId }; }, clock: () => now });
  const ticket = slow.create();
  await expect(slow.complete(ticket.handoffId, ticket.completionSecret, authorization)).rejects.toThrow('handoff_expired');
});
test('process restart cannot recover an old handoff or account token', () => {
  const old = new AuthHandoff({ verifyAuth: verified }).create(), restarted = new AuthHandoff({ verifyAuth: verified });
  expect(() => restarted.consume(old.handoffId, old.pollSecret)).toThrow('unauthorized');
});
test('HTTP sign-in headers, local SDK bundle, one-time handoff and safe provider defaults', async () => {
  let now = 0;
  const { server } = createGameServer({ identityConfig: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_testpublickey' }, verifyAuth: verified, clock: () => now });
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true); const endpoint = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown, auth?: string) => fetch(endpoint + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) });
  try {
    await server.listen(port, '127.0.0.1');
    const page = await fetch(endpoint + '/signin'), html = await page.text();
    expect(page.status).toBe(200); expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer'); expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(html).toContain('Supabase JS 2.117.2'); expect(html).toContain('Permission is hereby granted');
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i); expect(html).not.toContain('sourceMappingURL');
    expect(html).toContain('providers=["email"]'); expect(html).toContain("flowType:'pkce'");
    expect(html).toContain("type:'email'"); expect(html).toContain("history.replaceState(null,'',location.pathname+location.search)");
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(2); for (const script of scripts) expect(() => new Function(script[1]!)).not.toThrow();
    const source = scripts[1]![1]!;
    expect(source).not.toContain('refresh_token'); expect(source).not.toContain('postMessage'); expect(source).not.toContain('opener');
    // Execute the application script with provider stubs: sending/verification require explicit form submission.
    const handlers = new Map<string, (event: { preventDefault(): void }) => Promise<void>>();
    const elements = new Map<string, any>();
    const node = (id: string) => {
      if (!elements.has(id)) elements.set(id, { value: '', hidden: false, textContent: '', disabled: false, focus: () => {}, select: () => {}, appendChild: () => {}, addEventListener: (_type: string, callback: (event: { preventDefault(): void }) => Promise<void>) => handlers.set(id, callback) });
      return elements.get(id);
    };
    const values = new Map<string, string>(), browser: any = {}; browser.top = browser; browser.self = browser;
    const sent: unknown[] = [], verifiedCodes: unknown[] = [], completionRequests: Array<{ url: string; init: RequestInit }> = [], history: string[] = [];
    new Function('window','document','location','history','sessionStorage','supabase','fetch','navigator',source)(browser,
      { getElementById: node, createElement: () => node('provider') },
      { hash: `#handoff=${'a'.repeat(43)}&complete=${'b'.repeat(43)}`, pathname: '/signin', search: '', origin: endpoint },
      { replaceState: (_state: unknown, _title: unknown, url: string) => history.push(url) },
      { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
      { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null }, error: null }),
        signInWithOtp: async (input: unknown) => { sent.push(input); return { error: null }; },
        verifyOtp: async (input: unknown) => { verifiedCodes.push(input); return { error: null, data: { session: { access_token: 'header.payload.signature', refresh_token: 'DO_NOT_RELAY' } } }; } } }) },
      async (url: string, init: RequestInit) => { completionRequests.push({ url, init }); return Response.json({ returnCode: 'c'.repeat(22) }); }, { clipboard: {} });
    await Bun.sleep(0); expect(sent).toHaveLength(0); expect(verifiedCodes).toHaveLength(0); expect(history[0]).toBe('/signin');
    node('email').value = 'player@example.test'; node('code').value = '123456';
    await handlers.get('emailForm')!({ preventDefault: () => {} }); expect(sent).toHaveLength(1);
    await handlers.get('codeForm')!({ preventDefault: () => {} });
    expect(verifiedCodes).toEqual([{ email: 'player@example.test', token: '123456', type: 'email' }]);
    expect(completionRequests).toHaveLength(1); expect(completionRequests[0]!.url).toBe('/identity/handoffs/complete');
    expect((completionRequests[0]!.init.headers as Record<string, string>).Authorization).toBe(authorization);
    expect(completionRequests[0]!.init.body).not.toContain('DO_NOT_RELAY');
    expect(completionRequests[0]!.init.body).not.toContain('header.payload.signature');
    expect(node('returnCode').value).toBe('c'.repeat(22)); expect(values.has('enochian-signin-handoff')).toBe(false);
    const creation = await post('/identity/handoffs', {}); expect(creation.status).toBe(201); const handoff = await creation.json();
    expect((await post('/identity/handoffs/consume', { handoffId: handoff.handoffId, pollSecret: handoff.pollSecret })).status).toBe(202);
    expect((await post('/identity/handoffs/complete', { handoffId: handoff.handoffId, completionSecret: handoff.completionSecret })).status).toBe(401);
    const complete = await post('/identity/handoffs/complete', { handoffId: handoff.handoffId, completionSecret: handoff.completionSecret }, authorization);
    expect(complete.status).toBe(200); const { returnCode } = await complete.json();
    expect(JSON.stringify({ returnCode })).not.toContain('payload');
    const consumed = await post('/identity/handoffs/consume', { handoffId: handoff.handoffId, pollSecret: handoff.pollSecret, returnCode });
    expect(await consumed.json()).toEqual({ authorization, accountId });
    expect((await post('/identity/handoffs/consume', { handoffId: handoff.handoffId, pollSecret: handoff.pollSecret })).status).toBe(401);
    const expiring = await (await post('/identity/handoffs', {})).json(); now = 300000;
    expect((await post('/identity/handoffs/complete', { handoffId: expiring.handoffId, completionSecret: expiring.completionSecret }, authorization)).status).toBe(410);
    expect((await post('/identity/handoffs/complete', { handoffId: 'public-id', completionSecret: 'x', accountId, refreshToken: 'NEVER_ACCEPTED' }, authorization)).status).toBe(401);
  } finally { await server.gracefullyShutdown(false); }
}, 15000);
test('disabled identity does not create handoffs or serve sign-in configuration', async () => {
  const routes = new Map<string, Function>();
  const app = { get: (path: string, callback: Function) => routes.set(path, callback), post: (path: string, callback: Function) => routes.set(path, callback) } as unknown as Parameters<typeof registerSignIn>[0];
  registerSignIn(app, {});
  let status = 200, response: unknown;
  const res = { setHeader: () => {}, status: (code: number) => { status = code; return res; }, json: (data: unknown) => { response = data; } };
  await routes.get('/identity/handoffs')!({ body: '{}' }, res);
  expect(status).toBe(503); expect(response).toEqual({ code: 'identity_unavailable' });
});
