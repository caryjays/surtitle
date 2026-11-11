import { z } from 'zod';
import { Command, Snapshot, TurnTrace, type Segment } from '../../packages/protocol/index.ts';

export const DIAGNOSTIC_LIMIT = 5000;
const SAMPLE_MS = 2000;
type ControlCommand = ReturnType<typeof Command.parse>;
const DISPLAY_STAGES = ['original-first', 'original-all', 'translation-first', 'translation-all'] as const;
type DisplayStage = typeof DISPLAY_STAGES[number];
// A row as a pacer shows it; only whether each part is empty is read.
type DisplayedRow = Pick<Segment, 'sequence' | 'final' | 'state' | 'original' | 'translation'> & { originalRest: string; translationRest: string };
// What the browser applied to the microphone track, which can differ from what was requested. null: not reported.
// Deliberately no device label, device ID or group ID.
const CaptureSettings = z.object({
  echoCancellation: z.boolean().nullable(), noiseSuppression: z.boolean().nullable(), autoGainControl: z.boolean().nullable(),
  sampleRate: z.number().int().min(1).max(768_000).nullable(), channelCount: z.number().int().min(1).max(64).nullable(),
}).strict();
export type CaptureSettings = z.infer<typeof CaptureSettings>;
export function captureSettings(settings: unknown): CaptureSettings {
  const value = (typeof settings === 'object' && settings !== null ? settings : {}) as Record<string, unknown>;
  const pick = <T>(schema: z.ZodType<T>, key: string) => { const parsed = schema.safeParse(value[key]); return parsed.success ? parsed.data : null; };
  return { echoCancellation: pick(CaptureSettings.shape.echoCancellation.unwrap(), 'echoCancellation'),
    noiseSuppression: pick(CaptureSettings.shape.noiseSuppression.unwrap(), 'noiseSuppression'),
    autoGainControl: pick(CaptureSettings.shape.autoGainControl.unwrap(), 'autoGainControl'),
    sampleRate: pick(CaptureSettings.shape.sampleRate.unwrap(), 'sampleRate'),
    channelCount: pick(CaptureSettings.shape.channelCount.unwrap(), 'channelCount') };
}
export function describeCapture(settings: CaptureSettings) {
  const flag = (name: string, value: boolean | null) => `${name} ${value === null ? 'not reported' : value ? 'on' : 'off'}`;
  return [flag('echo cancellation', settings.echoCancellation), flag('noise suppression', settings.noiseSuppression),
    flag('automatic gain', settings.autoGainControl), ...(settings.sampleRate ? [`${settings.sampleRate} Hz`] : [])].join(' · ');
}

type Health = Pick<Snapshot, 'capture' | 'processing' | 'pair' | 'mode' | 'error' | 'queue' | 'running' | 'rejected' | 'gate' | 'restarts'>;
type Row = Pick<Segment, 'sequence' | 'final' | 'state' | 'source' | 'target' | 'translationMs'> & {
  originalChars: number; translationChars: number; scriptLetters: { latin: number; kana: number; han: number; other: number };
};
type Event = { atMs: number } & (
  { type: 'started' | 'stopped' }
  | { type: 'mark'; visibleSequences: number[] }
  | { type: 'connection'; online: boolean }
  | { type: 'capture'; settings: CaptureSettings }
  // When the console's audience preview, paced as an overlay is, first released a row's text and finished releasing it.
  | { type: 'display'; session: number; generation: number; sequence: number; stage: DisplayStage; paced: boolean }
  | { type: 'command'; command: ControlCommand }
  | { type: 'health'; session: number; generation: number; health: Health }
  | { type: 'segment'; session: number; generation: number; baseline: boolean; sinceFirstObservedMs: number; row: Row }
  | { type: 'turn'; session: number; generation: number; baseline: boolean; turn: TurnTrace }
  | { type: 'segment-removed'; session: number; generation: number; sequence: number; outcome: TurnTrace['outcome'] | 'unknown' }
);

