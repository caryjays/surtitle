import { connect, renderSegments } from './client.ts';
import { DEFAULT_PACE, Pacer } from './pacer.ts';
import { visibleSegments } from './visibility.ts';
import type { Snapshot } from '../../packages/protocol/index.ts';
const captions = document.querySelector<HTMLElement>('#captions')!;
const roll = document.querySelector<HTMLElement>('#roll')!;
// Per-surface settings in the Browser Source URL: ?pace=off releases text as it locks, ?lines=1..8 sizes the window.
const params = new URLSearchParams(location.search);
const pacer = new Pacer({ ...DEFAULT_PACE, enabled: params.get('pace') !== 'off' });
const lines = Number(params.get('lines'));
if (Number.isInteger(lines) && lines >= 1 && lines <= 8) captions.style.setProperty('--overlay-lines', String(lines));
const still = matchMedia('(prefers-reduced-motion: reduce)');
let state: Snapshot | undefined;
let receivedAt = 0;
let height = 0;
function render() {
  const now = Date.now();
  const rows = pacer.update(state, now).filter(row => row.original);
  renderSegments(roll, visibleSegments(state, receivedAt, now, rows, 6));
  // Roll-up: text that grows the window slides earlier lines up instead of jumping; the window clips the oldest.
  const grown = roll.offsetHeight - height;
  height = roll.offsetHeight;
  if (grown > 0 && !still.matches) {
    roll.style.transition = 'none'; roll.style.transform = `translateY(${grown}px)`;
    roll.getBoundingClientRect();
    roll.style.transition = 'transform 250ms ease-out'; roll.style.transform = '';
  }
}
connect('overlay', snapshot => { state = snapshot; receivedAt = Date.now(); render(); }, connected => {
  if (!connected) { state = undefined; render(); }
});
setInterval(render, 100);
