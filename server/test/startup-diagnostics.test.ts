import { expect, test } from 'bun:test';
import { startupDiagnostic } from '../src/recovery/startup-diagnostics.js';
import { startServer } from '../src/recovery/start-server.js';

test('startup diagnostics identify a command-cap rehydration failure without private details', () => {
  expect(startupDiagnostic('rehydrate', new Error('command_capacity'))).toEqual({
    event: 'multiplayer_startup_failed', stage: 'rehydrate', code: 'command_capacity',
  });
});

test('unknown startup errors cannot expose credentials, SQL, driver messages or causes', () => {
  const secret = 'postgres://private-user:private-password@private-host/db';
  const error = Object.assign(new Error(`SELECT record failed on ${secret}`, { cause: secret }), { code: secret });
  const diagnostic = startupDiagnostic('settlement', error);
  expect(diagnostic.code).toBe('startup_failed');
  expect(JSON.stringify(diagnostic)).not.toContain('private');
  expect(JSON.stringify(diagnostic)).not.toContain('SELECT');
  expect(startupDiagnostic('listen', Object.assign(new Error(secret), { code: 'EADDRINUSE' })).code).toBe('address_in_use');
  expect(startupDiagnostic('durable-runtime', new Error('Private database operation failed')).code).toBe('storage_unavailable');
});

test('real startup listener failure reports its safe stage instead of losing the cause', async () => {
  const occupied = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('fixture') });
  try {
    await expect(startServer({ HOST: '127.0.0.1', PORT: String(occupied.port) }, { signals: false }))
      .rejects.toThrow('Multiplayer startup failed (listen:address_in_use)');
  } finally { occupied.stop(true); }
});
