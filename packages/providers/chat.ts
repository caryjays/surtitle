import { z } from 'zod';
import { DEFAULT_PAIR, Translation, TranslationInput, type Pair, type TranslationDiagnostic } from '../protocol/index.ts';
import { TranslationFailure, type Translator } from './types.ts';
import { translationInstructionsFor, translationSchemaFor } from './translation.ts';

// Local servers (mlx_lm.server, LM Studio, Ollama) do not all enforce response_format,
// so the expected shape is also stated in the prompt.
function shape(pair: Pair) {
  const codes = [...pair, 'unknown'].map(code => `"${code}"`).join('|');
  return `Reply with only one JSON object of the form {"source":${codes},"target":${codes},"text":string}.`;
}

// Added only for a piece of an open row, so a whole row's prompt is unchanged.
export const CONTINUES_INSTRUCTION = 'continues true: the sentence goes on after text, and the next text will be appended to your translation. Translate text so it can be continued: never complete, close or summarise it.';

// System and user messages for a chat model; the local worker uses them too.
export function chatMessages(input: TranslationInput, instructions?: string, pair = DEFAULT_PAIR) {
  input = TranslationInput.parse(input);
  const continues = input.continues ? ` ${CONTINUES_INSTRUCTION}` : '';
  return { system: `${instructions ?? translationInstructionsFor(pair)}${continues} ${shape(pair)}`, user: JSON.stringify(input) };
}

export function chatTranslationRequest(model: string, input: TranslationInput, instructions?: string, pair = DEFAULT_PAIR) {
  const { system, user } = chatMessages(input, instructions, pair);
  return {
    model, max_tokens: 2048, stream: false,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name: 'caption_translation', strict: true, schema: translationSchemaFor(pair) } },
  };
}

// Tolerates code fences or a reasoning preamble around the object; the object itself is still validated.
export function extractObject(text: string) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no object');
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

// A streamed reply so far: its source and target once both are complete, and its text up to the last whole character.
// null until then, or for a reply that is not such an object. The finished reply is still parsed and validated whole.
export function partialObject(reply: string): { source: string; target: string; text: string } | null {
  const body = reply.slice(Math.max(0, reply.indexOf('{')));
  const field = (name: string) => new RegExp(`"${name}"\\s*:\\s*"([a-z]{2,3}|unknown)"`).exec(body)?.[1];
  const source = field('source'), target = field('target'), open = /"text"\s*:\s*"/.exec(body);
  if (!source || !target || !open) return null;
  const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
  let text = '';
  for (let i = open.index + open[0].length; i < body.length && body[i] !== '"';) {
    if (body[i] !== '\\') { text += body[i++]; continue; }
    const escape = body[i + 1];
    if (escape === undefined) break;
    if (escape === 'u') {
      const hex = body.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
      text += String.fromCharCode(parseInt(hex, 16)); i += 6;
    } else if (escape in escapes) { text += escapes[escape]; i += 2; } else return null;
  }
  return { source, target, text };
}

const Completion = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullish(),
    message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
  })).min(1),
});

// OpenAI-compatible chat completions, for local or private-network servers. Not wired into the live service.
export class ChatCompletionsTranslator implements Translator {
  private endpoint: string;
  constructor(private options: { baseUrl: string; model: string; key?: string; pair?: Pair; instructions?: string; fetch?: typeof fetch }) {
    this.endpoint = `${new URL(options.baseUrl).href.replace(/\/$/, '')}/chat/completions`;
  }
  async translate(input: TranslationInput, signal: AbortSignal, diagnostic?: (value: TranslationDiagnostic) => void) {
    let reported = false;
    const report = (value: TranslationDiagnostic) => { reported = true; diagnostic?.(value); };
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.endpoint, {
        method: 'POST', signal, body: JSON.stringify(chatTranslationRequest(this.options.model, input, this.options.instructions, this.options.pair)),
        headers: { 'Content-Type': 'application/json', ...(this.options.key ? { Authorization: `Bearer ${this.options.key}` } : {}) },
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
      const choice = Completion.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).choices[0]!;
      if (choice.message.refusal) { report({ response: 'refused' }); throw new Error('refused translation'); }
      if (choice.finish_reason === 'length') { report({ response: 'incomplete', outputTokenLimitReached: true }); throw new Error('incomplete translation'); }
      const translation = Translation.parse(extractObject(choice.message.content ?? ''));
      report({ response: 'completed', outputTokenLimitReached: false });
      return translation;
    } catch {
      if (!reported) report({ response: 'invalid' });
      throw new Error('translation response unavailable');
    }
  }
}
