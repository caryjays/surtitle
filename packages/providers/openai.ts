import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DEFAULT_PAIR, Translation, TranslationInput, direction, profile, type Glossary, type Mode, type Pair, type TranslationDiagnostic } from '../protocol/index.ts';
import { TranslationFailure, type Transcriber, type TranscriberFactory, type Translator, type TranscriptEvent } from './types.ts';
import { TurnDetector } from './turns.ts';
import { translationInstructions, translationInstructionsFor, translationSchema, translationSchemaFor } from './translation.ts';

const Id = z.string().min(1).max(100);
const ProviderEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.updated') }),
  z.object({ type: z.literal('input_audio_buffer.committed'), item_id: Id, previous_item_id: Id.nullable().optional() }),
  z.object({ type: z.literal('conversation.item.input_audio_transcription.delta'), item_id: Id, delta: z.string().max(4000) }),
  z.object({ type: z.literal('conversation.item.input_audio_transcription.completed'), item_id: Id, transcript: z.string().max(4000) }),
  z.object({ type: z.literal('conversation.item.input_audio_transcription.failed') }),
  z.object({ type: z.literal('error') }),
]);
const recognized = new Set(['session.updated', 'input_audio_buffer.committed', 'conversation.item.input_audio_transcription.delta', 'conversation.item.input_audio_transcription.completed', 'conversation.item.input_audio_transcription.failed', 'error']);
type Turn = { id: string; sequence: number; text: string; item?: string; committed: boolean; final: boolean; started: number };

export function transcriptionConfig(model: string, mode: Mode, glossary: Glossary, pair: Pair = DEFAULT_PAIR) {
  const forced = direction(mode);
  return { type: 'session.update', session: { type: 'transcription', audio: { input: {
    format: { type: 'audio/pcm', rate: 24000 },
    transcription: { model, languages: forced ? [forced.source] : [...pair],
      keywords: glossary.map(g => g.term).filter(t => !/[<>\r\n]/.test(t)),
      prompt: `Live ${profile(pair[0]).name} and ${profile(pair[1]).name} talk and questions. Preserve the original spoken language.`, delay: 'low' },
    turn_detection: null,
  } } } };
}

