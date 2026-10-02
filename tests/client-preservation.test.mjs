import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as preservation from '../scripts/check-client-preservation.mjs';
import { root, readOriginal, extractGames } from '../scripts/client-baseline.mjs';

const originals = extractGames(readOriginal().toString('utf8'));
const current = readFileSync(`${root}/enochian.html`, 'utf8');

test('Enochian permits only its one inline script to change', () => {
  assert.equal(typeof preservation.checkGamePage, 'function', 'A narrow reusable protection check exists');
  preservation.checkGamePage('enochian', current, originals.enochian.bytes.toString('utf8'));
  preservation.checkGamePage('enochian', current.replace("'use strict';", "'use strict';\n// permissible script comment"), originals.enochian.bytes.toString('utf8'));
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

test('launcher migration is locked to the committed Task 0 page', () => {
  assert.equal(typeof preservation.checkLauncher, 'function');
  const source = readFileSync(`${root}/index.html`, 'utf8');
  preservation.checkLauncher(source);
  assert.throws(() => preservation.checkLauncher(source.replace('function loadGamePage(', 'function changedLoader(')));
});
