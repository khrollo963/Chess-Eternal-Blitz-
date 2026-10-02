import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { root, readOriginal, extractGames, makeBaseline, readBaseline } from '../scripts/client-baseline.mjs';
import { extractGamePages } from '../scripts/extract-game-pages.mjs';
import { checkPreservation } from '../scripts/check-client-preservation.mjs';

test('baseline reproduces the immutable original, and all source outside loading is preserved', () => {
  assert.deepEqual(makeBaseline(readOriginal()), readBaseline());
  checkPreservation();
});

test('extraction is byte-exact and idempotent, with no overwrite of future edited games', () => {
  const destination = mkdtempSync(join(tmpdir(), 'chess-extraction-'));
  try {
    const games = extractGames(readOriginal().toString('utf8'));
    extractGamePages(destination);
    extractGamePages(destination);
    for (const [game, { bytes }] of Object.entries(games)) assert.ok(readFileSync(join(destination, `${game}.html`)).equals(bytes));
    const edited = Buffer.concat([games.enochian.bytes, Buffer.from('\n<!-- future edit -->')]);
    writeFileSync(join(destination, 'enochian.html'), edited);
    rmSync(join(destination, 'chaturaji.html'));
    assert.throws(() => extractGamePages(destination), /Refusing to overwrite modified enochian/);
    assert.ok(readFileSync(join(destination, 'enochian.html')).equals(edited));
    assert.equal(existsSync(join(destination, 'chaturaji.html')), false, 'Validation must precede all writes');
  } finally { rmSync(destination, { recursive: true, force: true }); }
});

