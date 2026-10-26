import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { get } from 'node:http';
import { WebSocket } from 'ws';
import { createCaptionServer } from '../apps/service/server.ts';
import { Snapshot } from '../packages/protocol/index.ts';
import { visibleSegments } from '../apps/web/visibility.ts';
import { harness, tick, ja } from './helpers.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const h = harness(); const webDir = await mkdtemp(join(tmpdir(), 'captions-test-'));
  for (const name of ['control.html', 'overlay.html', 'control.js', 'overlay.js', 'worklet.js', 'style.css']) await writeFile(join(webDir, name), 'fixture');
  const app = await createCaptionServer({ controller: h.controller, port: 0, webDir, configured: true });
  t.after(async () => { await app.close(); await rm(webDir, { recursive: true, force: true }); });
  async function connect(role: string, origin = app.origin) {
    const ws = new WebSocket(app.origin.replace('http:', 'ws:') + `/ws/${role}`, { origin });
    const first = once(ws, 'message'); await once(ws, 'open');
    const [data] = await first;
    return { ws, snapshot: Snapshot.parse(JSON.parse(String(data))) };
  }
  return { ...h, ...app, connect };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('condition timed out');
}
test('loopback server validates HTTP Host/Origin, paths and methods; overlay cannot request mic', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/control')).status, 200);
  const overlay = await fetch(f.origin + '/overlay');
  assert.equal(overlay.headers.get('permissions-policy'), 'microphone=(), camera=(), display-capture=()');
  assert.match(overlay.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal((await fetch(f.origin + '/control', { headers: { Origin: 'https://evil.test' } })).status, 403);
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    get(f.origin + '/control', { headers: { Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(wrongHost, 403);
  assert.equal((await fetch(f.origin + '/control', { method: 'POST' })).status, 405);
  assert.equal((await fetch(f.origin + '/.env')).status, 404);
  assert.equal((await fetch(f.origin + '/control', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});
test('foreign and missing WebSocket Origins are rejected', async t => {
  const f = await fixture(t);
  for (const origin of ['https://evil.test', undefined]) {
    const ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/ws/control', origin ? { origin } : {});
    await once(ws, 'error'); ws.terminate();
  }
  assert.equal(f.streams.length, 0);
});
test('overlay reconnect receives canonical snapshot without starting/stopping capture; overlay writes rejected', async t => {
  const f = await fixture(t); const control = await f.connect('control');
  control.ws.send(JSON.stringify({ type: 'start', mode: 'auto' }));
  await until(() => f.controller.snapshot().capture === 'active'); f.final('a'); f.requests[0]!.result.resolve(ja); await tick();
  const first = await f.connect('overlay'); assert.equal(first.snapshot.segments[0]!.translation, ja.text);
  first.ws.close(); await once(first.ws, 'close');
  assert.equal(f.streams[0]!.closed, false);
  const second = await f.connect('overlay'); assert.deepEqual(second.snapshot.segments, first.snapshot.segments); assert.equal(f.streams.length, 1);
  second.ws.send(JSON.stringify({ type: 'clear' })); await once(second.ws, 'close');
  assert.equal(f.controller.snapshot().segments[0]!.id, 'a'); assert.equal(f.streams[0]!.closed, false);
  control.ws.close(); await once(control.ws, 'close'); await until(() => f.controller.snapshot().capture === 'failed');
  const observer = await f.connect('overlay'); assert.equal(observer.snapshot.error, 'capture');
});
test('mode and flush commands keep the microphone session and history', async t => {
  const f = await fixture(t); const control = await f.connect('control');
  control.ws.send(JSON.stringify({ type: 'start', mode: 'auto' }));
  await until(() => f.controller.snapshot().capture === 'active'); f.final('a');
  const session = f.controller.snapshot().sessionId;
  control.ws.send(JSON.stringify({ type: 'set-mode', mode: 'ja-en' }));
  control.ws.send(JSON.stringify({ type: 'flush' }));
  await until(() => f.controller.snapshot().mode === 'ja-en' && f.streams[0]!.flushes === 1);
  assert.equal(f.streams.length, 1); assert.equal(f.streams[0]!.closed, false);
  assert.equal(f.controller.snapshot().sessionId, session); assert.equal(f.controller.snapshot().segments[0]!.id, 'a');
});
test('calibration command clears noise context without opening another capture stream', async t => {
  const f = await fixture(t); const control = await f.connect('control');
  control.ws.send(JSON.stringify({ type: 'start', mode: 'auto' }));
  await until(() => f.controller.snapshot().capture === 'active'); f.final('old');
  control.ws.send(JSON.stringify({ type: 'calibrate' }));
  await until(() => f.controller.snapshot().gate?.state === 'calibrating');
  assert.equal(f.controller.snapshot().segments.length, 0); assert.equal(f.streams.length, 1);
  assert(f.requests[0]!.signal.aborted);
});
test('audio frames have exact format, single owner, malformed messages stop capture safely', async t => {
  const f = await fixture(t); const control = await f.connect('control');
  const second = new WebSocket(f.origin.replace('http:', 'ws:') + '/ws/control', { origin: f.origin });
  await once(second, 'error'); second.terminate();
  control.ws.send(JSON.stringify({ type: 'start', mode: 'en-ja' })); await until(() => f.controller.snapshot().capture === 'active');
  control.ws.send(Buffer.alloc(2400)); await until(() => f.streams[0]!.frames === 1);
  control.ws.send(Buffer.alloc(12)); await once(control.ws, 'close');
  assert.equal(f.controller.snapshot().error, 'protocol'); assert(f.streams[0]!.closed);
});
test('stale/disconnected/failed overlays hide captions; clear snapshots stay empty', async t => {
  const h = harness(); t.after(() => { h.controller.dispose(); return Promise.resolve(); });
  await h.controller.start('auto'); h.final('a'); const state = h.controller.snapshot(); const now = Date.now();
  assert.equal(visibleSegments(state, now, now).length, 1);
  assert.deepEqual(visibleSegments(state, now, now + 6001), []);
  assert.deepEqual(visibleSegments(state, now + 21_000, now + 21_000), []);
  assert.deepEqual(visibleSegments(undefined, now, now), []);
  assert.deepEqual(visibleSegments({ ...state, capture: 'failed' }, now, now), []);
  await h.controller.clear(); assert.deepEqual(visibleSegments(h.controller.snapshot(), now, now), []);
});
