import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { Controller } from '../apps/service/controller.ts';
import { localTranscriberFactory } from '../packages/providers/local.ts';
import { LOCAL_TRANSLATION_MODELS, LocalTranslator, type LocalTranslationModel } from '../packages/providers/local-translator.ts';
import { AnthropicTranslator } from '../packages/providers/anthropic.ts';
import { EXAMPLE_GLOSSARY, loadGlossary } from '../apps/service/glossary.ts';
import { HostProbe } from '../packages/providers/host-probe.ts';
import { FRAME_BYTES, parsePairTag, type Pair, type Script } from '../packages/protocol/index.ts';

// Replays recordings in real time through the live controller with rolling recognition, with the local translator or
// without it, and writes a diagnostics file in the control page's format for `pnpm diag:latency`. It measures what
// translation on the shared GPU costs recognition, and what row rules cost or save. Offline unless --translate anthropic,
// which is paid: it needs --paid and ANTHROPIC_API_KEY in the environment, run with node --env-file, never printed. The
// diagnostics file holds timings and counts only; --review writes each row's text, for a person to read, so keep it ignored.
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  // local, off, or anthropic: Claude as the live translator, as the dev:listen profile with TRANSLATION_PROVIDER=anthropic.
  translate: { type: 'string', default: 'local' }, model: { type: 'string' }, out: { type: 'string' }, paid: { type: 'boolean', default: false },
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
  // Hold rolling interval decodes while a translation waits for its first text, at most this many ms; off, as live.
  hold: { type: 'string', default: 'off' },
  // A row that the newest decode's settled text takes to the length limit closes on that text, without waiting for the
  // next decode to agree on it; off, as live.
  'fresh-length': { type: 'boolean', default: false },
  // Make the local model generate its reply's opening, as before 2026-11-18; live gives it when the direction is known.
  'no-opening': { type: 'boolean', default: false },
} });
const [sentenceMs, maxMs, clause] = values.rows!.split(',');
const rows = { sentenceMs: Number(sentenceMs), maxMs: Number(maxMs), clauseMs: clause === 'off' ? null : Number(clause) };
const [intervalMs, settleMs] = values.cadence!.split(',').map(Number);
const cadence = { intervalMs: intervalMs!, settleMs: settleMs! };
const pauseMs = values.pause === 'off' ? null : Number(values.pause);
const holdMs = values.hold === 'off' ? null : Number(values.hold);
const cloud = values.translate === 'anthropic';
const model = values.model ?? (cloud ? 'claude-haiku-5-5' : 'qwen3.5-4b-q4');
if (cloud && (!values.paid || !process.env.ANTHROPIC_API_KEY?.trim())) {
  console.error('--translate anthropic is paid: pass --paid, with ANTHROPIC_API_KEY set through node --env-file. The key is never printed.'); process.exit(2);
}
if (!values.out || !positionals.length || !['local', 'off', 'anthropic'].includes(values.translate!)
  || !(cloud ? /^claude-[a-z0-9-]{1,60}$/.test(model) : (LOCAL_TRANSLATION_MODELS as readonly string[]).includes(model))
  || ![rows.sentenceMs, rows.maxMs, rows.clauseMs ?? 1000].every(ms => Number.isInteger(ms) && ms >= 1000 && ms <= 20_000)
  || ![cadence.intervalMs, cadence.settleMs].every(ms => Number.isInteger(ms) && ms >= 300 && ms <= 3000)
  || !['row', 'piece'].includes(values.units!) || !(pauseMs === null || (Number.isInteger(pauseMs) && pauseMs >= 100 && pauseMs <= 650))
  || !(holdMs === null || (Number.isInteger(holdMs) && holdMs >= 100 && holdMs <= 3000)) || (holdMs !== null && values.translate !== 'local')) {
  console.error('Usage: --translate local|off|anthropic [--paid] [--model <local model, or claude-* for anthropic>] [--rows sentence,max,clause|off] [--cadence interval,settle] [--pause ms|off] [--hold ms|off] [--fresh-length] [--no-opening] [--units row|piece] [--no-prompt-cache] [--review <file>] --out <diagnostics.json> <audio>...'); process.exit(2);
}
const CALIBRATION_MS = 1500;
let pair: Pair; let script: Script | null;
try { ({ pair, script } = parsePairTag(values.pair!)); } catch { console.error('--pair must be two profiled languages, such as en-ja or en-zh-Hant.'); process.exit(1); }
// Translations waiting for their first text, by when they were asked. Requests past the cap stop holding.
const waiting = new Map<symbol, number>(); const holds = { frames: 0, translations: 0 };
class HoldingTranslator extends LocalTranslator {
  override async translate(...[input, signal, diagnostic, partial]: Parameters<LocalTranslator['translate']>) {
    const key = Symbol(); waiting.set(key, performance.now()); holds.translations++;
    try { return await super.translate(input, signal, diagnostic, value => { waiting.delete(key); partial?.(value); }); }
    finally { waiting.delete(key); }
  }
}
const holdRolls = () => {
  const now = performance.now();
  for (const [key, at] of waiting) if (now - at > holdMs!) waiting.delete(key);
  if (waiting.size) holds.frames++;
  return waiting.size > 0;
};
const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };
const translator = values.translate === 'local' ? new (holdMs === null ? LocalTranslator : HoldingTranslator)({ model: model as LocalTranslationModel, promptCache: !values['no-prompt-cache'], pair, script, replyOpening: !values['no-opening'] })
  : cloud ? new AnthropicTranslator({ key: process.env.ANTHROPIC_API_KEY!.trim(), model, effort: 'none', pair, script,
    onUsage: u => { usage.requests++; usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; } }) : null;
