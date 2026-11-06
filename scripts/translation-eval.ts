// Translation comparison over frozen recognition cases. Cloud candidates and the cloud judge
// spend money, so nothing paid runs without --paid. Keys come from the environment only.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import type { TranslationDiagnostic } from '../packages/protocol/index.ts';
import { OpenAITranslator } from '../packages/providers/openai.ts';
import { AnthropicTranslator } from '../packages/providers/anthropic.ts';
import { ChatCompletionsTranslator } from '../packages/providers/chat.ts';
import { LocalTranslator } from '../packages/providers/local-translator.ts';
import { TranslationFailure, type Translator } from '../packages/providers/types.ts';
import { translationInstructions } from '../packages/providers/translation.ts';
import {
  CaseFile, JudgeResult, TermFile, VariantFile, applyVariant, blindJobs, direction, isPaid, judgeInstructions, judgeSchema, parseCandidate, summarize, table, termScore, usageFrom,
  type Candidate, type EvalCase, type Variant, type Judgment, type Price, type Run, type Usage,
} from './translation-eval-lib.ts';

const { values } = parseArgs({ options: {
  cases: { type: 'string', multiple: true, default: ['benchmarks/results/translation-cases.json'] },
  terms: { type: 'string', default: 'benchmarks/translation-terms.json' },
  variants: { type: 'string', default: 'benchmarks/prompt-variants.json' },
  candidate: { type: 'string', multiple: true, default: [] },
  judge: { type: 'string', default: 'anthropic:claude-opus-5-5' },
  'no-judge': { type: 'boolean', default: false },
  repeats: { type: 'string', default: '2' },
  mode: { type: 'string', default: 'auto' },
  'timeout-ms': { type: 'string', default: '12000' },
  limit: { type: 'string' },
  paid: { type: 'boolean', default: false },
  'out-dir': { type: 'string', default: 'benchmarks/results' },
  seed: { type: 'string' },
} });

const fail = (message: string): never => { console.error(message); process.exit(1); };
const repeats = Number(values.repeats), timeoutMs = Number(values['timeout-ms']);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) fail('--repeats must be 1 to 10.');
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) fail('--timeout-ms must be 1000 to 60000.');
if (values.mode !== 'auto' && values.mode !== 'forced') fail('--mode must be auto or forced.');
if (!values.candidate.length) fail('Name at least one --candidate, for example --candidate openai:gpt-5.6-terra --candidate anthropic:claude-haiku-5-5.');
let candidates: Candidate[] = [];
try { candidates = values.candidate.map(parseCandidate); } catch (error) { fail((error as Error).message); }
if (new Set(candidates.map(c => c.label)).size !== candidates.length) fail('Candidates must be distinct.');
const judge = values['no-judge'] ? undefined : parseCandidate(values.judge);
if (judge && !isPaid(judge)) fail('The judge must be openai:<model> or anthropic:<model>.');
const seed = values.seed === undefined ? Math.floor(Math.random() * 2 ** 31) : Number(values.seed);
if (!Number.isInteger(seed) || seed < 0) fail('--seed must be a non-negative integer.');

const terms = TermFile.parse(JSON.parse(await readFile(values.terms, 'utf8'))).terms;
let cases: EvalCase[] = [];
for (const path of values.cases) {
  try { cases.push(...CaseFile.parse(JSON.parse(await readFile(path, 'utf8'))).cases); }
  catch { fail(`Cannot read cases from ${path}. Generate public cases with pnpm eval:translation-cases.`); }
}
if (values.limit) cases = cases.slice(0, Number(values.limit));
const variantFile = VariantFile.parse(JSON.parse(await readFile(values.variants, 'utf8'))).variants;
const variantOf = (c: Candidate): Variant | undefined => {
  if (!c.variant) return undefined;
  const variant = variantFile[c.variant];
  if (!variant) fail(`Unknown prompt variant "${c.variant}". Define it in ${values.variants}.`);
  return variant;
};
const instructionsFor = new Map<string, string>();
for (const c of candidates) {
  const variant = variantOf(c);
  try { instructionsFor.set(c.label, variant ? applyVariant(translationInstructions, variant) : translationInstructions); }
  catch (error) { fail((error as Error).message); }
}
const prices = (JSON.parse(await readFile('benchmarks/model-prices.json', 'utf8')) as { models: Record<string, Price> }).models;

