import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, tick, ja, en } from './helpers.ts';
import { Controller } from '../apps/service/controller.ts';
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
test('the pair changes only while capture is off, among the offered pairs, and starts a new session in Auto', async t => {
  const h = harness({ pairs: [['en', 'ja'], ['en', 'es']] }); t.after(() => h.controller.dispose());
  assert.deepEqual(h.controller.snapshot().pairs, [['en', 'es'], ['en', 'ja']]);
  await h.controller.start('ja-en'); h.final('a');
  const before = h.controller.snapshot();
  h.controller.setPair(['en', 'es']);
  assert.deepEqual(h.controller.snapshot().pair, ['en', 'ja'], 'ignored while capturing');
  await h.controller.pause();
  h.controller.setPair(['en', 'zh' as never]);
  assert.deepEqual(h.controller.snapshot().pair, ['en', 'ja'], 'a pair that is not offered is ignored');
  h.controller.setPair(['en', 'es']);
  const after = h.controller.snapshot(); Snapshot.parse(after);
  assert.deepEqual([after.pair, after.mode, after.capture, after.segments.length], [['en', 'es'], 'auto', 'paused', 0]);
  assert.notEqual(after.sessionId, before.sessionId);
  assert.deepEqual(h.translatorPairs, [['en', 'es']]);
  assert(h.controller.accepts('es-en') && !h.controller.accepts('ja-en'));
  await h.controller.start('auto'); h.final('b', 'Hola');
  assert.deepEqual(h.streams.at(-1)!.pair, ['en', 'es']);
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
test('streamed translation text shows while pending, never as context, and a failure or wrong direction clears it', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.final('a');
  h.requests[0]!.partial({ source: 'en', target: 'ja', text: 'こん' });
  assert.deepEqual([h.controller.snapshot().segments[0]!.state, h.controller.snapshot().segments[0]!.translation], ['pending', 'こん']);
  h.final('b');
  // The next request's context does not carry the unfinished translation.
  assert.equal(h.requests[1]!.input.context![0]!.translation, null);
  assert.equal(h.controller.snapshot().turns[1]!.contextMissingTranslations, 1);
  h.requests[0]!.partial({ source: 'en', target: 'ja', text: 'こん'.repeat(40) });
  assert.equal(h.controller.snapshot().segments[0]!.translation, 'こん');
  h.requests[0]!.result.resolve(ja); await tick();
  assert.equal(h.controller.snapshot().segments[0]!.translation, ja.text);
  h.requests[0]!.partial({ source: 'en', target: 'ja', text: 'late' });
  assert.equal(h.controller.snapshot().segments[0]!.translation, ja.text);
  // A failure after streamed text keeps only the original.
  h.requests[1]!.partial({ source: 'en', target: 'ja', text: 'こん' });
  h.requests[1]!.result.reject(new Error('cut off')); await tick();
  assert.deepEqual([h.controller.snapshot().segments[1]!.state, h.controller.snapshot().segments[1]!.translation], ['failed', null]);
  Snapshot.parse(h.controller.snapshot());
  // A forced direction shows nothing streamed the wrong way, nor an unresolved reply.
  const forced = harness(); t.after(() => forced.controller.dispose()); await forced.controller.start('en-ja'); forced.final('c');
  forced.requests[0]!.partial({ source: 'ja', target: 'en', text: 'Hel' });
  forced.requests[0]!.partial({ source: 'unknown', target: 'unknown', text: 'x' });
  assert.equal(forced.controller.snapshot().segments[0]!.translation, null);
  // Clear invalidates a request that keeps streaming.
  forced.requests[0]!.partial({ source: 'en', target: 'ja', text: 'こ' });
  assert.equal(forced.controller.snapshot().segments[0]!.translation, 'こ');
  await forced.controller.clear();
  forced.requests[0]!.partial({ source: 'en', target: 'ja', text: 'こん' });
  assert.equal(forced.controller.snapshot().segments.length, 0);
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
test('a rejected row of uncaptioned speech stays as a marker, never translated or context', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.begin('spanish'); h.streams[0]!.emit({ type: 'final', id: 'spanish', text: '', rejected: true, uncaptioned: 'language' });
  const [marker] = h.controller.snapshot().segments;
  assert.deepEqual([marker!.original, marker!.final, marker!.state, marker!.uncaptioned, marker!.translation], ['', true, 'original', 'language', null]);
  assert.equal(h.requests.length, 0); assert.equal(h.controller.snapshot().rejected, 1);
  h.final('real'); assert.deepEqual(h.requests[0]!.input.context, []);
});
test('recalibration keeps finalized rows, cancels pending translations and context, and drops open rows without restarting capture', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.final('done'); h.requests[0]!.result.resolve(ja); await tick();
  h.final('pending'); h.requests[1]!.partial({ source: 'en', target: 'ja', text: 'こん' }); h.begin('open');
  assert.equal(h.controller.snapshot().segments[1]!.translation, 'こん');
  const before = h.controller.snapshot(); h.controller.calibrate();
  assert.equal(h.streams.length, 1); assert.equal(h.streams[0]!.closed, false); assert.equal(h.streams[0]!.calibrations, 1);
  assert(h.requests[1]!.signal.aborted); assert.equal(h.controller.snapshot().sessionId, before.sessionId);
  assert.equal(h.controller.snapshot().generation, before.generation); assert.equal(h.controller.snapshot().gate?.state, 'calibrating');
  h.requests[1]!.result.resolve(ja); h.streams[0]!.emit({ type: 'final', id: 'open', text: 'late' }); await tick();
  const after = h.controller.snapshot();
  assert.deepEqual(after.segments.map(row => [row.id, row.state, row.translation]), [['done', 'ready', ja.text], ['pending', 'skipped', null]]);
  assert.deepEqual(after.turns.map(turn => turn.outcome), ['ready', 'skipped']);
  assert.equal(after.queue, 0); assert.equal(after.running, 0);
  h.final('fresh'); assert.deepEqual(h.requests[2]!.input.context, []);
  h.requests[2]!.result.resolve(ja); await tick();
  h.final('next'); assert.deepEqual(h.requests[3]!.input.context!.map(row => row.translation), [ja.text]);
});
test('segmentation switches only while capture is off and applies from the next Start', async t => {
  const h = harness({ segmentation: 'turns' }); t.after(() => h.controller.dispose());
  assert.equal(h.controller.snapshot().segmentation, 'turns');
  h.controller.setSegmentation('rolling');
  await h.controller.start('auto');
  assert.equal(h.streams[0]!.segmentation, 'rolling');
  h.controller.setSegmentation('turns');
  assert.equal(h.controller.snapshot().segmentation, 'rolling', 'refused while capturing');
  await h.controller.pause(); h.controller.setSegmentation('turns'); await h.controller.start('auto');
  assert.equal(h.streams[1]!.segmentation, 'turns');
  // A recognizer without the choice reports none and ignores the command.
  const fixed = harness(); t.after(() => fixed.controller.dispose());
  fixed.controller.setSegmentation('rolling');
  assert.equal(fixed.controller.snapshot().segmentation, null);
  await fixed.controller.start('auto'); assert.equal(fixed.streams[0]!.segmentation, undefined);
  Snapshot.parse(h.controller.snapshot());
});
test('translation can be switched off and on per session; off drops queued requests and keeps originals', async t => {
  const h = harness({ processing: 'local-audio-cloud-text' }); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  assert.deepEqual(h.controller.snapshot().translation, { available: true, enabled: true });
  h.final('a'); h.final('b'); h.final('c'); // two run, one waits in the queue
  assert.equal(h.requests.length, 2); assert.equal(h.controller.snapshot().queue, 1);
  h.controller.setTranslation(false);
  const off = h.controller.snapshot();
  assert.equal(off.processing, 'local-only'); assert.equal(off.queue, 0);
  assert.equal(off.segments.find(r => r.id === 'c')!.state, 'original');
  h.requests[0]!.result.resolve(ja); await tick();
  assert.equal(h.controller.snapshot().segments.find(r => r.id === 'a')!.state, 'ready', 'a request already sent finishes');
  h.final('d'); assert.equal(h.requests.length, 2);
  assert.equal(h.controller.snapshot().segments.find(r => r.id === 'd')!.state, 'original');
  h.controller.setTranslation(true); h.final('e');
  assert.equal(h.requests.length, 3); assert.equal(h.controller.snapshot().processing, 'local-audio-cloud-text');
});
test('translation cannot be switched on without a configured translator', async t => {
  const none = new Controller({
    transcriber: () => ({ async connect() {}, audio() {}, async finish() {}, close() {} }), translator: null, glossary: [], backend: 'none', processing: 'local-only' });
  t.after(() => none.dispose());
  none.setTranslation(true);
  assert.deepEqual(none.snapshot().translation, { available: false, enabled: false });
  assert.equal(none.snapshot().processing, 'local-only');
});
test('the two settings commands parse and nothing else rides on them', () => {
  assert.doesNotThrow(() => Command.parse({ type: 'set-segmentation', segmentation: 'rolling' }));
  assert.doesNotThrow(() => Command.parse({ type: 'set-translation', enabled: false }));
  for (const bad of [{ type: 'set-segmentation', segmentation: 'words' }, { type: 'set-translation', enabled: 'yes' },
    { type: 'set-translation', enabled: true, provider: 'other' }]) assert.throws(() => Command.parse(bad));
});

test('a recognizer failure while capturing restarts it visibly, keeps finished rows and the noise gate, and stops after two', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.final('kept'); h.begin('open');
  h.streams[0]!.gate({ state: 'quiet', level: 0.001, threshold: 0.02, remainingMs: 0 });
  h.streams[0]!.fail();
  // Restarting shows as connecting with the flag; the open row is gone and the finished one stays.
  let snapshot = h.controller.snapshot();
  assert.deepEqual([snapshot.capture, snapshot.restarting, snapshot.restarts, snapshot.error], ['connecting', true, 1, null]);
  assert.deepEqual(snapshot.segments.map(row => row.id), ['kept']); assert.equal(h.streams[0]!.closed, true);
  await tick();
  snapshot = h.controller.snapshot(); Snapshot.parse(snapshot);
  assert.deepEqual([snapshot.capture, snapshot.restarting, snapshot.restarts], ['active', undefined, 1]);
  assert.equal(h.streams.length, 2); assert.equal(h.streams[1]!.gateThreshold, 0.02);
  // A late failure report from the replaced stream changes nothing.
  h.streams[0]!.fail(); assert.equal(h.controller.snapshot().capture, 'active');
  h.final('after'); assert.deepEqual(h.controller.snapshot().segments.map(row => row.id), ['kept', 'after']);
  // A second failure restarts again, without a gate to carry while the new stream has reported none.
  h.streams[1]!.fail(); await tick();
  assert.deepEqual([h.controller.snapshot().capture, h.controller.snapshot().restarts, h.streams[2]!.gateThreshold], ['active', 2, undefined]);
  // The third within the window fails capture and waits for the operator.
  h.streams[2]!.fail(); await tick();
  snapshot = h.controller.snapshot();
  assert.deepEqual([snapshot.capture, snapshot.error, snapshot.restarts, h.streams.length], ['failed', 'transcription', 2, 3]);
  // Start resets the count.
  await h.controller.start('auto'); assert.equal(h.controller.snapshot().restarts, 0);
});
test('a recognizer that fails while restarting fails capture, and Pause during a restart ends it', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.streams[0]!.fail(); h.streams[1]!.fail(); await tick();
  assert.deepEqual([h.controller.snapshot().capture, h.controller.snapshot().error], ['failed', 'transcription']);
  await h.controller.start('auto'); h.streams.at(-1)!.fail();
  await h.controller.pause(); await tick();
  assert.deepEqual([h.controller.snapshot().capture, h.controller.snapshot().restarting], ['paused', undefined]);
});

test('a partial row carries its agreed length only while it exceeds the locked one, and a final drops both', async t => {
  const h = harness(); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.begin('a');
  const row = () => h.controller.snapshot().segments.at(-1)!;
  h.streams[0]!.emit({ type: 'partial', id: 'a', text: 'one two three four', stable: 3, agreed: 13 });
  assert.deepEqual([row().stable, row().agreed], [3, 13]);
  h.streams[0]!.emit({ type: 'partial', id: 'a', text: 'one two', stable: 7, agreed: 40 });
  assert.deepEqual([row().stable, row().agreed], [7, undefined]);
  h.streams[0]!.emit({ type: 'partial', id: 'a', text: 'one two three', stable: 7, agreed: 40 });
  assert.deepEqual([row().stable, row().agreed], [7, 13]);
  h.streams[0]!.emit({ type: 'final', id: 'a', text: 'one two three four.', language: 'en' });
  assert.deepEqual([row().stable, row().agreed], [undefined, undefined]);
});