export class OpenAITranscriber implements Transcriber {
  private socket?: WebSocket;
  private ready = false;
  private closed = false;
  private sequence = 0;
  private turns: Turn[] = [];
  private commitQueue: Turn[] = [];
  private completed = new Set<string>();
  private early = new Map<string, { partial: string; final?: string }>();
  private current?: Turn;
  private timer?: ReturnType<typeof setInterval>;
  private rejectConnect?: () => void;
  private detector: TurnDetector;
  constructor(private options: {
    key: string; model: string; mode: Mode; pair?: Pair; glossary: Glossary;
    onEvent(event: TranscriptEvent): void; onFailure(): void;
    onTurnDiagnostic?: Parameters<TranscriberFactory>[0]['onTurnDiagnostic'];
    // Only tests inject a transport; production endpoints are not configurable.
    socketFactory?: () => WebSocket;
  }) {
    this.detector = new TurnDetector({
      begin: () => {
        if (this.turns.length >= 32) throw new Error('transcription backlog');
        const turn: Turn = { id: randomUUID(), sequence: this.sequence++, text: '', committed: false, final: false, started: Date.now() };
        this.turns.push(turn); this.current = turn;
        this.options.onEvent({ type: 'begin', id: turn.id, sequence: turn.sequence, mode: this.options.mode });
      },
      append: pcm => this.send({ type: 'input_audio_buffer.append', audio: Buffer.from(pcm).toString('base64') }),
      commit: detail => {
        if (!this.current) return;
        this.options.onTurnDiagnostic?.(this.current.id, detail);
        this.commitQueue.push(this.current); this.current = undefined;
        this.send({ type: 'input_audio_buffer.commit' });
      },
    });
  }
  async connect() {
    if (!this.options.key) throw new Error('credentials');
    const ws = this.options.socketFactory?.() ?? new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: { Authorization: `Bearer ${this.options.key}` }, maxPayload: 256 * 1024, handshakeTimeout: 10_000,
    });
    this.socket = ws;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => this.failure(), 10_000);
      this.rejectConnect = () => { clearTimeout(timeout); reject(new Error('transcription unavailable')); };
      ws.on('open', () => {
        try { this.send(transcriptionConfig(this.options.model, this.options.mode, this.options.glossary, this.options.pair)); } catch { this.failure(); }
      });
      ws.on('message', data => {
        try {
          const raw: unknown = JSON.parse(data.toString());
          const envelope = z.object({ type: z.string() }).parse(raw);
          if (!recognized.has(envelope.type)) return;
          const event = ProviderEvent.parse(raw);
          if (event.type === 'session.updated') {
            if (!this.ready) { this.ready = true; clearTimeout(timeout); this.rejectConnect = undefined; resolve(); }
          } else this.handle(event);
        } catch { this.failure(); }
      });
      ws.on('error', () => this.failure());
      ws.on('close', () => { if (!this.closed) this.failure(); });
    });
    this.timer = setInterval(() => {
      if (this.turns.some(t => Date.now() - t.started > 27_000)) this.failure();
    }, 1000);
    this.timer.unref();
  }
  private handle(event: z.infer<typeof ProviderEvent>) {
    if (this.closed) return;
    if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') { this.failure(); return; }
    if (!('item_id' in event)) return;
    if (event.type === 'input_audio_buffer.committed') {
      if (this.turns.some(t => t.item === event.item_id && t.committed) || this.completed.has(event.item_id)) return;
      const turn = this.commitQueue.shift();
      if (!turn || (turn.item && turn.item !== event.item_id)) throw new Error('commit ordering');
      turn.item = event.item_id; turn.committed = true;
      const early = this.early.get(event.item_id);
      this.early.delete(event.item_id);
      if (early?.partial) this.handle({ type: 'conversation.item.input_audio_transcription.delta', item_id: event.item_id, delta: early.partial });
      if (early?.final !== undefined) this.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: event.item_id, transcript: early.final });
      this.prune(turn);
      return;
    }
    if (this.completed.has(event.item_id)) return;
    const turn = this.turns.find(t => t.item === event.item_id);
    // Only commit acknowledgements establish order. Finals across turns can arrive
    // out of order, including before their acknowledgement; never guess by arrival.
    if (!turn) {
      if (!this.early.has(event.item_id) && this.early.size >= 32) throw new Error('unbound item limit');
      const early = this.early.get(event.item_id) ?? { partial: '' };
      if (event.type === 'conversation.item.input_audio_transcription.delta' && early.final === undefined) early.partial += event.delta;
      else if (event.type === 'conversation.item.input_audio_transcription.completed') early.final = event.transcript;
      if (early.partial.length > 4000) throw new Error('transcript too long');
      this.early.set(event.item_id, early);
      return;
    }
    if (turn.final) return;
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      turn.text += event.delta;
      if (turn.text.length > 4000) throw new Error('transcript too long');
      this.options.onEvent({ type: 'partial', id: turn.id, text: turn.text });
    } else {
      turn.final = true;
      this.options.onEvent({ type: 'final', id: turn.id, text: event.transcript });
      this.prune(turn);
    }
  }
  private prune(turn: Turn) {
    if (!turn.final || !turn.committed) return;
    this.turns = this.turns.filter(t => t !== turn);
    this.completed.add(turn.item!);
    if (this.completed.size > 256) this.completed.delete(this.completed.values().next().value!);
  }
  private send(event: unknown) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 128 * 1024) throw new Error('upstream unavailable');
    this.socket.send(JSON.stringify(event));
  }
  audio(pcm: Uint8Array) { if (this.ready && !this.closed) this.detector.push(pcm); }
  flush() { this.detector.finish(); }
  setMode(mode: Mode) {
    this.detector.finish('mode-change');
    this.options.mode = mode;
    this.send(transcriptionConfig(this.options.model, mode, this.options.glossary, this.options.pair));
  }
  async finish() {
    this.detector.finish('pause');
    const until = Date.now() + 8000;
    while (this.turns.length && !this.closed && Date.now() < until) await new Promise(r => setTimeout(r, 25));
    if (this.turns.length || this.closed) throw new Error('finalization timeout');
  }
  private failure() { if (this.closed) return; this.close(); this.options.onFailure(); }
  close() {
    if (this.closed) return;
    this.closed = true; this.ready = false; clearInterval(this.timer); this.rejectConnect?.(); this.rejectConnect = undefined;
    this.socket?.terminate(); this.turns = []; this.commitQueue = []; this.completed.clear(); this.early.clear();
  }
}

