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

// Task 12 additions are explicit islands. Removing exactly those islands keeps
// the original markup/art/style boundary enforceable instead of relaxing it.
export function withoutMultiplayerAdditions(source) {
  for (const name of ['MULTIPLAYER_UI', 'MULTIPLAYER_CONTROLS', 'CLIENT_SDKS', 'MULTIPLAYER_CLIENT']) {
    const begin = `<!-- ENOCHIAN_${name}_BEGIN -->`, end = `<!-- ENOCHIAN_${name}_END -->`;
    const starts = source.split(begin).length - 1, ends = source.split(end).length - 1;
    assert.equal(starts, ends, `${name} markers must pair`);
    assert.ok(starts <= 1, `${name} markers must be unique`);
    if (!starts) continue;
    const start = source.indexOf(begin), stop = source.indexOf(end);
    assert.ok(stop > start, `${name} markers must be ordered`);
    // Each inserted block owns the immediately following LF, never baseline bytes.
    assert.equal(source[stop + end.length], '\n', `${name} insertion terminator`);
    source = source.slice(0, start) + source.slice(stop + end.length + 1);
  }
  return source;
}

export function checkGamePage(game, current, original) {
  if (game === 'chaturaji') assert.equal(current, original, 'Chaturaji remains byte-identical');
  else {
    assert.equal(game, 'enochian', 'Only Enochian has a permitted script boundary');
    current = withoutMultiplayerAdditions(current);
    assert.deepEqual(inventory(current), inventory(original), 'Enochian keys and inline art, including guides');
    current = withoutGuideRedesign(current, original);
    assert.equal(outsideInlineScript(current), outsideInlineScript(original), 'Enochian original markup, CSS and bytes outside the existing script are protected');
    assert.match(current, /window\.parent\.addGameSession\('enochian',/, 'Enochian shared statistics bridge');
  }
  assert.deepEqual(inventory(current), inventory(original), `${game} keys and inline art`);
}

// User-approved guide edits are restricted to their original location, a scoped
// stylesheet immediately after the original stylesheet, and two guide buttons.
// Restore those regions from the immutable snapshot before protecting the rest.
export function withoutGuideRedesign(source, original) {
  const begin = '<!-- ENOCHIAN_GUIDE_STYLES_BEGIN -->';
  if (!source.includes(begin)) return source;
  const end = '<!-- ENOCHIAN_GUIDE_STYLES_END -->';
  for (const marker of [begin, end, '<!-- ENOCHIAN_GUIDE_CONTENT_BEGIN -->', '<!-- ENOCHIAN_GUIDE_CONTENT_END -->']) {
    assert.equal(source.split(marker).length - 1, 1, 'Guide markers must be unique and paired');
  }
  const styleStart = source.indexOf(begin), styleEnd = source.indexOf(end);
  assert.equal(styleStart, original.indexOf('</style>') + '</style>\n'.length, 'Guide style follows the original stylesheet');
  assert.ok(styleEnd > styleStart);
  assert.equal(source[styleEnd + end.length], '\n');
  const css = source.slice(styleStart + begin.length, styleEnd).trim();
  assert.match(css, /^<style>[\s\S]*<\/style>$/);
  assert.doesNotMatch(css.slice(7, -8), /</, 'Guide styles contain only CSS');
  assert.doesNotMatch(css, /<script|@import|url\(/i, 'Guide CSS cannot add scripts or remote assets');
  for (const selector of css.slice(7, -8).replace(/@media[^{}]+\{/g, '').matchAll(/([^{}]+)\{/g)) {
    for (const item of selector[1].trim().split(',')) {
      assert.match(item.trim(), /^\.enochian-guide(?:\s|$)/, 'Guide CSS must stay scoped');
      assert.doesNotMatch(item, /[+~]/, 'Guide CSS cannot select siblings outside its panel');
    }
  }
  source = source.slice(0, styleStart) + source.slice(styleEnd + end.length + 1);
  const oldNav = '<button class="tab-btn" data-tab="rules">Rules</button>';
  const newNav = '<button class="tab-btn" data-tab="rules">How to Play</button>\n  <button class="tab-btn" data-tab="meanings">Piece Meanings</button>';
  assert.equal(source.split(newNav).length - 1, 1, 'Only the approved guide navigation changes');
  source = source.replace(newNav, oldNav);
  const start = '    <!-- RULES TAB -->\n', stop = '    <!-- SESSION LOG TAB -->';
  const startAt = source.indexOf(start), stopAt = source.indexOf(stop);
  assert.ok(startAt >= 0 && stopAt > startAt, 'Original guide boundaries remain');
  const content = source.slice(startAt + start.length, stopAt);
  assert.ok(content.startsWith('    <!-- ENOCHIAN_GUIDE_CONTENT_BEGIN -->\n'));
  assert.ok(content.endsWith('    <!-- ENOCHIAN_GUIDE_CONTENT_END -->\n\n'));
  assert.doesNotMatch(content, /<script|<style|\son\w+\s*=/i, 'Guides are static content');
  return source.slice(0, startAt) + original.slice(original.indexOf(start), original.indexOf(stop)) + source.slice(stopAt);
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
  console.log('Preservation verified: exact Chaturaji and Task 0 launcher; Enochian gameplay markup, CSS, keys, art and statistics protected outside approved script, multiplayer and guide boundaries.');
}
