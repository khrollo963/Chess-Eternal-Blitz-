import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createGameServer } from '../src/index.js';
import { registerClientPages } from '../src/http/client-pages.js';
import { TransportSecurity } from '../src/http/transport-security.js';

test('website serves canonical pages and public response-only endpoint behind raw security', async () => {
  const origin = 'https://games.example';
  const { server, app } = createGameServer({ transportSecurity: new TransportSecurity({ allowedOrigins: [origin], allowMissingOrigin: true }), ingressPolicy: 'local-fixture' });
  registerClientPages(app, origin);
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  try {
    await server.listen(port, '127.0.0.1');
    const endpoint = `http://127.0.0.1:${port}`;
    for (const name of ['index.html', 'enochian.html', 'chaturaji.html']) {
      const response = await fetch(`${endpoint}/${name}`);
      expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/html');
      let source = await response.text();
      if (name === 'enochian.html') {
        const config = '<script>window.ENOCHIAN_MULTIPLAYER_CONFIG={"endpoint":"https://games.example"};</script>\n';
        expect(source).toContain(config); source = source.replace(config, '');
      }
      expect(source).toBe(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8'));
    }
    expect((await fetch(endpoint + '/')).status).toBe(200);
    expect((await fetch(endpoint + '/enochian.html', { headers: { Origin: 'null' } })).status).toBe(403);
    expect((await fetch(endpoint + '/server/.env.local')).status).toBe(404);
    expect(() => registerClientPages(app, 'http://remote.example')).toThrow();
  } finally { await server.gracefullyShutdown(false); }
});
