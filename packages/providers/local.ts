import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { TurnMeasurement, type Mode, type Glossary } from '../protocol/index.ts';
import type { Transcriber, TranscriberFactory } from './types.ts';
import { TurnDetector } from './turns.ts';
import { isRepetitiveTranscript } from './quality.ts';

const Reply = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('error') }).strict(),
  z.object({ type: z.literal('final'), id: z.string().uuid(), text: z.string().max(4000),
    language: z.enum(['en', 'ja', 'unknown']), inferenceMs: z.number().nonnegative().max(60_000), rejected: z.boolean().optional(),
    measurement: TurnMeasurement.pick({ recognitionLanguage: true, recognitionClipped: true, quality: true }).optional() }).strict(),
]);
export type LocalOptions = {
  model: 'small-q4' | 'turbo-q4'; python?: string; maxTurnMs?: number;
  previewIntervalMs?: number; glossary?: Glossary; calibrationMs?: number;
  startupTimeoutMs?: number; inferenceTimeoutMs?: number;
  workerFactory?: () => ChildProcessWithoutNullStreams;
  onDiagnostic?: (category: 'worker' | 'protocol' | 'startup-timeout' | 'inference-timeout' | 'queue-expired') => void;
  onTiming?: (timing: { id: string; audioMs: number; queueMs: number; inferenceMs: number; commitToFinalMs: number }) => void;
};
type Job = { id: string; requestId: string; kind: 'preview' | 'final'; language: 'en' | 'ja' | null;
  audio: Buffer; queued: number; sent?: number };
