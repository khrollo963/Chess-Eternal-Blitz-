import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { root, readOriginal, extractGames } from '../../scripts/client-baseline.mjs';

export function gameSource(version = 'current') {
  return version === 'original'
    ? extractGames(readOriginal().toString('utf8')).enochian.bytes.toString('utf8')
    : readFileSync(resolve(root, 'enochian.html'), 'utf8');
}

// Only the DOM, sound and clock are substitutes. Rules, turn flow, reset and
// menu actions execute the real page. The helper never manufactures legal moves.
function mutationRuntime(){
  const observers = new Set();
  class MutationObserver {
    constructor(callback){ this.callback = callback; this.records = []; this.targets = []; observers.add(this); }
    observe(target,options){ this.targets.push({target,options}); }
    disconnect(){ this.targets = []; this.records = []; }
  }
  return { MutationObserver,
    attribute(target,attributeName){
      for(const observer of observers) for(const watched of observer.targets){
        if(watched.options.attributes && (watched.target === target || watched.options.subtree && watched.target.owner === target.owner) &&
           (!watched.options.attributeFilter || watched.options.attributeFilter.includes(attributeName))){
          observer.records.push({type:'attributes',target,attributeName});
          break;
        }
      }
    },
    flush(){
      for(const observer of observers){
        const records = observer.records.splice(0);
        if(records.length) observer.callback(records,observer);
      }
    },
    get activeCount(){ return [...observers].filter(o => o.targets.length).length; }
  };
}
function surface(mutations) {
  const elements = new Map();
  const owner = {};
  const events = new Map();
  const eventTarget = handlers => ({
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
    dispatchEvent(event) { for (const fn of [...(handlers.get(event.type) || [])]) fn(event); return true; },
  });
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const el = {
      id, owner, dataset: {}, children: [], innerHTML: '', textContent: '',
      ...eventTarget(new Map()),
      classList: {
        add: (...names) => { names.forEach(name => classes.add(name)); mutations.attribute(el,'class'); },
        remove: (...names) => { names.forEach(name => classes.delete(name)); mutations.attribute(el,'class'); },
        contains: name => classes.has(name),
        toggle(name, force) { const next = force ?? !classes.has(name); if (next) classes.add(name); else classes.delete(name); mutations.attribute(el,'class'); return next; },
      },
      appendChild(child) { this.children.push(child); },
      setAttribute(name, value) { this[name] = value; },
      contains: () => false,
      closest(selector) { return selector === '.game-wrapper' ? this.parentElement : null; },
      getClientRects() { return this.style.display === 'none' ? [] : [{}]; },
    };
    el.style = new Proxy({}, {set(target,name,value){ target[name] = value; mutations.attribute(el,'style'); return true; }});
    elements.set(id, el);
    return el;
  }
  return {
    elements, element,
    document: {
      ...eventTarget(events), hidden: false, visibilityState: 'visible',
      baseURI: 'http://localhost:8080/index.html',
      documentElement: element('document-root'),
      getElementById: element,
      createElement: () => element(`generated-${elements.size}`),
      querySelectorAll: selector => selector === '.game-wrapper' ? [element('chaturaji-wrapper'), element('enochian-wrapper')] : [],
    },
    windowEvents: eventTarget(new Map()),
  };
}

