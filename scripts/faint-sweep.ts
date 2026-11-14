// Faint-level sweep: the tuning clips, never gate material, replayed in real time through rolling recognition at falling
// input levels, to see which gate loses quiet speech first: the energy gate, the speech gate or the decoder's filters.
// Explicit integration only: public fixtures, the local model, no .env, cloud, sockets or microphone. Prints counts only;
// the recognized text goes to the ignored --out file for scripts/local/faint_sweep_score.py.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { LocalTranscriber } from '../packages/providers/local.ts';
import { FRAME_BYTES, type TurnMeasurement } from '../packages/protocol/index.ts';
import type { TranscriptEvent } from '../packages/providers/types.ts';

const { values } = parseArgs({ options: {
  run: { type: 'boolean', default: false },
  // Attenuation in dB below the gate's replay level, a 90th-percentile 50 ms RMS of 0.1.
  levels: { type: 'string', default: '0,-6,-12,-18,-24,-30,-36' },
  // Noise bed RMS as a share of full scale; 0 is digital silence. The bed also runs through calibration and the gaps.
  beds: { type: 'string', default: '0,0.001' },
  out: { type: 'string', default: '.local/experiments/faint-sweep/results.json' },
} });
if (!values.run) { console.error('Explicit local model opt-in required: --run'); process.exit(2); }
const levels = values.levels!.split(',').map(Number); const beds = values.beds!.split(',').map(Number);
if (![...levels].every(l => Number.isFinite(l) && l <= 0 && l >= -60) || !beds.every(b => Number.isFinite(b) && b >= 0 && b <= 0.02)) {
  console.error('Usage: --run [--levels 0,-6,...] [--beds 0,0.001] [--out <file>]'); process.exit(2);
}
type Fixture = { id: string; language: 'en' | 'ja' };
const fixtures: Fixture[] = [...JSON.parse(readFileSync('benchmarks/fleurs.json', 'utf8')),
  ...JSON.parse(readFileSync('benchmarks/noisy-ja.json', 'utf8')).fixtures].map(({ id, language }: Fixture) => ({ id, language }));

const samples = (pcm: Buffer) => new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
// The gate's leveling rule, as scripts/local/gate.py: scale so the 90th-percentile 50 ms RMS is 0.1, without clipping.
function leveled(pcm: Buffer) {
  const s = samples(pcm); const rms: number[] = []; let peak = 0;
  for (let i = 0; i + 1200 <= s.length; i += 1200) {
    let sum = 0; for (let j = i; j < i + 1200; j++) { const v = s[j]! / 32768; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    rms.push(Math.sqrt(sum / 1200));
  }
  rms.sort((a, b) => a - b);
  const loud = rms[Math.min(rms.length - 1, Math.round((rms.length - 1) * 0.9))] ?? 0;
  const gain = loud > 0 && peak > 0 ? Math.min(0.1 / loud, 0.99 / peak) : 1;
  return Float64Array.from(s, v => v / 32768 * gain);
}
// A steady bed: white noise through a one-pole low-pass, from a fixed seed, scaled to the asked RMS.
function bed(length: number, rms: number, seed: number) {
  const out = new Float64Array(length); if (!rms) return out;
  let state = seed >>> 0; let low = 0; let sum = 0;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    low = 0.9 * low + 0.1 * (state / 2 ** 31 - 1); out[i] = low; sum += low * low;
  }
  const scale = rms / Math.sqrt(sum / length);
  for (let i = 0; i < length; i++) out[i]! *= scale;
  return out;
}
const toPcm = (audio: Float64Array) => { const b = Buffer.alloc(audio.length * 2); audio.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2)); return b; };
const clips = fixtures.map(f => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', `.local/fixtures/${f.id}.wav`, '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { maxBuffer: 50_000_000 });
  if (r.status !== 0) { console.error(`Missing fixture ${f.id}: run pnpm local:setup and pnpm local:noisy-fixtures`); process.exit(1); }
  return { ...f, audio: leveled(r.stdout) };
});

type ClipResult = { id: string; language: string; level: number; bed: number; opened: boolean; rows: number; shown: number;
  speechGate: number; filtered: number; otherLanguage: number; text: string };
const results: ClipResult[] = [];
for (const noise of beds) for (const level of levels) {
  let events: TranscriptEvent[] = []; let traces: TurnMeasurement[] = []; let opened = false; let failed = false;
  const stream = new LocalTranscriber({ model: 'turbo-q4', segmentation: 'rolling', mode: 'auto', pair: ['en', 'ja'], calibrationMs: 1500,
    onFailure: () => { failed = true; }, onEvent: event => events.push(event), onTurnDiagnostic: (_, value) => traces.push(value),
    onGate: gate => { if (gate.state === 'speech') opened = true; } });
  await stream.connect();
  let clock = performance.now(); let seed = 1;
  const play = async (audio: Float64Array) => {
    const mixed = bed(audio.length, noise, seed++); for (let i = 0; i < audio.length; i++) mixed[i]! += audio[i]!;
    const pcm = toPcm(mixed);
    for (let i = 0; i + FRAME_BYTES <= pcm.length; i += FRAME_BYTES) {
      clock += 50; await new Promise(r => setTimeout(r, Math.max(0, clock - performance.now())));
      stream.audio(pcm.subarray(i, i + FRAME_BYTES));
    }
  };
  await play(new Float64Array(24000 * 2)); // calibration in the bed alone, then half a second more
  const gain = 10 ** (level / 20);
  for (const clip of clips) {
    events = []; traces = []; opened = false;
    await play(clip.audio.map(v => v * gain)); await play(new Float64Array(24000 * 1.5));
    await stream.finish(); clock = performance.now();
    if (failed) { console.error('Recognizer failed'); process.exit(1); }
    const finals = events.filter(e => e.type === 'final') as Extract<TranscriptEvent, { type: 'final' }>[];
    const empty = traces.filter((_, i) => !finals[i]?.text);
    results.push({ id: clip.id, language: clip.language, level, bed: noise, opened, rows: finals.length, shown: finals.filter(f => f.text).length,
      speechGate: empty.filter(t => t.quality?.speechGateRejected).length,
      otherLanguage: empty.filter(t => !t.quality?.speechGateRejected && (t.quality?.otherLanguageDrops ?? 0) > 0).length,
      filtered: empty.filter(t => !t.quality?.speechGateRejected && !(t.quality?.otherLanguageDrops ?? 0)).length,
      text: finals.map(f => f.text).filter(Boolean).join(' ') });
  }
  stream.close();
  const here = results.filter(r => r.level === level && r.bed === noise);
  const sum = (key: 'rows' | 'shown' | 'speechGate' | 'filtered' | 'otherLanguage') => here.reduce((n, r) => n + r[key], 0);
  console.log(`bed ${noise} level ${level} dB: clips ${here.length}, never opened ${here.filter(r => !r.opened).length}, with text ${here.filter(r => r.text).length}, `
    + `rows ${sum('rows')}, shown ${sum('shown')}, empty by speech gate ${sum('speechGate')}, by other language ${sum('otherLanguage')}, by filters ${sum('filtered')}`);
}
mkdirSync(dirname(values.out!), { recursive: true });
writeFileSync(values.out!, JSON.stringify({ version: 1, results }, null, 1));
console.log(`Wrote ${values.out}; score with .local/venv/bin/python scripts/local/faint_sweep_score.py`);
