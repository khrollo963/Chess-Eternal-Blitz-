export type StartupStage = 'durable-runtime' | 'client-pages' | 'listen' | 'rehydrate' | 'settlement' | 'ready';
const safeCodes = new Set(['command_capacity', 'stale_revision', 'unauthorized', 'obsolete_service_instance',
  'invalid_phase', 'storage_unavailable', 'not_found', 'deadline_expired']);
/** Only fixed application/OS codes. Never retain driver messages, URLs, SQL, stacks or causes. */
export function startupDiagnostic(stage: StartupStage, error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const osCode = error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined;
  const code = safeCodes.has(message) ? message :
    message === 'Private database operation failed' || message === 'Durable multiplayer unavailable' ? 'storage_unavailable' :
    osCode === 'EADDRINUSE' ? 'address_in_use' : osCode === 'EACCES' ? 'permission_denied' : 'startup_failed';
  return { event: 'multiplayer_startup_failed', stage, code };
}
