import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, sha256 } from './client-baseline.mjs';

export const generatedPath = resolve(root, 'server/src/generated/enochian-engine.mjs');

export function engineBlock(html) {
  const start = '// ENOCHIAN_ENGINE_START\n', end = '// ENOCHIAN_ENGINE_END';
  assert.equal(html.split(start).length, 2, 'Exactly one engine start marker');
  assert.equal(html.split(end).length, 2, 'Exactly one engine end marker');
  const from = html.indexOf(start) + start.length, to = html.indexOf(end);
  assert.ok(to > from, 'Engine markers are ordered');
  return html.slice(from, to);
}

export function generatedEngine(html) {
  const block = engineBlock(html);
  return `// Generated from the canonical marked block in enochian.html. Do not edit.\n// Source SHA-256: ${sha256(block)}\n${block}\nexport { EnochianEngine };\nexport default EnochianEngine;\n`;
}

export function extractEngine({ check = false } = {}) {
  const output = generatedEngine(readFileSync(resolve(root, 'enochian.html'), 'utf8'));
  if (check) assert.equal(readFileSync(generatedPath, 'utf8'), output, 'Generated Enochian engine is stale; regenerate it');
  else { mkdirSync(dirname(generatedPath), { recursive: true }); writeFileSync(generatedPath, output, 'utf8'); }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.slice(2).every(arg => arg === '--check'), 'Only --check is supported');
  extractEngine({ check: process.argv.includes('--check') });
  console.log(process.argv.includes('--check') ? 'Canonical engine extraction is current.' : 'Canonical engine extracted.');
}
