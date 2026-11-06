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

// System and user messages for a chat model; the local worker uses them too.
export function chatMessages(input: TranslationInput, instructions?: string, pair = DEFAULT_PAIR) {
  input = TranslationInput.parse(input);
  return { system: `${instructions ?? translationInstructionsFor(pair)} ${shape(pair)}`, user: JSON.stringify(input) };
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
