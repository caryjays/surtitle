import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_PAIR, Translation, TranslationInput, type Pair, type TranslationDiagnostic } from '../protocol/index.ts';
import { TranslationFailure, type Translator } from './types.ts';
import { translationInstructions, translationInstructionsFor, translationSchema, translationSchemaFor } from './translation.ts';

export type AnthropicEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

// `none` keeps parity with the Responses default: thinking off, at effort low. How to turn
// thinking off differs by model: Sonnet 5.5 rejects `disabled` and takes `between_tools`;
// Opus 5.5 and Fable cannot turn it off, so low effort is the floor; others take `disabled`.
export function thinkingFor(model: string, effort: AnthropicEffort): Anthropic.ThinkingConfigParam {
  if (effort !== 'none' || /^claude-(opus-5-5|fable-5|mythos-5)/.test(model)) return { type: 'adaptive' };
  if (/^claude-sonnet-5-5/.test(model)) return { type: 'between_tools' };
  return { type: 'disabled' };
}

export function anthropicTranslationRequest(model: string, effort: AnthropicEffort, input: TranslationInput, instructions = translationInstructions, schema = translationSchema) {
  input = TranslationInput.parse(input);
  return {
    model, max_tokens: 2048,
    thinking: thinkingFor(model, effort),
    system: instructions,
    messages: [{ role: 'user' as const, content: JSON.stringify(input) }],
    output_config: {
      effort: effort === 'none' || effort === 'minimal' ? 'low' as const : effort,
      format: { type: 'json_schema' as const, schema },
    },
  } satisfies Anthropic.MessageCreateParamsNonStreaming;
}

export class AnthropicTranslator implements Translator {
  private client: Anthropic;
  constructor(private options: { key: string; model: string; effort: AnthropicEffort; pair?: Pair; instructions?: string; fetch?: typeof fetch }) {
    // Nothing is retried, matching the Responses translator; the controller owns timeouts.
    this.client = new Anthropic({ apiKey: options.key, maxRetries: 0, fetch: options.fetch });
  }
  async translate(input: TranslationInput, signal: AbortSignal, diagnostic?: (value: TranslationDiagnostic) => void) {
    let reported = false;
    const report = (value: TranslationDiagnostic) => { reported = true; diagnostic?.(value); };
    const pair = this.options.pair ?? DEFAULT_PAIR;
    const body = anthropicTranslationRequest(this.options.model, this.options.effort, input,
      this.options.instructions ?? translationInstructionsFor(pair), translationSchemaFor(pair));
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(body, { signal });
    } catch (error) {
      // SDK error messages can carry the provider body; only the status survives here.
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      if (status === undefined) { report({ response: 'network-error' }); throw new TranslationFailure('translation-network'); }
      report({ response: 'http-error' });
      if (status === 401 || status === 403) throw new TranslationFailure('translation-auth');
      if (status === 429) throw new TranslationFailure('translation-rate-limit');
      throw new Error('translation unavailable');
    }
    try {
      if (message.stop_reason === 'refusal') { report({ response: 'refused' }); throw new Error('refused translation'); }
      if (message.stop_reason !== 'end_turn') {
        report({ response: 'incomplete', outputTokenLimitReached: message.stop_reason === 'max_tokens' });
        throw new Error('incomplete translation');
      }
      const text = message.content.filter(block => block.type === 'text');
      if (text.length !== 1 || !text[0]!.text) throw new Error('invalid translation');
      const translation = Translation.parse(JSON.parse(text[0]!.text));
      report({ response: 'completed', outputTokenLimitReached: false });
      return translation;
    } catch {
      if (!reported) report({ response: 'invalid' });
      throw new Error('translation response unavailable');
    }
  }
}
