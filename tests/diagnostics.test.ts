import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticLog, DIAGNOSTIC_LIMIT, captureSettings, describeCapture } from '../apps/web/diagnostics.ts';
import { Snapshot } from '../packages/protocol/index.ts';

function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return Snapshot.parse({ type: 'snapshot', sessionId: '00000000-0000-4000-8000-000000000001', generation: 0, pair: ['en', 'ja'],
    revision: 1, capture: 'active', mode: 'auto', processing: 'local-audio-cloud-text', backend: 'PRIVATE_CONFIG_SENTINEL',
    error: null, queue: 0, running: 0, sentAt: 123, rejected: 2, gate: { state: 'quiet', level: 0.01, threshold: 0.025, remainingMs: 0 },
    segments: [{ id: 'PRIVATE_ID_SENTINEL', sequence: 0, original: 'PRIVATE_ORIGINAL_SENTINEL 日本語です',
      translation: 'PRIVATE_TRANSLATION_SENTINEL', final: true, source: 'ja', target: 'en', state: 'ready',
      finalizedAt: 100, translationMs: 250 }], ...patch });
}
const exported = (log: DiagnosticLog) => JSON.parse(log.exportJson());

test('diagnostics are off by default and never write to browser storage', () => {
  const log = new DiagnosticLog();
  log.observe(snapshot()); log.connection(true); log.command({ type: 'clear' }); log.mark();
  assert.deepEqual(log.status, { collecting: false, count: 0, dropped: 0 });
  assert.equal(exported(log).startedAtMs, null);
});
test('export uses a content-free allowlist, with language/script metadata but no IDs, text or config', () => {
  const log = new DiagnosticLog(() => 1000); log.start(); log.observe(snapshot());
  log.command({ type: 'set-mode', mode: 'ja-en' });
  log.command({ type: 'clear', Authorization: 'PRIVATE_AUTH_SENTINEL' });
  log.observe({ ...snapshot(), error: 'PRIVATE_ERROR_SENTINEL' });
  const json = log.exportJson(); const result = JSON.parse(json);
  assert(!json.includes('PRIVATE_'));
  assert(!json.includes('00000000-0000-4000-8000-000000000001'));
  const row = result.events.find((event: any) => event.type === 'segment');
  assert.equal(row.row.source, 'ja'); assert.equal(row.row.translationMs, 250);
  assert(row.row.scriptLetters.han > 0 && row.row.scriptLetters.kana > 0);
  assert.equal(row.baseline, true); assert.equal(row.sinceFirstObservedMs, 0);
  assert.deepEqual(result.events.filter((event: any) => event.type === 'command').map((event: any) => event.command), [{ type: 'set-mode', mode: 'ja-en' }]);
});
test('deduplicates unchanged rows, samples gate levels, and captures mode/error/rejection transitions', () => {
  let now = 1000; const log = new DiagnosticLog(() => now); log.start();
  const initial = snapshot(); log.observe(initial);
  const baselineCount = log.status.count;
  now += 50; log.observe(initial); assert.equal(log.status.count, baselineCount);
  now += 2000; log.observe({ ...initial, gate: { ...initial.gate!, level: 0.02 } });
  assert.equal(log.status.count, baselineCount + 1);
  now += 10; log.observe({ ...initial, mode: 'ja-en', rejected: 3, error: 'translation-network' });
  const last = exported(log).events.at(-1);
  assert.equal(last.health.mode, 'ja-en'); assert.equal(last.health.rejected, 3);
  assert.equal(last.health.error, 'translation-network');
  now += 100; log.observe({ ...initial, segments: [{ ...initial.segments[0]!, state: 'unresolved', source: 'unknown', target: 'unknown', translation: null }] });
  const changed = exported(log).events.at(-1);
  assert.equal(changed.row.state, 'unresolved'); assert.equal(changed.baseline, false);
  assert.equal(changed.sinceFirstObservedMs, 2160);
});
test('clear/new session boundaries, pause/resume and stop do not mix row observations', () => {
  let now = 1; const log = new DiagnosticLog(() => now); log.start(); log.observe(snapshot());
  now = 10; log.observe(snapshot({ generation: 1 }));
  assert.equal(exported(log).events.at(-1).sinceFirstObservedMs, 0);
  log.observe(snapshot({ sessionId: '00000000-0000-4000-8000-000000000002', generation: 0 }));
  assert.equal(exported(log).events.at(-1).session, 2);
  log.stop(); const count = log.status.count;
  now = 100; log.observe(snapshot()); log.mark(); assert.equal(log.status.count, count);
  log.start(); log.observe(snapshot()); assert.equal(exported(log).events.at(-1).baseline, true);
  log.clear(); assert.deepEqual(log.status, { collecting: false, count: 0, dropped: 0 });
  assert.equal(exported(log).startedAtMs, null);
});
test('already validated snapshot fast path preserves the same content-free export without a second full parse', () => {
  const checked = snapshot(); const direct = new DiagnosticLog(() => 1000); const validated = new DiagnosticLog(() => 1000);
  direct.start(); validated.start(); direct.observe(checked); validated.observeSnapshot(checked);
  assert.equal(validated.exportJson(), direct.exportJson());
  assert(!validated.exportJson().includes('PRIVATE_'));
});
test('retains only the latest bounded metadata events and reports truncation', () => {
  const log = new DiagnosticLog(); log.start();
  for (let i = 0; i < DIAGNOSTIC_LIMIT + 5; i++) log.mark();
  assert.equal(log.status.count, DIAGNOSTIC_LIMIT); assert.equal(log.status.dropped, 6);
  assert.equal(exported(log).events.length, DIAGNOSTIC_LIMIT);
});

