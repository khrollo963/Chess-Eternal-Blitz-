import { expect, test } from 'bun:test';
import { readConfig } from '../src/config.js';
import { startServer } from '../src/recovery/start-server.js';

test('ranked runtime admission is disabled unless explicitly enabled', () => {
  expect(readConfig({}).rankedEnabled).toBe(false);
  expect(readConfig({ MULTIPLAYER_RANKED_ENABLED: 'false' }).rankedEnabled).toBe(false);
  expect(readConfig({ MULTIPLAYER_RANKED_ENABLED: 'true' }).rankedEnabled).toBe(true);
  for (const value of ['', '1', 'TRUE', 'yes', ' true ']) {
    expect(() => readConfig({ MULTIPLAYER_RANKED_ENABLED: value })).toThrow('Invalid ranked policy');
  }
});

test('ranked startup requires valid identity before opening the durable runtime', async () => {
  await expect(startServer({ MULTIPLAYER_RANKED_ENABLED: 'true' }, { signals: false }))
    .rejects.toThrow('Ranked requires identity configuration');
  await expect(startServer({ MULTIPLAYER_RANKED_ENABLED: 'true', SUPABASE_URL: 'http://auth.example.test',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_publicfixture' }, { signals: false }))
    .rejects.toThrow('identity_configuration_invalid');
});

test('production entrypoint passes ranked opt-in to public configuration while durable readiness stays enforced', async () => {
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const app = await startServer({ PORT: String(port), HOST: '127.0.0.1', MULTIPLAYER_RANKED_ENABLED: 'true',
    SUPABASE_URL: 'https://auth.example.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_publicfixture' }, { signals: false });
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    expect((await (await fetch(endpoint + '/identity/config')).json()).rankedEnabled).toBe(true);
    expect((await fetch(endpoint + '/ready')).status).toBe(503);
    expect(app.lobby).toBeUndefined();
  } finally { await app.close(); }
});
