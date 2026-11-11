import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { DEFAULT_PAIR, Source, TurnMeasurement, RecognitionQuality as Quality, direction, inPair, profile, type Boundary, type Language, type Mode, type Glossary } from '../protocol/index.ts';
import type { Transcriber, TranscriberFactory } from './types.ts';
import { TurnDetector } from './turns.ts';
import { isRepetitiveTranscript } from './quality.ts';
import { ROLLING, endsSentence, hypothesis, isStockPhrase, joinText, lockCount, stablePrefix, type WorkerSegment } from './rolling.ts';

const Reply = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('error') }).strict(),
  z.object({ type: z.literal('final'), id: z.string().uuid(), text: z.string().max(4000),
    language: Source, inferenceMs: z.number().nonnegative().max(60_000), rejected: z.boolean().optional(),
    // Where each accepted Whisper segment ends within the request's audio, for rolling segmentation.
    segments: z.array(z.object({ endMs: z.number().int().min(0).max(30_000), text: z.string().max(4000) }).strict()).max(64).optional(),
    measurement: TurnMeasurement.pick({ recognitionLanguage: true, recognitionClipped: true, quality: true }).optional() }).strict(),
]);
export type LocalOptions = {
  model: 'small-q4' | 'turbo-q4'; python?: string; maxTurnMs?: number;
  // rolling: re-decode the open stretch about every second and lock text two decodes agree on. See rolling.ts.
  segmentation?: 'turns' | 'rolling';
  // Rolling row closing, for experiments; the live service keeps the defaults in ROLLING. clauseMs null: never at a clause.
  rows?: { sentenceMs: number; maxMs: number; clauseMs: number | null };
  // Rolling decode cadence, for experiments, defaults in ROLLING: new audio between decodes, and how long a segment must end
  // before the newest audio to lock.
  cadence?: { intervalMs: number; settleMs: number };
  previewIntervalMs?: number; glossary?: Glossary; calibrationMs?: number;
  startupTimeoutMs?: number; inferenceTimeoutMs?: number;
  workerFactory?: () => ChildProcessWithoutNullStreams;
  onDiagnostic?: (category: 'worker' | 'protocol' | 'startup-timeout' | 'inference-timeout' | 'queue-expired') => void;
  onTiming?: (timing: { id: string; audioMs: number; queueMs: number; inferenceMs: number; commitToFinalMs: number }) => void;
};
type Job = { id: string; requestId: string; kind: 'preview' | 'final' | 'roll' | 'close'; language: Language | null;
  audio: Buffer; queued: number; sent?: number;
  // Set by a recalibration while the decode is in flight: its reply is read and ignored.
  dropped?: boolean;
  // Rolling jobs: the stretch and row they decode for, and the closing boundary.
  stretch?: Stretch; row?: Row; detail?: { boundary: Boundary; trailingQuietMs: number } };
// A caption row in rolling mode: locked text only grows. Its begin event waits for its first locked text, so the row keeps
// the mode it was heard in; the mode can change before that event.
type Row = { id: string; mode: Mode; begun: boolean; text: string; audioMs: number; language: Language | null; created: number;
  level: Level;
  decodes: number; forced: number; lags: number[]; firstTextMs?: number; quality?: RecognitionQuality; afterNoise?: boolean;
  // The last partial sent: locked text plus the unlocked tail.
  shown?: string;
  // Decodes outside the pair that locked nothing: in a row, and since the last decode in the pair. marked: this stretch
  // already showed a marker for speech outside the pair, so the row shows no other.
  otherRun: number; otherDrops: number; marked?: boolean };
