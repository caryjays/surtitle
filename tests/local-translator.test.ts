import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { LocalTranslator } from '../packages/providers/local-translator.ts';
import { partialObject } from '../packages/providers/chat.ts';
import type { TranslationDiagnostic } from '../packages/protocol/index.ts';

function translator(behavior = 'normal') {
  let spawned = 0;
  const t = new LocalTranslator({ model: 'qwen3.5-4b-q4', workerFactory: () => {
    spawned++;
    return spawn(process.execPath, ['tests/fixtures/fake-translate-worker.mjs', behavior],
      { stdio: ['pipe', 'pipe', 'pipe'], env: spawned > 1 ? { SECOND: '1' } : {} });
  } });
  return { t, spawned: () => spawned };
}
const input = (text: string) => ({ text, mode: 'auto' as const, glossary: [] });

test('local translator returns the parsed object from the worker, skipping an empty thinking block', async t => {
  const { t: local } = translator(); t.after(() => local.close());
  const diagnostics: TranslationDiagnostic[] = [];
  const result = await local.translate(input('Hello'), new AbortController().signal, d => diagnostics.push(d));
  assert.deepEqual(result, { source: 'en', target: 'ja', text: '[ja] Hello' });
  assert.deepEqual(diagnostics, [{ response: 'completed', outputTokenLimitReached: false }]);
});

test('requests are answered in order by id, and an aborted request rejects at once without blocking the next', async t => {
  const { t: local } = translator('slow'); t.after(() => local.close());
  await local.start();
  const abort = new AbortController();
  const first = local.translate(input('one'), abort.signal);
  const second = local.translate(input('two'), new AbortController().signal);
  const started = performance.now();
  abort.abort();
  await assert.rejects(first, /cancelled/);
  assert(performance.now() - started < 100, 'abort waited for the generation');
  assert.equal((await second).text, '[ja] two');
});

test('a worker that exits fails its requests, and the next request starts a new worker', async t => {
  const { t: local, spawned } = translator('crash-once'); t.after(() => local.close());
  await assert.rejects(local.translate(input('lost'), new AbortController().signal));
  assert.equal((await local.translate(input('again'), new AbortController().signal)).text, '[ja] again');
  assert.equal(spawned(), 2);
});

test('an output cut at the token limit or text with no object is a failed translation, never shown', async t => {
  for (const [behavior, response] of [['length', 'incomplete'], ['garbage', 'invalid']] as const) {
    const { t: local } = translator(behavior); t.after(() => local.close());
    const diagnostics: TranslationDiagnostic[] = [];
    await assert.rejects(local.translate(input('Hello'), new AbortController().signal, d => diagnostics.push(d)));
    assert.equal(diagnostics[0]!.response, response);
  }
});

test('in Auto, the recognized language sets the direction the local model is asked for', async t => {
  const sent: string[] = [];
  const local = new LocalTranslator({ model: 'qwen3.5-4b-q4', workerFactory: () => {
    const child = spawn(process.execPath, ['tests/fixtures/fake-translate-worker.mjs', 'normal'], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = ((chunk: string) => { sent.push(chunk); return write(chunk); }) as typeof child.stdin.write;
    return child;
  } });
  t.after(() => local.close());
  await local.translate({ text: 'こんにちは', mode: 'auto', glossary: [], sourceLanguage: 'ja' }, new AbortController().signal);
  await local.translate({ text: 'Hmm', mode: 'auto', glossary: [], sourceLanguage: 'unknown' }, new AbortController().signal);
  const modes = sent.map(line => JSON.parse(JSON.parse(line).user).mode);
  assert.deepEqual(modes, ['ja-en', 'auto']);
});
test('a streamed reply parses once source and target are known, up to its last whole character', () => {
  assert.equal(partialObject('<think>\n\n</think>\n\n{"source":"en","tar'), null);
  assert.equal(partialObject('{"source":"en","target":"ja"'), null);
  assert.deepEqual(partialObject('{"source":"en","target":"ja","text":"'), { source: 'en', target: 'ja', text: '' });
  assert.deepEqual(partialObject('{"source": "en", "target": "ja", "text": "a\\"b\\n\\u3053\\'), { source: 'en', target: 'ja', text: 'a"b\nこ' });
  assert.deepEqual(partialObject('{"source":"en","target":"ja","text":"x\\u30'), { source: 'en', target: 'ja', text: 'x' });
  assert.deepEqual(partialObject('{"source":"en","target":"ja","text":"done"}'), { source: 'en', target: 'ja', text: 'done' });
  assert.equal(partialObject('{"source":"en","target":"ja","text":"bad \\q'), null);
});
test('local translator streams text so far, each a new prefix, and still returns the validated reply', async t => {
  const { t: local } = translator('stream'); t.after(() => local.close());
  const partials: string[] = [];
  const result = await local.translate(input('say "hi"'), new AbortController().signal, undefined, p => partials.push(p.text));
  assert.equal(result.text, '[ja] say "hi"');
  assert(partials.length > 3 && partials.every((p, i) => result.text.startsWith(p) && (i === 0 || p.length > partials[i - 1]!.length)));
  assert(partials.includes('[ja] say "'));
});
