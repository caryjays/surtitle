import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { LocalTranscriber } from '../packages/providers/local.ts';
import { FRAME_BYTES, inPair, parsePair, profile, type Pair, type TranslationContext } from '../packages/protocol/index.ts';

// Replays one recording in real time through the live local recognizer and writes draft eval cases:
// one per finalized turn, with up to four preceding originals as context, as the controller sends them.
// `reference` starts as the recognized text; the speaker corrects it by hand before the eval uses it.
// Offline: no .env, no network. Write output only under private/ for personal recordings.
const { values } = parseArgs({ options: {
  audio: { type: 'string' }, out: { type: 'string' }, id: { type: 'string' },
  model: { type: 'string', default: 'turbo-q4' },
  calibrate: { type: 'boolean', default: false },
  // quietest: the quietest 1.5 s of the file; silence: as if calibrated in a quiet room beforehand.
  'room-tone': { type: 'string', default: 'quietest' },
  'max-turn-ms': { type: 'string', default: '12000' },
  // rolling: the experimental segmentation; rows instead of capped turns, see packages/providers/rolling.ts.
  segmentation: { type: 'string', default: 'turns' },
  pair: { type: 'string', default: 'en-ja' },
} });
if (!values.audio || !values.out) { console.error('Usage: --audio <file> --out <cases.json> [--id prefix]'); process.exit(1); }
const prefix = values.id ?? basename(values.audio).replace(/\.[^.]+$/, '');
const model = values.model === 'small-q4' ? 'small-q4' : 'turbo-q4';
const maxTurnMs = Number(values['max-turn-ms']);
if (!Number.isInteger(maxTurnMs) || maxTurnMs < 1000 || maxTurnMs > 12_000) { console.error('--max-turn-ms must be 1000 to 12000.'); process.exit(1); }
const segmentation = values.segmentation;
if (segmentation !== 'turns' && segmentation !== 'rolling') { console.error('--segmentation must be turns or rolling.'); process.exit(1); }

let pair: Pair;
try { pair = parsePair(values.pair); } catch { console.error('--pair must be two profiled languages, such as en-ja.'); process.exit(1); }

