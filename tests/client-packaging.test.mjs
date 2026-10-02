import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { clientFiles, clientZip, crc32, packageClient, serializeSources, singleHtml } from '../scripts/package-client.mjs';
import { root } from '../scripts/client-baseline.mjs';

const files = Object.fromEntries(clientFiles.map(name => [name, readFileSync(resolve(root, name))]));
const launcher = files['index.html'].toString('utf8');
const sources = { chaturaji: files['chaturaji.html'].toString('utf8'), enochian: files['enochian.html'].toString('utf8') };
function readZip(zip) {
  const result = {};
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(zip.readUInt16LE(offset + 8), 0, 'Stored without compressor drift');
    const length = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extra;
    const bytes = zip.subarray(start, start + length);
    assert.equal(crc32(bytes), zip.readUInt32LE(offset + 14));
    result[name] = bytes;
    offset = start + length;
  }
  const directoryStart = offset;
  for (const name of clientFiles) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const nameLength = zip.readUInt16LE(offset + 28);
    assert.equal(zip.subarray(offset + 46, offset + 46 + nameLength).toString(), name);
    const localOffset = zip.readUInt32LE(offset + 42);
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50);
    assert.equal(zip.readUInt32LE(offset + 16), crc32(result[name]));
    offset += 46 + nameLength;
  }
  assert.equal(zip.readUInt32LE(offset), 0x06054b50);
  assert.equal(zip.readUInt16LE(offset + 10), 3);
  assert.equal(zip.readUInt32LE(offset + 12), offset - directoryStart);
  assert.equal(zip.readUInt32LE(offset + 16), directoryStart);
  assert.equal(zip.length, offset + 22);
  return result;
}

test('ZIP has exactly three root pages, canonical bytes and deterministic complete directories', () => {
  const first = clientZip(files);
  assert.deepEqual(clientZip(files), first);
  const decoded = readZip(first);
  assert.deepEqual(Object.keys(decoded), clientFiles);
  for (const name of clientFiles) assert.deepEqual(decoded[name], files[name]);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926, 'Independent CRC reference vector');
});

test('literal serialization survives malicious HTML/script delimiters and Unicode unchanged', () => {
  const malicious = { chaturaji: '</ScRiPt><script>alert("bad")</script><!-- & > \u2028\u2029 emoji ♟', enochian: '\\u003c\n"</script>\u0000' };
  const serialized = serializeSources(malicious);
  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/);
  assert.deepEqual(JSON.parse(serialized), malicious);
  const artifact = singleHtml(launcher, malicious);
  assert.equal((artifact.match(/<script\b/gi) || []).length, (launcher.match(/<script\b/gi) || []).length);
  assert.equal((artifact.match(/<\/script>/gi) || []).length, (launcher.match(/<\/script>/gi) || []).length);
});

test('standalone decoded pages match canonical bytes, bridges/license/version data retained', () => {
  const artifact = singleHtml(launcher, sources);
  const serialized = artifact.match(/const PACKAGED_GAME_SOURCES = (.*);/)[1];
  const decoded = JSON.parse(serialized);
  for (const name of ['chaturaji', 'enochian']) {
    assert.deepEqual(Buffer.from(decoded[name]), files[`${name}.html`]);
    assert.match(decoded[name], /window\.parent\.addGameSession/);
  }
  const start = launcher.indexOf('function loadGamePage(');
  const end = launcher.indexOf("document.getElementById('backBtn').addEventListener", start);
  assert.equal(artifact.slice(0, start), launcher.slice(0, start));
  assert.ok(artifact.endsWith(launcher.slice(end)), 'Statistics/menu initialization preserved');
  assert.doesNotMatch(artifact.slice(artifact.indexOf('function loadGamePage('), artifact.indexOf("document.getElementById('backBtn').addEventListener")), /frame\.src\s*=|new URL|\.html/);
});

test('standalone loader assigns each retained frame once, verifies board and supports retry', () => {
  const artifact = singleHtml(launcher, sources);
  const frames = {};
  const document = { getElementById: id => frames[id], createElement: () => ({ setAttribute() {}, style: {}, addEventListener() {}, appendChild() {} }) };
  for (const game of ['chaturaji', 'enochian']) {
    const events = {};
    let assignments = 0;
    frames[`${game}-frame`] = {
      dataset: {}, contentWindow: { location: { href: 'about:blank' } }, contentDocument: { getElementById: () => ({}) },
      addEventListener: (name, fn) => events[name] = fn, removeEventListener: name => delete events[name],
      set srcdoc(value) { this.source = value; assignments++; }, get assignments() { return assignments; }, events,
    };
    frames[`${game}-wrapper`] = { appendChild() {} };
  }
  const context = vm.createContext({ document });
  vm.runInContext(artifact.slice(artifact.indexOf('const PACKAGED_GAME_SOURCES ='), artifact.indexOf("document.getElementById('backBtn').addEventListener")), context);
  for (const game of ['chaturaji', 'enochian']) {
    const frame = frames[`${game}-frame`];
    vm.runInContext(`loadGamePage('${game}'); loadGamePage('${game}');`, context);
    assert.equal(frame.assignments, 1);
    frame.events.load(); // Initial blank load cannot falsely mark success.
    assert.equal(frame.dataset.loading, '1');
    frame.contentWindow.location.href = 'about:srcdoc';
    frame.events.load();
    assert.equal(frame.dataset.loaded, '1');
    vm.runInContext(`loadGamePage('${game}');`, context);
    assert.equal(frame.assignments, 1);
    assert.equal(frame.source, sources[game]);
  }
  assert.equal(frames['chaturaji-frame'].assignments, 1, 'Switching preserves first browsing context');
  const failed = frames['enochian-frame'];
  delete failed.dataset.loaded;
  failed.contentDocument.getElementById = () => null;
  vm.runInContext("loadGamePage('enochian')", context);
  failed.events.load();
  assert.equal(failed.dataset.failed, '1');
  vm.runInContext("loadGamePage('enochian')", context);
  assert.equal(failed.assignments, 3);
});

test('default writes ZIP only; optional output and CLI input boundary preserve source files', () => {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'chess-package-'));
  try {
    packageClient({ outputRoot });
    assert.deepEqual(readdirSync(outputRoot), ['chess-eternal-blitz.zip']);
    packageClient({ outputRoot, standalone: true });
    assert.deepEqual(readdirSync(outputRoot).sort(), ['chess-eternal-blitz.zip', 'index.html']);
    for (const name of clientFiles) assert.deepEqual(readFileSync(resolve(root, name)), files[name]);
    assert.throws(() => singleHtml(launcher.replace('frame.src = page;', 'frame.src = other;'), sources));
  } finally { rmSync(outputRoot, { recursive: true, force: true }); }
});
