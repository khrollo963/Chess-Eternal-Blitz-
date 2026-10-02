import type { LobbyStore } from '../storage/LobbyStore.js';
import type { CommandResult } from '../storage/MatchStore.js';
import type { RecoveryCoordinator } from './RecoveryCoordinator.js';

export async function runGlobalMaintenance(options: {
  store: LobbyStore; recovery: Pick<RecoveryCoordinator, 'expireLobby' | 'expire'>;
  now: number; settlePending: () => Promise<void>;
  onCommitted?: (matchId: string, result: CommandResult) => void | Promise<void>;
}) {
  for (const due of await options.store.listLifecycleDue(options.now)) {
    const result = due.kind === 'lobby' ? await options.recovery.expireLobby(due.matchId) : await options.recovery.expire(due.matchId);
    if (result) await options.onCommitted?.(due.matchId, result);
  }
  await options.settlePending();
}
