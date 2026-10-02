import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const baselinePath = resolve(root, 'tests/fixtures/client-baseline.json');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const originalRevision = '9d7a62a0407f6fcf34da3975312be1a757c020e5';
export const readOriginal = () => execFileSync('git', ['show', `${originalRevision}:index.html`], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
export const readBaseline = () => JSON.parse(readFileSync(baselinePath, 'utf8'));

export function extractGames(source) {
  return Object.fromEntries(['chaturaji', 'enochian'].map(game => {
    const name = `${game.toUpperCase()}_HTML_B64`;
    const match = source.match(new RegExp(`^const ${name} = ("[A-Za-z0-9+/=]+");\\r?$`, 'm'));
    if (!match) throw new Error(`Missing original ${name}`);
    const base64 = JSON.parse(match[1]);
    // Match the launcher's atob -> bytes -> TextDecoder semantics, including BOM handling.
    const bytes = Buffer.from(new TextDecoder('utf-8').decode(Buffer.from(base64, 'base64')), 'utf8');
    return [game, { base64, bytes }];
  }));
}

export function inventory(source) {
  return {
    storageKeys: [...new Set([...source.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]))].sort(),
    inlineAssets: [...source.matchAll(/data:image\/[^\s'"<>`)]+/g)].map(m => sha256(m[0])).sort(),
  };
}

export function stripPayloads(source) {
  return source.replace(/^const (?:CHATURAJI|ENOCHIAN)_HTML_B64 = "[A-Za-z0-9+/=]+";\r?\n/gm, '');
}

export function launcherOutsideLoader(source) {
  const text = stripPayloads(source);
  const start = text.includes('function b64ToUtf8(') ? text.indexOf('function b64ToUtf8(') : text.indexOf('function loadGamePage(');
  const end = text.indexOf("document.getElementById('backBtn').addEventListener");
  if (start < 0 || end < start) throw new Error('Cannot locate launcher loading boundary');
  return text.slice(0, start) + text.slice(end);
}

export function makeBaseline(original) {
  const source = original.toString('utf8');
  const games = extractGames(source);
  return {
    schemaVersion: 1,
    original: { revision: originalRevision, path: 'index.html', blob: execFileSync('git', ['rev-parse', `${originalRevision}:index.html`], { cwd: root, encoding: 'utf8' }).trim(), sha256: sha256(original), byteLength: original.length },
    launcherOutsideLoaderSha256: sha256(launcherOutsideLoader(source)),
    launcherInventory: inventory(stripPayloads(source)),
    games: Object.fromEntries(Object.entries(games).map(([game, { base64, bytes }]) => [game, { base64Sha256: sha256(base64), base64Length: base64.length, decodedSha256: sha256(bytes), decodedByteLength: bytes.length, ...inventory(bytes.toString('utf8')) }])),
    invariants: {
      statistics: { storageKey: 'unified_sessionlog_v1', maxSessions: 200, winResult: 'WIN', figuresGame: 'chaturaji', bridge: 'window.addGameSession', unchangedSourceSha256: sha256(source.slice(source.indexOf('let unifiedSessionLog'), source.indexOf('function globalSwitchGame'))) },
      navigation: { frames: ['chaturaji-frame', 'enochian-frame'], wrappers: ['chaturaji-wrapper', 'enochian-wrapper'], menu: 'mainMenu', backButton: 'backBtn', unchangedSourceSha256: sha256(source.slice(source.indexOf('function globalSwitchGame'), source.indexOf('function b64ToUtf8'))) },
    },
  };
}
