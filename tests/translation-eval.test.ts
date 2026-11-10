import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatCompletionsTranslator, chatMessages, chatTranslationRequest, extractObject } from '../packages/providers/chat.ts';
import { TranslationFailure } from '../packages/providers/types.ts';
import { applyVariant, blindJobs, degraded, direction, isPaid, parseCandidate, shuffle, percentile, summarize, termScore, usageFrom, type Run } from '../scripts/translation-eval-lib.ts';
import { ja } from './helpers.ts';

test('candidate specs parse provider, model, effort and local URL', () => {
  assert.deepEqual(parseCandidate('anthropic:claude-haiku-5-5#low'), { label: 'anthropic:claude-haiku-5-5#low', provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low' });
  assert.equal(parseCandidate('openai:gpt-5.6-terra').effort, 'none');
  assert.deepEqual(parseCandidate('local:qwen@http://127.0.0.1:8080/v1'), { label: 'local:qwen@http://127.0.0.1:8080/v1', provider: 'local', model: 'qwen', effort: 'none', baseUrl: 'http://127.0.0.1:8080/v1' });
  assert.deepEqual(parseCandidate('mlx:qwen3.5-4b-q4'), { label: 'mlx:qwen3.5-4b-q4', provider: 'mlx', model: 'qwen3.5-4b-q4', effort: 'none' });
  assert.throws(() => parseCandidate('mlx:some/other-model'));
  assert.equal(isPaid(parseCandidate('mlx:qwen3.5-4b-q4')), false);
  assert.equal(parseCandidate('mlx:qwen3.5-2b-q4').model, 'qwen3.5-2b-q4');
  assert.throws(() => parseCandidate('mlx:qwen3.5-9b-q4'));
  assert.deepEqual(parseCandidate('anthropic:claude-haiku-5-5#low~repair-cut'), { label: 'anthropic:claude-haiku-5-5#low~repair-cut', provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low', variant: 'repair-cut' });
  for (const bad of ['gemini:x', 'openai:', 'local:qwen', 'anthropic:m#turbo', 'anthropic:m~Bad Name']) assert.throws(() => parseCandidate(bad));
});
test('term, direction, degradation and usage scoring', () => {
  assert.deepEqual(termScore('The Ｆatima shrine', [['Fatima', 'Fátima'], ['Kowloon']]), { hit: 1, total: 2 });
  assert.equal(degraded({ reference: 'バルセロナの公用語は、', asr: 'バルセロナの公用語は' }), false);
  assert.equal(degraded({ reference: 'バルセロナ', asr: 'バルセアナ' }), true);
  assert.equal(direction({ language: 'ja' }, { source: 'ja', target: 'en', text: 'x' }), 'correct');
  assert.equal(direction({ language: 'ja' }, { source: 'en', target: 'ja', text: 'x' }), 'wrong');
  assert.equal(direction({ language: 'en' }, { source: 'unknown', target: 'unknown', text: '' }), 'unresolved');
  assert.deepEqual(usageFrom({ usage: { input_tokens: 10, output_tokens: 2 } }), { input: 10, output: 2 });
  assert.deepEqual(usageFrom({ usage: { prompt_tokens: 7, completion_tokens: 3 } }), { input: 7, output: 3 });
  assert.equal(usageFrom({ error: 'x' }), undefined);
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3); assert.equal(percentile([], 50), undefined);
});
test('summary counts failures, latency, terms, judged fidelity and cost per candidate', () => {
  const cases = [{ id: 'a', referenceId: 'a', condition: 'clean', language: 'ja' as const, detectedLanguage: 'ja' as const, reference: '香港', asr: '香港' },
    { id: 'b', referenceId: 'b', condition: 'noise', language: 'ja' as const, detectedLanguage: 'ja' as const, reference: '九龍', asr: 'クーロン' }];
  const runs: Run[] = [
    { candidate: 'x', caseId: 'a', repeat: 0, ms: 100, outcome: 'completed', direction: 'correct', terms: { hit: 1, total: 1 }, usage: { input: 1000, output: 100 } },
    { candidate: 'x', caseId: 'b', repeat: 0, ms: 300, outcome: 'completed', direction: 'wrong', terms: { hit: 0, total: 1 }, usage: { input: 1000, output: 100 } },
    { candidate: 'x', caseId: 'a', repeat: 1, ms: 12000, outcome: 'timeout', failure: 'timeout' },
  ];
  const [s] = summarize(['x'], runs, [{ candidate: 'x', caseId: 'a', fidelity: 5, recovered: 'na', invented: 'no' }, { candidate: 'x', caseId: 'b', fidelity: 2, recovered: 'no', invented: 'yes' }], cases, { x: { input: 1, output: 10 } });
  assert.equal(s!.invented, 1); assert.equal(s!.judged, 2);
  assert.equal(s!.completed, 2); assert.deepEqual(s!.failures, { timeout: 1 }); assert.equal(s!.wrongDirection, 1);
  assert.equal(s!.p50Ms, 100); assert.equal(s!.maxMs, 300); assert.equal(s!.termHits, 1); assert.equal(s!.termTotal, 2);
  assert.equal(s!.fidelity, 3.5); assert.equal(s!.fidelityHard, 2); assert.equal(s!.recoveredTotal, 1);
  assert.equal(s!.usdPer1000Turns, 2);
});

test('judge jobs are blind: no candidate identity, identical outputs shared, order shuffled by seed', () => {
  const cases = ['a', 'b', 'c', 'd'].map(id => ({ id, referenceId: id, condition: 'clean', language: 'ja' as const, detectedLanguage: 'ja' as const, reference: `参照${id}`, asr: `認識${id}` }));
  const labels = ['openai:gpt-5.6-terra', 'anthropic:claude-haiku-5-5', 'local:qwen@http://127.0.0.1:8080/v1'];
  const runs: Run[] = cases.flatMap(c => labels.map((label, i) => ({ candidate: label, caseId: c.id, repeat: 0, ms: 1, outcome: 'completed' as const,
    // Terra and Haiku agree up to whitespace on every case; the local model differs.
    translation: { source: 'ja' as const, target: 'en' as const, text: i === 2 ? `different ${c.id}` : i === 0 ? ` shared  ${c.id}` : `shared ${c.id}` } })));
  const jobs = blindJobs(labels, runs, cases, 7);
  assert.equal(jobs.length, 8);
  for (const job of jobs) {
    for (const forbidden of ['openai', 'anthropic', 'local', 'gpt', 'claude', 'haiku', 'terra', 'qwen', '127.0.0.1']) assert(!job.input.toLowerCase().includes(forbidden), forbidden);
    assert.deepEqual(Object.keys(JSON.parse(job.input)).sort(), ['recognized', 'reference', 'targetLanguage', 'translation']);
  }
  assert.equal(jobs.filter(j => j.candidates.length === 2).length, 4);
  assert.deepEqual(jobs.map(j => j.key), jobs.map((_, i) => `j${i + 1}`));
  assert.deepEqual(blindJobs(labels, runs, cases, 7), jobs);
  const grouped = jobs.map(j => j.candidates.length === 2 ? 'shared' : 'single');
  assert.notDeepEqual(grouped, [...grouped].sort(), 'order must not group candidates');
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], 1).sort(), [1, 2, 3, 4, 5]);
});

