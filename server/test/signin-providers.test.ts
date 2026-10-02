import { expect, test } from 'bun:test';
import { readConfig } from '../src/config.js';
import { startServer } from '../src/recovery/start-server.js';

test('sign-in provider configuration defaults to email and accepts only supported explicit providers', () => {
  expect(readConfig({}).signInProviders).toEqual(['email']);
  expect(readConfig({ MULTIPLAYER_SIGNIN_PROVIDERS: 'github' }).signInProviders).toEqual(['github']);
  expect(readConfig({ MULTIPLAYER_SIGNIN_PROVIDERS: 'github,email, github' }).signInProviders).toEqual(['github', 'email']);
  for (const value of ['', ' ', 'GitHub', 'github,', ',email', 'password', 'github,unsupported', '__proto__']) {
    expect(() => readConfig({ MULTIPLAYER_SIGNIN_PROVIDERS: value })).toThrow('Invalid sign-in providers');
  }
});

test('invalid sign-in provider configuration fails before database acquisition', async () => {
  await expect(startServer({ MULTIPLAYER_SIGNIN_PROVIDERS: 'unsupported', DATABASE_URL: 'postgres://unused.invalid/db' }, { signals: false }))
    .rejects.toThrow('Invalid sign-in providers');
});

test('production GitHub-only page hides email and initiates only GitHub with the exact sign-in redirect', async () => {
  const portReservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = portReservation.port!; portReservation.stop(true);
  const app = await startServer({ PORT: String(port), HOST: '127.0.0.1', MULTIPLAYER_SIGNIN_PROVIDERS: 'github',
    SUPABASE_URL: 'https://auth.example.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_publicfixture' }, { signals: false });
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    const response = await fetch(endpoint + '/signin'); expect(response.status).toBe(200);
    const html = await response.text(); expect(html.includes('providers=["github"]')).toBe(true);
    const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][1]![1]!;
    const elements = new Map<string, any>(), buttons: any[] = [], storage = new Map<string, string>(), oauth: unknown[] = [], completions: Array<{ url: string; init: RequestInit }> = [];
    let session: { access_token: string; refresh_token: string } | null = null;
    const element = () => ({ hidden: false, disabled: false, textContent: '', value: '', handlers: new Map<string, Function>(),
      focus() {}, addEventListener(type: string, callback: Function) { this.handlers.set(type, callback); }, appendChild(button: unknown) { buttons.push(button); } });
    const node = (id: string) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    const browser: any = {}; browser.top = browser; browser.self = browser;
    const execute = (location: unknown) => new Function('window', 'document', 'location', 'history', 'sessionStorage', 'supabase', 'fetch', 'navigator', script)(browser,
      { getElementById: node, createElement: element },
      location,
      { replaceState() {} },
      { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
      { createClient: (_url: string, _key: string, options: any) => { expect(options.auth.flowType).toBe('pkce'); expect(options.auth.detectSessionInUrl).toBe(true); return { auth: {
        getSession: async () => ({ data: { session }, error: null }),
        signInWithOAuth: async (input: unknown) => { oauth.push(input); return { error: null }; },
      } }; } },
      async (url: string, init: RequestInit) => { completions.push({ url, init }); return Response.json({ returnCode: 'c'.repeat(22) }); }, {});
    execute({ hash: `#handoff=${'a'.repeat(43)}&complete=${'b'.repeat(43)}`, pathname: '/signin', search: '', origin: endpoint });
    await Bun.sleep(0);
    expect(node('emailPanel').hidden).toBe(true);
    expect(buttons).toHaveLength(1); expect(buttons[0].textContent).toBe('Continue with GitHub'); expect(buttons[0].disabled).toBe(false);
    await buttons[0].handlers.get('click')();
    expect(oauth).toEqual([{ provider: 'github', options: { redirectTo: endpoint + '/signin' } }]);
    // A same-tab PKCE callback restores its private binding and automatically
    // returns the SDK-established session without code entry or email traffic.
    session = { access_token: 'header.payload.signature', refresh_token: 'NEVER_RELAY_REFRESH_TOKEN' };
    elements.clear(); buttons.length = 0;
    execute({ hash: '', pathname: '/signin', search: '?code=fixture-authorization-code', origin: endpoint });
    await Bun.sleep(0);
    expect(completions).toHaveLength(1); expect(completions[0]!.url).toBe('/identity/handoffs/complete');
    expect((completions[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer header.payload.signature');
    expect(JSON.parse(completions[0]!.init.body as string)).toEqual({ handoffId: 'a'.repeat(43), completionSecret: 'b'.repeat(43) });
    expect(completions[0]!.init.body).not.toContain('NEVER_RELAY_REFRESH_TOKEN');
    expect(node('done').hidden).toBe(false); expect(node('returnCode').value).toBe('c'.repeat(22));
    expect(storage.has('enochian-signin-handoff')).toBe(false);
  } finally { await app.close(); }
});