if (translator instanceof LocalTranslator) await translator.start();
const controller = new Controller({ pair, script, backend: 'replay', processing: cloud ? 'local-audio-cloud-text' : translator ? 'local-audio-local-text' : 'local-only', sessionLimitMs: null,
  glossary: [], termSets: [await loadGlossary(EXAMPLE_GLOSSARY, 'Example')], translator, segmentation: 'rolling', translationUnit: values.units as 'row' | 'piece',
  transcriber: localTranscriberFactory({ model: 'turbo-q4', segmentation: 'rolling', calibrationMs: CALIBRATION_MS, rows, cadence, pauseMs,
    ...(holdMs === null ? {} : { holdRolls }), ...(values['fresh-length'] ? { freshLengthClose: true } : {}) }) });
// Collected as rows change: a snapshot holds only the latest rows. Keyed by recording and sequence.
// heard: the recognizer's language when the row closed, before an unresolved reply sets the row's source to unknown.
const review = new Map<string, { recording: number; sequence: number; original: string; translation: string | null; state: string;
  heard: string | null; uncaptioned: boolean }>();
let recording = 0;

type Event = Record<string, unknown> & { type: string; atMs: number };
const events: Event[] = []; const origin = Date.now();
const seen = new Map<string, string>();
// Host load beside the replay, as the console's health events carry it, so diag:latency can show it per minute. Its
// "ours" group is this process's children: the recognizer and translator workers.
const hostProbe = process.platform === 'darwin' ? new HostProbe() : undefined;
hostProbe?.start();
const hostSamples = setInterval(() => {
  const host = hostProbe?.latest();
  if (host) events.push({ type: 'health', atMs: Date.now() - origin, health: { host } });
}, 2000);
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
    if (values.review) {
      const key = `${recording}:${row.sequence}`;
      const heard = review.get(key)?.heard ?? (row.final ? row.source : null);
      review.set(key, { recording, sequence: row.sequence, original: row.original, translation: row.translation ?? null, state: row.state,
        heard, uncaptioned: Boolean(row.uncaptioned) });
    }
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
clearInterval(hostSamples); hostProbe?.close();
controller.dispose(); if (translator instanceof LocalTranslator) translator.close();
if (cloud) console.error(`Paid requests ${usage.requests}: ${usage.inputTokens} input and ${usage.outputTokens} output tokens.`);
if (holdMs !== null) console.log(`Held interval decodes for about ${(holds.frames * 50 / 1000).toFixed(0)} s in all, over ${holds.translations} translations, at most ${holdMs} ms each.`);
await writeFile(values.out, `${JSON.stringify({ version: 2, events })}\n`);
if (values.review) await writeFile(values.review, `${JSON.stringify({ rows: values.rows, cadence: values.cadence, freshLength: values['fresh-length'], units: values.units, model: translator ? model : null, review: [...review.values()] }, null, 2)}\n`);
console.log(`Wrote ${events.length} events: ${values.out}`);