test('prompt variants edit the live instructions and fail loudly when a replacement stops matching', async () => {
  const base = 'Translate. No tools, explanations, or invented speech. Done.';
  assert.equal(applyVariant(base, { replace: [['No tools, explanations, or invented speech.', 'X.']], append: 'Extra.' }), 'Translate. X. Done. Extra.');
  assert.throws(() => applyVariant(base, { replace: [['missing text', 'y']] }), /no longer matches/);
  const { translationInstructions } = await import('../packages/providers/translation.ts');
  const { VariantFile } = await import('../scripts/translation-eval-lib.ts');
  const file = VariantFile.parse(JSON.parse(await readFile('benchmarks/prompt-variants.json', 'utf8')));
  for (const variant of Object.values(file.variants)) assert.notEqual(applyVariant(translationInstructions, variant), translationInstructions);
});

const completion = (content: string, finish = 'stop') => ({ choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
test('chat-completions translator states the shape, tolerates fences and maps failures', async () => {
  const request = chatTranslationRequest('m', { text: 'こんにちは', mode: 'auto', glossary: [] });
  assert.match(request.messages[0]!.content, /Reply with only one JSON object/); assert.equal(JSON.parse(request.messages[1]!.content).text, 'こんにちは');
  assert.deepEqual(extractObject('```json\n{"a":1}\n```'), { a: 1 });
  const ok = new ChatCompletionsTranslator({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm', fetch: async url => {
    assert.equal(String(url), 'http://127.0.0.1:1/v1/chat/completions');
    return Response.json(completion(`<think>x</think>\n${JSON.stringify(ja)}`));
  } });
  assert.deepEqual(await ok.translate({ text: 'hello', mode: 'auto', glossary: [] }, new AbortController().signal), ja);
  const diagnostics: unknown[] = [];
  const cut = new ChatCompletionsTranslator({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm', fetch: async () => Response.json(completion('{"source":', 'length')) });
  await assert.rejects(cut.translate({ text: 'hello', mode: 'auto', glossary: [] }, new AbortController().signal, d => diagnostics.push(d)));
  assert.deepEqual(diagnostics, [{ response: 'incomplete', outputTokenLimitReached: true }]);
  const down = new ChatCompletionsTranslator({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm', fetch: async () => { throw new TypeError('refused'); } });
  await assert.rejects(down.translate({ text: 'hello', mode: 'auto', glossary: [] }, new AbortController().signal), e => e instanceof TranslationFailure && e.category === 'translation-network');
});

const cli = ['--import', 'tsx', 'scripts/translation-eval.ts'];
const env = { PATH: process.env.PATH ?? '' }; // never inherit provider keys
test('eval refuses paid candidates without --paid and makes no request', () => {
  const result = spawnSync(process.execPath, [...cli, '--candidate', 'openai:gpt-5.6-terra', '--no-judge', '--cases', 'tests/fixtures/translation-cases.json'], { env, encoding: 'utf8' });
  assert.equal(result.status, 2); assert.match(result.stdout, /Re-run with --paid/);
});
test('eval runs end to end against a local chat-completions server and writes a results file', async t => {
  let calls = 0;
  const server = createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      calls++;
      const input = JSON.parse(JSON.parse(body).messages[1].content);
      const out = input.text.includes('Barcelona') ? { source: 'en', target: 'ja', text: 'バルセロナ' } : { source: 'ja', target: 'en', text: 'Catalan in Barcelona' };
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(completion(JSON.stringify(out))));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const out = await mkdtemp(join(tmpdir(), 'surtitle-eval-'));
  const child = spawn(process.execPath, [...cli, '--candidate', `local:fake@http://127.0.0.1:${port}/v1`, '--no-judge', '--repeats', '2',
    '--cases', 'tests/fixtures/translation-cases.json', '--out-dir', out], { env });
  let stdout = ''; child.stdout.on('data', c => { stdout += c; });
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 0);
  assert.equal(calls, 1 + 2 * 2); assert.match(stdout, /local:fake/);
  const [file] = await readdir(out);
  const report = JSON.parse(await readFile(join(out, file!), 'utf8'));
  assert.equal(report.summary[0].completed, 4); assert.equal(report.summary[0].termHits, 2); assert.equal(report.summary[0].termTotal, 2);
  assert.equal(report.summary[0].wrongDirection, 0); assert.deepEqual(report.summary[0].tokensPerCall, { input: 5, output: 2 });
});

test('a chat prompt puts the text to translate last, after context and glossary', () => {
  const user = JSON.parse(chatMessages({ text: 'Then we tried RAG.', mode: 'auto', glossary: [{ term: 'RAG', translation: 'RAG' }],
    sourceLanguage: 'en', context: [{ original: 'Earlier.', translation: '前に。', source: 'en' }] }).user);
  assert.deepEqual(Object.keys(user), ['mode', 'glossary', 'sourceLanguage', 'context', 'text']);
});
