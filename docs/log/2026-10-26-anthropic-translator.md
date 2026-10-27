# 2026-10-26: Anthropic translator adapter

Backend: none. No `.env` read, no paid call, no microphone.

## Done

- Added `packages/providers/anthropic.ts`, an `AnthropicTranslator` that implements the existing `Translator` interface over the Anthropic Messages API through `@anthropic-ai/sdk` 1.3.0, with `maxRetries: 0`.
- Moved the translator instructions and output schema from `openai.ts` into `packages/providers/translation.ts` so both providers send the same contract. The OpenAI request is unchanged.
- Added `TRANSLATION_PROVIDER` (`openai` default, `anthropic`), `ANTHROPIC_API_KEY` and `ANTHROPIC_TRANSLATION_MODEL` (default `claude-haiku-5-5`) to `apps/service/main.ts` and `.env.example`. Preflight requires the key of the selected provider. The operator backend label names the provider.
- `TRANSLATION_REASONING_EFFORT=none` maps to thinking disabled at effort `low`; `minimal` maps to adaptive thinking at `low`; other levels pass through with adaptive thinking.
- Added six fake-fetch tests: data isolation and request shape, 401/403/429 categories without raw bodies, no retries on network failure or 529, and diagnostics for token limit, refusal, invalid output and completion.

## Provider documentation checked

Fetched on 2026-10-26: the Anthropic structured outputs page and the pricing page.

- `output_config.format` with `type: json_schema` is generally available and lists `claude-haiku-5-5`. Every object needs `additionalProperties: false`; string `enum` is supported. A `refusal` or `max_tokens` stop can return output that does not match the schema, so the adapter checks `stop_reason` before parsing.
- Claude Haiku 5.5: $0.10 input and $0.50 output per million tokens for prompts up to 100,000 tokens; $0.50 and $2.50 above. Caption prompts are far below the threshold.
- Haiku 5.5 runs adaptive thinking by default at effort `medium`. Thinking can be disabled at effort `high` or below. Sampling parameters other than the defaults return 400; the adapter sends none.

## Observed

`pnpm check` passes. `node dist/service.mjs --listen --preflight` with `TRANSLATION_PROVIDER=anthropic` and no key reports the credential missing.

## Not done

- No authenticated request. Model access, rate limits, latency, refusal rate and Japanese ↔ English quality against Terra are unmeasured.
- Anthropic retention terms for this account are not checked.
- No side-by-side comparison harness exists. A comparison needs explicit authorization for paid calls to both providers.
