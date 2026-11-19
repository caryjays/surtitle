import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { HostProbe } from '../packages/providers/host-probe.ts';
import { DiagnosticLog } from '../apps/web/diagnostics.ts';
import { describeHost } from '../apps/web/console.ts';
import { Snapshot } from '../packages/protocol/index.ts';

function probe(behavior: string, now = () => clock) {
  let child: ReturnType<typeof spawn> | undefined;
  const p = new HostProbe({ now, workerFactory: () => (child = spawn(process.execPath, ['tests/fixtures/fake-host-probe.mjs', behavior],
    { stdio: ['pipe', 'pipe', 'pipe'] })) as never });
  p.start();
  return { p, child: () => child! };
}
let clock = 0;
const until = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 10)); };

test('the host probe keeps the latest valid sample, and it goes stale after three intervals', async t => {
  clock = 0; const { p } = probe('normal'); t.after(() => p.close());
  await until(() => p.latest() !== null);
  assert.equal(p.latest()?.gpu?.obs, 0.3);
  assert.equal(p.latest()?.thermal, 'fair');
  clock = 6001;
  assert.equal(p.latest(), null);
});

test('a probe line with any field outside the schema, such as a process name, stops the probe', async t => {
  clock = 0; const { p, child } = probe('leak'); t.after(() => p.close());
  await once(child(), 'exit');
  assert.equal(p.latest(), null);
});

test('host load reaches the health diagnostic as shares and states only, and the console describes it', () => {
  const host = { intervalMs: 2000, gpu: { ours: 0.6, obs: 0.3, browser: 0.05, windowServer: 0.02, other: 0 },
    thermal: 'fair' as const, lowPower: true, power: 'battery' as const };
  const snapshot = Snapshot.parse({ type: 'snapshot', sessionId: '00000000-0000-4000-8000-000000000001', generation: 0, pair: ['en', 'ja'],
    revision: 1, capture: 'active', mode: 'auto', processing: 'local-audio-local-text', backend: 'x', error: null, queue: 0, running: 0,
    sentAt: 1, segments: [], host });
  const log = new DiagnosticLog(() => 1000); log.start(); log.observe(snapshot);
  const health = JSON.parse(log.exportJson()).events.find((e: { type: string }) => e.type === 'health');
  assert.deepEqual(health.health.host, host);
  assert.throws(() => Snapshot.parse({ ...snapshot, host: { ...host, name: 'OBS' } }));
  assert.deepEqual(describeHost(host), [['GPU use', 'captions 60% · OBS 30% · browser 5% · display 2% · other 0%'],
    ['Mac', 'thermal fair · on battery · Low Power Mode']]);
  assert.deepEqual(describeHost(null), []);
});
