import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../../src/index.js';
import { MemoryLobbyStore } from '../../src/storage/MemoryLobbyStore.js';

/** Local browser acceptance fixture only; never a production entry point. */
const hostname = '127.0.0.1';
const port = process.env.PREVIEW_PORT === undefined ? 41741 : Number(process.env.PREVIEW_PORT);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PREVIEW_PORT');
const endpoint = `http://${hostname}:${port}`;
const root = new URL('../../../', import.meta.url);
const pages = new Map<string, string>();
for (const name of ['index.html', 'enochian.html', 'chaturaji.html']) {
  let source = readFileSync(fileURLToPath(new URL(name, root)), 'utf8');
  if (name === 'enochian.html') {
    const marker = '<!-- ENOCHIAN_CLIENT_SDKS_BEGIN -->';
    if (!source.includes(marker)) throw new Error('Multiplayer SDK insertion marker is missing');
    const configuration = `<script>window.ENOCHIAN_MULTIPLAYER_CONFIG=${JSON.stringify({ endpoint })};</script>\n`;
    // Inject only into this served response. Canonical files and engine stay untouched.
    source = source.replace(marker, () => configuration + marker);
  }
  pages.set(name, source);
}

const store = new MemoryLobbyStore();
const { server, app } = createGameServer({
  store, isReady: () => true, rankedEnabled: false,
  botOptions: { delayMs: 3000 },
});
for (const [name, source] of pages) {
  const serve = (_request: unknown, response: { setHeader(name: string, value: string): unknown; send(body: string): unknown }) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(source);
  };
  app.get(`/${name}`, serve);
  if (name === 'index.html') app.get('/', serve);
}

await server.listen(port, hostname);
console.info(`Local-only memory browser preview: ${endpoint}/index.html`);
console.info('Ranked and live identity are disabled. Use two tabs to create, join and confirm Ready.');
let closing: Promise<void> | undefined;
const close = () => closing ??= server.gracefullyShutdown(false);
process.once('SIGINT', close);
process.once('SIGTERM', close);
