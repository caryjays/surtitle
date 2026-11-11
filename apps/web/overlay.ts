import { connect } from './client.ts';
import { audienceView, parseOverlayQuery } from './audience.ts';
import type { Snapshot } from '../../packages/protocol/index.ts';
const view = audienceView(document.querySelector<HTMLElement>('#captions')!, document.querySelector<HTMLElement>('#roll')!);
// Per-surface settings in the Browser Source URL: ?pace=off releases text as it locks, ?lines=1..8 sizes the window.
view.configure(parseOverlayQuery(location.search));
let state: Snapshot | undefined;
let receivedAt = 0;
const render = () => view.render(state, receivedAt, Date.now());
connect('overlay', snapshot => { state = snapshot; receivedAt = Date.now(); render(); }, connected => {
  if (!connected) { state = undefined; render(); }
});
setInterval(render, 100);
