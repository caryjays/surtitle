import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, tick } from './helpers.ts';
import { Snapshot } from '../packages/protocol/index.ts';
import { CONTINUES_INSTRUCTION, chatMessages } from '../packages/providers/chat.ts';

// A rolling row: each lock reports the locked text, its audio and the lag of the lock.
async function pieces(mode: 'auto' | 'en-ja' | 'ja-en' = 'auto') {
  const h = harness({ translationUnit: 'piece' }); await h.controller.start(mode);
  const lock = (id: string, text: string, audioMs: number, tail = '', language = 'en') =>
    h.streams.at(-1)!.emit({ type: 'partial', id, text: text + tail, stable: text.length, locked: { audioMs, lagMs: 2000, language } });
  const close = (id: string, text: string) => h.streams.at(-1)!.emit({ type: 'final', id, text, language: 'en' });
  const row = () => h.controller.snapshot().segments.at(-1)!;
  return { ...h, lock, close, row };
}
const piece = (text: string) => ({ source: 'en', target: 'ja', text });

test('a piece is cut at a clause mark once it holds 1.5 s of locked audio, or at 4 s without one', async t => {
  const h = await pieces(); t.after(() => h.controller.dispose());
  h.begin('a');
  h.lock('a', 'So,', 900, ' the');
  assert.equal(h.requests.length, 0, 'too short');
  h.lock('a', 'So, the first thing', 2500, ' we');
  assert.equal(h.requests.length, 0, 'no mark');
  h.lock('a', 'So, the first thing we did,', 3000, ' was');
  assert.equal(h.requests.length, 1);
  assert.deepEqual([h.requests[0]!.input.text, h.requests[0]!.input.continues, h.requests[0]!.input.sourceLanguage], ['So, the first thing we did,', true, 'en']);
  h.requests[0]!.result.resolve(piece('まず最初にしたのは、')); await tick();
  h.lock('a', 'So, the first thing we did, was to measure the delay', 7100);
  assert.equal(h.requests.length, 2, 'past 4 s without a mark');
  assert.equal(h.requests[1]!.input.text, 'was to measure the delay');
  const trace = h.controller.snapshot().turns[0]!;
  assert.deepEqual(trace.pieces!.map(p => [p.endMs, p.outcome]), [[3000, 'ready'], [7100, undefined]]);
  assert(trace.pieces!.every(p => p.queueMs >= 0)); // sent as soon as cut; the wall-clock value depends on machine load
  assert.ok(trace.pieces![0]!.lagMs >= 2000);
});

test('one request at a time: pieces grow while a request runs, and translations append in order', async t => {
  const h = await pieces(); t.after(() => h.controller.dispose());
  h.begin('a');
  h.lock('a', 'First part,', 2000);
  h.lock('a', 'First part, second part,', 4000);
  h.lock('a', 'First part, second part, third part,', 6000);
  assert.equal(h.requests.length, 1);
  h.requests[0]!.partial(piece('最初'));
  assert.equal(h.row().translation, '最初');
  h.requests[0]!.result.resolve(piece('最初の部分、')); await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1]!.input.text, 'second part, third part,');
  // Context: this row's translated pieces, so the next piece continues them.
  assert.deepEqual(h.requests[1]!.input.context, [{ original: 'First part,', translation: '最初の部分、', source: 'en' }]);
  h.requests[1]!.partial(piece('二番目'));
  assert.equal(h.row().translation, '最初の部分、二番目');
  h.requests[1]!.result.resolve(piece('二番目と三番目の部分、')); await tick();
  assert.equal(h.row().translation, '最初の部分、二番目と三番目の部分、');
  assert.equal(h.row().state, 'partial');
  h.close('a', 'First part, second part, third part, and the end.');
  assert.equal(h.requests.length, 3);
  assert.deepEqual([h.requests[2]!.input.text, h.requests[2]!.input.continues], ['and the end.', undefined]);
  h.requests[2]!.result.resolve(piece('そして終わり。')); await tick();
  assert.deepEqual([h.row().state, h.row().translation, h.row().source, h.row().target], ['ready', '最初の部分、二番目と三番目の部分、そして終わり。', 'en', 'ja']);
  Snapshot.parse(h.controller.snapshot());
});

test('English pieces join with a space; a row closed with nothing left is ready without another request', async t => {
  const h = await pieces(); t.after(() => h.controller.dispose());
  h.begin('a');
  h.lock('a', '最初に、', 2000, '', 'ja');
  h.requests[0]!.result.resolve({ source: 'ja', target: 'en', text: 'First,' }); await tick();
  h.lock('a', '最初に、測りました。', 4000, '', 'ja');
  h.requests[1]!.result.resolve({ source: 'ja', target: 'en', text: 'we measured.' }); await tick();
  h.streams[0]!.emit({ type: 'final', id: 'a', text: '最初に、測りました。', language: 'ja' }); await tick();
  assert.equal(h.requests.length, 2);
  assert.deepEqual([h.row().state, h.row().translation, h.row().source], ['ready', 'First, we measured.', 'ja']);
});

