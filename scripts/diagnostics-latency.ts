// Stage-by-stage latency from a downloaded control-page diagnostics file: one report per Start, over the rows that were
// translated. Reads only timing and count metadata; the file holds no speech text.
import { readFileSync } from 'node:fs';

type Event = { type: string; atMs: number; command?: { type: string }; turn?: Record<string, unknown> & { sequence: number; outcome: string };
  row?: { sequence: number; final: boolean; state: string; originalChars: number; translationChars: number } };
const path = process.argv[2];
if (!path) { console.error('Usage: pnpm diag:latency <captions-diagnostics.json>'); process.exit(2); }
const events = (JSON.parse(readFileSync(path, 'utf8')) as { events: Event[] }).events;

function percentile(values: (number | undefined)[], p: number) {
  const sorted = values.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]! : undefined;
}
const s = (ms: number | undefined) => ms === undefined ? '–' : (ms / 1000).toFixed(1);
function line(name: string, values: (number | undefined)[], unit: 'ms' | 'n' = 'ms') {
  const f = unit === 'ms' ? s : (v: number | undefined) => v === undefined ? '–' : String(v);
  const n = values.filter(v => typeof v === 'number').length;
  console.log(`  ${name.padEnd(40)} n ${String(n).padStart(3)}  p50 ${f(percentile(values, 0.5)).padStart(5)}  p90 ${f(percentile(values, 0.9)).padStart(5)}  max ${f(percentile(values, 1)).padStart(5)}`);
}
const tally = (values: unknown[]) => Object.entries(values.reduce<Record<string, number>>((m, v) => (m[String(v)] = (m[String(v)] ?? 0) + 1, m), {}))
  .map(([k, v]) => `${k} ${v}`).join(', ');

const starts = events.filter(e => e.command?.type === 'start');
starts.forEach((start, i) => {
  const end = events.find(e => e.command?.type === 'pause' && e.atMs > start.atMs)?.atMs ?? Infinity;
  // Translations of the last rows can land shortly after Pause.
  const within = events.filter(e => e.atMs >= start.atMs && e.atMs <= end + 20_000);
  const turns = new Map<number, Record<string, unknown>>();
  for (const e of within) if (e.turn) turns.set(e.turn.sequence, { ...turns.get(e.turn.sequence), ...e.turn, [`at:${e.turn.outcome}`]: e.atMs });
  const firstText = new Map<number, number>(); const ready = new Map<number, { at: number; original: number; translation: number }>();
  for (const e of within) if (e.row) {
    if (e.row.originalChars > 0 && !firstText.has(e.row.sequence)) firstText.set(e.row.sequence, e.atMs);
    if (e.row.state === 'ready' && !ready.has(e.row.sequence)) ready.set(e.row.sequence, { at: e.atMs, original: e.row.originalChars, translation: e.row.translationChars });
  }
  const rows = [...turns.values()].filter(t => ready.has(t.sequence as number) && firstText.has(t.sequence as number));
  const n = (key: string) => rows.map(t => t[key] as number | undefined);
  console.log(`Start ${i + 1}: ${end === Infinity ? 'not paused' : `${Math.round((end - start.atMs) / 1000)} s`}, ${turns.size} rows, ${rows.length} translated`);
  console.log(`  closed by: ${tally(n('boundary'))}; outcomes: ${tally([...turns.values()].map(t => t.outcome))}`);
  // Recognition over every kept row, translated or not, so a run without translation compares with one with it.
  const kept = [...turns.values()].filter(t => !['rejected', 'capturing', 'empty'].includes(t.outcome as string));
  console.log('  Recognition, all kept rows');
  line('row start to first locked text', kept.map(t => t.firstTextMs as number | undefined));
  line('lock lag (locked audio end to lock)', kept.map(t => t.lockLagMs as number | undefined));
  line('closing decode inference', kept.map(t => t.recognitionInferenceMs as number | undefined));
  console.log('  Translated rows (seconds unless noted)');
  line('row audio', n('audioMs'));
  line('original characters', rows.map(t => ready.get(t.sequence as number)!.original), 'n');
  line('translation characters', rows.map(t => ready.get(t.sequence as number)!.translation), 'n');
  line('decodes per row', n('decodes'), 'n');
  console.log('  Stages');
  line('row start to first locked text', n('firstTextMs'));
  line('lock lag (locked audio end to lock)', n('lockLagMs'));
  line('first shown text to final (browser)', rows.map(t => (t['at:translating'] as number | undefined) === undefined ? undefined
    : (t['at:translating'] as number) - firstText.get(t.sequence as number)!));
  line('closing quiet', n('trailingQuietMs'));
  line('closing decode queue', n('recognitionQueueMs'));
  line('closing decode inference', n('recognitionInferenceMs'));
  line('translation queue', n('translationQueueMs'));
  line('translation request', n('translationMs'));
  console.log('  End to end, before display pacing');
  line('first shown text to translation', rows.map(t => ready.get(t.sequence as number)!.at - firstText.get(t.sequence as number)!));
  line('row start to translation', rows.map(t => t.firstTextMs === undefined ? undefined
    : (t.firstTextMs as number) + ready.get(t.sequence as number)!.at - firstText.get(t.sequence as number)!));
});
