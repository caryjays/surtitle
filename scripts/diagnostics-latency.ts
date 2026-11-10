// Stage-by-stage latency from a downloaded control-page diagnostics file: one report per Start, over the rows that were
// translated. Reads only timing and count metadata; the file holds no speech text.
import { readFileSync } from 'node:fs';

type Event = { type: string; atMs: number; command?: { type: string }; turn?: Record<string, unknown> & { sequence: number; outcome: string };
  row?: { sequence: number; final: boolean; state: string; originalChars: number; translationChars: number };
  sequence?: number; stage?: string; paced?: boolean; settings?: Record<string, unknown> };
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

// Collection switched on after Start records no start command; the whole file is then one session from its first event.
const commands = events.filter(e => e.command?.type === 'start');
const starts = commands.length ? commands : events.slice(0, 1);
if (!commands.length) console.log('No Start recorded: diagnostics began mid-session, so rows already open then are partly measured.');
starts.forEach((start, i) => {
  const end = events.find(e => e.command?.type === 'pause' && e.atMs > start.atMs)?.atMs ?? Infinity;
  // Translations of the last rows can land shortly after Pause.
  const within = events.filter(e => e.atMs >= start.atMs && e.atMs <= end + 20_000);
  const turns = new Map<number, Record<string, unknown>>();
  // at:<outcome> is when the turn first reached it; a trace can change again while translating.
  for (const e of within) if (e.turn) {
    const previous = turns.get(e.turn.sequence), at = `at:${e.turn.outcome}`;
    turns.set(e.turn.sequence, { ...previous, ...e.turn, [at]: previous?.[at] ?? e.atMs });
  }
  const firstText = new Map<number, number>(); const firstTranslation = new Map<number, number>(); const ready = new Map<number, { at: number; original: number; translation: number }>();
  for (const e of within) if (e.row) {
    if (e.row.originalChars > 0 && !firstText.has(e.row.sequence)) firstText.set(e.row.sequence, e.atMs);
    // A streaming translator shows text before the row is ready; otherwise this is the ready event.
    if (e.row.translationChars > 0 && !firstTranslation.has(e.row.sequence)) firstTranslation.set(e.row.sequence, e.atMs);
    if (e.row.state === 'ready' && !ready.has(e.row.sequence)) ready.set(e.row.sequence, { at: e.atMs, original: e.row.originalChars, translation: e.row.translationChars });
  }
  const rows = [...turns.values()].filter(t => ready.has(t.sequence as number) && firstText.has(t.sequence as number));
  // When the console's audience preview released each row's text: `${sequence}:${stage}` to its time.
  const displayed = new Map<string, number>();
  for (const e of within) if (e.type === 'display' && !displayed.has(`${e.sequence}:${e.stage}`)) displayed.set(`${e.sequence}:${e.stage}`, e.atMs);
  const capture = within.find(e => e.type === 'capture')?.settings;
  const n = (key: string) => rows.map(t => t[key] as number | undefined);
  console.log(`Start ${i + 1}: ${end === Infinity ? 'not paused' : `${Math.round((end - start.atMs) / 1000)} s`}, ${turns.size} rows, ${rows.length} translated`);
  console.log(`  closed by: ${tally(n('boundary'))}; outcomes: ${tally([...turns.values()].map(t => t.outcome))}`);
  if (capture) console.log(`  applied capture settings: ${Object.entries(capture).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  // Recognition over every kept row, translated or not, so a run without translation compares with one with it.
  const kept = [...turns.values()].filter(t => !['rejected', 'capturing', 'empty'].includes(t.outcome as string));
  console.log('  Recognition, all kept rows');
  line('row start to first locked text', kept.map(t => t.firstTextMs as number | undefined));
  line('lock lag (locked audio end to lock)', kept.map(t => t.lockLagMs as number | undefined));
  line('closing decode inference', kept.map(t => t.recognitionInferenceMs as number | undefined));
  line('speech end to final text', kept.map(t => t.speechEndToFinalMs as number | undefined));
  const level = (key: string) => {
    const values = kept.map(t => t[key]).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    return values.length ? `p10 ${values[Math.floor(0.1 * (values.length - 1))]!.toFixed(4)}, p50 ${values[Math.floor(0.5 * (values.length - 1))]!.toFixed(4)}, max ${values.at(-1)!.toFixed(4)}` : 'not recorded';
  };
  console.log(`  Input level per row, share of full scale: RMS ${level('inputRms')}; peak ${level('inputPeak')}`);
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
  line('translation request to first translated text', rows.map(t => (t['at:translating'] as number | undefined) === undefined ? undefined
    : firstTranslation.get(t.sequence as number)! - (t['at:translating'] as number)));
  console.log('  End to end, before display pacing');
  line('first shown text to translation', rows.map(t => ready.get(t.sequence as number)!.at - firstText.get(t.sequence as number)!));
  line('row start to translation', rows.map(t => t.firstTextMs === undefined ? undefined
    : (t.firstTextMs as number) + ready.get(t.sequence as number)!.at - firstText.get(t.sequence as number)!));
  // What a listener waits: from when a word was said to its translation. Speech end is measured; earlier words in the
  // row wait longer by their distance from the end, taken here from the row's audio length.
  const heard = (t: Record<string, unknown>, share: number, first = false) => {
    const sequence = t.sequence as number; const shown = first ? firstTranslation.get(sequence)! : ready.get(sequence)!.at;
    return t.speechEndToFinalMs === undefined || t['at:translating'] === undefined ? undefined
      : (t.speechEndToFinalMs as number) + shown - (t['at:translating'] as number) + share * (t.audioMs as number);
  };
  console.log('  Speech to translation (rolling)');
  line('last word of the row', rows.map(t => heard(t, 0)));
  line('middle of the row', rows.map(t => heard(t, 0.5)));
  line('first word of the row', rows.map(t => heard(t, 1)));
  // Display pacing on the console's audience preview, which paces as an overlay does. A word's translation is on screen
  // somewhere between the translation's first and last released text; the middle of the row takes their midpoint.
  const shown = (t: Record<string, unknown>, stage: string) => displayed.get(`${t.sequence}:${stage}`);
  if (rows.some(t => shown(t, 'translation-all') !== undefined)) {
    const paced = within.filter(e => e.type === 'display').every(e => e.paced);
    console.log(`  Display pacing (audience preview, pacing ${paced ? 'on' : 'off or changed'})`);
    line('original: final text to all released', rows.map(t => shown(t, 'original-all') === undefined || t['at:translating'] === undefined ? undefined
      : Math.max(0, shown(t, 'original-all')! - (t['at:translating'] as number))));
    line('translation: first text to first released', rows.map(t => shown(t, 'translation-first') === undefined ? undefined
      : Math.max(0, shown(t, 'translation-first')! - firstTranslation.get(t.sequence as number)!)));
    line('translation: ready to all released', rows.map(t => shown(t, 'translation-all') === undefined ? undefined
      : Math.max(0, shown(t, 'translation-all')! - ready.get(t.sequence as number)!.at)));
    const seen = (t: Record<string, unknown>, share: number, at: number | undefined) => at === undefined || t.speechEndToFinalMs === undefined
      || t['at:translating'] === undefined ? undefined : (t.speechEndToFinalMs as number) + at - (t['at:translating'] as number) + share * (t.audioMs as number);
    const mid = (t: Record<string, unknown>) => shown(t, 'translation-first') === undefined || shown(t, 'translation-all') === undefined ? undefined
      : (shown(t, 'translation-first')! + shown(t, 'translation-all')!) / 2;
    console.log('  Speech to displayed translation (rolling): row length, lock lag, translation and pacing together');
    line('last word to translation all released', rows.map(t => seen(t, 0, shown(t, 'translation-all'))));
    line('middle of the row to mid-release', rows.map(t => seen(t, 0.5, mid(t))));
    line('first word to first released text', rows.map(t => seen(t, 1, shown(t, 'translation-first'))));
  }
  const pieced = rows.filter(t => Array.isArray(t.pieces) && (t.pieces as unknown[]).length);
  if (!pieced.length) {
    console.log('  Speech to first translated text (rolling; the same as above unless the translator streams)');
    line('last word of the row', rows.map(t => heard(t, 0, true)));
    line('middle of the row', rows.map(t => heard(t, 0.5, true)));
    line('first word of the row', rows.map(t => heard(t, 1, true)));
    return;
  }
  // Piece translation: a word waits for the first translated text of the piece that translated it, the first translated
  // piece ending at or after it. From that piece's speech end: the lag to its request, the queue and the first text.
  type Piece = { endMs: number; lagMs: number; queueMs: number; firstTranslationMs?: number; translationMs?: number; outcome?: string };
  const byPiece = (t: Record<string, unknown>, share: number) => {
    const done = (t.pieces as Piece[]).filter(p => p.outcome === 'ready');
    const at = (1 - share) * (t.audioMs as number);
    const piece = done.find(p => p.endMs >= at) ?? done.at(-1);
    const first = piece?.firstTranslationMs ?? piece?.translationMs;
    return piece && first !== undefined ? piece.lagMs + piece.queueMs + first + Math.max(0, piece.endMs - at) : undefined;
  };
  const all = pieced.flatMap(t => t.pieces as Piece[]);
  console.log('  Pieces');
  line('pieces per row', pieced.map(t => (t.pieces as Piece[]).length), 'n');
  line('failed or unresolved pieces per row', pieced.map(t => (t.pieces as Piece[]).filter(p => p.outcome && p.outcome !== 'ready').length), 'n');
  line('piece speech end to request', all.map(p => p.lagMs + p.queueMs));
  line('piece request', all.map(p => p.translationMs));
  line('piece request to first translated text', all.map(p => p.firstTranslationMs));
  console.log('  Speech to first translated text, by piece');
  line('last word of the row', pieced.map(t => byPiece(t, 0)));
  line('middle of the row', pieced.map(t => byPiece(t, 0.5)));
  line('first word of the row', pieced.map(t => byPiece(t, 1)));
});