const converted = spawnSync('ffmpeg', ['-v', 'error', '-i', values.audio, '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { maxBuffer: 200_000_000 });
if (converted.status !== 0) { console.error('Audio conversion failed.'); process.exit(1); }
let pcm = converted.stdout;
// --calibrate mirrors listen mode: 1.5 s of room tone first, so the detector learns the noise floor
// as it does when the operator calibrates in a quiet moment. The quietest 1.5 s of the file stands in.
const CALIBRATION_MS = 1500;
if (values.calibrate && values['room-tone'] === 'silence') {
  pcm = Buffer.concat([Buffer.alloc((CALIBRATION_MS / 50) * FRAME_BYTES), pcm]);
} else if (values.calibrate) {
  const window = (CALIBRATION_MS / 50) * FRAME_BYTES;
  let best = 0, bestEnergy = Infinity;
  for (let start = 0; start + window <= pcm.length; start += FRAME_BYTES) {
    let energy = 0;
    for (let i = start; i < start + window; i += 2) energy += pcm.readInt16LE(i) ** 2;
    if (energy < bestEnergy) { bestEnergy = energy; best = start; }
  }
  pcm = Buffer.concat([pcm.subarray(best, best + window), pcm]);
}

type Turn = { id: string; sequence: number; text: string; language?: string; rejected?: boolean; audioMs?: number; boundary?: string;
  decodes?: number; forcedLocks?: number; firstTextMs?: number; lockLagMs?: number; beganAtMs?: number; finalAtMs?: number };
const turns: Turn[] = [];
let failed = false;
const stream = new LocalTranscriber({
  model, mode: 'auto', pair, maxTurnMs, segmentation, calibrationMs: values.calibrate ? CALIBRATION_MS : undefined, onFailure: () => { failed = true; },
  onEvent: event => {
    // Times are audio-clock milliseconds since replay start, excluding calibration.
    const at = Math.round(performance.now() - started) - (values.calibrate ? CALIBRATION_MS : 0);
    if (event.type === 'begin') turns.push({ id: event.id, sequence: event.sequence, text: '', beganAtMs: at });
    if (event.type === 'final') {
      const turn = turns.find(t => t.id === event.id);
      if (turn) Object.assign(turn, { text: event.text, language: event.language, rejected: event.rejected, finalAtMs: at });
    }
  },
  onTurnDiagnostic: (id, measurement) => {
    const turn = turns.find(t => t.id === id);
    if (turn) Object.assign(turn, { audioMs: measurement.audioMs ?? turn.audioMs, boundary: measurement.boundary ?? turn.boundary,
      decodes: measurement.decodes, forcedLocks: measurement.forcedLocks, firstTextMs: measurement.firstTextMs, lockLagMs: measurement.lockLagMs });
  },
});
await stream.connect();
const frames = Math.ceil(pcm.length / FRAME_BYTES) + 20; // one second of trailing silence lets the pause detector finalize
const started = performance.now();
for (let i = 0; i < frames; i++) {
  await new Promise(r => setTimeout(r, Math.max(0, started + (i + 1) * 50 - performance.now())));
  if (failed) break;
  const frame = Buffer.alloc(FRAME_BYTES);
  if (i * FRAME_BYTES < pcm.length) pcm.copy(frame, 0, i * FRAME_BYTES, Math.min(pcm.length, (i + 1) * FRAME_BYTES));
  stream.audio(frame);
}
try { await stream.finish(); } catch { failed = true; }
stream.close();
if (failed) { console.error('Local recognition failed during replay.'); process.exit(1); }

const accepted = turns.sort((a, b) => a.sequence - b.sequence).filter(t => !t.rejected && t.text.trim());
// A draft case's language. A pair with one kana or kanji language is told apart by script, as before pairs were
// configurable; a pair in one script takes the recognizer's word. Hangul needs its own rule when Korean arrives.
const cjk = pair.find(language => profile(language).scoring === 'character');
const latin = pair.find(language => language !== cjk) ?? pair[0];
const languageOf = (turn: Turn) => cjk
  ? ((turn.text.match(/[぀-ヿ一-鿿]/g)?.length ?? 0) > turn.text.length / 4 ? cjk : latin)
  : (turn.language && inPair(pair, turn.language) ? turn.language : pair[0]);
const cases = accepted.map((turn, index) => {
  const context: TranslationContext = accepted.slice(Math.max(0, index - 4), index)
    .map(t => ({ original: t.text.slice(0, 800), translation: null, source: languageOf(t) }));
  return {
    id: `${prefix}-${String(index + 1).padStart(2, '0')}`, referenceId: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    condition: 'own-recording', language: languageOf(turn),
    detectedLanguage: turn.language && inPair(pair, turn.language) ? turn.language : 'unknown',
    reference: turn.text, asr: turn.text, context, terms: [] as string[][],
    // A max-duration boundary cuts this turn's end and the next turn's start.
    truncated: { start: accepted[index - 1]?.boundary === 'max-duration', end: turn.boundary === 'max-duration' },
    turn: { audioMs: turn.audioMs, boundary: turn.boundary,
      ...(segmentation === 'rolling' ? { decodes: turn.decodes, forcedLocks: turn.forcedLocks, firstTextMs: turn.firstTextMs,
        lockLagMs: turn.lockLagMs, beganAtMs: turn.beganAtMs, finalAtMs: turn.finalAtMs } : {}) },
  };
});
await writeFile(values.out, `${JSON.stringify({ version: 1, recognition: { model, language: 'auto', segmentation: `${segmentation === 'rolling' ? 'rolling rows' : `live energy turns, ${maxTurnMs / 1000} s maximum`}, ${values.calibrate ? `1.5 s room calibration from ${values['room-tone'] === 'silence' ? 'silence' : 'the quietest window'}` : 'no room calibration'}` },
  rejectedTurns: turns.length - accepted.length, reviewed: false, cases }, null, 2)}\n`);
console.log(`${cases.length} turns kept, ${turns.length - accepted.length} rejected or empty: ${values.out}`);
