import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { extractGames, inventory, launcherOutsideLoader, readBaseline, readOriginal, root, sha256, stripPayloads } from './client-baseline.mjs';

function outsideInlineScript(source) {
  const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'Exactly one existing inline game script');
  assert.equal((source.match(/<script\b/gi) || []).length, 1, 'No additional script tags');
  const match = scripts[0], bodyStart = match.index + '<script>'.length;
  return source.slice(0, bodyStart) + source.slice(bodyStart + match[1].length);
}

export function checkGamePage(game, current, original) {
  if (game === 'chaturaji') assert.equal(current, original, 'Chaturaji remains byte-identical');
  else {
    assert.equal(game, 'enochian', 'Only Enochian has a permitted script boundary');
    assert.equal(outsideInlineScript(current), outsideInlineScript(original), 'Enochian markup, CSS and all bytes outside the existing script are protected');
    assert.match(current, /window\.parent\.addGameSession\('enochian',/, 'Enochian shared statistics bridge');
  }
  assert.deepEqual(inventory(current), inventory(original), `${game} keys and inline art`);
}

// Task 0 is the sole approved launcher migration. Later engine work must leave
// even its loader byte-identical; the original comparison below also stays on.
export function checkLauncher(current) {
  const expected = execFileSync('git', ['show', '97b6ce4:index.html'], { cwd: root, maxBuffer: 10 * 1024 * 1024 }).toString('utf8');
  assert.equal(current, expected, 'Launcher remains byte-identical to Task 0');
}

export function checkPreservation() {
  const baseline = readBaseline();
  const original = readOriginal();
  assert.equal(sha256(original), baseline.original.sha256, 'Original launcher hash');
  const games = extractGames(original.toString('utf8'));
  for (const [game, { base64, bytes }] of Object.entries(games)) {
    assert.equal(sha256(base64), baseline.games[game].base64Sha256, `${game} Base64 snapshot`);
    assert.equal(sha256(bytes), baseline.games[game].decodedSha256, `${game} decoded snapshot`);
    const current = readFileSync(resolve(root, `${game}.html`));
    if (game === 'chaturaji') {
      assert.ok(current.equals(bytes), 'Chaturaji page must match the original extraction byte for byte');
      assert.equal(sha256(current), baseline.games.chaturaji.decodedSha256, 'Chaturaji actual file-byte hash');
    }
    checkGamePage(game, current.toString('utf8'), bytes.toString('utf8'));
  }
  const launcher = readFileSync(resolve(root, 'index.html'), 'utf8');
  checkLauncher(launcher);
  assert.doesNotMatch(launcher, /CHATURAJI_HTML_B64|ENOCHIAN_HTML_B64|b64ToUtf8|\.srcdoc\s*=/);
  assert.equal(sha256(launcherOutsideLoader(launcher)), baseline.launcherOutsideLoaderSha256, 'Only payloads and launcher loading may change');
  assert.deepEqual(inventory(launcher), baseline.launcherInventory, 'Launcher keys and inline art');
  assert.equal(launcherOutsideLoader(launcher), launcherOutsideLoader(original.toString('utf8')), 'Launcher statistics, navigation, styles and markup');
  return baseline;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPreservation();
  console.log('Preservation verified: exact Chaturaji and Task 0 launcher; Enochian changes confined to its script; markup, CSS, keys, art and statistics protected.');
}
