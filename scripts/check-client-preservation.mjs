import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractGames, inventory, launcherOutsideLoader, readBaseline, readOriginal, root, sha256, stripPayloads } from './client-baseline.mjs';

export function checkPreservation() {
  const baseline = readBaseline();
  const original = readOriginal();
  assert.equal(sha256(original), baseline.original.sha256, 'Original launcher hash');
  const games = extractGames(original.toString('utf8'));
  for (const [game, { base64, bytes }] of Object.entries(games)) {
    assert.equal(sha256(base64), baseline.games[game].base64Sha256, `${game} Base64 snapshot`);
    assert.equal(sha256(bytes), baseline.games[game].decodedSha256, `${game} decoded snapshot`);
    const current = readFileSync(resolve(root, `${game}.html`));
    assert.ok(current.equals(bytes), `${game} page must match the original extraction byte for byte`);
    assert.deepEqual(inventory(current.toString('utf8')), inventory(bytes.toString('utf8')), `${game} keys and inline art`);
  }
  const launcher = readFileSync(resolve(root, 'index.html'), 'utf8');
  assert.doesNotMatch(launcher, /CHATURAJI_HTML_B64|ENOCHIAN_HTML_B64|b64ToUtf8|\.srcdoc\s*=/);
  assert.equal(sha256(launcherOutsideLoader(launcher)), baseline.launcherOutsideLoaderSha256, 'Only payloads and launcher loading may change');
  assert.deepEqual(inventory(launcher), baseline.launcherInventory, 'Launcher keys and inline art');
  assert.equal(launcherOutsideLoader(launcher), launcherOutsideLoader(original.toString('utf8')), 'Launcher statistics, navigation, styles and markup');
  return baseline;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPreservation();
  console.log('Preservation verified: both exact game pages, storage keys, inline art, statistics and scoped launcher changes.');
}