function summarize(row: Segment): Row {
  const scriptLetters = { latin: 0, kana: 0, han: 0, other: 0 };
  for (const char of row.original) {
    if (/\p{Script=Latin}/u.test(char)) scriptLetters.latin++;
    else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)) scriptLetters.kana++;
    else if (/\p{Script=Han}/u.test(char)) scriptLetters.han++;
    else if (/\p{Letter}/u.test(char)) scriptLetters.other++;
  }
  return { sequence: row.sequence, final: row.final, state: row.state, source: row.source, target: row.target,
    translationMs: row.translationMs, originalChars: row.original.length, translationChars: row.translation?.length ?? 0, scriptLetters };
}

/** Explicit opt-in, content-free browser diagnostics. Never retain snapshots or arbitrary error/config objects. */
export class DiagnosticLog {
  private events: Event[] = [];
  private collecting = false;
  private startedAt: number | null = null;
  private dropped = 0;
  private identity = '';
  private sessionId = '';
  private session = 0;
  private baseline = true;
  private lastHealth = '';
  private lastSample = -Infinity;
  private rows = new Map<string, { signature: string; metadata: string; firstSeen: number; scannedAt: number; sequence: number }>();
  private turns = new Map<number, string>();
  private serviceTelemetry = false;
  private displayed = new Map<number, Set<DisplayStage>>();
  private displayGeneration = -1;
  private displayBaseline = true;
  constructor(private readonly now = Date.now) {}
  get hasTurnTelemetry() { return this.serviceTelemetry; }
  get status() { return { collecting: this.collecting, count: this.events.length, dropped: this.dropped }; }
  private add(event: Event) {
    if (!this.collecting) return;
    if (this.events.length === DIAGNOSTIC_LIMIT) { this.events.shift(); this.dropped++; }
    this.events.push(event);
  }
  start() {
    if (this.collecting) return;
    this.collecting = true; this.startedAt ??= this.now(); this.baseline = true;
    this.rows.clear(); this.turns.clear(); this.lastHealth = ''; this.lastSample = -Infinity;
    this.displayed.clear(); this.displayBaseline = true;
    this.add({ type: 'started', atMs: this.now() });
  }
  stop() { if (this.collecting) this.add({ type: 'stopped', atMs: this.now() }); this.collecting = false; }
  clear() {
    this.stop(); this.events = []; this.startedAt = null; this.dropped = 0;
    this.rows.clear(); this.turns.clear(); this.serviceTelemetry = false;
    this.identity = ''; this.sessionId = ''; this.session = 0;
  }
  connection(online: boolean) { this.add({ type: 'connection', atMs: this.now(), online }); }
  capture(input: unknown) {
    const parsed = CaptureSettings.safeParse(input);
    if (parsed.success) this.add({ type: 'capture', atMs: this.now(), settings: parsed.data });
  }
  command(input: unknown) {
    if (!this.collecting) return;
    const parsed = Command.safeParse(input);
    if (parsed.success) this.add({ type: 'command', atMs: this.now(), command: parsed.data });
  }
  mark(sequences: unknown = []) {
    const parsed = TurnTrace.shape.sequence.array().max(60).safeParse(sequences);
    if (parsed.success) this.add({ type: 'mark', atMs: this.now(), visibleSequences: parsed.data });
  }
  // Called with the audience preview's rows after each render. Text is inspected for emptiness only and never kept.
  // A final row's original is all released once none of it waits; a translation, once the row is ready and none waits.
  display(rows: DisplayedRow[], paced: boolean) {
    if (!this.collecting || !this.sessionId) return;
    const generation = this.displayGeneration;
    const live = new Set<number>();
    for (const row of rows) {
      live.add(row.sequence);
      let stages = this.displayed.get(row.sequence);
      if (!stages) { stages = new Set(); this.displayed.set(row.sequence, stages); }
      const reached: Record<DisplayStage, boolean> = {
        'original-first': Boolean(row.original), 'original-all': row.final && Boolean(row.original) && !row.originalRest,
        'translation-first': Boolean(row.translation), 'translation-all': row.state === 'ready' && Boolean(row.translation) && !row.translationRest };
      for (const stage of DISPLAY_STAGES) if (reached[stage] && !stages.has(stage)) {
        stages.add(stage);
        // Text already on screen when collection starts has no release time.
        if (!this.displayBaseline) this.add({ type: 'display', atMs: this.now(), session: this.session, generation, sequence: row.sequence, stage, paced });
      }
    }
    for (const sequence of this.displayed.keys()) if (!live.has(sequence)) this.displayed.delete(sequence);
    this.displayBaseline = false;
  }
  observe(input: unknown) {
    if (!this.collecting) return;
    const parsed = Snapshot.safeParse(input);
    if (!parsed.success) return; // Never log raw invalid payloads/errors.
    this.observeSnapshot(parsed.data);
  }
  // Internal fast path: connect() already validates Snapshot at the WebSocket boundary.
  // Keep observe(unknown) above for untrusted callers; never parse the same full history twice per gate tick.
  observeSnapshot(snapshot: Snapshot) {
    if (!this.collecting) return;
    const atMs = this.now();
    if (snapshot.sessionId !== this.sessionId) { this.session++; this.sessionId = snapshot.sessionId; }
    const identity = `${snapshot.sessionId}:${snapshot.generation}`;
    if (identity !== this.identity) {
      this.rows.clear(); this.turns.clear(); this.lastHealth = ''; this.identity = identity;
      this.displayed.clear(); this.displayGeneration = snapshot.generation;
    }
    // Deliberate allowlist: no backend strings, model names, IDs, text, provider bodies, device labels or URLs.
    const health: Health = { capture: snapshot.capture, processing: snapshot.processing, pair: [...snapshot.pair], mode: snapshot.mode,
      error: snapshot.error, queue: snapshot.queue, running: snapshot.running, rejected: snapshot.rejected, restarts: snapshot.restarts,
      gate: snapshot.gate ? { state: snapshot.gate.state, level: snapshot.gate.level,
        threshold: snapshot.gate.threshold, remainingMs: snapshot.gate.remainingMs, ...(snapshot.gate.masked ? { masked: true as const } : {}) } : null };
    const signature = JSON.stringify({ ...health, gate: health.gate ? [health.gate.state, health.gate.masked ?? false] : null });
    if (signature !== this.lastHealth || atMs - this.lastSample >= SAMPLE_MS) {
      this.add({ type: 'health', atMs, session: this.session, generation: snapshot.generation, health });
      this.lastHealth = signature; this.lastSample = atMs;
    }
    if (snapshot.turnTelemetryVersion === 2) this.serviceTelemetry = true;
    const turnSequences = new Set<number>();
    for (const turn of snapshot.turns) {
      turnSequences.add(turn.sequence);
      const signature = JSON.stringify(turn);
      if (this.turns.get(turn.sequence) !== signature) {
        // TurnTrace is a strict bounded metadata schema: no text/config/IDs can enter this event.
        this.add({ type: 'turn', atMs, session: this.session, generation: snapshot.generation, baseline: this.baseline, turn });
        this.turns.set(turn.sequence, signature);
      }
    }
    for (const sequence of this.turns.keys()) if (!turnSequences.has(sequence)) this.turns.delete(sequence);
    const keep = new Set<string>();
    for (const segment of snapshot.segments) {
      keep.add(segment.id);
      const previous = this.rows.get(segment.id);
      const metadata = JSON.stringify([segment.sequence, segment.final, segment.state, segment.source, segment.target,
        segment.translationMs, segment.original.length, segment.translation?.length ?? 0]);
      // Do not rescan every retained transcript on each heartbeat/gate tick. No text is cached here.
      if (previous?.metadata === metadata && atMs - previous.scannedAt < SAMPLE_MS) continue;
      const row = summarize(segment);
      const signature = JSON.stringify(row);
      const firstSeen = previous?.firstSeen ?? atMs;
      if (signature !== previous?.signature) this.add({ type: 'segment', atMs, session: this.session,
        generation: snapshot.generation, baseline: this.baseline, sinceFirstObservedMs: atMs - firstSeen, row });
      this.rows.set(segment.id, { signature, metadata, firstSeen, scannedAt: atMs, sequence: segment.sequence });
    }
    for (const [id, previous] of this.rows) if (!keep.has(id)) {
      this.add({ type: 'segment-removed', atMs, session: this.session, generation: snapshot.generation, sequence: previous.sequence,
        outcome: snapshot.turns.find(turn => turn.sequence === previous.sequence)?.outcome ?? 'unknown' });
      this.rows.delete(id);
    }
    this.baseline = false;
  }
  exportJson() {
    return JSON.stringify({ format: 'captions-diagnostics', version: 2, startedAtMs: this.startedAt,
      exportedAtMs: this.now(), serviceTurnTelemetryObserved: this.serviceTelemetry, ...this.status, maxEvents: DIAGNOSTIC_LIMIT, healthSampleMs: SAMPLE_MS,
      timing: 'atMs/sinceFirstObservedMs are browser observations. Turn audioMs counts captured PCM including pre-roll/trailing quiet; recognition queue/inference/commit and translation timings are service/worker measurements, not human end-of-speech latency.',
      language: 'Segment source/target are caption labels revised by translation. Turn recognitionLanguage is decoder-reported (or supplied hint when gated); recognitionSource is EN/JA/unknown before translation. No language probabilities; script counts are not language detection.',
      privacy: 'No transcript text, audio, credentials, device labels, raw errors or provider configuration. Nothing uploaded automatically.',
      events: this.events }, null, 2);
  }
}

