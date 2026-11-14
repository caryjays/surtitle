import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { Controller } from '../apps/service/controller.ts';
import { localTranscriberFactory } from '../packages/providers/local.ts';
import { LOCAL_TRANSLATION_MODELS, LocalTranslator, type LocalTranslationModel } from '../packages/providers/local-translator.ts';
import { EXAMPLE_GLOSSARY, loadGlossary } from '../apps/service/glossary.ts';
import { FRAME_BYTES, parsePair, type Pair } from '../packages/protocol/index.ts';

// Replays recordings in real time through the live controller with rolling recognition, with the local translator or
// without it, and writes a diagnostics file in the control page's format for `pnpm diag:latency`. It measures what
// translation on the shared GPU costs recognition, and what row rules cost or save. Offline: no .env, no network. The
// diagnostics file holds timings and counts only; --review writes each row's text, for a person to read, so keep it ignored.
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  translate: { type: 'string', default: 'local' }, model: { type: 'string', default: 'qwen3.5-4b-q4' }, out: { type: 'string' },
  // sentence,max,clause in ms, clause 'off' for none; the live rules are 3000,8000,off.
  rows: { type: 'string', default: '3000,8000,off' }, review: { type: 'string' },
  // interval,settle in ms; the live cadence is 1000,500.
  cadence: { type: 'string', default: '1000,500' },
  // row: translate each closed row, as live; piece: translate locked pieces before the row closes.
  units: { type: 'string', default: 'row' },
  // The local translator computes the shared start of its prompts for every request, as before 2026-11-11; live reuses it.
  'no-prompt-cache': { type: 'boolean', default: false },
  pair: { type: 'string', default: 'en-ja' },
  // Quiet in ms before a rolling decode may serve as the closing one, live 300; off: decodes on the interval only.
  pause: { type: 'string', default: '300' },
} });
const [sentenceMs, maxMs, clause] = values.rows!.split(',');
const rows = { sentenceMs: Number(sentenceMs), maxMs: Number(maxMs), clauseMs: clause === 'off' ? null : Number(clause) };
const [intervalMs, settleMs] = values.cadence!.split(',').map(Number);
const cadence = { intervalMs: intervalMs!, settleMs: settleMs! };
const pauseMs = values.pause === 'off' ? null : Number(values.pause);
if (!values.out || !positionals.length || !['local', 'off'].includes(values.translate!)
  || !(LOCAL_TRANSLATION_MODELS as readonly string[]).includes(values.model!)
  || ![rows.sentenceMs, rows.maxMs, rows.clauseMs ?? 1000].every(ms => Number.isInteger(ms) && ms >= 1000 && ms <= 20_000)
  || ![cadence.intervalMs, cadence.settleMs].every(ms => Number.isInteger(ms) && ms >= 300 && ms <= 3000)
  || !['row', 'piece'].includes(values.units!) || !(pauseMs === null || (Number.isInteger(pauseMs) && pauseMs >= 100 && pauseMs <= 650))) {
  console.error('Usage: --translate local|off [--model <local translation model>] [--rows sentence,max,clause|off] [--cadence interval,settle] [--pause ms|off] [--units row|piece] [--no-prompt-cache] [--review <file>] --out <diagnostics.json> <audio>...'); process.exit(2);
}
const CALIBRATION_MS = 1500;
let pair: Pair;
try { pair = parsePair(values.pair!); } catch { console.error('--pair must be two profiled languages, such as en-ja.'); process.exit(1); }
const translator = values.translate === 'local' ? new LocalTranslator({ model: values.model as LocalTranslationModel, promptCache: !values['no-prompt-cache'], pair }) : null;
await translator?.start();
const controller = new Controller({ pair, backend: 'replay', processing: translator ? 'local-audio-local-text' : 'local-only', sessionLimitMs: null,
  glossary: await loadGlossary(EXAMPLE_GLOSSARY), translator, segmentation: 'rolling', translationUnit: values.units as 'row' | 'piece',
  transcriber: localTranscriberFactory({ model: 'turbo-q4', segmentation: 'rolling', calibrationMs: CALIBRATION_MS, rows, cadence, pauseMs }) });
// Collected as rows change: a snapshot holds only the latest rows. Keyed by recording and sequence.
const review = new Map<string, { recording: number; sequence: number; original: string; translation: string | null; state: string }>();
let recording = 0;

type Event = Record<string, unknown> & { type: string; atMs: number };
const events: Event[] = []; const origin = Date.now();
const seen = new Map<string, string>();
controller.subscribe(() => {
  const snapshot = controller.snapshot(); const atMs = Date.now() - origin;
  for (const turn of snapshot.turns) {
    const key = `t${turn.sequence}`; const value = JSON.stringify(turn);
    if (seen.get(key) !== value) { seen.set(key, value); events.push({ type: 'turn', atMs, turn }); }
  }
  for (const row of snapshot.segments) {
    const meta = { sequence: row.sequence, final: row.final, state: row.state, originalChars: row.original.length, translationChars: row.translation?.length ?? 0 };
    const key = `r${row.sequence}`; const value = JSON.stringify(meta);
    if (seen.get(key) !== value) { seen.set(key, value); events.push({ type: 'segment', atMs, row: meta }); }
    if (values.review) review.set(`${recording}:${row.sequence}`, { recording, sequence: row.sequence, original: row.original, translation: row.translation ?? null, state: row.state });
  }
});

for (const audio of positionals) {
  const converted = spawnSync('ffmpeg', ['-v', 'error', '-i', audio, '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { maxBuffer: 200_000_000 });
  if (converted.status !== 0) { console.error(`Audio conversion failed: ${audio}`); process.exit(1); }
  // Calibration in a quiet room, then the recording, then trailing quiet so the last row closes.
  const pcm = Buffer.concat([Buffer.alloc((CALIBRATION_MS / 50) * FRAME_BYTES), converted.stdout, Buffer.alloc(40 * FRAME_BYTES)]);
  seen.clear(); recording++;
  events.push({ type: 'command', atMs: Date.now() - origin, command: { type: 'start' } });
  await controller.start('auto');
  const frames = Math.ceil(pcm.length / FRAME_BYTES); const started = performance.now();
  for (let i = 0; i < frames; i++) {
    await new Promise(r => setTimeout(r, Math.max(0, started + (i + 1) * 50 - performance.now())));
    if (controller.snapshot().capture !== 'active') { console.error('Capture stopped during replay.'); process.exit(1); }
    const frame = Buffer.alloc(FRAME_BYTES); pcm.copy(frame, 0, i * FRAME_BYTES, Math.min(pcm.length, (i + 1) * FRAME_BYTES));
    controller.audio(frame);
  }
  events.push({ type: 'command', atMs: Date.now() - origin, command: { type: 'pause' } });
  await controller.pause();
  // Let the last translations land before the next Start invalidates them.
  await new Promise(r => setTimeout(r, translator ? 15_000 : 1000));
  console.log(`Replayed ${positionals.indexOf(audio) + 1} of ${positionals.length}.`);
}
controller.dispose(); translator?.close();
await writeFile(values.out, `${JSON.stringify({ version: 2, events })}\n`);
if (values.review) await writeFile(values.review, `${JSON.stringify({ rows: values.rows, cadence: values.cadence, units: values.units, model: translator ? values.model : null, review: [...review.values()] }, null, 2)}\n`);
console.log(`Wrote ${events.length} events: ${values.out}`);