function launcherHarness(initialLog = []) {
  const elements = new Map();
  function element(id) {
    const classes = new Set();
    const handlers = new Map();
    const el = {
      id, dataset: {}, textContent: '', assignments: [],
      style: {}, children: [],
      setAttribute(name, value) { this[name] = value; },
      appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); },
      remove() { elements.delete(this.id); },
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
      removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
      emit(type) { for (const fn of [...(handlers.get(type) || [])]) fn(); },
      contentWindow: { location: { href: 'about:blank' } },
      contentDocument: { getElementById: () => ({}) },
      set src(value) { if (this.throwOnAssign) throw Error('Navigation failed'); this.assignments.push(value); },
    };
    elements.set(id, el);
    return el;
  }
  for (const id of ['mainMenu', 'backBtn', 'chaturaji-frame', 'enochian-frame', 'chaturaji-wrapper', 'enochian-wrapper', 'totalGames', 'totalWins', 'winRate', 'uniqueFigures']) element(id);
  const storage = new Map([['unified_sessionlog_v1', JSON.stringify(initialLog)]]);
  const document = {
    baseURI: 'http://localhost:8080/nested/index.html',
    getElementById: id => elements.get(id),
    createElement: () => element(''),
    querySelectorAll: () => [elements.get('chaturaji-wrapper'), elements.get('enochian-wrapper')],
  };
  const context = vm.createContext({ document, URL, window: {}, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  function complete(game, success = true) {
    const frame = elements.get(`${game}-frame`);
    frame.contentWindow.location.href = new URL(`./${game}.html`, document.baseURI).href;
    frame.contentDocument.getElementById = () => success ? {} : null;
    frame.emit('load');
  }
  return { elements, storage, window: context.window, complete };
}

test('first selection loads once; loading and loaded frames remain mounted across menus and switches', () => {
  const { elements, window, complete } = launcherHarness();
  const chaturaji = elements.get('chaturaji-frame');
  const enochian = elements.get('enochian-frame');
  assert.deepEqual(chaturaji.assignments, []);
  assert.deepEqual(enochian.assignments, []);
  window.globalSwitchGame('chaturaji');
  chaturaji.emit('load'); // Initial about:blank must not mark success or permit a second assignment.
  window.globalBackToMenu();
  window.globalSwitchGame('chaturaji');
  assert.equal(chaturaji.dataset.loading, '1');
  assert.deepEqual(chaturaji.assignments, ['./chaturaji.html']);
  complete('chaturaji');
  chaturaji.contentWindow.gameState = { turn: 17 };
  window.globalSwitchGame('enochian');
  complete('enochian');
  window.globalBackToMenu();
  assert.equal(elements.get('mainMenu').classList.contains('hidden'), false);
  assert.equal(elements.get('backBtn').classList.contains('hidden'), true);
  window.globalSwitchGame('chaturaji');
  assert.equal(elements.get('chaturaji-wrapper').classList.contains('active'), true);
  assert.equal(elements.get('enochian-wrapper').classList.contains('active'), false);
  assert.deepEqual(chaturaji.contentWindow.gameState, { turn: 17 });
  assert.deepEqual(chaturaji.assignments, ['./chaturaji.html']);
  assert.deepEqual(enochian.assignments, ['./enochian.html']);
  assert.equal(chaturaji.dataset.loaded, '1');
  assert.equal(enochian.dataset.loaded, '1');
});

test('network errors, HTTP error documents and assignment exceptions allow retry without resetting successful frames', () => {
  const { elements, window, complete } = launcherHarness();
  const good = elements.get('chaturaji-frame');
  const failed = elements.get('enochian-frame');
  window.globalSwitchGame('chaturaji');
  complete('chaturaji');
  window.globalSwitchGame('enochian');
  failed.emit('error');
  assert.equal(failed.dataset.failed, '1');
  assert.equal(failed.dataset.loading, undefined);
  const error = elements.get('enochian-load-error');
  assert.equal(error.role, 'alert');
  assert.equal(error.children[0].textContent, 'The game could not load. Please try again.');
  assert.equal(error.children[1].textContent, 'Retry');
  error.children[1].emit('click');
  assert.equal(elements.has('enochian-load-error'), false);
  complete('enochian', false); // HTTP 404 pages often emit load rather than error.
  assert.equal(failed.dataset.loaded, undefined);
  assert.equal(failed.dataset.failed, '1');
  failed.throwOnAssign = true;
  window.globalSwitchGame('enochian');
  assert.equal(failed.dataset.loading, undefined);
  failed.throwOnAssign = false;
  window.globalSwitchGame('enochian');
  complete('enochian');
  window.globalSwitchGame('enochian');
  assert.equal(failed.dataset.loaded, '1');
  assert.equal(failed.dataset.failed, undefined);
  assert.equal(elements.has('enochian-load-error'), false);
  assert.deepEqual(failed.assignments, ['./enochian.html', './enochian.html', './enochian.html']);
  assert.deepEqual(good.assignments, ['./chaturaji.html']);
  assert.equal(good.dataset.loaded, '1');
});

test('parent bridge retains saved history, aggregates both games and persists capped sessions', () => {
  const { elements, storage, window } = launcherHarness([{ game: 'chaturaji', result: 'WIN', figure: 'Via' }, { game: 'enochian', result: 'LOSS' }]);
  assert.equal(elements.get('totalGames').textContent, 2);
  assert.equal(elements.get('winRate').textContent, '50%');
  window.addGameSession('chaturaji', { result: 'WIN', figure: 'Via' });
  window.addGameSession('enochian', { result: 'WIN', figure: 'Ignored' });
  assert.equal(elements.get('totalGames').textContent, 4);
  assert.equal(elements.get('totalWins').textContent, 3);
  assert.equal(elements.get('winRate').textContent, '75%');
  assert.equal(elements.get('uniqueFigures').textContent, 1);
  const saved = JSON.parse(storage.get('unified_sessionlog_v1'));
  assert.equal(saved[0].game, 'enochian');
  assert.equal(saved[1].game, 'chaturaji');
  for (let i = 0; i < 205; i++) window.addGameSession('enochian', { result: 'LOSS' });
  assert.equal(JSON.parse(storage.get('unified_sessionlog_v1')).length, 200);
});