export function fakeClock() {
  let now = 0, nextId = 1;
  const jobs = new Map();
  return {
    jobs,
    setTimeout(fn, delay = 0) { const id = nextId++; jobs.set(id, { fn, due: now + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    tick(ms) {
      const end = now + ms;
      let executed = 0;
      for (;;) {
        const entry = [...jobs].filter(([, job]) => job.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!entry) break;
        assert.ok(executed++ < 100, 'Clock exceeded 100 callbacks: possible scheduling loop');
        const [id, job] = entry;
        jobs.delete(id); now = job.due; job.fn();
      }
      now = end;
    },
    get now() { return now; },
  };
}

export function createHarness({ version = 'current', observeAI = false, launched = false } = {}) {
  const mutations = mutationRuntime();
  const ui = surface(mutations);
  const clock = fakeClock();
  const storage = new Map();
  const scores = [], successors = [];
  const sandbox = {
    document: ui.document, console, URL, URLSearchParams, Event,
    location: { href: 'http://localhost:8080/enochian.html', search: '' },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem: () => null },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    MutationObserver: mutations.MutationObserver,
    ...ui.windowEvents,
    getComputedStyle: el => ({ display: el.id?.endsWith('-wrapper') && !el.classList.contains('active') ? 'none' : (el.style.display || 'block') }),
    __observeScore: (move, score) => scores.push({ move: { ...move }, score }),
  };
  sandbox.window = sandbox; sandbox.parent = sandbox;
  const context = vm.createContext(sandbox);
  const run = code => vm.runInContext(code, context);
  const html = gameSource(version);
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'Harness: expected the existing inline game script');
  let script = match[1];
  if (observeAI && version === 'original') {
    // Observation only: the candidate, arithmetic and comparison stay intact.
    const anchor = 'if(score > bestScore){ bestScore = score; best = m; }';
    assert.equal(script.split(anchor).length, 2, 'Harness: scoring observation anchor changed; adapt to the real engine API');
    script = script.replace(anchor, `__observeScore(m, score);\n    ${anchor}`);
  }
  run(script);
  run(`Math.random = () => 0;
    renderBoard = () => {}; renderMoveLog = () => {}; updateTurnIndicator = () => {};
    sndClick = sndMove = sndCapture = sndKingCapture = sndPromote = sndWin = sndDraw = () => {};`);
  if (observeAI) {
    sandbox.__observeSuccessor = (board, alive, attacked, state) => successors.push({ board: JSON.parse(JSON.stringify(board)), alive: { ...alive }, attacked, state: state && structuredClone(state) });
    sandbox.__observeCandidate = ({move,score,state,attacked}) => {
      sandbox.__observeScore(move,score);
      sandbox.__observeSuccessor(state.board,state.alive,attacked,state);
    };
    if (version === 'original' || !script.includes('// ENOCHIAN_ENGINE_START')) run(`const originalAttackProbe = isSquareAttacked;
      isSquareAttacked = function(board, r, c, colors) {
        const attacked = originalAttackProbe(board, r, c, colors);
        __observeSuccessor(board, game.alive, attacked);
        return attacked;
      };`);
  }
  let launcher;
  if (launched) {
    const outer = surface(mutations);
    const wrapper = outer.element('enochian-wrapper');
    const frame = outer.element('enochian-frame');
    wrapper.classList.add('active'); frame.parentElement = wrapper;
    frame.dataset.loaded = '1'; frame.contentWindow = sandbox; frame.contentDocument = ui.document;
    sandbox.frameElement = frame;
    const parent = { document: outer.document, URL, localStorage: sandbox.localStorage, getComputedStyle: sandbox.getComputedStyle };
    parent.window = parent;
    const parentContext = vm.createContext(parent);
    sandbox.parent = parent;
    const launcherScript = readFileSync(resolve(root, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
    vm.runInContext(launcherScript, parentContext);
    launcher = { hide: () => { parent.globalBackToMenu(); mutations.flush(); }, reopen: () => { parent.globalSwitchGame('enochian'); mutations.flush(); }, wrapper, document: outer.document };
  }
  run('init()');
  return {
    run, clock, ui, launcher, scores, successors, mutations,
    snapshot: () => JSON.parse(run('JSON.stringify(game)')),
    setState(board, overrides = {}) {
      sandbox.__fixture = structuredClone({ turnIndex: 0, alive: { R: true, B: true, Y: true, K: true }, selected: null, legalMoves: [], over: false, playerColor: null, difficulty: 'hard', moveCount: 0, moveLog: [], ...overrides, board });
      run('Object.assign(game, __fixture)');
    },
    legalMoves(color) {
      sandbox.__color = color;
      return JSON.parse(run(`JSON.stringify(Object.entries(game.board).flatMap(([key,p]) => {
        if(p.color !== __color) return [];
        const [fr,fc] = key.split(',').map(Number);
        return getLegalMoves(fr,fc).map(m => ({fr,fc,tr:m.r,tc:m.c}));
      }))`));
    },
    choose(color = 'R', difficulty = 'hard', options = {}) {
      sandbox.__color = color; sandbox.__difficulty = difficulty;
      sandbox.__options = options;
      return JSON.parse(run(version === 'current'
        ? 'JSON.stringify(EnochianEngine.chooseAiMove(game,__color,__difficulty,Math.random,{...__options,observe: typeof __observeCandidate === "function" ? __observeCandidate : undefined}))'
        : 'JSON.stringify(aiSelectMove(__color, __difficulty))'));
    },
  };
}