export function setupDiagnostics(current: () => { snapshot?: Snapshot; online: boolean; capture?: CaptureSettings }) {
  const log = new DiagnosticLog();
  const toggle = document.getElementById('diagnostic-toggle') as HTMLButtonElement;
  const download = document.getElementById('diagnostic-download') as HTMLButtonElement;
  const clear = document.getElementById('diagnostic-clear') as HTMLButtonElement;
  const mark = document.getElementById('diagnostic-mark') as HTMLButtonElement;
  function update() {
    const { collecting, count, dropped } = log.status;
    toggle.textContent = collecting ? 'Stop diagnostics' : 'Start diagnostics';
    toggle.setAttribute('aria-pressed', String(collecting));
    document.getElementById('diagnostic-indicator')!.textContent = collecting ? 'ON' : 'OFF';
    document.getElementById('diagnostic-status')!.textContent = `${collecting ? 'Diagnostics ON' : 'Diagnostics OFF'} · ${count} events in memory${dropped ? ` · ${dropped} older events dropped` : ''}${collecting ? log.hasTurnTelemetry ? ' · turn details available' : ' · turn details unavailable: restart updated service' : ''}`;
    download.disabled = clear.disabled = count === 0; mark.disabled = !collecting;
  }
  toggle.onclick = () => {
    if (log.status.collecting) log.stop();
    else {
      log.start(); const { snapshot, online, capture } = current();
      log.connection(online); if (capture) log.capture(capture); if (snapshot) log.observeSnapshot(snapshot);
    }
    update();
  };
  mark.onclick = () => {
    const captions = document.getElementById('captions')!;
    const viewport = captions.getBoundingClientRect();
    const visible = document.getElementById('preview-notice')!.hidden ? [...captions.children].filter(node => {
      const bounds = node.getBoundingClientRect(); return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
    }).map(node => Number((node as HTMLElement).dataset.sequence)) : [];
    log.mark(visible); update();
  };
  clear.onclick = () => { log.clear(); update(); };
  download.onclick = () => {
    const url = URL.createObjectURL(new Blob([log.exportJson()], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `captions-diagnostics-${Date.now()}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  update();
  return {
    observe(snapshot: Snapshot) { log.observeSnapshot(snapshot); update(); },
    connection(online: boolean) { log.connection(online); update(); },
    capture(settings: CaptureSettings) { log.capture(settings); update(); },
    // Runs on every render; the status line changes only when an event is added.
    display(rows: DisplayedRow[], paced: boolean) { const before = log.status.count; log.display(rows, paced); if (log.status.count !== before) update(); },
    command(command: ControlCommand) { log.command(command); update(); },
  };
}
