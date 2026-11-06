import { CAPTION_TTL_MS, HEARTBEAT_TIMEOUT_MS, type Snapshot } from '../../packages/protocol/index.ts';
export function visibleSegments<T extends Snapshot['segments'][number]>(state: Snapshot | undefined, receivedAt: number, now: number,
  rows: T[] = (state?.segments ?? []) as T[], count = 2) {
  if (!state || now - receivedAt > HEARTBEAT_TIMEOUT_MS || state.capture === 'failed' || state.capture === 'connecting') return [];
  return rows.filter(row => row.finalizedAt === null || now - row.finalizedAt < CAPTION_TTL_MS).slice(-count);
}
