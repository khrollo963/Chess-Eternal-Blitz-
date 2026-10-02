/** Bounds unauthenticated room/polling amplification; historical records remain retained. */
export const DEFAULT_MAX_UNSTARTED_LOBBIES = 64;
export class LobbyCapacityError extends Error {
  constructor() { super('lobby_capacity'); }
}
export function lobbyCapacity(value = DEFAULT_MAX_UNSTARTED_LOBBIES): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) throw new Error('Invalid lobby capacity');
  return value;
}
export function readLobbyCapacity(env: Record<string, string | undefined>): number {
  const value = env.MULTIPLAYER_MAX_UNSTARTED_LOBBIES;
  if (value === undefined) return DEFAULT_MAX_UNSTARTED_LOBBIES;
  if (!/^[1-9]\d{0,2}$/.test(value)) throw new Error('Invalid lobby capacity');
  return lobbyCapacity(Number(value));
}
