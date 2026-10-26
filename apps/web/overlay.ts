import { connect, renderSegments } from './client.ts';
import { visibleSegments } from './visibility.ts';
import type { Snapshot } from '../../packages/protocol/index.ts';
const captions = document.querySelector<HTMLElement>('#captions')!;
let state: Snapshot | undefined;
let receivedAt = 0;
function render() { renderSegments(captions, visibleSegments(state, receivedAt, Date.now())); }
connect('overlay', snapshot => { state = snapshot; receivedAt = Date.now(); render(); }, connected => {
  if (!connected) { state = undefined; render(); }
});
setInterval(render, 500);
