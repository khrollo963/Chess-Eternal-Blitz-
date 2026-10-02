import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractGames, readBaseline, readOriginal, root, sha256 } from './client-baseline.mjs';

export function extractGamePages(destination = root) {
  const baseline = readBaseline();
  const original = readOriginal();
  if (sha256(original) !== baseline.original.sha256) throw new Error('Original launcher hash mismatch');
  const games = extractGames(original.toString('utf8'));
  // Validate every existing destination before writing any file. Future edited pages are protected.
  for (const [game, { bytes }] of Object.entries(games)) {
    if (sha256(bytes) !== baseline.games[game].decodedSha256) throw new Error(`${game}: baseline mismatch`);
    const path = resolve(destination, `${game}.html`);
    if (existsSync(path) && !readFileSync(path).equals(bytes)) throw new Error(`Refusing to overwrite modified ${game}.html`);
  }
  for (const [game, { bytes }] of Object.entries(games)) {
    const path = resolve(destination, `${game}.html`);
    if (!existsSync(path)) writeFileSync(path, bytes, { flag: 'wx' });
  }
  return games;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  extractGamePages();
  console.log('Game pages match the original UTF-8 extraction; existing pages were preserved.');
}
