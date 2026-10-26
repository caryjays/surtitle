import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AudioGate, Failure, Glossary, Mode, Segment, Snapshot } from '../../packages/protocol/index.ts';
import { MAX_SEGMENTS, Translation, TurnMeasurement, TranslationDiagnostic, endsInEllipsis, type TurnTrace, type TranslationContext } from '../../packages/protocol/index.ts';
import { TranslationFailure, type Transcriber, type TranscriberFactory, type Translator, type TranscriptEvent } from '../../packages/providers/types.ts';
import { isRepetitiveTranscript } from '../../packages/providers/quality.ts';

type Job = { row: Segment; mode: Mode; context: TranslationContext; epoch: number; queued: number };
export class Controller {
  private sessionId = randomUUID();
  private generation = 0;
  private revision = 0;
  private epoch = 0;
  private mode: Mode = 'auto';
  private capture: Snapshot['capture'] = 'paused';
  private error: Failure | null = null;
  private gate: AudioGate | null = null;
  private rejected = 0;
  private rows: Segment[] = [];
  private nextSequence = 0;
  private rowModes = new WeakMap<Segment, Mode>();
  private traces: TurnTrace[] = [];
  private rowTraces = new WeakMap<Segment, TurnTrace>();
  private queue: Job[] = [];
  private running = new Set<AbortController>();
  private transcriber?: Transcriber;
  private streamToken = 0;
  private lastAudio = 0;
  private started = 0;
  private listeners = new Set<() => void>();
  private clock: ReturnType<typeof setInterval>;
  constructor(private options: {
    transcriber: TranscriberFactory; translator: Translator | null; glossary: Glossary;
    backend: string; processing?: Snapshot['processing']; translationTimeoutMs?: number; queueTtlMs?: number;
    // Local inference has no upstream session lifetime. Cloud ASR keeps its conservative cap.
    sessionLimitMs?: number | null;
  }) {
    this.clock = setInterval(() => {
      if (this.capture === 'active' && Date.now() - this.lastAudio > 5000) this.fail('capture');
      const limit = this.options.sessionLimitMs === undefined ? 25 * 60_000 : this.options.sessionLimitMs;
      if (this.capture === 'active' && limit !== null && Date.now() - this.started > limit) this.fail('session-limit');
    }, 1000);
    this.clock.unref();
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): Snapshot {
    return { type: 'snapshot', sessionId: this.sessionId, generation: this.generation, revision: this.revision,
      mode: this.mode, capture: this.capture, error: this.error, backend: this.options.backend,
      processing: this.options.processing ?? 'cloud-audio-and-text',
      queue: this.queue.length, running: this.running.size, gate: this.gate, rejected: this.rejected, segments: this.rows.map(r => ({ ...r })), sentAt: Date.now(), turns: structuredClone(this.traces), turnTelemetryVersion: 2 };
  }
  private changed() { this.revision++; for (const listener of this.listeners) listener(); }
  private invalidate() {
    this.epoch++; this.generation++;
    this.queue = [];
    for (const abort of this.running) abort.abort();
    this.running.clear(); this.rows = []; this.traces = []; this.error = null; this.gate = null; this.rejected = 0;
  }
  private closeStream() { this.streamToken++; this.transcriber?.close(); this.transcriber = undefined; this.gate = null; }
  async start(mode: Mode) {
    if (this.capture === 'active' || this.capture === 'connecting' || this.capture === 'stopping') return;
    this.closeStream(); this.invalidate(); this.sessionId = randomUUID(); this.mode = mode;
    await this.openStream();
  }
  private async openStream() {
    const token = ++this.streamToken;
    this.capture = 'connecting'; this.changed();
    try {
      const stream = this.options.transcriber({ mode: this.mode,
        onEvent: event => { if (token === this.streamToken) this.transcript(event); },
        onFailure: () => { if (token === this.streamToken) this.fail('transcription'); },
        onTurnDiagnostic: (id, value) => {
          if (token !== this.streamToken) return;
          const row = this.rows.find(row => row.id === id);
          const trace = row && this.trace(row);
          const parsed = TurnMeasurement.safeParse(value);
          if (!trace || row?.final || !parsed.success) return;
          Object.assign(trace, parsed.data);
          if (parsed.data.boundary) trace.outcome = 'committed';
          this.changed();
        },
        onGate: gate => { if (token === this.streamToken) { this.gate = gate; this.changed(); } },
      });
      this.transcriber = stream;
      await stream.connect();
      if (token !== this.streamToken) { stream.close(); return; }
      this.capture = 'active'; this.lastAudio = this.started = Date.now(); this.changed();
    } catch { if (token === this.streamToken) this.fail('transcription'); }
  }
  audio(pcm: Uint8Array) {
    if (this.capture !== 'active') return;
    this.lastAudio = Date.now();
    try { this.transcriber?.audio(pcm); } catch { this.fail('transcription'); }
  }
  setMode(mode: Mode) {
    if (this.capture === 'connecting' || this.capture === 'stopping') return;
    if (mode === this.mode) return;
    if (this.capture === 'active') {
      if (!this.transcriber?.setMode) return;
      try { this.transcriber.setMode(mode); } catch { this.fail('transcription'); return; }
    }
    this.mode = mode; this.changed();
  }
  flush() {
    if (this.capture !== 'active') return;
    try { this.transcriber?.flush?.(); } catch { this.fail('transcription'); }
  }
  calibrate() {
    if (this.capture !== 'active' || !this.transcriber?.calibrate) return;
    // Drop stale/noisy rows, pending translations and context without reloading
    // the model. A pre-calibration turn finishing later has no surviving row.
    this.invalidate();
    try { this.transcriber.calibrate(); } catch { this.fail('transcription'); }
    this.changed();
  }
  async pause() {
    if (this.capture === 'connecting') { this.closeStream(); this.capture = 'paused'; this.changed(); return; }
    if (this.capture !== 'active') return;
    this.capture = 'stopping'; this.changed();
    const token = this.streamToken;
    try { await this.transcriber?.finish(); }
    catch { if (token === this.streamToken) this.fail('transcription'); return; }
    if (token !== this.streamToken) return;
    this.closeStream(); this.capture = 'paused'; this.changed();
  }
  async clear() {
    const active = this.capture === 'active' || this.capture === 'connecting';
    this.closeStream(); this.invalidate(); this.capture = 'paused'; this.changed();
    // Reset upstream audio/context too, so old partials cannot become new captions.
    if (active) await this.openStream();
  }
  newSession() {
    this.closeStream(); this.invalidate(); this.sessionId = randomUUID(); this.capture = 'paused'; this.changed();
  }
  fail(error: Failure) {
    this.closeStream(); this.capture = 'failed'; this.error = error;
    // Preserve originals; incomplete previews must not look final.
    for (const trace of this.traces) if (['capturing', 'committed'].includes(trace.outcome)) trace.outcome = 'capture-failed';
    this.rows = this.rows.filter(r => r.final); this.changed();
  }
  private trace(row: Segment) {
    const trace = this.rowTraces.get(row);
    return trace && this.traces.includes(trace) ? trace : undefined;
  }
  private transcript(event: TranscriptEvent) {
    let row = this.rows.find(r => r.id === event.id);
    if (event.type === 'begin') {
      if (row) return;
      row = { id: event.id, sequence: this.nextSequence++, original: '', final: false,
        translation: null, source: 'unknown', target: 'unknown', state: 'partial', finalizedAt: null, translationMs: null };
      this.rowModes.set(row, event.mode ?? this.mode);
      const trace: TurnTrace = { sequence: row.sequence, mode: event.mode ?? this.mode, outcome: 'capturing' };
      this.rowTraces.set(row, trace); this.traces.push(trace); this.traces = this.traces.slice(-MAX_SEGMENTS);
      this.rows.push(row); this.rows = this.rows.slice(-MAX_SEGMENTS);
    } else {
      if (!row || row.final) return;
      const repeated = isRepetitiveTranscript(event.text);
      const rejected = repeated || (event.type === 'final' && event.rejected);
      const trace = this.trace(row);
      if (event.type === 'final' && trace) {
        trace.recognitionSource = event.language ?? 'unknown';
        trace.controllerRepetitionRejected = repeated;
        trace.recognitionClipped = Boolean(trace.recognitionClipped || event.text.length > 4000);
        trace.originalEndsInEllipsis = endsInEllipsis(event.text.slice(0, 4000));
        trace.outcome = rejected ? 'rejected' : !event.text.trim() ? 'empty' : !this.options.translator ? 'original' : 'translating';
      }
      row.original = rejected ? '' : event.text.slice(0, 4000);
      if (event.type === 'final' && rejected) {
        this.rejected++; this.rows = this.rows.filter(r => r !== row); this.changed(); return;
      }
      if (event.type === 'final') {
        row.final = true; row.finalizedAt = Date.now(); row.state = 'pending';
        row.source = event.language ?? 'unknown';
        if (!row.original.trim()) { this.rows = this.rows.filter(r => r !== row); }
        else if (!this.options.translator) row.state = 'original';
        else if (this.queue.length >= 8) {
          row.state = 'skipped'; this.error = 'overload';
          if (trace) { trace.outcome = 'skipped'; trace.translationFailure = 'queue-full'; }
        }
        else {
          // Snapshot ONLY earlier finalized rows at commit time. Never include future
          // turns or let later translations mutate an already queued request's context.
          const preceding = this.rows.filter(r => r.final && r.sequence < row!.sequence).slice(-4);
          if (trace) {
            trace.contextSequences = preceding.map(r => r.sequence);
            trace.contextMissingTranslations = preceding.filter(r => !r.translation).length;
            trace.contextClippedRows = preceding.filter(r => r.original.length > 800 || (r.translation?.length ?? 0) > 800).length;
          }
          const context = preceding.map(r => ({
            original: r.original.slice(0, 800), translation: r.translation?.slice(0, 800) ?? null, source: r.source,
          }));
          this.queue.push({ row, mode: this.rowModes.get(row) ?? this.mode, context, epoch: this.epoch, queued: performance.now() });
        }
      }
    }
    this.changed(); this.pump();
  }
  private pump() {
    while (this.running.size < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      if (performance.now() - job.queued > (this.options.queueTtlMs ?? 8000) || !this.rows.includes(job.row)) {
        job.row.state = 'skipped';
        const trace = this.trace(job.row);
        if (trace) { trace.outcome = 'skipped'; trace.translationFailure = 'queue-expired'; }
        this.changed(); continue;
      }
      const abort = new AbortController(); this.running.add(abort); this.changed();
      void this.translate(job, abort);
    }
  }
  private async translate(job: Job, abort: AbortController) {
    const start = performance.now();
    const trace = this.trace(job.row);
    if (trace) trace.translationQueueMs = Math.round(start - job.queued);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        abort.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        timer = setTimeout(() => abort.abort(), this.options.translationTimeoutMs ?? 12_000);
      });
      const result = Translation.parse(await Promise.race([
        this.options.translator!.translate({ text: job.row.original, mode: job.mode, glossary: this.options.glossary,
          sourceLanguage: job.row.source, context: job.context }, abort.signal, value => {
            const diagnostic = TranslationDiagnostic.safeParse(value);
            if (!trace || abort.signal.aborted || job.epoch !== this.epoch || !this.traces.includes(trace) || !diagnostic.success) return;
            trace.translationResponse = diagnostic.data.response;
            if (diagnostic.data.outputTokenLimitReached !== undefined) trace.outputTokenLimitReached = diagnostic.data.outputTokenLimitReached;
          }), cancelled,
      ]));
      if (job.mode !== 'auto' && (result.source !== (job.mode === 'en-ja' ? 'en' : 'ja') || result.target !== (job.mode === 'en-ja' ? 'ja' : 'en'))) throw new Error('direction');
      if (job.epoch !== this.epoch || !this.rows.includes(job.row)) return;
      Object.assign(job.row, { translation: result.text || null, source: result.source, target: result.target,
        state: result.source === 'unknown' ? 'unresolved' : 'ready', translationMs: Math.round(performance.now() - start) });
      if (trace && this.traces.includes(trace)) {
        trace.outcome = result.source === 'unknown' ? 'unresolved' : 'ready';
        trace.translationMs = job.row.translationMs!;
        trace.translationEndsInEllipsis = endsInEllipsis(result.text);
      }
      if (this.error?.startsWith('translation')) this.error = null;
    } catch (error) {
      if (job.epoch === this.epoch && this.rows.includes(job.row)) {
        job.row.state = 'failed'; this.error = error instanceof TranslationFailure ? error.category : 'translation';
        if (trace && this.traces.includes(trace)) {
          trace.outcome = 'failed'; trace.translationMs = Math.round(performance.now() - start);
          trace.translationFailure = abort.signal.aborted ? 'timeout' : 'request-error';
        }
      }
    } finally {
      clearTimeout(timer); this.running.delete(abort);
      if (job.epoch === this.epoch) { this.changed(); this.pump(); }
    }
  }
  dispose() { clearInterval(this.clock); this.closeStream(); this.invalidate(); this.listeners.clear(); }
}
