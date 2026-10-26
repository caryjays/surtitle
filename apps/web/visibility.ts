import { CAPTION_TTL_MS, HEARTBEAT_TIMEOUT_MS, type Snapshot } from '../../packages/protocol/index.ts';
export function visibleSegments(state: Snapshot | undefined, receivedAt: number, now: number) {
  if (!state || now - receivedAt > HEARTBEAT_TIMEOUT_MS || state.capture === 'failed' || state.capture === 'connecting') return [];
  return state.segments.filter(row => row.finalizedAt === null || now - row.finalizedAt < CAPTION_TTL_MS).slice(-2);
}
