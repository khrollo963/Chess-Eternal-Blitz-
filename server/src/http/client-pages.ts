import { readFileSync } from 'node:fs';
import type { BunWebSockets } from '@colyseus/bun-websockets';
import { publicEndpoint } from './transport-security.js';

type App = ReturnType<BunWebSockets['getExpressApp']>;
/** The approved website preview uses canonical pages; configuration is response-only. */
export function registerClientPages(app: App, endpoint: string, root = new URL('../../../', import.meta.url)) {
  const address = publicEndpoint(endpoint);
  for (const name of ['index.html', 'enochian.html', 'chaturaji.html']) {
    let source = readFileSync(new URL(name, root), 'utf8');
    if (name === 'enochian.html') {
      const marker = '<!-- ENOCHIAN_CLIENT_SDKS_BEGIN -->';
      if (source.split(marker).length !== 2) throw new Error('Client configuration boundary missing');
      const serialized = JSON.stringify({ endpoint: address }).replace(/</g, '\\u003c');
      source = source.replace(marker, `<script>window.ENOCHIAN_MULTIPLAYER_CONFIG=${serialized};</script>\n${marker}`);
    }
    const serve = (_req: unknown, res: { setHeader(name: string, value: string): unknown; send(body: string): unknown }) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.send(source);
    };
    app.get(`/${name}`, serve);
    if (name === 'index.html') app.get('/', serve);
  }
}