export class LocalTranscriber implements Transcriber {
  private worker?: ChildProcessWithoutNullStreams;
  private closed = false;
  private ready = false;
  private output = '';
  private sequence = 0;
  private gateFrames = 0;
  private current?: { id: string; frames: Buffer[]; language: 'en' | 'ja' | null;
    lastPreviewMs: number; hypothesis: string; stable: string };
  private preview?: Job;
  private queue: Job[] = [];
  private active?: Job;
  private deadline?: ReturnType<typeof setTimeout>;
  private resolveConnect?: () => void;
  private rejectConnect?: () => void;
  private detector: TurnDetector;
  constructor(private options: LocalOptions & Parameters<TranscriberFactory>[0]) {
    this.detector = new TurnDetector({
      begin: () => {
        this.current = { id: randomUUID(), frames: [],
          language: options.mode === 'auto' ? null : options.mode === 'en-ja' ? 'en' : 'ja',
          lastPreviewMs: 0, hypothesis: '', stable: '' };
        options.onEvent({ type: 'begin', id: this.current.id, sequence: this.sequence++, mode: options.mode });
      },
      append: pcm => this.current?.frames.push(Buffer.from(pcm)),
      commit: detail => {
        if (!this.current) return;
        options.onTurnDiagnostic?.(this.current.id, detail);
        if (this.queue.length >= 2) throw new Error('Local inference backlog');
        this.queue.push({ id: this.current.id, requestId: this.current.id, kind: 'final', language: this.current.language,
          audio: Buffer.concat(this.current.frames), queued: performance.now() });
        this.current = undefined; this.preview = undefined; this.pump();
      },
    }, { maxTurnMs: options.maxTurnMs ?? 12_000, calibrationMs: options.calibrationMs });
  }
  async connect() {
    if (this.closed || this.worker) throw new Error('Invalid local lifecycle');
    await new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve; this.rejectConnect = () => reject(new Error('Local inference unavailable'));
      // No .env, API key, HF token, PYTHONPATH or arbitrary parent environment reaches the worker.
      this.worker = this.options.workerFactory?.() ?? spawn(this.options.python ?? '.local/venv/bin/python',
        ['-u', 'scripts/local/worker.py', this.options.model], {
          env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8',
            HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', PYTHONUNBUFFERED: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      this.deadline = setTimeout(() => this.failure('startup-timeout'), this.options.startupTimeoutMs ?? 60_000);
      this.worker.stderr.resume(); // Never print raw inference errors or speech content.
      this.worker.on('error', () => this.failure());
      this.worker.on('exit', () => { if (!this.closed) this.failure(); });
      this.worker.stdin.on('error', () => this.failure());
      this.worker.stdout.setEncoding('utf8');
      this.worker.stdout.on('data', (chunk: string) => {
        if (this.closed) return;
        this.output += chunk;
        if (this.output.length > 32_000) { this.failure(); return; }
        let end: number;
        while ((end = this.output.indexOf('\n')) >= 0) {
          const line = this.output.slice(0, end); this.output = this.output.slice(end + 1);
          try { this.reply(Reply.parse(JSON.parse(line))); } catch { this.failure('protocol'); }
          if (this.closed) return;
        }
      });
    });
  }
  private reply(message: z.infer<typeof Reply>) {
    if (message.type === 'error') { this.failure(); return; }
    if (message.type === 'ready') {
      if (this.ready) throw new Error('Duplicate ready');
      this.ready = true; clearTimeout(this.deadline);
      if (this.options.calibrationMs) this.options.onGate?.(this.detector.status());
      this.resolveConnect?.();
      this.resolveConnect = undefined; this.rejectConnect = undefined; return;
    }
    const job = this.active;
    if (!job || message.id !== job.requestId) throw new Error('Unexpected local result');
    clearTimeout(this.deadline); this.active = undefined;
    const repeated = !message.rejected && isRepetitiveTranscript(message.text);
    const rejected = message.rejected || repeated;
    const text = rejected ? '' : message.text;
    if (job.kind === 'final') {
      this.options.onTurnDiagnostic?.(job.id, { ...message.measurement,
        recognitionLanguage: message.measurement?.recognitionLanguage ?? message.language,
        recognitionQueueMs: Math.round(job.sent! - job.queued), recognitionInferenceMs: message.inferenceMs,
        commitToFinalMs: Math.round(performance.now() - job.queued), adapterRepetitionRejected: repeated });
      this.options.onTiming?.({ id: job.id, audioMs: job.audio.length / 48,
        queueMs: job.sent! - job.queued, inferenceMs: message.inferenceMs, commitToFinalMs: performance.now() - job.queued });
      this.options.onEvent({ type: 'final', id: job.id, text, language: message.language, ...(rejected ? { rejected: true } : {}) });
    } else if (this.current?.id === job.id && rejected) {
      this.current.hypothesis = ''; this.current.stable = '';
      this.options.onEvent({ type: 'partial', id: job.id, text: '' });
    } else if (this.current?.id === job.id) {
      // Two consecutive full-turn hypotheses must agree. This is a provisional
      // source preview ONLY; no translation is scheduled until the actual final.
      const current = this.current;
      let length = 0;
      while (length < current.hypothesis.length && current.hypothesis[length] === message.text[length]) length++;
      let stable = message.text.slice(0, length);
      if (/[A-Za-z0-9]$/.test(stable) && /[A-Za-z0-9]/.test(message.text[length] ?? '')) stable = stable.replace(/[A-Za-z0-9]+$/, '');
      stable = stable.trimEnd();
      if (stable.startsWith(current.stable) && stable.length > current.stable.length) {
        current.stable = stable;
        this.options.onEvent({ type: 'partial', id: job.id, text: stable });
      }
      current.hypothesis = message.text;
    }
    this.pump();
  }
  private pump() {
    if (this.closed || !this.ready || this.active) return;
    const job = this.queue.shift() ?? this.preview;
    if (!job) return;
    if (job === this.preview) this.preview = undefined;
    if (performance.now() - job.queued > 8000) { this.failure('queue-expired', job.id); return; }
    job.sent = performance.now(); this.active = job;
    this.deadline = setTimeout(() => this.failure('inference-timeout'), this.options.inferenceTimeoutMs ?? 12_000);
    const prompt = (this.options.glossary ?? []).flatMap(g => [g.term, g.translation])
      .filter(term => !/[<>\r\n]/.test(term)).join(', ').slice(0, 1000);
    this.worker!.stdin.write(JSON.stringify({ id: job.requestId, audio: job.audio.toString('base64'),
      language: job.language, ...(prompt ? { prompt } : {}) }) + '\n');
  }
  audio(pcm: Uint8Array) {
    if (!this.ready || this.closed) return;
    const previousState = this.detector.status().state;
    this.detector.push(pcm);
    if (this.options.calibrationMs && (++this.gateFrames % 5 === 0 || previousState !== this.detector.status().state)) {
      this.options.onGate?.(this.detector.status());
    }
    const current = this.current;
    const interval = this.options.previewIntervalMs;
    if (current && interval && current.frames.length * 50 - current.lastPreviewMs >= interval && !this.queue.length) {
      current.lastPreviewMs = current.frames.length * 50;
      this.preview = { id: current.id, requestId: randomUUID(), kind: 'preview', language: current.language,
        audio: Buffer.concat(current.frames), queued: performance.now() };
      this.pump();
    }
  }
  flush() { this.detector.finish(); }
  calibrate() { this.detector.calibrate(); this.options.onGate?.(this.detector.status()); }
  setMode(mode: Mode) { this.detector.finish('mode-change'); this.options.mode = mode; }
  async finish() {
    if (this.closed) throw new Error('Local inference closed');
    this.detector.finish('pause');
    const until = performance.now() + 8000;
    while ((this.active || this.queue.length) && !this.closed && performance.now() < until) await new Promise(r => setTimeout(r, 20));
    if (this.closed || this.active || this.queue.length) throw new Error('Local finalization timeout');
  }
  private failure(category: Parameters<NonNullable<LocalOptions['onDiagnostic']>>[0] = 'worker', id?: string) {
    if (this.closed) return;
    const turnId = id ?? this.active?.id ?? this.current?.id;
    if (turnId) this.options.onTurnDiagnostic?.(turnId, { recognitionFailure: category === 'worker' ? 'runtime' : category });
    this.options.onDiagnostic?.(category); this.close(); this.options.onFailure();
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.ready = false; clearTimeout(this.deadline);
    this.rejectConnect?.(); this.rejectConnect = undefined; this.resolveConnect = undefined;
    this.queue = []; this.preview = undefined; this.active = undefined; this.current = undefined; this.output = '';
    this.worker?.stdin.destroy(); this.worker?.kill('SIGKILL');
  }
}
export function localTranscriberFactory(options: LocalOptions): TranscriberFactory {
  return callbacks => new LocalTranscriber({ ...options, ...callbacks });
}
