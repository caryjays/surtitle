import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { LocalTranslator } from '../packages/providers/local-translator.ts';
import { AnthropicTranslator } from '../packages/providers/anthropic.ts';
import { attached, inScript } from '../packages/providers/script.ts';
import { projectTerms } from '../packages/providers/terms.ts';
import { EXAMPLE_GLOSSARY, loadGlossary } from '../apps/service/glossary.ts';
import { parsePairTag, type Source, type TranslationContext } from '../packages/protocol/index.ts';
import type { Translator } from '../packages/providers/types.ts';

// Called by scripts/local/review_export.py, never on its own: re-translates a replay's rows in order, outside real time,
// with two translators, so both read over the same recognized text. Context is built as the controller builds it, from
// the four rows before, each translator from its own translations.
//   --compare opening: the local model generating its reply's opening, then given it, as live.
//   --compare cloud:   the local model as live, then Claude Haiku 5.5 as the dev:listen profile asks it. Paid: needs --paid
//                      and ANTHROPIC_API_KEY through node --env-file, never printed.
// Prints counts only.
const { values } = parseArgs({ options: { pair: { type: 'string' }, in: { type: 'string' }, out: { type: 'string' },
  compare: { type: 'string', default: 'opening' }, paid: { type: 'boolean', default: false } } });
if (!values.pair || !values.in || !values.out || !['opening', 'cloud'].includes(values.compare!)) {
  console.error('Usage: --pair <pair> --in <rows.json> --out <file> [--compare opening|cloud [--paid]]'); process.exit(2);
}
const cloud = values.compare === 'cloud';
if (cloud && (!values.paid || !process.env.ANTHROPIC_API_KEY?.trim())) {
  console.error('--compare cloud is paid: pass --paid, with ANTHROPIC_API_KEY set through node --env-file.'); process.exit(2);
}
const { pair, script } = parsePairTag(values.pair);
type Row = { recording: number; sequence: number; original: string; translation: string | null; state: string; heard: string | null; uncaptioned: boolean };
const rows: Row[] = JSON.parse(await readFile(values.in, 'utf8')).review;
// As live: the example set as the session's pair sends it.
const { glossary } = projectTerms(await loadGlossary(EXAMPLE_GLOSSARY, 'Example'), pair, script);
type Outcome = { translation: string | null; state: 'ready' | 'unresolved' | 'failed'; ms: number };
const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };

const make: Record<string, () => Translator & { close?: () => void; start?: () => Promise<void> }> = cloud
  ? { local: () => new LocalTranslator({ model: 'qwen3.5-4b-q4', pair, script }),
      cloud: () => new AnthropicTranslator({ key: process.env.ANTHROPIC_API_KEY!.trim(), model: 'claude-haiku-5-5', effort: 'none', pair, script,
        onUsage: u => { usage.requests++; usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; } }) }
  : { withoutOpening: () => new LocalTranslator({ model: 'qwen3.5-4b-q4', pair, script, replyOpening: false }),
      withOpening: () => new LocalTranslator({ model: 'qwen3.5-4b-q4', pair, script }) };

async function variant(name: string) {
  const translator = make[name]!();
  await translator.start?.();
  const results = new Map<string, Outcome>();
  try {
    for (const recording of [...new Set(rows.map(r => r.recording))]) {
      const done: { original: string; translation: string | null; source: Source }[] = [];
      for (const row of rows.filter(r => r.recording === recording && !r.uncaptioned && r.original.trim() && r.heard).sort((a, b) => a.sequence - b.sequence)) {
        const context: TranslationContext = done.slice(-4).map(r => ({ original: r.original.slice(0, 800), translation: r.translation?.slice(0, 800) ?? null, source: r.source }));
        let outcome: Outcome; let source = row.heard as Source; const started = performance.now();
        // The controller's timeout, so a stalled request fails as it would live.
        const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 12_000);
        try {
          const result = await translator.translate({ text: row.original, mode: 'auto', glossary, sourceLanguage: source, context }, abort.signal);
          outcome = { translation: attached(result.target, inScript(result.target, script, result.text)) || null, state: result.source === 'unknown' ? 'unresolved' : 'ready', ms: Math.round(performance.now() - started) };
          source = result.source;
        } catch { outcome = { translation: null, state: 'failed', ms: Math.round(performance.now() - started) }; }
        finally { clearTimeout(timer); }
        results.set(`${row.recording}:${row.sequence}`, outcome);
        done.push({ original: row.original, translation: outcome.state === 'ready' ? outcome.translation : null, source });
      }
    }
  } finally { translator.close?.(); }
  return results;
}

const [a, b] = Object.keys(make) as [string, string];
const first = await variant(a), second = await variant(b);
const out = [...first.keys()].map(key => ({ key, [a]: first.get(key)!, [b]: second.get(key)! }));
await writeFile(values.out, `${JSON.stringify(out)}\n`);
const count = (m: Map<string, Outcome>, state: string) => [...m.values()].filter(o => o.state === state).length;
const median = (m: Map<string, Outcome>) => { const v = [...m.values()].map(o => o.ms).sort((x, y) => x - y); return v[Math.floor(v.length / 2)] ?? 0; };
console.error(`${first.size} rows; ${a} / ${b}: unresolved ${count(first, 'unresolved')} / ${count(second, 'unresolved')}, `
  + `failed ${count(first, 'failed')} / ${count(second, 'failed')}, median request ${median(first)} / ${median(second)} ms; `
  + `changed ${out.filter(o => first.get(o.key)!.translation !== second.get(o.key)!.translation).length}`
  + (cloud ? `; paid requests ${usage.requests}: ${usage.inputTokens} input and ${usage.outputTokens} output tokens` : ''));