// One stretch of speech between energy-detector boundaries; audio holds what is not locked yet.
type Stretch = { audio: Buffer[]; windowMs: number; sinceRequestMs: number; previous: string; row: Row };
type RecognitionQuality = z.infer<typeof Quality>;
const BYTES_PER_MS = 48;
// Input level over a turn's or row's PCM16 frames, for diagnostics only.
type Level = { squares: number; samples: number; peak: number };
function measure(level: Level, pcm: Uint8Array) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let i = 0; i + 1 < pcm.byteLength; i += 2) {
    const value = view.getInt16(i, true) / 32768;
    level.squares += value * value; level.peak = Math.max(level.peak, Math.abs(value));
  }
  level.samples += pcm.byteLength >> 1;
}
function levels(level: Level): Pick<TurnMeasurement, 'inputRms' | 'inputPeak'> {
  const round = (value: number) => Math.min(1, Math.round(value * 10_000) / 10_000);
  return level.samples ? { inputRms: round(Math.sqrt(level.squares / level.samples)), inputPeak: round(level.peak) } : {};
}
export class LocalTranscriber implements Transcriber {
  private worker?: ChildProcessWithoutNullStreams;
  private closed = false;
  private ready = false;
  private output = '';
  private sequence = 0;
  private gateFrames = 0;
  private current?: { id: string; frames: Buffer[]; language: Language | null; level: Level;
    lastPreviewMs: number; hypothesis: string; stable: string };
  private preview?: Job;
  private stretch?: Stretch;
  private queue: Job[] = [];
  private active?: Job;
  private deadline?: ReturnType<typeof setTimeout>;
  private resolveConnect?: () => void;
  private rejectConnect?: () => void;
  private detector: TurnDetector;
  private pair: readonly [Language, Language];
  private sentenceEnds: string;
  private clauseEnds: string;
  private rows: { sentenceMs: number; maxMs: number; clauseMs: number | null };
  private cadence: { intervalMs: number; settleMs: number };
  constructor(private options: LocalOptions & Parameters<TranscriberFactory>[0]) {
    this.pair = options.pair ?? DEFAULT_PAIR;
    this.sentenceEnds = this.pair.map(language => profile(language).sentenceEnd).join('');
    this.clauseEnds = this.pair.map(language => profile(language).clauseEnd).join('');
    this.rows = options.rows ?? { sentenceMs: ROLLING.sentenceRowMs, maxMs: ROLLING.maxRowMs, clauseMs: null };
    this.cadence = options.cadence ?? { intervalMs: ROLLING.intervalMs, settleMs: ROLLING.settleMs };
    const rolling = options.segmentation === 'rolling';
    this.detector = new TurnDetector(rolling ? {
      begin: () => { this.stretch = { audio: [], windowMs: 0, sinceRequestMs: 0, previous: '', row: this.row() }; },
      append: pcm => {
        if (!this.stretch) return;
        this.stretch.audio.push(Buffer.from(pcm)); measure(this.stretch.row.level, pcm);
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
        this.current = { id: randomUUID(), frames: [], level: { squares: 0, samples: 0, peak: 0 },
          language: direction(options.mode)?.source ?? null,
          lastPreviewMs: 0, hypothesis: '', stable: '' };
        options.onEvent({ type: 'begin', id: this.current.id, sequence: this.sequence++, mode: options.mode });
      },
      append: pcm => { if (this.current) { this.current.frames.push(Buffer.from(pcm)); measure(this.current.level, pcm); } },
      commit: detail => {
        if (!this.current) return;
        options.onTurnDiagnostic?.(this.current.id, { ...detail, ...levels(this.current.level) });
        if (this.queue.length >= 2) throw new Error('Local inference backlog');
        this.queue.push({ id: this.current.id, requestId: this.current.id, kind: 'final', language: this.current.language,
          audio: Buffer.concat(this.current.frames), queued: performance.now() });
        this.current = undefined; this.preview = undefined; this.pump();
      },
    }, { maxTurnMs: rolling ? null : options.maxTurnMs ?? 12_000, calibrationMs: options.calibrationMs,
      ...(options.gateThreshold !== undefined ? { threshold: options.gateThreshold } : {}) });
  }
  private row(): Row {
    const mode = this.options.mode;
    return { id: randomUUID(), mode, level: { squares: 0, samples: 0, peak: 0 }, begun: false, text: '', audioMs: 0, created: performance.now(), decodes: 0, forced: 0, lags: [],
      otherRun: 0, otherDrops: 0,
      language: direction(mode)?.source ?? null };
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
    if (job.dropped) { this.pump(); return; }
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
    // A lock after a noise trim needs a confident decode; a reply without confidence is not one.
    const unconfirmed = row.afterNoise === true
      && !((message.measurement?.quality?.logprobMin ?? -Infinity) >= ROLLING.noiseConfirmLogprob);
    // Auto, before the row has a language: a decode detected outside the pair locks nothing and is handled as wholly
    // filtered, so third-language speech never displays and a misdetected pair-language window is decoded again.
    const otherLanguage = !row.language && !inPair(this.pair, message.language);
    if (otherLanguage && !rejected && message.segments?.length) {
      row.otherRun++; row.otherDrops++;
      if (row.quality) row.quality = { ...row.quality, otherLanguageDrops: Math.min(10_000, (row.quality.otherLanguageDrops ?? 0) + 1) };
    } else if (!rejected && message.segments?.length) row.otherRun = 0;
    const segments: WorkerSegment[] = rejected || otherLanguage || (unconfirmed && job.kind === 'close') ? [] : message.segments ?? [];
    // Auto: once per row, from the decode whose text locks first; the closing decode locks all it returns. A short opening
    // misheard as the other language can pass the filters once, and keeping that language would force it on every later decode.
    const settle = () => { if (!row.language && inPair(this.pair, message.language)) row.language = message.language; };
    if (job.kind === 'close') {
      if (segments.length) settle();
      // Everything left locks. An older worker without segments still returns its text.
      row.text = joinText(row.text, rejected || unconfirmed || otherLanguage ? '' : message.segments ? segments.map(s => s.text).join('') : message.text);
      row.audioMs += windowMs;
      // Speech that shows nothing leaves a marker instead: speech outside the pair, or speech the filters rejected. Not
      // for non-speech, nor after a noise trim without a confident decode.
      const quality = message.measurement?.quality;
      const filtered = rejected && quality && !quality.speechGateRejected && !unconfirmed
        && (repeated || quality.repetitionDrops + quality.lowConfidenceDrops + quality.stockPhraseDrops > 0);
      const uncaptioned = row.marked ? undefined : row.otherDrops ? 'language' as const : filtered ? 'filtered' as const : undefined;
      this.closeRow(row, job.detail!.boundary, { trailingQuietMs: job.detail!.trailingQuietMs,
        recognitionQueueMs: Math.round(job.sent! - job.queued), recognitionInferenceMs: message.inferenceMs,
        commitToFinalMs: Math.round(performance.now() - job.queued), adapterRepetitionRejected: repeated,
        ...(message.measurement?.recognitionLanguage ? { recognitionLanguage: message.measurement.recognitionLanguage } : {}),
      }, rejected || unconfirmed || otherLanguage, uncaptioned);
      this.options.onTiming?.({ id: row.id, audioMs: row.audioMs, queueMs: job.sent! - job.queued,
        inferenceMs: message.inferenceMs, commitToFinalMs: performance.now() - job.queued });
      return;
    }
    const current = hypothesis(segments);
    const locks = lockCount(segments, stablePrefix(stretch!.previous, current), windowMs, false, this.cadence.settleMs);
    const { count, forced } = unconfirmed ? { count: 0, forced: false } : locks;
    if (count) {
      settle();
      row.afterNoise = false;
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
      const rules = this.rows;
      if (row.audioMs >= rules.maxMs || (row.audioMs >= rules.sentenceMs && endsSentence(row.text, this.sentenceEnds))
        || (rules.clauseMs !== null && row.audioMs >= rules.clauseMs && endsSentence(row.text, this.clauseEnds))) {
        this.closeRow(row, 'length', {}, false);
        stretch!.row = this.row();
      }
    } else if (otherLanguage && !rejected && message.segments?.length && stretch!.previous && windowMs < ROLLING.forceMs) {
      // Text outside the pair between two decodes is evidence against them, not a gap to skip: on noise, Auto alternates
      // a stock word in a pair language with text in another, and skipping the second let the first agree with itself.
      stretch!.previous = '';
    } else if (!segments.length && stretch!.previous && windowMs < ROLLING.forceMs) {
      // One wholly filtered decode, such as a repetition loop, inside text the previous decode returned: skip it, so the
      // decodes on either side can still agree, rather than trim the unlocked speech.
    } else if (!segments.length && windowMs > ROLLING.noiseMs) {
      // Noise held the gate open: keep only the last second, and in Auto relearn the language.
      const dropMs = windowMs - ROLLING.keepMs;
      stretch!.audio = [Buffer.concat(stretch!.audio).subarray(dropMs * BYTES_PER_MS)];
      stretch!.windowMs -= dropMs; stretch!.previous = ''; row.afterNoise = true;
      if (!row.text && row.mode === 'auto') row.language = null;
    } else {
      stretch!.previous = current;
    }
    if (row === stretch!.row && !row.text && !row.marked && row.otherRun >= ROLLING.otherMarkDecodes) {
      // Sustained speech outside the pair: close the row now as a marker rather than leave the display empty until the
      // stretch ends. The stretch continues in a row that shows no second marker.
      this.closeRow(row, 'length', {}, true, 'language');
      stretch!.row = { ...this.row(), marked: true, ...(row.afterNoise ? { afterNoise: true } : {}) };
    }
    this.partial(stretch!.row, stretch!.previous);
  }
  private rowText(row: Row) {
    if (!row.begun) {
      row.begun = true;
      this.options.onEvent({ type: 'begin', id: row.id, sequence: this.sequence++, mode: row.mode });
    }
    row.firstTextMs ??= performance.now() - row.created;
  }
  // Locked text plus the unlocked tail, for the operator's view; displays reveal only the first `stable` characters.
  // A row shows a tail only once it has locked text, and not while a noise trim waits for a confident decode.
  private partial(row: Row, tail: string) {
    if (!row.begun || !row.text) return;
    const text = row.afterNoise ? row.text : joinText(row.text, tail);
    if (text === row.shown) return;
    row.shown = text;
    this.options.onEvent({ type: 'partial', id: row.id, text, stable: row.text.length,
      locked: { audioMs: Math.round(row.audioMs), lagMs: Math.round(row.lags.at(-1) ?? 0), language: row.language ?? 'unknown' } });
  }
  private closeRow(row: Row, boundary: Boundary, extra: TurnMeasurement, rejected: boolean, uncaptioned?: 'language' | 'filtered') {
    // A whole row of stock sign-off from long audio replaced real speech.
    const stock = row.audioMs >= ROLLING.stockMs && isStockPhrase(row.text);
    if (!row.begun) { row.begun = true; this.options.onEvent({ type: 'begin', id: row.id, sequence: this.sequence++, mode: row.mode }); }
    if (row.text.trim()) row.firstTextMs ??= performance.now() - row.created;
    // A closing decode: the trailing quiet plus the decode. A length close: the lock that closed it.
    const speechEnd = extra.commitToFinalMs !== undefined ? (extra.trailingQuietMs ?? 0) + extra.commitToFinalMs : row.lags.at(-1);
    const lags = [...row.lags].sort((a, b) => a - b);
    const quality = row.quality && stock ? { ...row.quality, stockPhraseDrops: Math.min(10_000, row.quality.stockPhraseDrops + 1) } : row.quality;
    this.options.onTurnDiagnostic?.(row.id, { boundary, audioMs: Math.min(120_000, Math.round(row.audioMs)), ...levels(row.level), ...extra,
      decodes: row.decodes, forcedLocks: row.forced,
      ...(row.firstTextMs !== undefined ? { firstTextMs: Math.min(120_000, Math.round(row.firstTextMs)) } : {}),
      ...(lags.length ? { lockLagMs: Math.min(120_000, Math.round(lags[Math.floor((lags.length - 1) / 2)]!)) } : {}),
      ...(speechEnd !== undefined ? { speechEndToFinalMs: Math.min(120_000, Math.round(speechEnd)) } : {}),
      ...(quality ? { quality } : {}) });
    const empty = stock || !row.text.trim();
    const reason = stock && !row.marked ? 'filtered' : uncaptioned;
    this.options.onEvent({ type: 'final', id: row.id, text: stock ? '' : row.text, language: row.language ?? 'unknown',
      ...((empty && rejected) || stock ? { rejected: true, ...(reason ? { uncaptioned: reason } : {}) } : {}) });
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
    // Rolling Auto: with the pair, the worker decodes misheard pair speech again in the pair; see packages/providers/rolling.ts.
    const pair = this.options.segmentation === 'rolling' && !job.language ? { pair: [...this.pair] } : {};
    this.worker!.stdin.write(JSON.stringify({ id: job.requestId, audio: job.audio.toString('base64'),
      language: job.language, ...(prompt ? { prompt } : {}), ...pair }) + '\n');
  }
  audio(pcm: Uint8Array) {
    if (!this.ready || this.closed) return;
    const previousState = this.detector.status().state;
    this.detector.push(pcm);
    if (this.options.calibrationMs && (++this.gateFrames % 5 === 0 || previousState !== this.detector.status().state)) {
      this.options.onGate?.(this.detector.status());
    }
    const stretch = this.stretch;
    if (stretch && stretch.sinceRequestMs >= this.cadence.intervalMs && stretch.windowMs >= ROLLING.minWindowMs
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
  // Audio heard before a recalibration never becomes text: the open turn or stretch and the queued decodes are dropped and
  // the reply to a decode in flight is ignored, so no event follows for them. The worker and its model stay.
  calibrate() {
    this.current = undefined; this.stretch = undefined; this.queue = []; this.preview = undefined;
    if (this.active) this.active.dropped = true;
    this.detector.finish('recalibration'); this.detector.calibrate(); this.options.onGate?.(this.detector.status());
  }
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
    noSpeechMax: extreme(a.noSpeechMax, b.noSpeechMax, Math.max), logprobMin: extreme(a.logprobMin, b.logprobMin, Math.min),
    ...(a.pairRetries !== undefined || b.pairRetries !== undefined ? { pairRetries: add(a.pairRetries ?? 0, b.pairRetries ?? 0) } : {}),
    ...(a.otherLanguageDrops !== undefined || b.otherLanguageDrops !== undefined
      ? { otherLanguageDrops: add(a.otherLanguageDrops ?? 0, b.otherLanguageDrops ?? 0) } : {}) };
}
export function localTranscriberFactory(options: LocalOptions): TranscriberFactory {
  return callbacks => new LocalTranscriber({ ...options, ...callbacks });
}
