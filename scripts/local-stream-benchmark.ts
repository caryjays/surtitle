import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { LocalTranscriber } from '../packages/providers/local.ts';
import { FRAME_BYTES, Mode } from '../packages/protocol/index.ts';

// No .env, microphones, sockets, cloud calls or audience audio. Uses public fixtures only.
async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string, fallback: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  const model = z.enum(['small-q4', 'turbo-q4']).parse(value('--model', 'turbo-q4'));
  const mode = z.enum(['auto', 'forced']).parse(value('--mode', 'auto'));
  const maxTurnMs = z.coerce.number().int().min(1000).max(12_000).parse(value('--max-turn-ms', '12000'));
  const fixtures = z.array(z.object({ id: z.string().regex(/^(en_us|ja_jp)-\d+$/),
    language: z.enum(['en', 'ja']), sha256: z.string().length(64) })).parse(JSON.parse(await readFile('benchmarks/fleurs.json', 'utf8')));
  const prepared = await Promise.all(fixtures.map(async fixture => {
    const path = `.local/fixtures/${fixture.id}.wav`;
    if (createHash('sha256').update(await readFile(path)).digest('hex') !== fixture.sha256) throw new Error('Fixture hash');
    const converted = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { maxBuffer: 2_000_000 });
    if (converted.status !== 0) throw new Error('Audio conversion');
    const pcm = converted.stdout;
    let gain = 1;
    if (args.includes('--normalize')) {
      const levels: number[] = []; let peak = 0;
      for (let offset = 0; offset + FRAME_BYTES <= pcm.length; offset += FRAME_BYTES) {
        let energy = 0;
        for (let i = offset; i < offset + FRAME_BYTES; i += 2) {
          const sample = pcm.readInt16LE(i) / 32768; energy += sample * sample; peak = Math.max(peak, Math.abs(sample));
        }
        levels.push(Math.sqrt(energy / 1200));
      }
      levels.sort((a, b) => a - b);
      const p90 = levels[Math.floor(levels.length * 0.9)] ?? 0;
      if (p90 > 0 && peak > 0) gain = Math.min(0.06 / p90, 0.9 / peak, 100);
      for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i) * gain))), i);
    }
    return { ...fixture, pcm, gain }; // Fixture-only level adjustment, not a live AGC claim.
  }));
  const runs = [];
  // Auto uses one persistent worker across EN then JA; forced opens once per language.
  let stream: LocalTranscriber | undefined;
  let failed = false;
  let previousLanguage: string | undefined;
  let started = 0;
  let lastFinal = 0;
  let texts: { id: string; sequence: number; text: string }[] = [];
  let timings: Parameters<NonNullable<ConstructorParameters<typeof LocalTranscriber>[0]['onTiming']>>[0][] = [];
  try {
    for (const fixture of prepared) {
      texts = []; timings = []; lastFinal = 0;
      if (!stream || (mode === 'forced' && previousLanguage !== fixture.language)) {
        stream?.close();
        stream = new LocalTranscriber({ model, mode: Mode.parse(mode === 'auto' ? 'auto' : `${fixture.language}-${fixture.language === 'en' ? 'ja' : 'en'}`),
          maxTurnMs, onFailure: () => { failed = true; }, onDiagnostic: category => console.log(`Worker failure category: ${category}`),
          onTiming: timing => { timings.push(timing); console.log(`  turn ${timing.audioMs}ms audio: ${timing.inferenceMs}ms inference`); },
          onEvent: event => {
            if (event.type === 'begin') texts.push({ id: event.id, sequence: event.sequence, text: '' });
            if (event.type === 'final') {
              const row = texts.find(t => t.id === event.id); if (row) row.text = event.text;
              lastFinal = performance.now();
            }
          },
        });
        await stream.connect(); previousLanguage = fixture.language;
      }
      const frames: Buffer[] = [];
      let lastVoicedEndMs = 0;
      for (let offset = 0; offset < fixture.pcm.length; offset += FRAME_BYTES) {
        const frame = Buffer.alloc(FRAME_BYTES); fixture.pcm.copy(frame, 0, offset, offset + FRAME_BYTES); frames.push(frame);
        let energy = 0;
        for (let i = 0; i < FRAME_BYTES; i += 2) energy += (frame.readInt16LE(i) / 32768) ** 2;
        if (Math.sqrt(energy / 1200) >= 0.012) lastVoicedEndMs = frames.length * 50;
      }
      // One second trailing silence lets the real 700ms pause detector finalize.
      for (let i = 0; i < 20; i++) frames.push(Buffer.alloc(FRAME_BYTES));
      started = performance.now();
      for (let i = 0; i < frames.length; i++) {
        await new Promise(r => setTimeout(r, Math.max(0, started + (i + 1) * 50 - performance.now())));
        if (failed) throw new Error('Local inference failed');
        stream.audio(frames[i]!);
      }
      await stream.finish();
      if (failed || !timings.length) throw new Error('No completed speech');
      const run = { id: fixture.id, language: fixture.language, audioSeconds: fixture.pcm.length / 48000,
        gain: fixture.gain, turns: timings.length, timings, tailLatencyMs: lastFinal - (started + lastVoicedEndMs),
        hypothesis: texts.sort((a, b) => a.sequence - b.sequence).map(t => t.text).join(fixture.language === 'en' ? ' ' : '') };
      runs.push(run);
      console.log(`${fixture.id}: ${run.turns} turns, estimated tail latency ${run.tailLatencyMs.toFixed(0)}ms`);
    }
  } finally { stream?.close(); }
  const scored = spawnSync('.local/venv/bin/python', ['scripts/local/score_stream.py', ...(args.includes('--review') ? ['--review'] : [])], {
    input: JSON.stringify({ model, mode, maxTurnMs, levelNormalized: args.includes('--normalize'),
      speechGate: JSON.parse(await readFile('scripts/local/vad-model.json', 'utf8')),
      scope: 'real-time replay through local adapter with fixed RMS segmentation + CPU speech/repetition rejection; no listen-mode room calibration or previews; excludes browser/OBS; optional fixture-only p90 RMS normalization', runs }),
    encoding: 'utf8', maxBuffer: 20_000, env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' },
  });
  if (scored.status !== 0) throw new Error('Scoring failed');
  console.log(scored.stdout.trim());
}
void main().catch(() => { console.error('Local stream benchmark failed. Check fixture/model setup and worker availability. Details suppressed.'); process.exitCode = 1; });