test('later pieces keep the first piece direction', async t => {
  const h = await pieces(); t.after(() => h.controller.dispose());
  h.begin('a');
  h.lock('a', 'One,', 2000);
  assert.equal(h.requests[0]!.input.mode, 'auto');
  h.requests[0]!.result.resolve(piece('一、')); await tick();
  h.lock('a', 'One, two,', 4000);
  assert.equal(h.requests[1]!.input.mode, 'en-ja');
  // A piece that comes back the other way is not shown and goes to the next piece.
  h.requests[1]!.partial({ source: 'ja', target: 'en', text: 'two' });
  assert.equal(h.row().translation, '一、');
  h.requests[1]!.result.resolve({ source: 'ja', target: 'en', text: 'two,' }); await tick();
  assert.equal(h.row().translation, '一、');
  h.close('a', 'One, two, three.');
  assert.equal(h.requests[2]!.input.text, 'two, three.');
});

test('a failed piece is withdrawn and retried with the next; a failed last piece keeps earlier pieces', async t => {
  const h = await pieces(); t.after(() => h.controller.dispose());
  h.begin('a');
  h.lock('a', 'One,', 2000);
  h.requests[0]!.result.resolve(piece('一、')); await tick();
  h.lock('a', 'One, two,', 4000);
  h.requests[1]!.partial(piece('二'));
  assert.equal(h.row().translation, '一、二');
  h.requests[1]!.result.reject(new Error('cut off')); await tick();
  assert.equal(h.row().translation, '一、');
  assert.equal(h.controller.snapshot().error, null, 'a piece that will be retried is not an error');
  // The next lock retries the failed piece's text with the new text.
  h.lock('a', 'One, two, three,', 6000);
  assert.equal(h.requests[2]!.input.text, 'two, three,');
  // With the direction kept from the first piece, an unresolved reply fails the direction check, as in a forced mode.
  h.requests[2]!.result.resolve({ source: 'unknown', target: 'unknown', text: '' }); await tick();
  h.lock('a', 'One, two, three, four', 5900);
  assert.equal(h.requests.length, 3, 'no new mark and under 4 s');
  h.close('a', 'One, two, three, four.');
  assert.equal(h.requests[3]!.input.text, 'two, three, four.');
  h.requests[3]!.result.reject(new Error('cut off')); await tick();
  assert.deepEqual([h.row().state, h.row().translation, h.row().original], ['failed', '一、', 'One, two, three, four.']);
  assert.equal(h.controller.snapshot().error, 'translation');
  assert.deepEqual(h.controller.snapshot().turns[0]!.pieces!.map(p => p.outcome), ['ready', 'failed', 'failed', 'failed']);
});

test('context holds earlier rows only once translated, and a closed row waits behind the running piece', async t => {
  const h = await pieces(); t.after(() => h.controller.dispose());
  h.begin('a');
  h.lock('a', 'One,', 2000);
  h.close('a', 'One, two.');
  // The running piece finishes first; the rest of the row follows it.
  assert.equal(h.requests.length, 1);
  h.begin('b');
  h.lock('b', 'Next,', 2000);
  assert.equal(h.requests.length, 1, 'no piece while a request runs');
  h.requests[0]!.result.resolve(piece('一、')); await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1]!.input.text, 'two.');
  assert.deepEqual(h.requests[1]!.input.context, [{ original: 'One,', translation: '一、', source: 'en' }]);
  h.requests[1]!.partial(piece('二'));
  assert.equal(h.requests.length, 2);
  h.requests[1]!.result.resolve(piece('二。')); await tick();
  // The queue is empty, so the open row's piece goes now, with the finished row as context.
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests[2]!.input.context, [{ original: 'One, two.', translation: '一、二。', source: 'en' }]);
});

test('clear and new session invalidate a piece in flight', async t => {
  const h = await pieces(); t.after(() => h.controller.dispose());
  h.begin('a');
  h.lock('a', 'One,', 2000);
  h.requests[0]!.partial(piece('一'));
  await h.controller.clear();
  assert.equal(h.requests[0]!.signal.aborted, true);
  h.requests[0]!.partial(piece('一、'));
  h.requests[0]!.result.resolve(piece('一、')); await tick();
  assert.equal(h.controller.snapshot().segments.length, 0);
  h.begin('b');
  h.lock('b', 'Two,', 2000);
  assert.equal(h.requests.length, 2);
  h.controller.newSession();
  assert.equal(h.requests[1]!.signal.aborted, true);
});

test('row translation ignores locked pieces; turning translation off stops new pieces', async t => {
  const h = harness({ translationUnit: 'row' }); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.begin('a');
  h.streams[0]!.emit({ type: 'partial', id: 'a', text: 'One, two,', stable: 9, locked: { audioMs: 5000, lagMs: 2000, language: 'en' } });
  assert.equal(h.requests.length, 0);
  const p = await pieces(); t.after(() => p.controller.dispose());
  p.controller.setTranslation(false);
  p.begin('a'); p.lock('a', 'One, two,', 5000);
  assert.equal(p.requests.length, 0);
});

test('the continues instruction is added only for a piece, leaving a whole row prompt unchanged', () => {
  const input = { text: 'One,', mode: 'en-ja', glossary: [] };
  const row = chatMessages(input), part = chatMessages({ ...input, continues: true });
  assert.ok(!row.system.includes(CONTINUES_INSTRUCTION));
  assert.equal(part.system.replace(` ${CONTINUES_INSTRUCTION}`, ''), row.system);
  assert.ok(part.user.includes('"continues":true'));
});
