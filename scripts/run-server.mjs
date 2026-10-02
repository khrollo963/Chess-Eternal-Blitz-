import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const server = fileURLToPath(new URL('../server/', import.meta.url));
const local = fileURLToPath(new URL('../.tooling/bun-1.4.2/bun-windows-x64/bun.exe', import.meta.url));
const runtime = existsSync(local) ? local : process.execPath;
const version = spawnSync(runtime, ['--version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== '1.4.2') {
  throw new Error('Run with approved Bun 1.4.2 or install the approved project-local runtime.');
}
const operations = {
  typecheck: ['node_modules/typescript/lib/tsc.js', '--noEmit'],
  build: ['node_modules/typescript/lib/tsc.js'],
  'build:test': ['node_modules/typescript/lib/tsc.js', '-p', 'tsconfig.test.json'],
  test: ['test', './test'],
  'test:integration': ['test', 'test/compatibility.test.ts'],
  dev: ['--watch', 'src/index.ts'],
  start: ['dist/index.js'],
};
const operation = process.argv[2];
const args = operations[operation];
if (!args) throw new Error(`Unknown server operation: ${operation}`);
console.info(`Selected runtime: Bun ${version.stdout.trim()}`);
if (operation === 'build') {
  const freshness = spawnSync(runtime, ['../scripts/extract-enochian-engine.mjs', '--check'], { cwd: server, stdio: 'inherit' });
  if (freshness.error) throw freshness.error;
  if (freshness.status !== 0) process.exit(freshness.status ?? 1);
}
if (operation === 'start' || operation === 'dev') {
  const child = spawn(runtime, args, { cwd: server, stdio: 'inherit' });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? 1;
  });
} else {
  const result = spawnSync(runtime, args, { cwd: server, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