const paid = [...candidates, ...(judge ? [judge] : [])].filter(isPaid);
const calls = cases.length * repeats + 1;
if (paid.length && !values.paid) {
  console.log(`Planned: ${cases.length} cases × ${repeats} repeats + 1 warm-up = ${calls} calls per candidate${judge ? `, plus up to ${cases.length * candidates.length} judge calls to ${judge.label}` : ''}.`);
  console.log(`Paid providers: ${[...new Set(paid.map(c => c.label))].join(', ')}. Re-run with --paid to spend.`);
  process.exit(2);
}
const keys = { openai: process.env.OPENAI_API_KEY?.trim() ?? '', anthropic: process.env.ANTHROPIC_API_KEY?.trim() ?? '' };
for (const c of paid) if (!keys[c.provider as 'openai' | 'anthropic']) fail(`Credential missing for ${c.provider}. Set it in .env; it is never printed.`);

// Each translator gets its own fetch so the eval can read token usage from a copy of the reply.
function instrumented() {
  let pending: Promise<Usage | undefined> = Promise.resolve(undefined);
  const wrapped: typeof fetch = async (input, init) => {
    pending = Promise.resolve(undefined);
    const response = await fetch(input, init);
    pending = response.clone().json().then(usageFrom, () => undefined);
    return response;
  };
  return { fetch: wrapped, usage: () => pending };
}
const workers: LocalTranslator[] = [];
function translatorFor(c: Candidate, f: typeof fetch): Translator {
  const instructions = instructionsFor.get(c.label);
  if (c.provider === 'openai') return new OpenAITranslator({ key: keys.openai, model: c.model, effort: c.effort, instructions, fetch: f });
  if (c.provider === 'anthropic') return new AnthropicTranslator({ key: keys.anthropic, model: c.model, effort: c.effort, instructions, fetch: f });
  if (c.provider === 'mlx') { const t = new LocalTranslator({ model: 'qwen3.5-4b-q4', instructions }); workers.push(t); return t; }
  return new ChatCompletionsTranslator({ baseUrl: c.baseUrl!, model: c.model, instructions, fetch: f });
}
const pool = candidates.map(c => { const meter = instrumented(); return { c, meter, translator: translatorFor(c, meter.fetch) }; });
const inputFor = (item: EvalCase, c: Candidate) => ({
  ...(variantOf(c)?.truncation && item.truncated ? { truncated: item.truncated } : {}),
  text: item.asr, glossary: item.glossary ?? [], sourceLanguage: item.detectedLanguage, context: item.context ?? [],
  mode: values.mode === 'forced' ? (item.language === 'en' ? 'en-ja' as const : 'ja-en' as const) : 'auto' as const,
});

async function call(entry: typeof pool[number], item: EvalCase, repeat: number): Promise<Run> {
  let diagnostic: TranslationDiagnostic | undefined;
  const signal = AbortSignal.timeout(timeoutMs);
  const start = performance.now();
  try {
    const translation = await entry.translator.translate(inputFor(item, entry.c), signal, value => { diagnostic = value; });
    const ms = Math.round(performance.now() - start);
    const groups = item.terms ?? terms[item.referenceId];
    return { candidate: entry.c.label, caseId: item.id, repeat, ms, outcome: 'completed', translation,
      direction: direction(item, translation), terms: groups ? termScore(translation.text, groups) : undefined, usage: await entry.meter.usage() };
  } catch (error) {
    const ms = Math.round(performance.now() - start);
    if (signal.aborted) return { candidate: entry.c.label, caseId: item.id, repeat, ms, outcome: 'timeout', failure: 'timeout' };
    return { candidate: entry.c.label, caseId: item.id, repeat, ms, outcome: 'failed',
      failure: error instanceof TranslationFailure ? error.category : diagnostic?.response ?? 'error', diagnostic: diagnostic?.response };
  }
}