export function translationRequest(model: string, effort: string, input: TranslationInput, instructions = translationInstructions, schema = translationSchema) {
  input = TranslationInput.parse(input);
  return {
    model, store: false, reasoning: { effort }, max_output_tokens: 2048,
    instructions,
    input: [{ role: 'user', content: JSON.stringify(input) }],
    text: { format: { type: 'json_schema', name: 'caption_translation', strict: true, schema } },
  };
}
const ResponseEnvelope = z.object({
  status: z.literal('completed'),
  output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
});
export class OpenAITranslator implements Translator {
  constructor(private options: { key: string; model: string; effort: string; pair?: Pair; instructions?: string; fetch?: typeof fetch }) {}
  setPair(pair: Pair) { this.options = { ...this.options, pair }; }
  async translate(input: TranslationInput, signal: AbortSignal, diagnostic?: (value: TranslationDiagnostic) => void) {
    let reported = false;
    const report = (value: TranslationDiagnostic) => { reported = true; diagnostic?.(value); };
    const pair = this.options.pair ?? DEFAULT_PAIR;
    const body = JSON.stringify(translationRequest(this.options.model, this.options.effort, input,
      this.options.instructions ?? translationInstructionsFor(pair), translationSchemaFor(pair)));
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${this.options.key}`, 'Content-Type': 'application/json' },
        body, signal,
      });
    } catch { report({ response: 'network-error' }); throw new TranslationFailure('translation-network'); }
    if (!response.ok || !response.body) {
      report({ response: 'http-error' });
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new TranslationFailure('translation-auth');
      if (response.status === 429) throw new TranslationFailure('translation-rate-limit');
      throw new Error('translation unavailable');
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.length;
        if (length > 64 * 1024) { report({ response: 'invalid' }); throw new Error('response too large'); }
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    try {
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const status = z.object({ status: z.string(), incomplete_details: z.object({ reason: z.string() }).nullish() }).parse(raw);
      if (status.status === 'incomplete') {
        report({ response: 'incomplete', outputTokenLimitReached: status.incomplete_details?.reason === 'max_output_tokens' });
        throw new Error('incomplete translation');
      }
      const result = ResponseEnvelope.parse(raw);
      const content = result.output.filter(o => o.type === 'message').flatMap(o => o.content ?? []);
      if (content.some(item => item.type === 'refusal')) { report({ response: 'refused' }); throw new Error('refused translation'); }
      if (content.length !== 1 || content[0]?.type !== 'output_text' || !content[0].text) throw new Error('invalid translation');
      const translation = Translation.parse(JSON.parse(content[0].text));
      report({ response: 'completed', outputTokenLimitReached: false });
      return translation;
    } catch {
      if (!reported) report({ response: 'invalid' });
      throw new Error('translation response unavailable');
    }
  }
}
export function openAITranscriberFactory(key: string, model: string, glossary: Glossary): TranscriberFactory {
  return options => new OpenAITranscriber({ ...options, key, model, glossary });
}
