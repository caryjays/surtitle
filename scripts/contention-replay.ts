import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { Controller } from '../apps/service/controller.ts';
import { localTranscriberFactory } from '../packages/providers/local.ts';
import { LOCAL_TRANSLATION_MODELS, LocalTranslator, type LocalTranslationModel } from '../packages/providers/local-translator.ts';
import { EXAMPLE_GLOSSARY, loadGlossary } from '../apps/service/glossary.ts';
import { FRAME_BYTES } from '../packages/protocol/index.ts';

// Replays recordings in real time through the live controller with rolling recognition, with the local translator or
// without it, and writes a diagnostics file in the control page's format for `pnpm diag:latency`. It measures what
// translation on the shared GPU costs recognition. Offline: no .env, no network. The file holds timings and counts only.
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  translate: { type: 'string', default: 'local' }, model: { type: 'string', default: 'qwen3.5-4b-q4' }, out: { type: 'string' },
} });
if (!values.out || !positionals.length || !['local', 'off'].includes(values.translate!)
  || !(LOCAL_TRANSLATION_MODELS as readonly string[]).includes(values.model!)) {
  console.error('Usage: --translate local|off [--model <local translation model>] --out <diagnostics.json> <audio>...'); process.exit(2);
}
const CALIBRATION_MS = 1500;
const translator = values.translate === 'local' ? new LocalTranslator({ model: values.model as LocalTranslationModel }) : null;
await translator?.start();
const controller = new Controller({ backend: 'replay', processing: translator ? 'local-audio-local-text' : 'local-only', sessionLimitMs: null,
  glossary: await loadGlossary(EXAMPLE_GLOSSARY), translator, segmentation: 'rolling',
  transcriber: localTranscriberFactory({ model: 'turbo-q4', segmentation: 'rolling', calibrationMs: CALIBRATION_MS }) });

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
  }
});

for (const audio of positionals) {
  const converted = spawnSync('ffmpeg', ['-v', 'error', '-i', audio, '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { maxBuffer: 200_000_000 });
  if (converted.status !== 0) { console.error(`Audio conversion failed: ${audio}`); process.exit(1); }
  // Calibration in a quiet room, then the recording, then trailing quiet so the last row closes.
  const pcm = Buffer.concat([Buffer.alloc((CALIBRATION_MS / 50) * FRAME_BYTES), converted.stdout, Buffer.alloc(40 * FRAME_BYTES)]);
  seen.clear();
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
console.log(`Wrote ${events.length} events: ${values.out}`);
