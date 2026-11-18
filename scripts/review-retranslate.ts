import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { LocalTranslator } from '../packages/providers/local-translator.ts';
import { EXAMPLE_GLOSSARY, loadGlossary } from '../apps/service/glossary.ts';
import { parsePair, type Source, type TranslationContext } from '../packages/protocol/index.ts';

// Called by scripts/local/review_export.py with --opening, never on its own: re-translates a replay's rows in order,
// outside real time, once as live and once with the reply's opening given to the model, so both read over the same
// recognized text. Context is built as the controller builds it, from the four rows before, each variant from its own
// translations. Offline: no .env, no network. Prints counts only.
const { values } = parseArgs({ options: { pair: { type: 'string' }, in: { type: 'string' }, out: { type: 'string' } } });
if (!values.pair || !values.in || !values.out) { console.error('Usage: --pair <pair> --in <rows.json> --out <file>'); process.exit(2); }
const pair = parsePair(values.pair);
type Row = { recording: number; sequence: number; original: string; translation: string | null; state: string; heard: string | null; uncaptioned: boolean };
const rows: Row[] = JSON.parse(await readFile(values.in, 'utf8')).review;
const glossary = await loadGlossary(EXAMPLE_GLOSSARY);
type Outcome = { translation: string | null; state: 'ready' | 'unresolved' | 'failed' };

async function variant(replyOpening: boolean) {
  const translator = new LocalTranslator({ model: 'qwen3.5-4b-q4', pair, replyOpening });
  await translator.start();
  const results = new Map<string, Outcome>();
  try {
    for (const recording of [...new Set(rows.map(r => r.recording))]) {
      const done: { original: string; translation: string | null; source: Source }[] = [];
      for (const row of rows.filter(r => r.recording === recording && !r.uncaptioned && r.original.trim() && r.heard).sort((a, b) => a.sequence - b.sequence)) {
        const context: TranslationContext = done.slice(-4).map(r => ({ original: r.original.slice(0, 800), translation: r.translation?.slice(0, 800) ?? null, source: r.source }));
        let outcome: Outcome; let source = row.heard as Source;
        try {
          const result = await translator.translate({ text: row.original, mode: 'auto', glossary, sourceLanguage: source, context }, new AbortController().signal);
          outcome = { translation: result.text || null, state: result.source === 'unknown' ? 'unresolved' : 'ready' };
          source = result.source;
        } catch { outcome = { translation: null, state: 'failed' }; }
        results.set(`${row.recording}:${row.sequence}`, outcome);
        done.push({ original: row.original, translation: outcome.state === 'ready' ? outcome.translation : null, source });
      }
    }
  } finally { translator.close(); }
  return results;
}

const off = await variant(false), on = await variant(true);
const out = [...off.keys()].map(key => ({ key, off: off.get(key)!, on: on.get(key)! }));
await writeFile(values.out, `${JSON.stringify(out)}\n`);
const count = (m: Map<string, Outcome>, state: string) => [...m.values()].filter(o => o.state === state).length;
const live = rows.filter(r => off.has(`${r.recording}:${r.sequence}`) && r.state === 'ready');
console.error(`${off.size} rows; unresolved without the opening ${count(off, 'unresolved')}, with it ${count(on, 'unresolved')}; `
  + `failed ${count(off, 'failed')}, ${count(on, 'failed')}; changed by the opening ${out.filter(o => o.off.translation !== o.on.translation).length}; `
  + `live ready rows reproduced without the opening ${live.filter(r => off.get(`${r.recording}:${r.sequence}`)!.translation === r.translation).length} of ${live.length}`);
