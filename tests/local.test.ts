import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { LocalTranscriber, type LocalOptions } from '../packages/providers/local.ts';
import { Controller } from '../apps/service/controller.ts';
import { Snapshot, type TurnMeasurement } from '../packages/protocol/index.ts';
import type { TranscriptEvent } from '../packages/providers/types.ts';
import { deferred } from './helpers.ts';

function frame(voiced: boolean) {
  const pcm = Buffer.alloc(2400);
  if (voiced) for (let i = 0; i < 2400; i += 2) pcm.writeInt16LE(6000, i);
  return pcm;
}
function fixture(behavior = 'normal', extra: Partial<LocalOptions> = {}) {
  const measurements: TurnMeasurement[] = [];
  const events: TranscriptEvent[] = []; const failed = deferred<void>(); let failures = 0;
  const stream = new LocalTranscriber({ model: 'small-q4', mode: 'ja-en',
    workerFactory: () => spawn(process.execPath, ['tests/fixtures/fake-local-worker.mjs', behavior], { stdio: ['pipe', 'pipe', 'pipe'], env: {} }),
    onTurnDiagnostic: (_id, value) => measurements.push(value),
    onEvent: event => events.push(event), onFailure: () => { failures++; failed.resolve(); }, ...extra });
  return { stream, events, measurements, failed: failed.promise, failures: () => failures };
}
function turn(stream: LocalTranscriber) { stream.audio(frame(true)); for (let i = 0; i < 14; i++) stream.audio(frame(false)); }

