import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DEFAULT_PAIR, Source, Translation, inPair, type Pair, type TranslationDiagnostic, type TranslationInput } from '../protocol/index.ts';
import type { PartialTranslation, Translator } from './types.ts';
import { chatMessages, extractObject, partialObject } from './chat.ts';

const Reply = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('error') }).strict(),
  z.object({ type: z.literal('cancelled'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('partial'), id: z.string().uuid(), text: z.string().max(16_000) }).strict(),
  z.object({ type: z.literal('result'), id: z.string().uuid(), text: z.string().max(16_000), inferenceMs: z.number().nonnegative().max(600_000),
    promptTokens: z.number().int().nonnegative(), generationTokens: z.number().int().nonnegative(), finish: z.string().max(20) }).strict(),
]);
type Result = Extract<z.infer<typeof Reply>, { type: 'result' }>;
// Pinned in scripts/local/translators.json.
export const LOCAL_TRANSLATION_MODELS = ['qwen3.5-4b-q4', 'qwen3.5-2b-q4'] as const;
export type LocalTranslationModel = typeof LOCAL_TRANSLATION_MODELS[number];
export type LocalTranslatorOptions = {
  model: LocalTranslationModel; python?: string; pair?: Pair; instructions?: string; maxTokens?: number;
  startupTimeoutMs?: number; workerFactory?: () => ChildProcessWithoutNullStreams;
  // Per-request generation timing, for the eval and the service's diagnostics. Never text.
  onTiming?: (timing: { inferenceMs: number; promptTokens: number; generationTokens: number }) => void;
};

// A translation model on this Mac behind a stdio worker: no port, no network, no key. One request generates at a time;
// the rest wait in the worker's queue. A worker that exits is started again by the next request.
export class LocalTranslator implements Translator {
  private worker?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private output = '';
  private pending = new Map<string, { resolve: (r: Result) => void; reject: (e: Error) => void; partial: (text: string) => void }>();
  constructor(private options: LocalTranslatorOptions) {}
  // Loads and warms the model; the service calls it at startup so the first caption does not pay for the load.
  start() {
    this.starting ??= new Promise<void>((resolve, reject) => {
      const worker = this.options.workerFactory?.() ?? spawn(this.options.python ?? '.local/venv/bin/python',
        ['-u', 'scripts/local/translate_worker.py', this.options.model], {
          // No .env, API key, HF token, PYTHONPATH or arbitrary parent environment reaches the worker.
          env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8',
            HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', PYTHONUNBUFFERED: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      this.worker = worker; this.output = '';
      let ready = false;
      const deadline = setTimeout(() => fail(), this.options.startupTimeoutMs ?? 120_000);
      const fail = () => {
        clearTimeout(deadline);
        if (this.worker !== worker) return;
        this.worker = undefined; this.starting = undefined;
        worker.stdin.destroy(); worker.kill('SIGKILL');
        for (const job of this.pending.values()) job.reject(new Error('local translation unavailable'));
        this.pending.clear();
        if (!ready) reject(new Error('local translation unavailable'));
      };
      worker.stderr.resume(); // Never print raw inference errors or caption text.
      worker.on('error', fail); worker.on('exit', fail); worker.stdin.on('error', fail);
      worker.stdout.setEncoding('utf8');
      worker.stdout.on('data', (chunk: string) => {
        this.output += chunk;
        if (this.output.length > 64_000) { fail(); return; }
        let end: number;
        while ((end = this.output.indexOf('\n')) >= 0) {
          const line = this.output.slice(0, end); this.output = this.output.slice(end + 1);
          let reply: z.infer<typeof Reply>;
          try { reply = Reply.parse(JSON.parse(line)); } catch { fail(); return; }
          if (reply.type === 'ready') { if (ready) { fail(); return; } ready = true; clearTimeout(deadline); resolve(); }
          else if (reply.type === 'error') { fail(); return; }
          else if (reply.type === 'partial') this.pending.get(reply.id)?.partial(reply.text);
          else {
            const job = this.pending.get(reply.id); this.pending.delete(reply.id);
            if (reply.type === 'result') job?.resolve(reply); else job?.reject(new Error('cancelled'));
          }
        }
      });
    });
    return this.starting;
  }
  async translate(input: TranslationInput, signal: AbortSignal, diagnostic?: (value: TranslationDiagnostic) => void,
    partial?: (value: PartialTranslation) => void) {
    // A 4B model given Auto often rewrites the source in its own language instead of translating it. In Auto, the
    // recognizer's language of the pair sets the direction; with no such language the model still decides.
    const pair = this.options.pair ?? DEFAULT_PAIR;
    const source = input.mode === 'auto' && input.sourceLanguage && inPair(pair, input.sourceLanguage) ? input.sourceLanguage : null;
    const directed = source ? { ...input, mode: `${source}-${pair.find(l => l !== source)}` } : input;
    const { system, user } = chatMessages(directed, this.options.instructions, pair);
    try { await this.start(); } catch { diagnostic?.({ response: 'network-error' }); throw new Error('local translation unavailable'); }
    if (signal.aborted) throw new Error('cancelled');
    const id = randomUUID(); const worker = this.worker!;
    let shown = '';
    const progress = (reply: string) => {
      const value = partialObject(reply);
      if (!partial || !value || value.text === shown) return;
      const source = Source.safeParse(value.source), target = Source.safeParse(value.target);
      if (!source.success || !target.success) return;
      shown = value.text; partial({ source: source.data, target: target.data, text: value.text });
    };
    const result = await new Promise<Result>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, partial: progress });
      // A timeout, clear or new session stops the generation instead of letting it hold the model.
      signal.addEventListener('abort', () => {
        if (!this.pending.delete(id)) return;
        reject(new Error('cancelled'));
        if (this.worker === worker) worker.stdin.write(JSON.stringify({ cancel: id }) + '\n');
      }, { once: true });
      worker.stdin.write(JSON.stringify({ id, system, user, maxTokens: this.options.maxTokens ?? 512 }) + '\n');
    });
    this.options.onTiming?.({ inferenceMs: result.inferenceMs, promptTokens: result.promptTokens, generationTokens: result.generationTokens });
    if (result.finish === 'length') { diagnostic?.({ response: 'incomplete', outputTokenLimitReached: true }); throw new Error('incomplete translation'); }
    try {
      const translation = Translation.parse(extractObject(result.text));
      diagnostic?.({ response: 'completed', outputTokenLimitReached: false });
      return translation;
    } catch {
      diagnostic?.({ response: 'invalid' });
      throw new Error('translation response unavailable');
    }
  }
  close() {
    const worker = this.worker; this.worker = undefined; this.starting = undefined;
    for (const job of this.pending.values()) job.reject(new Error('closed'));
    this.pending.clear();
    worker?.stdin.destroy(); worker?.kill('SIGKILL');
  }
}