test('applied capture settings are logged from an allowlist, without the device label or IDs', () => {
  const log = new DiagnosticLog(() => 1000); log.start();
  const settings = captureSettings({ echoCancellation: true, noiseSuppression: false, autoGainControl: 'PRIVATE_VALUE_SENTINEL', sampleRate: 48_000,
    channelCount: 1, deviceId: 'PRIVATE_DEVICE_SENTINEL', groupId: 'PRIVATE_GROUP_SENTINEL', label: 'PRIVATE_LABEL_SENTINEL' });
  log.capture(settings);
  log.capture({ ...settings, deviceId: 'PRIVATE_DEVICE_SENTINEL' }); // not the allowlisted shape: dropped
  const json = log.exportJson();
  assert(!json.includes('PRIVATE_'));
  assert.deepEqual(JSON.parse(json).events.filter((event: any) => event.type === 'capture').map((event: any) => event.settings),
    [{ echoCancellation: true, noiseSuppression: false, autoGainControl: null, sampleRate: 48_000, channelCount: 1 }]);
  assert.equal(describeCapture(settings), 'echo cancellation on · noise suppression off · automatic gain not reported · 48000 Hz');
  assert.deepEqual(captureSettings(undefined), { echoCancellation: null, noiseSuppression: null, autoGainControl: null, sampleRate: null, channelCount: null });
});

test('display events record when the audience preview released a row, once per stage, without text', () => {
  let now = 1000;
  const log = new DiagnosticLog(() => now); log.start(); log.observe(snapshot());
  const shown = (patch: object) => [{ sequence: 7, final: false, state: 'partial' as const, original: '', originalRest: '',
    translation: null as string | null, translationRest: '', ...patch }];
  log.display([{ sequence: 0, final: true, state: 'ready', original: 'PRIVATE_ORIGINAL_SENTINEL', originalRest: '', translation: 'PRIVATE_TRANSLATION_SENTINEL', translationRest: '' }], true);
  now = 2000; log.display(shown({ original: 'PRIVATE_A', originalRest: 'PRIVATE_B' }), true);
  now = 3000; log.display(shown({ original: 'PRIVATE_A', final: true, state: 'pending', translation: 'PRIVATE_C', translationRest: 'PRIVATE_D' }), true);
  now = 4000; log.display(shown({ original: 'PRIVATE_A', final: true, state: 'ready', translation: 'PRIVATE_C', translationRest: 'PRIVATE_D' }), true);
  now = 5000; log.display(shown({ original: 'PRIVATE_A', final: true, state: 'ready', translation: 'PRIVATE_C' }), true);
  now = 6000; log.display(shown({ original: 'PRIVATE_A', final: true, state: 'ready', translation: 'PRIVATE_C' }), true);
  const json = log.exportJson();
  assert(!json.includes('PRIVATE_'));
  // The row on screen when collection started has no release time and is not reported.
  assert.deepEqual(JSON.parse(json).events.filter((event: any) => event.type === 'display').map((event: any) => [event.atMs, event.sequence, event.stage, event.paced]),
    [[2000, 7, 'original-first', true], [3000, 7, 'original-all', true], [3000, 7, 'translation-first', true], [5000, 7, 'translation-all', true]]);
});
