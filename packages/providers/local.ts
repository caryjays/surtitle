import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { TurnMeasurement, RecognitionQuality as Quality, type Boundary, type Mode, type Glossary } from '../protocol/index.ts';
import type { Transcriber, TranscriberFactory } from './types.ts';
import { TurnDetector } from './turns.ts';
import { isRepetitiveTranscript } from './quality.ts';
import { ROLLING, endsSentence, hypothesis, isStockPhrase, joinText, lockCount, stablePrefix, type WorkerSegment } from './rolling.ts';

const Reply = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('error') }).strict(),
  z.object({ type: z.literal('final'), id: z.string().uuid(), text: z.string().max(4000),
    language: z.enum(['en', 'ja', 'unknown']), inferenceMs: z.number().nonnegative().max(60_000), rejected: z.boolean().optional(),
    // Where each accepted Whisper segment ends within the request's audio, for rolling segmentation.
    segments: z.array(z.object({ endMs: z.number().int().min(0).max(30_000), text: z.string().max(4000) }).strict()).max(64).optional(),
    measurement: TurnMeasurement.pick({ recognitionLanguage: true, recognitionClipped: true, quality: true }).optional() }).strict(),
]);
export type LocalOptions = {
  model: 'small-q4' | 'turbo-q4'; python?: string; maxTurnMs?: number;
  // rolling: re-decode the open stretch about every second and lock text two decodes agree on. See rolling.ts.
  segmentation?: 'turns' | 'rolling';
  previewIntervalMs?: number; glossary?: Glossary; calibrationMs?: number;
  startupTimeoutMs?: number; inferenceTimeoutMs?: number;
  workerFactory?: () => ChildProcessWithoutNullStreams;
  onDiagnostic?: (category: 'worker' | 'protocol' | 'startup-timeout' | 'inference-timeout' | 'queue-expired') => void;
  onTiming?: (timing: { id: string; audioMs: number; queueMs: number; inferenceMs: number; commitToFinalMs: number }) => void;
};
type Job = { id: string; requestId: string; kind: 'preview' | 'final' | 'roll' | 'close'; language: 'en' | 'ja' | null;
  audio: Buffer; queued: number; sent?: number;
  // Rolling jobs: the stretch and row they decode for, and the closing boundary.
  stretch?: Stretch; row?: Row; detail?: { boundary: Boundary; trailingQuietMs: number } };
// A caption row in rolling mode: locked text only grows. Its begin event waits for its first locked text.
type Row = { id: string; begun: boolean; text: string; audioMs: number; language: 'en' | 'ja' | null; created: number;
  decodes: number; forced: number; lags: number[]; firstTextMs?: number; quality?: RecognitionQuality };
