import { readFileSync } from 'node:fs';

// Local packaging acceptance only. No database, credentials or deployment.
const root = new URL('../../../', import.meta.url);
const files = new Map<string, string>([
  ['/package/index.html', 'index.html'], ['/package/enochian.html', 'enochian.html'], ['/package/chaturaji.html', 'chaturaji.html'],
  ['/standalone/index.html', 'dist/index.html'],
]);
const requests: Record<string, number> = {};
const server = Bun.serve({ hostname: '127.0.0.1', port: 41742, fetch(request) {
  const path = new URL(request.url).pathname;
  requests[path] = (requests[path] ?? 0) + 1;
  if (path === '/__requests') return Response.json(requests);
  const file = files.get(path);
  if (!file) return new Response('Not found', { status: 404 });
  return new Response(readFileSync(new URL(file, root)), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
} });
console.info('Local packaged previews: http://127.0.0.1:41742/package/index.html and /standalone/index.html');
process.once('SIGINT', () => server.stop(true));
process.once('SIGTERM', () => server.stop(true));
