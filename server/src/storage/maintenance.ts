import { COLORS, type MatchRecord } from '../domain/match.js';
import type { MaintenanceHead } from './LobbyStore.js';

export function maintenanceLimit(limit = 64): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new Error('Invalid maintenance bounds');
  return limit;
}
export function maintenanceTime(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid maintenance time');
}
export function recordMaintenanceHead(record: MatchRecord): MaintenanceHead {
  const extra = record as MatchRecord & { service?: { instanceId: string }; exchangeOffer?: { expiresAt: number } | null };
  const deadlines: Array<number | null | undefined> = [];
  if (record.phase === 'lobby') deadlines.push(record.lobbyDeadline);
  if (record.phase === 'paused') deadlines.push(record.recoveryDeadline);
  if (record.phase === 'active' || record.phase === 'paused') deadlines.push(...COLORS.map(color => record.seats[color].disconnectDeadline));
  if (record.phase === 'active') deadlines.push(extra.exchangeOffer?.expiresAt);
  const times = deadlines.filter((value): value is number => value !== null && value !== undefined);
  return { revision: record.revision, phase: record.phase, nextDeadline: times.length ? Math.min(...times) : null,
    serviceInstanceId: extra.service?.instanceId ?? null };
}