// One stretch of speech between energy-detector boundaries; audio holds what is not locked yet.
type Stretch = { audio: Buffer[]; windowMs: number; sinceRequestMs: number; previous: string; row: Row };
type RecognitionQuality = z.infer<typeof Quality>;
const BYTES_PER_MS = 48;
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
  private stretch?: Stretch;
  private queue: Job[] = [];
  private active?: Job;
  private deadline?: ReturnType<typeof setTimeout>;
  private resolveConnect?: () => void;
  private rejectConnect?: () => void;
  private detector: TurnDetector;
  constructor(private options: LocalOptions & Parameters<TranscriberFactory>[0]) {
    const rolling = options.segmentation === 'rolling';
    this.detector = new TurnDetector(rolling ? {
      begin: () => { this.stretch = { audio: [], windowMs: 0, sinceRequestMs: 0, previous: '', row: this.row() }; },
      append: pcm => {
        if (!this.stretch) return;
        this.stretch.audio.push(Buffer.from(pcm));
        this.stretch.windowMs += pcm.byteLength / BYTES_PER_MS; this.stretch.sinceRequestMs += pcm.byteLength / BYTES_PER_MS;
      },
      commit: detail => {
        const stretch = this.stretch;
        if (!stretch) return;
        if (this.queue.length >= 2) throw new Error('Local inference backlog');
        // A decode still in flight for this stretch is superseded: the closing decode covers its audio and locks all of it.
        this.queue.push({ id: stretch.row.id, requestId: randomUUID(), kind: 'close', language: stretch.row.language,
          audio: this.window(stretch), queued: performance.now(), row: stretch.row,
          detail: { boundary: detail.boundary, trailingQuietMs: detail.trailingQuietMs } });
        this.stretch = undefined; this.preview = undefined; this.pump();
      },
    } : {
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
    }, { maxTurnMs: rolling ? null : options.maxTurnMs ?? 12_000, calibrationMs: options.calibrationMs });
  }
  private row(): Row {
    return { id: randomUUID(), begun: false, text: '', audioMs: 0, created: performance.now(), decodes: 0, forced: 0, lags: [],
      language: this.options.mode === 'auto' ? null : this.options.mode === 'en-ja' ? 'en' : 'ja' };
  }
  // The unlocked audio as one buffer, capped below Whisper's 30 s input.
  private window(stretch: Stretch) {
    const audio = Buffer.concat(stretch.audio);
    stretch.audio = [audio];
    return audio.subarray(0, ROLLING.maxWindowMs * BYTES_PER_MS);
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
    if (job.kind === 'roll' || job.kind === 'close') {
      this.rolled(job, message, rejected, repeated); this.pump(); return;
    }
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
  private rolled(job: Job, message: Extract<z.infer<typeof Reply>, { type: 'final' }>, rejected: boolean, repeated: boolean) {
    const stretch = job.stretch;
    if (job.kind === 'roll' && (!stretch || stretch !== this.stretch)) return; // superseded by the closing decode
    const row = job.kind === 'close' ? job.row! : stretch!.row;
    const windowMs = job.audio.length / BYTES_PER_MS;
    row.decodes++; row.quality = mergeQuality(row.quality, message.measurement?.quality);
    if (!row.language && (message.language === 'en' || message.language === 'ja')) row.language = message.language; // Auto: once per row
    const segments: WorkerSegment[] = rejected ? [] : message.segments ?? [];
    if (job.kind === 'close') {
      // Everything left locks. An older worker without segments still returns its text.
      row.text = joinText(row.text, rejected ? '' : message.segments ? segments.map(s => s.text).join('') : message.text);
      row.audioMs += windowMs;
      this.closeRow(row, job.detail!.boundary, { trailingQuietMs: job.detail!.trailingQuietMs,
        recognitionQueueMs: Math.round(job.sent! - job.queued), recognitionInferenceMs: message.inferenceMs,
        commitToFinalMs: Math.round(performance.now() - job.queued), adapterRepetitionRejected: repeated,
        ...(message.measurement?.recognitionLanguage ? { recognitionLanguage: message.measurement.recognitionLanguage } : {}),
      }, rejected);
      this.options.onTiming?.({ id: row.id, audioMs: row.audioMs, queueMs: job.sent! - job.queued,
        inferenceMs: message.inferenceMs, commitToFinalMs: performance.now() - job.queued });
      return;
    }
    const current = hypothesis(segments);
    const { count, forced } = lockCount(segments, stablePrefix(stretch!.previous, current), windowMs, false);
    if (count) {
      const locked = segments.slice(0, count);
      const endMs = locked.at(-1)!.endMs;
      stretch!.previous = current.slice(hypothesis(locked).length).trimStart();
      // Replies arrive in order and only replies trim, so the request's window still starts where this stretch's does.
      stretch!.audio = [Buffer.concat(stretch!.audio).subarray(endMs * BYTES_PER_MS)];
      stretch!.windowMs -= endMs;
      row.text = joinText(row.text, locked.map(s => s.text).join(''));
      row.audioMs += endMs; row.forced += Number(forced);
      row.lags.push(windowMs - endMs + performance.now() - job.queued);
      this.rowText(row);
      if (row.audioMs >= ROLLING.maxRowMs || (row.audioMs >= ROLLING.sentenceRowMs && endsSentence(row.text))) {
        this.closeRow(row, 'length', {}, false);
        stretch!.row = this.row();
      }
    } else if (!segments.length && windowMs > ROLLING.noiseMs) {
      // Noise held the gate open: keep only the last second, and in Auto relearn the language.
      const dropMs = windowMs - ROLLING.keepMs;
      stretch!.audio = [Buffer.concat(stretch!.audio).subarray(dropMs * BYTES_PER_MS)];
      stretch!.windowMs -= dropMs; stretch!.previous = '';
      if (!row.text && this.options.mode === 'auto') row.language = null;
    } else {
      stretch!.previous = current;
    }
  }
  private rowText(row: Row) {
    if (!row.begun) {
      row.begun = true;
      this.options.onEvent({ type: 'begin', id: row.id, sequence: this.sequence++, mode: this.options.mode });
    }
    row.firstTextMs ??= performance.now() - row.created;
    if (row.text) this.options.onEvent({ type: 'partial', id: row.id, text: row.text });
  }
  private closeRow(row: Row, boundary: Boundary, extra: TurnMeasurement, rejected: boolean) {
    // A whole row of stock sign-off from long audio replaced real speech.
    const stock = row.audioMs >= ROLLING.stockMs && isStockPhrase(row.text);
    if (!row.begun) { row.begun = true; this.options.onEvent({ type: 'begin', id: row.id, sequence: this.sequence++, mode: this.options.mode }); }
    if (row.text.trim()) row.firstTextMs ??= performance.now() - row.created;
    const lags = [...row.lags].sort((a, b) => a - b);
    const quality = row.quality && stock ? { ...row.quality, stockPhraseDrops: Math.min(10_000, row.quality.stockPhraseDrops + 1) } : row.quality;
    this.options.onTurnDiagnostic?.(row.id, { boundary, audioMs: Math.min(120_000, Math.round(row.audioMs)), ...extra,
      decodes: row.decodes, forcedLocks: row.forced,
      ...(row.firstTextMs !== undefined ? { firstTextMs: Math.min(120_000, Math.round(row.firstTextMs)) } : {}),
      ...(lags.length ? { lockLagMs: Math.min(120_000, Math.round(lags[Math.floor((lags.length - 1) / 2)]!)) } : {}),
      ...(quality ? { quality } : {}) });
    const empty = stock || !row.text.trim();
    this.options.onEvent({ type: 'final', id: row.id, text: stock ? '' : row.text, language: row.language ?? 'unknown',
      ...((empty && rejected) || stock ? { rejected: true } : {}) });
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
    const stretch = this.stretch;
    if (stretch && stretch.sinceRequestMs >= ROLLING.intervalMs && stretch.windowMs >= ROLLING.minWindowMs
      && !this.active && !this.queue.length && !this.preview) {
      // Backpressure: a slow decode delays the next request rather than queueing more.
      stretch.sinceRequestMs = 0;
      this.preview = { id: stretch.row.id, requestId: randomUUID(), kind: 'roll', language: stretch.row.language,
        audio: this.window(stretch), queued: performance.now(), stretch };
      this.pump();
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
    const turnId = id ?? this.active?.id ?? this.current?.id ?? this.stretch?.row.id;
    if (turnId) this.options.onTurnDiagnostic?.(turnId, { recognitionFailure: category === 'worker' ? 'runtime' : category });
    this.options.onDiagnostic?.(category); this.close(); this.options.onFailure();
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.ready = false; clearTimeout(this.deadline);
    this.rejectConnect?.(); this.rejectConnect = undefined; this.resolveConnect = undefined;
    this.queue = []; this.preview = undefined; this.active = undefined; this.current = undefined; this.stretch = undefined; this.output = '';
    this.worker?.stdin.destroy(); this.worker?.kill('SIGKILL');
  }
}
// Quality over a row's decodes: counters add, extremes combine.
function mergeQuality(a: RecognitionQuality | undefined, b: RecognitionQuality | undefined): RecognitionQuality | undefined {
  if (!a || !b) return a ?? b;
  const add = (x: number, y: number) => Math.min(10_000, x + y);
  const extreme = (x: number | null, y: number | null, pick: (...v: number[]) => number) => x === null ? y : y === null ? x : pick(x, y);
  return { speechGateRejected: a.speechGateRejected || b.speechGateRejected,
    decodedSegments: add(a.decodedSegments, b.decodedSegments), droppedSegments: add(a.droppedSegments, b.droppedSegments),
    noSpeechDrops: add(a.noSpeechDrops, b.noSpeechDrops), lowConfidenceDrops: add(a.lowConfidenceDrops, b.lowConfidenceDrops),
    repetitionDrops: add(a.repetitionDrops, b.repetitionDrops), stockPhraseDrops: add(a.stockPhraseDrops, b.stockPhraseDrops),
    invalidScoreDrops: add(a.invalidScoreDrops, b.invalidScoreDrops),
    noSpeechMax: extreme(a.noSpeechMax, b.noSpeechMax, Math.max), logprobMin: extreme(a.logprobMin, b.logprobMin, Math.min) };
}
export function localTranscriberFactory(options: LocalOptions): TranscriberFactory {
  return callbacks => new LocalTranscriber({ ...options, ...callbacks });
}
