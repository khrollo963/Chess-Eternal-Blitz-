import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as preservation from '../scripts/check-client-preservation.mjs';
import { root, readOriginal, extractGames } from '../scripts/client-baseline.mjs';

const originals = extractGames(readOriginal().toString('utf8'));
const current = readFileSync(`${root}/enochian.html`, 'utf8');

test('Enochian permits its original script and marked multiplayer additions to change', () => {
  assert.equal(typeof preservation.checkGamePage, 'function', 'A narrow reusable protection check exists');
  preservation.checkGamePage('enochian', current, originals.enochian.bytes.toString('utf8'));
  preservation.checkGamePage('enochian', current.replace("'use strict';", "'use strict';\n// permissible script comment"), originals.enochian.bytes.toString('utf8'));
});

test('multiplayer insertion markers cannot hide original markup corruption', () => {
  for (const changed of [
    current.replace('<!-- ENOCHIAN_MULTIPLAYER_UI_END -->', ''),
    current.replace('<!-- ENOCHIAN_MULTIPLAYER_UI_BEGIN -->', '<!-- ENOCHIAN_MULTIPLAYER_UI_BEGIN --><!-- ENOCHIAN_MULTIPLAYER_UI_BEGIN -->'),
    current.replace('<!-- ENOCHIAN_MULTIPLAYER_UI_END -->', '<!-- ENOCHIAN_MULTIPLAYER_UI_END -->extra'),
  ]) assert.throws(() => preservation.checkGamePage('enochian', changed, originals.enochian.bytes.toString('utf8')));
});

test('Enochian CSS, markup, artwork, keys and statistics bridge stay protected', () => {
  assert.equal(typeof preservation.checkGamePage, 'function');
  const mutations = [
    current.replace('<style>', '<style>/* changed */'),
    current.replace('<body>', '<body data-changed="true">'),
    current.replace("'use strict';", "'use strict';\nconst changedAsset = 'data:image/png;base64,AAAA';"),
    current.replaceAll('enochian_sessionlog_v1', 'changed_key'),
    current.replaceAll('window.parent.addGameSession', 'window.parent.changedBridge'),
    current.replace('</script>', '</script><script>/* another boundary */</script>'),
  ];
  for (const changed of mutations) {
    assert.notEqual(changed, current, 'Each corruption fixture changes an existing protected feature');
    assert.throws(() => preservation.checkGamePage('enochian', changed, originals.enochian.bytes.toString('utf8')));
  }
});

test('Chaturaji byte changes are rejected, even within its script', () => {
  assert.equal(typeof preservation.checkGamePage, 'function');
  const source = originals.chaturaji.bytes.toString('utf8');
  preservation.checkGamePage('chaturaji', source, source);
  assert.throws(() => preservation.checkGamePage('chaturaji', source.replace('<script>', '<script>/* changed */'), source));
});

test('approved static changelogs cannot hide gameplay edits or execute code', () => {
  for (const game of ['chaturaji','enochian']) {
    const source=readFileSync(`${root}/${game}.html`,'utf8'),original=originals[game].bytes.toString('utf8');
    preservation.checkGamePage(game,source,original);
    for (const changed of [
      source.replace('<!-- GAME_CHANGELOG_CONTENT_END -->',''),
      source.replace('<!-- GAME_CHANGELOG_NAV_END -->','<!-- GAME_CHANGELOG_NAV_END -->extra'),
      source.replace('aria-label="'+(game==='chaturaji'?'Chaturaji':'Enochian')+' changelog"','onclick="alert(1)"'),
      source.replace('<body>','<body data-changed="true">'),
    ]) assert.throws(()=>preservation.checkGamePage(game,changed,original));
  }
});

test('guide redesign cannot consume gameplay markup or escape its CSS scope', () => {
  for (const changed of [
    current.replace('<!-- ENOCHIAN_GUIDE_CONTENT_END -->', ''),
    current.replace('<!-- ENOCHIAN_GUIDE_CONTENT_BEGIN -->', '<!-- ENOCHIAN_GUIDE_CONTENT_BEGIN --><!-- ENOCHIAN_GUIDE_CONTENT_BEGIN -->'),
    current.replace('.enochian-guide{', 'body{'),
    current.replace('.enochian-guide{', '.enochian-guide ~ .mp-panel{'),
    current.replace('<!-- ENOCHIAN_GUIDE_STYLES_BEGIN -->', '').replace('<body>', '<body><!-- ENOCHIAN_GUIDE_STYLES_BEGIN -->'),
    current.replace('    <!-- ENOCHIAN_GUIDE_CONTENT_BEGIN -->', '').replace('<main>', '<main>\n    <!-- ENOCHIAN_GUIDE_CONTENT_BEGIN -->'),
    current.replace('<header class="guide-header">', '<header class="guide-header" onclick="alert(1)">'),
  ]) {
    assert.notEqual(changed, current);
    assert.throws(() => preservation.checkGamePage('enochian', changed, originals.enochian.bytes.toString('utf8')));
  }
});

test('launcher migration is locked to the committed Task 0 page', () => {
  assert.equal(typeof preservation.checkLauncher, 'function');
  const source = readFileSync(`${root}/index.html`, 'utf8');
  preservation.checkLauncher(source);
  assert.throws(() => preservation.checkLauncher(source.replace('function loadGamePage(', 'function changedLoader(')));
});
