import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const clientFiles = Object.freeze(['index.html', 'chaturaji.html', 'enochian.html']);

// JSON remains literal source text, but cannot close the surrounding HTML script.
export function serializeSources(sources) {
  return JSON.stringify(sources).replace(/[<>&\u2028\u2029]/g, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function singleHtml(launcher, sources) {
  const start = launcher.indexOf('function loadGamePage(');
  const end = launcher.indexOf("document.getElementById('backBtn').addEventListener", start);
  if (start < 0 || end < start) throw new Error('Unsupported launcher loading boundary');
  let loader = launcher.slice(start, end);
  const replacements = [
    ["  const page = './' + gameType + '.html';\n  const expectedUrl = new URL(page, document.baseURI).href;", '  const page = PACKAGED_GAME_SOURCES[gameType];'],
    ["frame.contentWindow.location.href === expectedUrl &&", "frame.contentWindow.location.href === 'about:srcdoc' &&"],
    ['frame.src = page;', 'frame.srcdoc = page;'],
  ];
  // Preserve canonical line endings outside the permitted generated loader.
  const newline = loader.includes('\r\n') ? '\r\n' : '\n';
  loader = loader.replaceAll('\r\n', '\n');
  for (const [before, after] of replacements) {
    if (loader.split(before).length !== 2) throw new Error('Unsupported launcher loader');
    loader = loader.replace(before, after);
  }
  loader = loader.replaceAll('\n', newline);
  const literal = `const PACKAGED_GAME_SOURCES = ${serializeSources(sources)};${newline}${newline}`;
  return launcher.slice(0, start) + literal + loader + launcher.slice(end);
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ZIP STORE avoids compressor-version drift. Fixed UTC-independent DOS date,
// fixed entry order, no timestamps/extras/comments and exact canonical bytes.
export function clientZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const filename of clientFiles) {
    const bytes = Buffer.from(files[filename]);
    const name = Buffer.from(filename);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); // 1980-01-01
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(bytes.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, bytes);
    central.push(directory, name);
    offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(clientFiles.length, 8);
  end.writeUInt16LE(clientFiles.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function packageClient({ sourceRoot = root, outputRoot = resolve(root, 'dist'), standalone = false } = {}) {
  const files = Object.fromEntries(clientFiles.map(name => [name, readFileSync(resolve(sourceRoot, name))]));
  mkdirSync(outputRoot, { recursive: true });
  const zipPath = resolve(outputRoot, 'chess-eternal-blitz.zip');
  writeFileSync(zipPath, clientZip(files));
  let htmlPath;
  if (standalone) {
    // Reject non-UTF8 input rather than silently replacing source bytes.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const source = name => decoder.decode(files[name]);
    htmlPath = resolve(outputRoot, 'index.html');
    writeFileSync(htmlPath, singleHtml(source('index.html'), {
      chaturaji: source('chaturaji.html'), enochian: source('enochian.html'),
    }));
  }
  return { zipPath, ...(htmlPath ? { htmlPath } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--single-html') || args.length > 1) {
    throw new Error('Usage: node scripts/package-client.mjs [--single-html]');
  }
  console.log(JSON.stringify(packageClient({ standalone: args.includes('--single-html') })));
}