test('local worker returns original-language final and forwards direction hints, no translation', async t => {
  const f = fixture(); t.after(() => f.stream.close()); await f.stream.connect(); turn(f.stream); await f.stream.finish();
  assert.deepEqual(f.events.map(e => e.type), ['begin', 'final']);
  const final = f.events[1]; assert(final?.type === 'final'); assert.equal(final.language, 'ja'); assert.equal(final.text, 'Local fixture');
  assert.equal(f.failures(), 0);
});
test('local adapter forwards duration, boundary, actual language, partial filtering and timings', async t => {
  const f = fixture('measurement'); t.after(() => f.stream.close()); await f.stream.connect();
  turn(f.stream); await f.stream.finish();
  assert.deepEqual(f.measurements[0], { boundary: 'silence', audioMs: 750, trailingQuietMs: 700 });
  const final = f.measurements.at(-1)!;
  assert.equal(final.recognitionLanguage, 'ja'); assert.equal(final.recognitionClipped, true);
  assert.equal(final.quality?.droppedSegments, 1); assert.equal(final.quality?.lowConfidenceDrops, 1);
  assert.equal(final.recognitionInferenceMs, 1);
  assert(final.recognitionQueueMs !== undefined && final.commitToFinalMs !== undefined);
  assert.equal(f.events.filter(event => event.type === 'final').length, 1);
});
for (const behavior of ['malformed', 'oversized', 'bad-measurement']) test(`local worker ${behavior} output fails closed`, async t => {
  const f = fixture(behavior); t.after(() => f.stream.close()); await f.stream.connect(); turn(f.stream); await f.failed;
  assert.equal(f.failures(), 1); assert.equal(f.events.filter(e => e.type === 'final').length, 0);
});
test('local startup and inference deadlines are bounded', async t => {
  const cold = fixture('no-ready', { startupTimeoutMs: 50 }); t.after(() => cold.stream.close());
  await assert.rejects(cold.stream.connect()); assert.equal(cold.failures(), 1);
  const busy = fixture('hang', { inferenceTimeoutMs: 20 }); t.after(() => busy.stream.close());
  await busy.stream.connect(); turn(busy.stream); await busy.failed; assert.equal(busy.failures(), 1);
  assert.equal(busy.measurements.at(-1)!.recognitionFailure, 'inference-timeout');
});
test('closing during model initialization cancels without resurrecting capture', async () => {
  const f = fixture('no-ready'); const pending = f.stream.connect(); f.stream.close();
  await assert.rejects(pending); assert.equal(f.failures(), 0);
});
test('local backlog is limited to one active and two queued; silence makes no inference work', async t => {
  const f = fixture('hang'); t.after(() => f.stream.close()); await f.stream.connect();
  for (let i = 0; i < 100; i++) f.stream.audio(frame(false)); assert.equal(f.events.length, 0);
  turn(f.stream); turn(f.stream); turn(f.stream);
  assert.throws(() => turn(f.stream), /backlog/);
});
test('translation-off bypasses translator and marks originals without false error or unresolved label', async t => {
  let emit!: (event: TranscriptEvent) => void;
  const controller = new Controller({ translator: null, glossary: [], backend: 'Local transcription · translation off', processing: 'local-only',
    transcriber: options => { emit = options.onEvent; return { async connect() {}, audio() {}, async finish() {}, close() {} }; } });
  t.after(() => controller.dispose()); await controller.start('ja-en');
  emit({ type: 'begin', id: 'fixture', sequence: 0 }); emit({ type: 'final', id: 'fixture', text: 'こんにちは', language: 'ja' });
  const state = Snapshot.parse(controller.snapshot());
  assert.equal(state.processing, 'local-only'); assert.equal(state.segments[0]!.state, 'original'); assert.equal(state.segments[0]!.source, 'ja');
  assert.equal(state.running, 0); assert.equal(state.queue, 0); assert.equal(state.error, null);
});
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail('worker event timed out');
}
test('local hint changes finalize old audio with its original hint and reuse the worker', async t => {
  const f = fixture(); t.after(() => f.stream.close()); await f.stream.connect();
  f.stream.audio(frame(true)); f.stream.setMode('en-ja');
  turn(f.stream); await f.stream.finish();
  assert.deepEqual(f.events.filter(e => e.type === 'begin').map(e => e.mode), ['ja-en', 'en-ja']);
  assert.deepEqual(f.events.filter(e => e.type === 'final').map(e => e.language), ['ja', 'en']);
  assert.equal(f.failures(), 0);
});
test('two agreeing local previews produce provisional source only; final remains a single event', async t => {
  const f = fixture('normal', { previewIntervalMs: 1000 }); t.after(() => f.stream.close()); await f.stream.connect();
  for (let i = 0; i < 20; i++) f.stream.audio(frame(true));
  // First preview seeds agreement, but must not display an unconfirmed hypothesis.
  await new Promise(r => setTimeout(r, 30));
  assert.equal(f.events.filter(e => e.type === 'partial').length, 0);
  for (let i = 0; i < 20; i++) f.stream.audio(frame(true));
  await until(() => f.events.some(e => e.type === 'partial'));
  assert.equal(f.events.filter(e => e.type === 'final').length, 0);
  f.stream.flush(); await f.stream.finish();
  assert.equal(f.events.filter(e => e.type === 'final').length, 1);
  assert.equal(f.failures(), 0);
});
test('preview results from a flushed turn do not repaint or become duplicate finals', async t => {
  const f = fixture('normal', { previewIntervalMs: 1000 }); t.after(() => f.stream.close()); await f.stream.connect();
  for (let i = 0; i < 20; i++) f.stream.audio(frame(true));
  f.stream.flush(); await f.stream.finish();
  assert.deepEqual(f.events.map(e => e.type), ['begin', 'final']);
});
for (const behavior of ['loop', 'rejected']) test(`local ${behavior} output is suppressed before leaving the adapter`, async t => {
  const f = fixture(behavior); t.after(() => f.stream.close()); await f.stream.connect(); turn(f.stream); await f.stream.finish();
  const final = f.events.find(event => event.type === 'final');
  assert(final?.type === 'final'); assert.equal(final.text, ''); assert.equal(final.rejected, true);
});
test('local calibration plus steady nonzero ambient input produces no recognition turns', async t => {
  const f = fixture('normal', { calibrationMs: 1500 }); t.after(() => f.stream.close()); await f.stream.connect();
  function signal(amplitude: number) {
    const pcm = Buffer.alloc(2400);
    for (let i = 0; i < 1200; i++) pcm.writeInt16LE(Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * 440 * i / 24000)), i * 2);
    return pcm;
  }
  for (let i = 0; i < 630; i++) f.stream.audio(signal(0.04));
  assert.equal(f.events.length, 0);
  for (let i = 0; i < 6; i++) f.stream.audio(signal(0.2));
  for (let i = 0; i < 14; i++) f.stream.audio(signal(0.04));
  await f.stream.finish();
  assert.equal(f.events.filter(event => event.type === 'final').length, 1);
  assert.equal(f.failures(), 0);
});
