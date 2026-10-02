import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const htmlPath = resolve(root, 'enochian.html');
const packages = [
  { name: '@colyseus/sdk', version: '0.18.4', bundle: 'dist/colyseus.js' },
  { name: '@supabase/supabase-js', version: '2.117.2', bundle: 'dist/umd/supabase.js' },
];
const hash = text => createHash('sha256').update(text).digest('hex');
const safe = text => text.replace(/<\/script/gi, '<\\/script');
const licenses = ['@colyseus/sdk','@colyseus/schema','@colyseus/shared-types','@colyseus/better-call','msgpackr','tslib','@supabase/supabase-js','@supabase/auth-js','@supabase/realtime-js','@supabase/functions-js','@supabase/storage-js','@supabase/postgrest-js'];
const licenseText = licenses.map(name => {
  const directory = resolve(root, 'server/node_modules', name);
  const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  let text;
  for (const file of ['LICENSE','LICENSE.md','LICENSE.txt','LICENSE-MIT.txt']) {
    try { text = readFileSync(resolve(directory, file), 'utf8'); break; } catch { /* known alternate license filename */ }
  }
  if (!text) throw new Error(`Missing bundled license: ${name}`);
  return `${name}@${metadata.version}\n${text}`;
}).join('\n\n');
const scripts = packages.map(({ name, version, bundle }) => {
  const directory = resolve(root, 'server/node_modules', name);
  const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.version !== version) throw new Error(`Unapproved SDK version: ${name}`);
  const original = readFileSync(resolve(directory, bundle), 'utf8');
  const body = safe(original.replace(/^\/\/# sourceMappingURL=.*$/gm, ''));
  return `<!-- ${name}@${version}; source SHA-256 ${hash(original)} -->\n<script data-enochian-vendor="${name}">\n${body}\n</script>`;
}).join('\n');
const block = `<!-- ENOCHIAN_CLIENT_SDKS_BEGIN -->\n<script type="application/json" id="enochian-sdk-licenses">${safe(JSON.stringify({ packages, licenses: licenseText }))}</script>\n${scripts}\n<!-- ENOCHIAN_CLIENT_SDKS_END -->\n`;
const source = readFileSync(htmlPath, 'utf8');
const pattern = /<!-- ENOCHIAN_CLIENT_SDKS_BEGIN -->[\s\S]*?<!-- ENOCHIAN_CLIENT_SDKS_END -->\r?\n?/;
const next = pattern.test(source) ? source.replace(pattern, () => block) : source.replace('<!-- ENOCHIAN_MULTIPLAYER_CLIENT_BEGIN -->', () => block + '<!-- ENOCHIAN_MULTIPLAYER_CLIENT_BEGIN -->');
if (next === source && !pattern.test(source)) throw new Error('Missing multiplayer client insertion marker');
if (process.argv.includes('--check')) {
  if (next !== source) throw new Error('Embedded SDK bundles are stale; run scripts/embed-client-sdks.mjs');
  console.log('Pinned inline SDKs, source hashes and licenses verified.');
} else { writeFileSync(htmlPath, next); console.log('Embedded approved official browser SDKs and licenses.'); }
