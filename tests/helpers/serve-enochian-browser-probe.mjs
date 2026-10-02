// Local-only lifecycle diagnostics. Injected controls never enter a release artifact.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from '../../scripts/client-baseline.mjs';

const probe = `<script>
(() => {
  const panel = document.createElement('pre');
  panel.id = 'lifecycle-probe-evidence';
  Object.assign(panel.style, {position:'fixed', bottom:'0', right:'0', zIndex:99999, background:'white', color:'black', font:'12px monospace'});
  const controls = document.createElement('div');
  Object.assign(controls.style, {position:'fixed', top:'0', right:'0', zIndex:99999});
  document.body.append(controls, panel);
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const pending = new Set();
  let callbacks = 0;
  let prepared = false;
  function report() {
    const wrapper = window.parent.document.getElementById('enochian-wrapper');
    panel.textContent = JSON.stringify({prepared, pendingCpuJobs:pending.size, callbacks, moveCount:game.moveCount, turnIndex:game.turnIndex, over:game.over, gameVisible:document.getElementById('gamePlayArea').style.display !== 'none', launcherVisible:wrapper?.classList.contains('active') ?? true});
    const outer = window.parent.document.getElementById('lifecycle-probe-summary');
    if (outer) outer.textContent = panel.textContent;
  }
  // Stretch only the existing CPU delay, leaving its callback and cancellation semantics intact.
  // This gives the operator enough time to return to the launcher before the callback fires.
  window.setTimeout = (callback, delay, ...args) => {
    if (!prepared || (delay !== 1400 && delay !== 200)) return nativeTimeout(callback, delay, ...args);
    const id = nativeTimeout(() => {
      pending.delete(id); callbacks++; callback(...args); report();
    }, 4000);
    pending.add(id); report(); return id;
  };
  window.clearTimeout = id => {pending.delete(id); nativeClearTimeout(id); report();};
  function button(text, action) {
    const button = document.createElement('button'); button.textContent = text;
    button.addEventListener('click', action); controls.append(button);
  }
  button('Prepare CPU lifecycle probe', () => {
    game.playerColor = null; startGame(); game.playerColor = 'Y'; prepared = true;
    maybeRunCpuTurn(); maybeRunCpuTurn(); report();
  });
  button('Reset lifecycle probe match', () => {
    game.playerColor = null; startGame(); game.playerColor = 'Y'; report();
  });
  button('Stop lifecycle probe', () => {
    prepared = false;
    for (const id of pending) nativeClearTimeout(id);
    pending.clear(); game.playerColor = null; backToMainMenu(); report();
  });
  new MutationObserver(report).observe(window.parent.document.getElementById('enochian-wrapper'), {attributes:true, attributeFilter:['class','style']});
  report();
})();
</script>`;

const launcherProbe = `<pre id="lifecycle-probe-summary" style="position:fixed;bottom:0;right:0;z-index:99999;background:white;color:black;font:12px monospace">Enochian has not loaded.</pre>`;
const files = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/enochian.html', 'enochian.html'], ['/chaturaji.html', 'chaturaji.html']]);
const server = createServer((request, response) => {
  const file = files.get(new URL(request.url, 'http://127.0.0.1').pathname);
  if (!file) {response.writeHead(404); response.end('Not found'); return;}
  let html = readFileSync(resolve(root, file), 'utf8');
  if (file === 'enochian.html') html = html.replace('</body>', probe + '</body>');
  if (file === 'index.html') html = html.replace('</body>', launcherProbe + '</body>');
  response.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
  response.end(html);
});
server.listen(41739, '127.0.0.1', () => console.log('Local lifecycle probe: http://127.0.0.1:41739/index.html'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
