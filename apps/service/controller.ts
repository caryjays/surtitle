import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AudioGate, Failure, Glossary, Mode, Segment, Segmentation, Snapshot } from '../../packages/protocol/index.ts';
import { DEFAULT_PAIR, MAX_SEGMENTS, Translation, direction, inPair, modes, profile, type Pair, type Source, TurnMeasurement, TranslationDiagnostic, endsInEllipsis, type TurnTrace, type TranslationContext, type TranslationInput } from '../../packages/protocol/index.ts';
import { TranslationFailure, type PartialTranslation, type Transcriber, type TranscriberFactory, type Translator, type TranscriptEvent } from '../../packages/providers/types.ts';
import { isRepetitiveTranscript } from '../../packages/providers/quality.ts';
import { endsSentence } from '../../packages/providers/rolling.ts';

// Automatic recognizer restarts: at most this many within the window, then capture fails and waits for the operator.
const RESTART = { max: 2, windowMs: 5 * 60_000 };

// piece: a request for locked text of the row, the rest of the row when last. Its text and context are taken when it is sent.
type Job = { row: Segment; mode: Mode; context: TranslationContext; epoch: number; queued: number; piece?: { last: boolean } };
// Piece translation, rolling only: an open row's locked text is translated in pieces, each appended to the row's
// translation and never rewritten. Design: docs/log/2026-11-09-piece-translation-design.md.
// A piece is cut while no request runs, once it holds minMs of locked audio and ends at a clause or sentence mark, or holds maxMs.
export const PIECE = { minMs: 1500, maxMs: 4000 };
type Pieces = {
  // Characters of the original and locked audio sent so far; a failed piece moves them back so the next piece retries its text,
  // once more text has locked (retryAfterMs).
  cut: number; cutMs: number; retryAfterMs?: number; parts: { original: string; translation: string }[];
  // The latest lock: locked characters and audio, and when that audio's end was heard.
  stable: number; lockedMs: number; heardAt: number; language: Source;
  // The direction and target of the first translated piece; later pieces of the row keep them.
  direction?: Mode; target?: Source };
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
  // Rows before this sequence were finalized before a recalibration and are not translation context.
  private contextFloor = 0;
  private rowModes = new WeakMap<Segment, Mode>();
  private traces: TurnTrace[] = [];
  private rowTraces = new WeakMap<Segment, TurnTrace>();
  private rowPieces = new WeakMap<Segment, Pieces>();
  private queue: Job[] = [];
  private running = new Set<AbortController>();
  private transcriber?: Transcriber;
  private restarts = 0;
  private restartTimes: number[] = [];
  private restarting = false;
  private streamToken = 0;
  private lastAudio = 0;
  private started = 0;
  private listeners = new Set<() => void>();
  private clock: ReturnType<typeof setInterval>;
  pair: Pair;
  private readonly pairs: Pair[];
  private segmentation: Segmentation | null;
  // Translation can be switched off for a session; it can only be switched on when a translator was configured.
  private translating: boolean;
  constructor(private options: {
    transcriber: TranscriberFactory; translator: Translator | null; glossary: Glossary;
    backend: string; processing?: Snapshot['processing']; translationTimeoutMs?: number; queueTtlMs?: number;
    // Local inference has no upstream session lifetime. Cloud ASR keeps its conservative cap.
    sessionLimitMs?: number | null;
    pair?: Pair;
    // Pairs the operator may switch to while capture is off; default only the session's own.
    pairs?: Pair[];
    // The recognizer's segmentation when it can be switched while capture is off.
    segmentation?: Segmentation;
    // What one translation request covers: a closed row, or locked pieces of a row before it closes. Replay only for now.
    translationUnit?: 'row' | 'piece';
  }) {
    this.pair = options.pair ?? DEFAULT_PAIR;
    const same = (a: Pair, b: Pair) => a[0] === b[0] && a[1] === b[1];
    this.pairs = [...(options.pairs ?? []).filter(pair => !same(pair, this.pair)), this.pair].sort((a, b) => a.join().localeCompare(b.join()));
    this.segmentation = options.segmentation ?? null;
    this.translating = Boolean(options.translator);
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
      pair: [...this.pair], pairs: this.pairs.map(pair => [...pair] as Pair), mode: this.mode, capture: this.capture, error: this.error, backend: this.options.backend,
      processing: this.processing(), segmentation: this.segmentation,
      translation: { available: Boolean(this.options.translator), enabled: this.translating },
      restarts: this.restarts, ...(this.restarting ? { restarting: true as const } : {}),
      queue: this.queue.length, running: this.running.size, gate: this.gate, rejected: this.rejected, segments: this.rows.map(r => ({ ...r })), sentAt: Date.now(), turns: structuredClone(this.traces), turnTelemetryVersion: 2 };
  }
  private processing(): Snapshot['processing'] {
    const configured = this.options.processing ?? 'cloud-audio-and-text';
    if (this.translating) return configured;
    return configured === 'local-audio-cloud-text' ? 'local-only' : configured === 'cloud-audio-and-text' ? 'cloud-audio-only' : configured;
  }
  // Takes effect at the next Start, so a row never mixes two segmentations.
  offers(pair: Pair) { return this.pairs.some(offered => offered[0] === pair[0] && offered[1] === pair[1]); }
  // Only while capture is off: a new session in the other pair, in Auto, with nothing of the old pair left on screen or in
  // translation context. A request while capturing is ignored; the page disables the control then.
  setPair(pair: Pair) {
    if (!this.offers(pair) || (pair[0] === this.pair[0] && pair[1] === this.pair[1])) return;
    if (['active', 'connecting', 'stopping'].includes(this.capture)) return;
    this.closeStream(); this.invalidate(); this.sessionId = randomUUID(); this.capture = 'paused';
    this.pair = [...pair] as Pair; this.mode = 'auto';
    this.options.translator?.setPair?.(this.pair);
    this.changed();
  }
  setSegmentation(value: Segmentation) {
    if (this.segmentation === null || this.segmentation === value || ['active', 'connecting', 'stopping'].includes(this.capture)) return;
    this.segmentation = value; this.changed();
  }
  // Off: queued requests are dropped and their rows keep the original; a request already sent finishes.
  setTranslation(enabled: boolean) {
    if (!this.options.translator || enabled === this.translating) return;
    this.translating = enabled;
    if (!enabled) {
      for (const job of this.queue) {
        job.row.state = 'original';
        const trace = this.trace(job.row);
        if (trace) trace.outcome = 'original';
      }
      this.queue = [];
    }
    this.changed();
  }
  private changed() { this.revision++; for (const listener of this.listeners) listener(); }
  private invalidate() {
    this.epoch++; this.generation++;
    this.queue = [];
    for (const abort of this.running) abort.abort();
    this.running.clear(); this.rows = []; this.traces = []; this.error = null; this.gate = null; this.rejected = 0;
    this.contextFloor = this.nextSequence;
  }
  private closeStream() { this.streamToken++; this.transcriber?.close(); this.transcriber = undefined; this.gate = null; this.restarting = false; }
  // Modes outside the session's pair are refused; the server treats them as a protocol error.
  accepts(mode: Mode) { return modes(this.pair).includes(mode); }
  async start(mode: Mode) {
    if (!this.accepts(mode)) return;
    if (this.capture === 'active' || this.capture === 'connecting' || this.capture === 'stopping') return;
    this.closeStream(); this.invalidate(); this.sessionId = randomUUID(); this.mode = mode;
    this.restarts = 0; this.restartTimes = [];
    await this.openStream();
  }
  // The recognizer failed while capturing: restart it, visibly, instead of waiting for a manual Start. Finished rows stay,
  // open rows are dropped, and the noise gate carries over so no quiet is needed. A third failure within five minutes, or
  // a failure while restarting, fails capture as before.
  private interrupted() {
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter(at => now - at < RESTART.windowMs);
    if (this.capture !== 'active' || this.restartTimes.length >= RESTART.max) { this.fail('transcription'); return; }
    this.restartTimes.push(now); this.restarts++;
    const threshold = this.gate && this.gate.state !== 'calibrating' ? this.gate.threshold : undefined;
    this.closeStream(); this.dropOpenRows(); this.restarting = true;
    void this.openStream(threshold);
  }
  private async openStream(gateThreshold?: number) {
    const token = ++this.streamToken;
    const restarting = this.restarting;
    this.capture = 'connecting'; this.changed();
    try {
      const stream = this.options.transcriber({ mode: this.mode, pair: this.pair, ...(this.segmentation ? { segmentation: this.segmentation } : {}),
        onEvent: event => { if (token === this.streamToken) this.transcript(event); },
        onFailure: () => { if (token === this.streamToken) this.interrupted(); },
        ...(gateThreshold !== undefined ? { gateThreshold } : {}),
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
      // The session limit counts from Start, not from an automatic restart.
      this.capture = 'active'; this.restarting = false; this.lastAudio = Date.now(); if (!restarting) this.started = this.lastAudio;
      this.changed();
    } catch { if (token === this.streamToken) this.fail('transcription'); }
  }
  audio(pcm: Uint8Array) {
    if (this.capture !== 'active') return;
    this.lastAudio = Date.now();
    try { this.transcriber?.audio(pcm); } catch { this.interrupted(); }
  }
  setMode(mode: Mode) {
    if (!this.accepts(mode)) return;
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
    // Finalized rows stay as reading history. Open rows go, pending translations are cancelled and their rows keep the
    // original, and earlier rows stop being context, all without reloading the model. The transcriber drops its pending
    // recognition work too: rolling rows begin late, so an old decode could otherwise start a row after this.
    this.epoch++; this.queue = [];
    for (const abort of this.running) abort.abort();
    this.running.clear(); this.error = null; this.gate = null; this.contextFloor = this.nextSequence;
    const open = this.rows.filter(row => !row.final);
    this.traces = this.traces.filter(trace => !open.some(row => this.rowTraces.get(row) === trace));
    this.rows = this.rows.filter(row => row.final);
    for (const row of this.rows) if (row.state === 'pending') {
      row.state = 'skipped'; row.translation = null;
      const trace = this.trace(row);
      if (trace) trace.outcome = 'skipped';
    }
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
    this.closeStream(); this.capture = 'failed'; this.error = error; this.restarting = false;
    this.dropOpenRows(); this.changed();
  }
  // Preserve originals; incomplete previews must not look final.
  private dropOpenRows() {
    for (const trace of this.traces) if (['capturing', 'committed'].includes(trace.outcome)) trace.outcome = 'capture-failed';
    this.rows = this.rows.filter(r => r.final);
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
      // A recognized language outside the session's pair is not evidence for either direction.
      const language = event.type === 'final' && event.language && inPair(this.pair, event.language) ? event.language : 'unknown';
      if (event.type === 'final' && trace) {
        trace.recognitionSource = language;
        trace.controllerRepetitionRejected = repeated;
        trace.recognitionClipped = Boolean(trace.recognitionClipped || event.text.length > 4000);
        trace.originalEndsInEllipsis = endsInEllipsis(event.text.slice(0, 4000));
        trace.outcome = rejected ? 'rejected' : !event.text.trim() ? 'empty' : !this.translating ? 'original' : 'translating';
      }
      row.original = rejected ? '' : event.text.slice(0, 4000);
      if (event.type === 'partial' && event.stable !== undefined && row.original) row.stable = Math.min(event.stable, row.original.length);
      else delete row.stable;
      if (event.type === 'partial' && event.locked && row.stable !== undefined && this.options.translationUnit === 'piece') {
        const pieces = this.pieces(row);
        if (event.locked.audioMs > pieces.lockedMs) {
          Object.assign(pieces, { stable: row.stable, lockedMs: event.locked.audioMs, heardAt: performance.now() - event.locked.lagMs });
        }
        if (event.locked.language !== 'unknown') pieces.language = event.locked.language;
      }
      if (event.type === 'final' && rejected) {
        this.rejected++;
        if (event.uncaptioned && !repeated) {
          // Kept as a marker so the display shows that speech went uncaptioned; nothing to translate.
          Object.assign(row, { final: true, finalizedAt: Date.now(), state: 'original', uncaptioned: event.uncaptioned });
        } else this.rows = this.rows.filter(r => r !== row);
        this.changed(); return;
      }
      if (event.type === 'final') {
        row.final = true; row.finalizedAt = Date.now(); row.state = 'pending';
        row.source = language;
        if (!row.original.trim()) { this.rows = this.rows.filter(r => r !== row); }
        else if (!this.translating) row.state = 'original';
        else if (this.queue.length >= 8) {
          row.state = 'skipped'; this.error = 'overload';
          if (trace) { trace.outcome = 'skipped'; trace.translationFailure = 'queue-full'; }
        }
        else if (this.options.translationUnit === 'piece') {
          this.queue.push({ row, mode: this.rowModes.get(row) ?? this.mode, context: [], epoch: this.epoch, queued: performance.now(), piece: { last: true } });
        }
        else {
          // Snapshot ONLY earlier finalized rows at commit time. Never include future
          // turns or let later translations mutate an already queued request's context.
          const preceding = this.rows.filter(r => r.final && !r.uncaptioned && r.sequence >= this.contextFloor && r.sequence < row!.sequence).slice(-4);
          if (trace) {
            trace.contextSequences = preceding.map(r => r.sequence);
            trace.contextMissingTranslations = preceding.filter(r => r.state !== 'ready' || !r.translation).length;
            trace.contextClippedRows = preceding.filter(r => r.original.length > 800 || (r.translation?.length ?? 0) > 800).length;
          }
          const context = preceding.map(r => ({
            // A translation still streaming is not context.
            original: r.original.slice(0, 800), translation: r.state === 'ready' ? r.translation?.slice(0, 800) ?? null : null, source: r.source,
          }));
          this.queue.push({ row, mode: this.rowModes.get(row) ?? this.mode, context, epoch: this.epoch, queued: performance.now() });
        }
      }
    }
    this.changed(); this.pump();
  }
  private pump() {
    const pieces = this.options.translationUnit === 'piece';
    // Pieces: one request at a time, so when translation is slower than speech, pieces grow instead of queueing.
    while (this.running.size < (pieces ? 1 : 2) && this.queue.length) {
      const job = this.queue.shift()!;
      if (performance.now() - job.queued > (this.options.queueTtlMs ?? 8000) || !this.rows.includes(job.row)) {
        job.row.state = 'skipped';
        const trace = this.trace(job.row);
        if (trace) { trace.outcome = 'skipped'; trace.translationFailure = 'queue-expired'; }
        this.changed(); continue;
      }
      this.send(job);
    }
    if (pieces && this.translating && !this.running.size && !this.queue.length) this.cut();
  }
  private send(job: Job) {
    const abort = new AbortController(); this.running.add(abort); this.changed();
    void this.translate(job, abort);
  }
  private pieces(row: Segment) {
    let pieces = this.rowPieces.get(row);
    if (!pieces) { pieces = { cut: 0, cutMs: 0, parts: [], stable: 0, lockedMs: 0, heardAt: 0, language: 'unknown' }; this.rowPieces.set(row, pieces); }
    return pieces;
  }
  // Starts a piece of an open row's locked text; see PIECE.
  private cut() {
    const marks = this.pair.map(language => profile(language).clauseEnd + profile(language).sentenceEnd).join('');
    for (const row of this.rows) {
      const pieces = this.rowPieces.get(row);
      if (row.final || !pieces) continue;
      const text = row.original.slice(pieces.cut, pieces.stable).trimEnd(), ms = pieces.lockedMs - pieces.cutMs;
      if (!text.trim() || ms < PIECE.minMs || (ms < PIECE.maxMs && !endsSentence(text, marks))
        || pieces.lockedMs <= (pieces.retryAfterMs ?? -1)) continue;
      this.send({ row, mode: this.rowModes.get(row) ?? this.mode, context: [], epoch: this.epoch, queued: performance.now(), piece: { last: false } });
      return;
    }
  }
  // The row's translated pieces, joined as the target language writes words.
  private joined(pieces: Pieces, more = '') {
    const separator = pieces.target && pieces.target !== 'unknown' && !profile(pieces.target).spaced ? '' : ' ';
    return [...pieces.parts.map(part => part.translation), more].filter(Boolean).join(separator).slice(0, 4000);
  }
  private async translate(job: Job, abort: AbortController) {
    if (job.piece) return this.translatePiece(job, job.piece.last, abort);
    const start = performance.now();
    const trace = this.trace(job.row);
    if (trace) trace.translationQueueMs = Math.round(start - job.queued);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await this.request(job, { text: job.row.original, mode: job.mode, glossary: this.options.glossary,
        sourceLanguage: job.row.source, context: job.context }, abort, trace, timer$ => { timer = timer$; }, partial => {
        if (job.row.state !== 'pending') return;
        // A runaway reply stops showing well past any translation of the row; its result, if valid, still shows in full.
        const text = partial.text.slice(0, 4000);
        if (!text.trim() || text === job.row.translation || text.length > 4 * job.row.original.length + 40) return;
        job.row.translation = text; this.changed();
      });
      if (!this.directed(job.mode, result)) throw new Error('direction');
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
        job.row.state = 'failed'; job.row.translation = null; this.error = error instanceof TranslationFailure ? error.category : 'translation';
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
  // One request with the timeout and abort, diagnostics, and streamed text in a direction the result could take.
  private async request(job: Job, input: TranslationInput, abort: AbortController, trace: TurnTrace | undefined,
    setTimer: (timer: ReturnType<typeof setTimeout>) => void, show: (partial: PartialTranslation) => void) {
    const cancelled = new Promise<never>((_, reject) => {
      abort.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      setTimer(setTimeout(() => abort.abort(), this.options.translationTimeoutMs ?? 12_000));
    });
    return Translation.parse(await Promise.race([
      this.options.translator!.translate(input, abort.signal, value => {
        const diagnostic = TranslationDiagnostic.safeParse(value);
        if (!trace || abort.signal.aborted || job.epoch !== this.epoch || !this.traces.includes(trace) || !diagnostic.success) return;
        trace.translationResponse = diagnostic.data.response;
        if (diagnostic.data.outputTokenLimitReached !== undefined) trace.outputTokenLimitReached = diagnostic.data.outputTokenLimitReached;
      }, partial => {
        // Streamed text shows while the request runs, once its direction is valid; the result replaces it and a failure clears it.
        if (abort.signal.aborted || job.epoch !== this.epoch || !this.rows.includes(job.row)
          || partial.source === 'unknown' || !this.directed(input.mode, partial)) return;
        show(partial);
      }), cancelled,
    ]));
  }
  // A piece: the locked text since the last cut, or when last, the rest of the closed row. Its translation is appended.
  // A failed or unresolved piece before the last is withdrawn and its text goes to the next piece.
  private async translatePiece(job: Job, last: boolean, abort: AbortController) {
    const start = performance.now(); const row = job.row; const pieces = this.pieces(row);
    const trace = this.trace(row);
    const from = { cut: pieces.cut, cutMs: pieces.cutMs };
    const text = row.original.slice(pieces.cut, last ? undefined : pieces.stable).trim();
    pieces.cut = last ? row.original.length : pieces.stable;
    pieces.cutMs = last ? trace?.audioMs ?? pieces.lockedMs : pieces.lockedMs;
    const clamp = (ms: number) => Math.min(120_000, Math.max(0, Math.round(ms)));
    const record: NonNullable<TurnTrace['pieces']>[number] | undefined = text && trace && (trace.pieces ??= []).length < 32 ? { endMs: clamp(pieces.cutMs),
      lagMs: clamp(last ? trace.speechEndToFinalMs ?? 0 : start - pieces.heardAt), queueMs: clamp(start - job.queued) } : undefined;
    if (record) trace!.pieces!.push(record);
    if (last && trace) trace.translationQueueMs = record?.queueMs ?? clamp(start - job.queued);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => job.epoch === this.epoch && this.rows.includes(row);
    try {
      if (!text) {
        // The pieces already sent covered the whole row.
        if (last && current()) this.finish(row, pieces, trace, start);
        return;
      }
      const source = pieces.direction ? direction(pieces.direction)!.source : pieces.language;
      // Earlier rows' finished translations, then this row's translated pieces, at most four.
      const context = [
        ...this.rows.filter(r => r.final && !r.uncaptioned && r.sequence >= this.contextFloor && r.sequence < row.sequence).slice(-4).map(r => ({ original: r.original.slice(0, 800),
          translation: r.state === 'ready' ? r.translation?.slice(0, 800) ?? null : null, source: r.source })),
        ...pieces.parts.map(part => ({ original: part.original.slice(0, 800), translation: part.translation.slice(0, 800) || null, source })),
      ].slice(-4);
      const mode = pieces.direction ?? job.mode;
      const result = await this.request(job, { text, mode, glossary: this.options.glossary,
        sourceLanguage: row.source !== 'unknown' ? row.source : pieces.language, context, ...(last ? {} : { continues: true }) },
      abort, trace, timer$ => { timer = timer$; }, partial => {
        if (!['partial', 'pending'].includes(row.state)) return;
        const shown = partial.text.slice(0, 4000);
        if (!shown.trim() || shown.length > 4 * text.length + 40) return;
        const translation = this.joined({ ...pieces, target: pieces.target ?? partial.target }, shown);
        if (translation === row.translation) return;
        row.translation = translation;
        if (record) record.firstTranslationMs ??= clamp(performance.now() - start);
        this.changed();
      });
      if (!this.directed(mode, result)) throw new Error('direction');
      if (!current()) return;
      if (record) Object.assign(record, { translationMs: clamp(performance.now() - start), outcome: result.source === 'unknown' ? 'unresolved' : 'ready' });
      if (result.source !== 'unknown') {
        pieces.parts.push({ original: text, translation: result.text });
        pieces.direction ??= `${result.source}-${result.target}`; pieces.target ??= result.target;
      } else if (!last) Object.assign(pieces, from, { retryAfterMs: pieces.lockedMs });
      row.translation = this.joined(pieces) || null;
      if (last) this.finish(row, pieces, trace, start);
      if (this.error?.startsWith('translation')) this.error = null;
    } catch (error) {
      if (!current()) return;
      if (record) Object.assign(record, { translationMs: clamp(performance.now() - start), outcome: 'failed' });
      row.translation = this.joined(pieces) || null;
      if (!last) { Object.assign(pieces, from, { retryAfterMs: pieces.lockedMs }); return; }
      // The row fails but keeps the pieces already translated.
      row.state = 'failed'; row.translationMs = Math.round(performance.now() - start);
      this.error = error instanceof TranslationFailure ? error.category : 'translation';
      if (trace && this.traces.includes(trace)) {
        trace.outcome = 'failed'; trace.translationMs = row.translationMs;
        trace.translationFailure = abort.signal.aborted ? 'timeout' : 'request-error';
      }
    } finally {
      clearTimeout(timer); this.running.delete(abort);
      if (job.epoch === this.epoch) { this.changed(); this.pump(); }
    }
  }
  private finish(row: Segment, pieces: Pieces, trace: TurnTrace | undefined, start: number) {
    const resolved = pieces.direction ? direction(pieces.direction)! : null;
    Object.assign(row, { source: resolved?.source ?? 'unknown', target: resolved?.target ?? 'unknown',
      state: resolved ? 'ready' : 'unresolved', translationMs: Math.round(performance.now() - start) });
    if (trace && this.traces.includes(trace)) {
      trace.outcome = row.state as 'ready' | 'unresolved'; trace.translationMs = row.translationMs!;
      trace.translationEndsInEllipsis = endsInEllipsis(row.translation ?? '');
    }
  }
  private directed(mode: Mode, result: PartialTranslation) {
    const forced = direction(mode);
    return forced ? result.source === forced.source && result.target === forced.target
      : result.source === 'unknown' || (inPair(this.pair, result.source) && inPair(this.pair, result.target));
  }
  dispose() { clearInterval(this.clock); this.closeStream(); this.invalidate(); this.listeners.clear(); }
}
