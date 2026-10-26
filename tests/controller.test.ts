import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, tick, ja, en } from './helpers.ts';
import { Command, MAX_SEGMENTS, Snapshot, Translation, TranslationInput } from '../packages/protocol/index.ts';
import { TranslationFailure } from '../packages/providers/types.ts';

test('partials do not translate; final replaces partial and duplicate finals do not bill twice', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.begin('a'); h.streams[0]!.emit({ type: 'partial', id: 'a', text: 'Hel' });
  assert.equal(h.requests.length, 0);
  h.streams[0]!.emit({ type: 'final', id: 'a', text: 'Hello' });
  h.streams[0]!.emit({ type: 'final', id: 'a', text: 'duplicate' });
  assert.equal(h.requests.length, 1); assert.equal(h.controller.snapshot().segments[0]!.original, 'Hello');
  h.requests[0]!.result.resolve(ja); await tick();
  assert.equal(h.controller.snapshot().segments[0]!.translation, ja.text);
  Snapshot.parse(h.controller.snapshot());
});
test('out-of-order translations update matching rows in speech order', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.final('first'); h.final('second', 'こんにちは');
  h.requests[1]!.result.resolve(en); await tick();
  assert.deepEqual(h.controller.snapshot().segments.map(r => [r.id, r.translation]), [['first', null], ['second', 'Hello']]);
  h.requests[0]!.result.resolve(ja); await tick();
  assert.deepEqual(h.controller.snapshot().segments.map(r => r.id), ['first', 'second']);
});
for (const mode of ['en-ja', 'ja-en'] as const) test(`direction ${mode} is passed and enforced`, async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start(mode); h.final('a');
  assert.equal(h.requests[0]!.input.mode, mode);
  h.requests[0]!.result.resolve(mode === 'en-ja' ? en : ja); await tick();
  assert.equal(h.controller.snapshot().segments[0]!.state, 'failed');
  h.final('b'); h.requests[1]!.result.resolve(mode === 'en-ja' ? ja : en); await tick();
  assert.equal(h.controller.snapshot().segments[1]!.state, 'ready');
});
test('failure and ambiguous auto output preserve original; subsequent requests recover', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.final('failure'); h.requests[0]!.result.reject(new Error('sensitive provider body')); await tick();
  assert.equal(h.controller.snapshot().segments[0]!.original, 'Hello');
  assert.equal(h.controller.snapshot().error, 'translation');
  h.final('ambiguous', 'CAD'); h.requests[1]!.result.resolve({ source: 'unknown', target: 'unknown', text: '' }); await tick();
  assert.equal(h.controller.snapshot().segments[1]!.state, 'unresolved');
  h.final('success'); h.requests[2]!.result.resolve(ja); await tick();
  assert.equal(h.controller.snapshot().segments[2]!.state, 'ready');
});
test('clear aborts translations and upstream, old callbacks cannot repaint; new generation works', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto'); h.final('old');
  const before = h.controller.snapshot(); await h.controller.clear();
  assert(h.streams[0]!.closed); assert(h.requests[0]!.signal.aborted);
  h.streams[0]!.emit({ type: 'begin', id: 'stale', sequence: 99 });
  h.streams[0]!.emit({ type: 'final', id: 'stale', text: 'old audio' });
  h.requests[0]!.result.resolve(ja); await tick();
  assert.equal(h.controller.snapshot().segments.length, 0);
  assert.equal(h.controller.snapshot().sessionId, before.sessionId);
  assert(h.controller.snapshot().generation > before.generation);
  h.final('new'); h.requests[1]!.result.resolve(ja); await tick();
  assert.equal(h.controller.snapshot().segments[0]!.id, 'new');
});
test('new session rejects prior work; pause flushes and leaves finalized originals', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto'); h.final('a');
  await h.controller.pause(); assert.equal(h.controller.snapshot().capture, 'paused');
  assert.equal(h.controller.snapshot().segments[0]!.original, 'Hello');
  const old = h.controller.snapshot().sessionId; h.controller.newSession();
  h.requests[0]!.result.resolve(ja); await tick();
  assert.notEqual(h.controller.snapshot().sessionId, old); assert.deepEqual(h.controller.snapshot().segments, []);
});
test('bounded concurrency, queue and history; overload is visible', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  for (let i = 0; i < 100; i++) h.final(String(i));
  const state = h.controller.snapshot();
  assert.equal(h.requests.length, 2); assert.equal(state.running, 2); assert.equal(state.queue, 8); assert.equal(state.segments.length, MAX_SEGMENTS);
  assert.equal(state.error, 'overload'); Snapshot.parse(state);
});
test('timeouts free capacity even if a provider ignores abort', async t => {
  const h = harness({ translationTimeoutMs: 10 }); t.after(() => h.controller.dispose()); await h.controller.start('auto'); h.final('a');
  await new Promise(r => setTimeout(r, 25));
  assert.equal(h.controller.snapshot().segments[0]!.state, 'failed'); assert.equal(h.controller.snapshot().running, 0);
  h.final('b'); h.requests[1]!.result.resolve(ja); await tick(); assert.equal(h.controller.snapshot().segments[1]!.state, 'ready');
});
test('stale queued work is skipped rather than flooding the overlay', async t => {
  const h = harness({ queueTtlMs: 1 }); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.final('a'); h.final('b'); h.final('c'); await new Promise(r => setTimeout(r, 5));
  h.requests[0]!.result.resolve(ja); await tick();
  assert.equal(h.requests.length, 2); assert.equal(h.controller.snapshot().segments[2]!.state, 'skipped');
});
test('capture failure is visible and preserves finalized original', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto'); h.final('a'); h.begin('partial');
  h.controller.fail('capture');
  assert.equal(h.controller.snapshot().capture, 'failed'); assert.equal(h.controller.snapshot().segments.length, 1);
});
test('protocol rejects malformed commands, oversized text and impossible language pairs', () => {
  for (const command of [{ type: 'start', mode: 'xx' }, { type: 'clear', secret: 'x' }, { type: 'audio', data: 'x' }]) assert.equal(Command.safeParse(command).success, false);
  assert.equal(Translation.safeParse({ source: 'en', target: 'en', text: 'hello' }).success, false);
  assert.equal(Translation.safeParse({ source: 'unknown', target: 'unknown', text: 'invented' }).success, false);
  assert.equal(Translation.safeParse({ ...ja, text: 'x'.repeat(4001) }).success, false);
});
test('conversation changes direction automatically without assuming alternating speakers', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  for (const [id, text, language, result] of [
    ['a', 'こんにちは', 'ja', en], ['b', '質問です', 'ja', en], ['c', 'Hello', 'en', ja],
  ] as const) {
    h.begin(id); h.streams[0]!.emit({ type: 'final', id, text, language });
    const request = h.requests.at(-1)!;
    assert.equal(request.input.mode, 'auto'); assert.equal(request.input.sourceLanguage, language);
    request.result.resolve(result); await tick();
  }
  assert.deepEqual(h.controller.snapshot().segments.map(r => r.target), ['en', 'en', 'ja']);
});
test('preset switch keeps current turn direction and does not restart capture or clear history', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto'); h.begin('old');
  const session = h.controller.snapshot().sessionId;
  h.controller.setMode('ja-en'); h.controller.flush();
  h.streams[0]!.emit({ type: 'final', id: 'old', text: 'Hello', language: 'en' });
  assert.equal(h.requests[0]!.input.mode, 'auto'); h.requests[0]!.result.resolve(ja); await tick();
  h.final('new', 'こんにちは'); assert.equal(h.requests[1]!.input.mode, 'ja-en');
  assert.equal(h.streams.length, 1); assert.equal(h.streams[0]!.closed, false);
  assert.equal(h.streams[0]!.flushes, 1); assert.deepEqual(h.streams[0]!.modes, ['auto', 'ja-en']);
  assert.equal(h.controller.snapshot().sessionId, session); assert.equal(h.controller.snapshot().segments.length, 2);
});
test('translation context is bounded, immutable, preceding-only and reset by clear', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  const longText = Array.from({ length: 1000 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
  h.final('first', longText); h.final('second');
  assert.deepEqual(h.requests[0]!.input.context, []);
  assert.equal(h.requests[1]!.input.context![0]!.original.length, 800);
  assert.equal(h.requests[1]!.input.context![0]!.translation, null);
  assert.deepEqual(h.controller.snapshot().turns[1]!.contextSequences, [0]);
  assert.equal(h.controller.snapshot().turns[1]!.contextMissingTranslations, 1);
  assert.equal(h.controller.snapshot().turns[1]!.contextClippedRows, 1);
  h.requests[0]!.result.resolve(ja); h.requests[1]!.result.resolve(ja); await tick();
  // Completing earlier work must not mutate context already submitted for the next turn.
  assert.equal(h.requests[1]!.input.context![0]!.translation, null);
  for (let i = 0; i < 7; i++) {
    h.final(`next-${i}`); h.requests.at(-1)!.result.resolve(ja); await tick();
  }
  assert.equal(h.requests.at(-1)!.input.context!.length, 4);
  await h.controller.clear(); h.final('fresh'); assert.deepEqual(h.requests.at(-1)!.input.context, []);
});
test('out-of-order finals never use later speech as translation context', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.begin('first'); h.begin('second');
  h.streams[0]!.emit({ type: 'final', id: 'second', text: 'Later speech' });
  h.streams[0]!.emit({ type: 'final', id: 'first', text: 'Earlier speech' });
  assert.deepEqual(h.requests[1]!.input.context, []);
});
test('local sessions can exceed 25 minutes while cloud session cap remains available', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 });
  const local = harness({ sessionLimitMs: null }); const cloud = harness();
  t.after(() => { local.controller.dispose(); cloud.controller.dispose(); });
  await local.controller.start('auto'); await cloud.controller.start('auto');
  // Keep receiving audio so only the session-age guard is under test.
  for (let i = 0; i < 26 * 60; i++) {
    local.controller.audio(new Uint8Array(2400)); cloud.controller.audio(new Uint8Array(2400));
    t.mock.timers.tick(1000);
  }
  assert.equal(local.controller.snapshot().capture, 'active');
  assert.equal(cloud.controller.snapshot().error, 'session-limit');
});
test('translation error categories are actionable and later success clears stale errors', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.final('failed'); h.requests[0]!.result.reject(new TranslationFailure('translation-rate-limit')); await tick();
  assert.equal(h.controller.snapshot().error, 'translation-rate-limit');
  assert.equal(h.controller.snapshot().segments[0]!.original, 'Hello');
  h.final('success'); h.requests[1]!.result.resolve(ja); await tick();
  assert.equal(h.controller.snapshot().error, null);
});
test('translation boundary rejects oversized or privileged context fields', () => {
  const base = { text: 'Hello', mode: 'auto', glossary: [] };
  const context = [{ original: 'x', translation: null, source: 'en' }];
  assert.equal(TranslationInput.safeParse({ ...base, context }).success, true);
  assert.equal(TranslationInput.safeParse({ ...base, context: Array(5).fill(context[0]) }).success, false);
  assert.equal(TranslationInput.safeParse({ ...base, context: [{ ...context[0], role: 'system' }] }).success, false);
  assert.equal(TranslationInput.safeParse({ ...base, context: [{ ...context[0], original: 'x'.repeat(801) }] }).success, false);
});
test('recognition loops are dropped before display, cloud translation and future context', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.begin('loop'); h.streams[0]!.emit({ type: 'partial', id: 'loop', text: 'クラス'.repeat(100) });
  assert.equal(h.controller.snapshot().segments[0]!.original, '');
  h.streams[0]!.emit({ type: 'final', id: 'loop', text: 'クラス'.repeat(100), language: 'ja' });
  assert.equal(h.requests.length, 0); assert.equal(h.controller.snapshot().segments.length, 0);
  assert.equal(h.controller.snapshot().rejected, 1);
  h.final('real'); assert.deepEqual(h.requests[0]!.input.context, []);
});
test('model-rejected non-speech does not translate even when text is not repetitive', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.begin('noise'); h.streams[0]!.emit({ type: 'final', id: 'noise', text: 'Invented speech', rejected: true });
  assert.equal(h.requests.length, 0); assert.equal(h.controller.snapshot().segments.length, 0);
  assert.equal(h.controller.snapshot().rejected, 1);
});
test('recalibration cancels old translations/context without restarting capture', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto'); h.final('old');
  const before = h.controller.snapshot(); h.controller.calibrate();
  assert.equal(h.streams.length, 1); assert.equal(h.streams[0]!.closed, false); assert.equal(h.streams[0]!.calibrations, 1);
  assert(h.requests[0]!.signal.aborted); assert.equal(h.controller.snapshot().sessionId, before.sessionId);
  assert(h.controller.snapshot().generation > before.generation); assert.equal(h.controller.snapshot().gate?.state, 'calibrating');
  h.requests[0]!.result.resolve(ja); await tick(); assert.deepEqual(h.controller.snapshot().segments, []);
  h.final('fresh'); assert.deepEqual(h.requests[1]!.input.context, []);
});