// Model load is not request time: local workers load before the warm-up.
if (workers.length) { console.log('Loading local translation models.'); await Promise.all(workers.map(w => w.start())); }
console.log(`${cases.length} cases, ${repeats} repeats, mode ${values.mode}, timeout ${timeoutMs} ms. Warming up connections.`);
for (const entry of pool) await call(entry, cases[0]!, -1);
const runs: Run[] = [];
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const [index, item] of cases.entries()) {
    // Rotate the order so no candidate always runs first after a pause.
    const order = pool.map((_, i) => pool[(i + index + repeat) % pool.length]!);
    const line: string[] = [];
    for (const entry of order) {
      const run = await call(entry, item, repeat);
      runs.push(run);
      line.push(`${entry.c.label} ${run.outcome === 'completed' ? `${run.ms}ms` : run.failure}`);
    }
    console.log(`[${repeat + 1}/${repeats}] ${item.id}: ${line.join(' · ')}`);
  }
}

// Takes only the prepared blind input, so candidate identity cannot reach the judge.
async function judgeOne(input: string): Promise<Omit<Judgment, 'candidate' | 'caseId'>> {
  const signal = AbortSignal.timeout(60_000);
  try {
    if (judge!.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: keys.anthropic, maxRetries: 2 });
      // Server-side fallback keeps grading going if the judge model declines; the serving model is recorded.
      const fallback = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(judge!.model);
      const message = await client.beta.messages.create({
        model: judge!.model, max_tokens: 4000, system: judgeInstructions,
        messages: [{ role: 'user', content: input }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: judgeSchema } },
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      }, { signal });
      if (message.stop_reason !== 'end_turn') return { failure: message.stop_reason ?? 'incomplete' };
      const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
      return { ...JudgeResult.parse(JSON.parse(text)), judgeModel: message.model };
    }
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal, headers: { Authorization: `Bearer ${keys.openai}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: judge!.model, store: false, max_output_tokens: 4000, instructions: judgeInstructions,
        input: [{ role: 'user', content: input }],
        text: { format: { type: 'json_schema', name: 'translation_grade', strict: true, schema: judgeSchema } } }),
    });
    if (!response.ok) { await response.body?.cancel(); return { failure: `http-${response.status}` }; }
    const body = await response.json() as { status?: string; model?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] };
    const text = body.output?.filter(o => o.type === 'message').flatMap(o => o.content ?? []).find(c => c.type === 'output_text')?.text;
    if (body.status !== 'completed' || !text) return { failure: body.status ?? 'invalid' };
    return { ...JudgeResult.parse(JSON.parse(text)), judgeModel: body.model ?? judge!.model };
  } catch (error) {
    return { failure: error instanceof Anthropic.APIError && error.status ? `http-${error.status}` : 'error' };
  }
}

const judgments: Judgment[] = [];
const jobs = judge ? blindJobs(candidates.map(c => c.label), runs, cases, seed) : [];
if (judge) {
  const graded = jobs.reduce((n, job) => n + job.candidates.length, 0);
  console.log(`Judging ${jobs.length} distinct translations (${graded - jobs.length} shared by identical outputs) with ${judge.label}, blind, seed ${seed}.`);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const result = await judgeOne(job.input);
      for (const candidate of job.candidates) judgments.push({ candidate, caseId: job.caseId, judgeKey: job.key, ...result });
    }
  }));
  const failed = jobs.length - new Set(judgments.filter(j => !j.failure).map(j => j.judgeKey)).size;
  if (failed) console.log(`${failed} judge calls failed; those translations are unscored.`);
}

const summary = summarize(candidates.map(c => c.label), runs, judgments, cases,
  Object.fromEntries(candidates.map(c => [c.label, !isPaid(c) ? undefined : prices[c.model]])));
const createdAt = new Date().toISOString();
await mkdir(values['out-dir'], { recursive: true });
const output = `${values['out-dir']}/translation-eval-${createdAt.replace(/[:.]/g, '-')}.json`;
await writeFile(output, `${JSON.stringify({ version: 1, createdAt, caseFiles: values.cases, mode: values.mode, repeats, timeoutMs,
  candidates, judge, judgeSeed: judge ? seed : undefined, judgeJobs: jobs.map(({ key, caseId, candidates }) => ({ key, caseId, candidates })), summary, runs, judgments }, null, 2)}\n`);
console.log(`\n${table(summary)}\n`);
console.log('Latency is request time from this machine, warm connections, sequential calls. Terms count first-repeat outputs. Fidelity is the judge mean (1–5); "errors" covers cases where recognition changed the words.');
console.log(`Full results: ${output}`);
for (const worker of workers) worker.close();
