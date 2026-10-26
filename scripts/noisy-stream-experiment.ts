import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { LocalTranscriber } from '../packages/providers/local.ts';
import { FRAME_BYTES, TurnMeasurement } from '../packages/protocol/index.ts';

// Explicit integration only: fixed public fixtures; no .env, cloud, sockets or microphone.
const Profile = z.enum(['baseline-auto', 'gate-035', 'confidence-125', 'forced-ja', 'preview-1500', 'chunks-8000']);
const Case = z.object({ id: z.string().regex(/^(ja_lab-\d+|control)--[a-z0-9-]+$/), condition: z.string().regex(/^[a-z0-9-]+$/),
  path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), referenceId: z.string().nullable(), speechExpected: z.boolean(), seconds: z.number().min(0.1).max(30) });
async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--run')) throw new Error('Explicit local model opt-in required');
  const flag = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const model = z.enum(['turbo-q4', 'small-q4']).parse(flag('--model', 'turbo-q4'));
  const profiles = z.array(Profile).min(1).max(6).parse(flag('--profiles', 'baseline-auto,preview-1500,chunks-8000')!.split(','));
  if (new Set(profiles).size !== profiles.length) throw new Error('Repeated profiles');
  const input = z.object({ version: z.literal(1), sampleRate: z.literal(24000), cases: z.array(Case).max(64) })
    .parse(JSON.parse(await readFile('benchmarks/results/noisy-inputs.json', 'utf8')));
  const firstTarget = z.string().regex(/^ja_lab-\d+$/).parse(flag('--target', input.cases.find(c => c.speechExpected)!.referenceId!));
  const conditions = z.array(z.enum(['clean', 'fast-125', 'babble-0db', 'faint-minus12db', 'noise-high'])).min(1).max(5)
    .parse(flag('--conditions', 'clean,fast-125,babble-0db,faint-minus12db,noise-high')!.split(','));
  if (new Set(conditions).size !== conditions.length) throw new Error('Repeated conditions');
  const selected = input.cases.filter(c => conditions.includes(c.condition as typeof conditions[number])
    && (c.referenceId === firstTarget || c.id === 'control--noise-high'));
  if (selected.length !== conditions.length) throw new Error('Fixed replay selection');
  const prepared = await Promise.all(selected.map(async c => {
    if (c.path !== `.local/experiments/noisy/${c.id}.pcm`) throw new Error('Input path allowlist');
    const pcm = await readFile(c.path);
    if (createHash('sha256').update(pcm).digest('hex') !== c.sha256) throw new Error('Input integrity');
    return { ...c, pcm };
  }));
  const runs = [];
  for (const profile of profiles) {
    let failed = false;
    let records = new Map<string, { sequence: number; text: string; final: boolean; rejected: boolean; measurement: z.infer<typeof TurnMeasurement> }>();
    let targetStart = 0; let firstText: number | null = null; let firstFinalText: number | null = null; let lastFinal: number | null = null;
    let frameLateMax = 0; let workerReplies = 0;
    const stream = new LocalTranscriber({ model, mode: profile === 'forced-ja' ? 'ja-en' : 'auto',
      maxTurnMs: profile === 'chunks-8000' ? 8000 : 12000, previewIntervalMs: profile === 'preview-1500' ? 1500 : 3000, calibrationMs: 1500,
      workerFactory: () => {
        const child = spawn('.local/venv/bin/python', ['-u', 'scripts/local/noisy_worker.py', model, profile], {
          env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', PYTHONUNBUFFERED: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Count replies, not their text; after ready/reset this counts final + provisional inference jobs.
        child.stdout.on('data', (chunk: Buffer | string) => { workerReplies += chunk.toString().split('\n').length - 1; });
        return child;
      },
      onFailure: () => { failed = true; },
      onTurnDiagnostic: (id, value) => { const row = records.get(id); if (row) Object.assign(row.measurement, value); },
      onEvent: event => {
        if (event.type === 'begin') records.set(event.id, { sequence: event.sequence, text: '', final: false, rejected: false, measurement: {} });
        else {
          const row = records.get(event.id); if (!row) return;
          if (event.text && firstText === null) firstText = performance.now() - targetStart;
          if (event.type === 'final') {
            if (event.text && firstFinalText === null) firstFinalText = performance.now() - targetStart;
            row.text = event.text; row.final = true; row.rejected = Boolean(event.rejected); lastFinal = performance.now() - targetStart;
          }
        }
      },
    });
    try {
      await stream.connect();
      for (const fixture of prepared) {
        records = new Map(); firstText = null; firstFinalText = null; lastFinal = null; frameLateMax = 0; workerReplies = 0;
        stream.calibrate();
        const started = performance.now(); targetStart = started + 1500;
        const count = Math.ceil(fixture.pcm.length / FRAME_BYTES);
        for (let frame = 0; frame < 30 + count + 20; frame++) {
          const due = started + (frame + 1) * 50;
          await new Promise(resolve => setTimeout(resolve, Math.max(0, due - performance.now())));
          frameLateMax = Math.max(frameLateMax, performance.now() - due);
          if (failed) throw new Error('Worker failed');
          const pcm = Buffer.alloc(FRAME_BYTES);
          if (frame >= 30 && frame < 30 + count) fixture.pcm.copy(pcm, 0, (frame - 30) * FRAME_BYTES, (frame - 29) * FRAME_BYTES);
          stream.audio(pcm);
        }
        await stream.finish();
        if (failed) throw new Error('Worker failed');
        const turns = [...records.values()].sort((a, b) => a.sequence - b.sequence);
        runs.push({ id: fixture.id, profile, condition: fixture.condition, referenceId: fixture.referenceId, speechExpected: fixture.speechExpected,
          audioSeconds: fixture.seconds, firstEmittedOriginalMs: firstText, firstFinalizedOriginalMs: firstFinalText, lastFinalFromPcmEndMs: lastFinal === null ? null : lastFinal - fixture.seconds * 1000,
          frameLateMaxMs: frameLateMax, workerReplies, turns: turns.map(({ sequence, final, rejected, measurement }) => ({ sequence, final, rejected, measurement })),
          hypothesis: turns.map(row => row.text).join('') });
        console.log(`Replayed ${profile}/${fixture.condition}: ${turns.length} candidate turns; first emitted original ${firstText === null ? 'none' : `${Math.round(firstText)}ms from target PCM start`}.`);
      }
    } finally { stream.close(); }
  }
  const scored = spawnSync('.local/venv/bin/python', ['scripts/local/noisy_score_stream.py'], {
    input: JSON.stringify({ model, profiles, runs }), encoding: 'utf8', maxBuffer: 40_000,
    env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' },
  });
  if (scored.status !== 0) throw new Error('Scoring failed');
  console.log(scored.stdout.trim());
}
void main().catch(() => { console.error('Noisy replay failed (safe fixture/worker/scoring category); details suppressed. No cloud calls.'); process.exitCode = 1; });
