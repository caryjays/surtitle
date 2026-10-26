import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../apps/service/controller.ts';
import { DiagnosticLog } from '../apps/web/diagnostics.ts';
import { Snapshot, TurnTrace, endsInEllipsis, MAX_SEGMENTS } from '../packages/protocol/index.ts';
import type { TranscriberFactory, Translator } from '../packages/providers/types.ts';
import { deferred, tick, ja } from './helpers.ts';

function fixture(translator: Translator | null = null, translationTimeoutMs?: number) {
  let callbacks!: Parameters<TranscriberFactory>[0];
  const controller = new Controller({ translator, translationTimeoutMs, backend: 'PRIVATE_CONFIG_SENTINEL', glossary: [], processing: 'local-only',
    transcriber: options => { callbacks = options; return { async connect() {}, audio() {}, async finish() {}, close() {} }; } });
  return { controller, callbacks: () => callbacks };
}

test('turn traces preserve rejected/empty outcomes without retaining speech and are strictly bounded', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.start('ja-en');
  const cb = f.callbacks();
  cb.onEvent({ type: 'begin', id: 'private-id', sequence: 0 });
  cb.onTurnDiagnostic?.('private-id', { boundary: 'max-duration', audioMs: 12000, trailingQuietMs: 0 });
  cb.onTurnDiagnostic?.('private-id', { recognitionLanguage: 'ru', recognitionInferenceMs: 301, recognitionQueueMs: 4,
    quality: { speechGateRejected: true, decodedSegments: 0, droppedSegments: 0, noSpeechDrops: 0,
      lowConfidenceDrops: 0, repetitionDrops: 0, invalidScoreDrops: 0, noSpeechMax: null, logprobMin: null } });
  cb.onEvent({ type: 'final', id: 'private-id', text: '', rejected: true, language: 'unknown' });
  assert.equal(f.controller.snapshot().segments.length, 0);
  const trace = f.controller.snapshot().turns[0]!;
  assert.equal(trace.outcome, 'rejected'); assert.equal(trace.mode, 'ja-en');
  assert.equal(trace.boundary, 'max-duration'); assert.equal(trace.recognitionLanguage, 'ru');
  const log = new DiagnosticLog(); log.start(); log.observe(f.controller.snapshot());
  const report = JSON.parse(log.exportJson());
  assert.equal(report.version, 2); assert.equal(report.serviceTurnTelemetryObserved, true);
  assert(report.events.some((event: any) => event.type === 'turn' && event.turn.outcome === 'rejected'));
  assert(!log.exportJson().includes('private-id')); assert(!log.exportJson().includes('PRIVATE_CONFIG_SENTINEL'));
  for (let i = 0; i < MAX_SEGMENTS + 10; i++) {
    cb.onEvent({ type: 'begin', id: `empty-${i}`, sequence: i + 1 });
    cb.onEvent({ type: 'final', id: `empty-${i}`, text: '' });
  }
  assert.equal(f.controller.snapshot().turns.length, MAX_SEGMENTS);
  assert(f.controller.snapshot().turns.every(turn => turn.outcome === 'empty'));
  f.controller.newSession(); assert.equal(f.controller.snapshot().turns.length, 0);
});
test('trace carries actual old-turn mode, pre-translation language, context bounds and ellipsis flags', async t => {
  const pending = deferred<typeof ja>();
  const f = fixture({ async translate(_input, _signal, diagnostic) {
    diagnostic?.({ response: 'completed', outputTokenLimitReached: false }); return pending.promise;
  } });
  t.after(() => f.controller.dispose()); await f.controller.start('auto');
  const cb = f.callbacks();
  cb.onEvent({ type: 'begin', id: 'old', sequence: 0, mode: 'en-ja' });
  cb.onEvent({ type: 'final', id: 'old', text: 'PRIVATE_ORIGINAL_SENTINEL...', language: 'en' });
  pending.resolve({ ...ja, text: 'PRIVATE_TRANSLATION_SENTINEL…' }); await tick();
  const turn = f.controller.snapshot().turns[0]!;
  assert.equal(turn.mode, 'en-ja'); assert.equal(turn.recognitionSource, 'en');
  assert.equal(turn.originalEndsInEllipsis, true); assert.equal(turn.translationEndsInEllipsis, true);
  assert.equal(turn.translationResponse, 'completed'); assert.equal(turn.outcome, 'ready');
  assert.deepEqual(turn.contextSequences, []); assert.equal(turn.contextMissingTranslations, 0);
  assert(turn.translationQueueMs !== undefined && turn.translationMs !== undefined);
  const log = new DiagnosticLog(); log.start(); log.observe(f.controller.snapshot());
  assert(!log.exportJson().includes('PRIVATE_'));
  cb.onEvent({ type: 'begin', id: 'second', sequence: 1 });
  cb.onEvent({ type: 'final', id: 'second', text: 'A continuation', language: 'en' });
  assert.deepEqual(f.controller.snapshot().turns[1]!.contextSequences, [0]);
});
test('old in-flight diagnostic callbacks cannot repopulate after clear or timeout', async t => {
  let report!: Parameters<Translator['translate']>[2];
  const pending = deferred<typeof ja>();
  const f = fixture({ async translate(_input, _signal, diagnostic) { report = diagnostic; return pending.promise; } });
  t.after(() => f.controller.dispose()); await f.controller.start('auto');
  const cb = f.callbacks(); cb.onEvent({ type: 'begin', id: 'old', sequence: 0 });
  cb.onEvent({ type: 'final', id: 'old', text: 'A test question', language: 'en' });
  await f.controller.clear(); report?.({ response: 'incomplete', outputTokenLimitReached: true });
  pending.resolve(ja); await tick();
  assert.deepEqual(f.controller.snapshot().turns, []); assert.deepEqual(f.controller.snapshot().segments, []);
  let late!: Parameters<Translator['translate']>[2]; const lateResult = deferred<typeof ja>();
  const slow = fixture({ async translate(_input, _signal, diagnostic) { late = diagnostic; return lateResult.promise; } }, 5);
  t.after(() => slow.controller.dispose()); await slow.controller.start('auto');
  slow.callbacks().onEvent({ type: 'begin', id: 'slow', sequence: 0 });
  slow.callbacks().onEvent({ type: 'final', id: 'slow', text: 'A test question', language: 'en' });
  await new Promise(resolve => setTimeout(resolve, 20));
  const failed = slow.controller.snapshot().turns;
  assert.equal(failed[0]!.translationFailure, 'timeout');
  late?.({ response: 'completed', outputTokenLimitReached: false }); lateResult.resolve(ja); await tick();
  assert.deepEqual(slow.controller.snapshot().turns, failed);
});
test('segment removal is explicit and attributed to a retained rejection trace', () => {
  const log = new DiagnosticLog(); log.start();
  const snapshot = Snapshot.parse({ type: 'snapshot', sessionId: '00000000-0000-4000-8000-000000000001', generation: 0,
    revision: 1, capture: 'active', mode: 'auto', processing: 'local-only', backend: 'fake', error: null,
    queue: 0, running: 0, sentAt: 1, segments: [{ id: 'test', sequence: 3, original: '', translation: null,
      state: 'partial', source: 'unknown', target: 'unknown', final: false, finalizedAt: null, translationMs: null }],
    turns: [{ sequence: 3, mode: 'auto', outcome: 'capturing' }], turnTelemetryVersion: 2 });
  log.observe(snapshot);
  log.observe({ ...snapshot, segments: [], turns: [{ sequence: 3, mode: 'auto', outcome: 'rejected' }] });
  const events = JSON.parse(log.exportJson()).events;
  assert(events.some((event: any) => event.type === 'segment-removed' && event.sequence === 3 && event.outcome === 'rejected'));
});
test('telemetry boundary rejects arbitrary text, invalid metrics and oversized histories', () => {
  const trace = { sequence: 0, mode: 'auto', outcome: 'ready' };
  assert(TurnTrace.safeParse(trace).success);
  for (const value of [{ ...trace, transcript: 'private' }, { ...trace, recognitionLanguage: 'private-secret' },
    { ...trace, recognitionInferenceMs: -1 }, { ...trace, audioMs: Infinity }, { ...trace, boundary: 'sentence' },
    { ...trace, contextSequences: [0, 1, 2, 3, 4] }]) assert.equal(TurnTrace.safeParse(value).success, false);
  assert.equal(endsInEllipsis('A continuation...'), true);
  assert.equal(endsInEllipsis('続き…」'), true);
  assert.equal(endsInEllipsis('A finished sentence.'), false);
});
