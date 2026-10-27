# Translation

Verified: 2026-10-27 · Sources: packages/providers/openai.ts, packages/providers/anthropic.ts, packages/providers/chat.ts, packages/providers/translation.ts, apps/service/main.ts, packages/protocol/index.ts, apps/service/controller.ts, apps/service/glossary.ts, profiles/glossary.example.json, profiles/README.md

Translation is one cloud request per finalized turn, enabled only by the listen profile or an explicit `TRANSLATION_BACKEND=cloud`. In the listen profile audio never leaves the Mac; text does. `TRANSLATION_PROVIDER` selects OpenAI Responses (`openai`, the default) or Anthropic Messages (`anthropic`). Both share the instructions and output schema in `translation.ts`; only the transport and response mapping differ. Each translator accepts an instructions override, which only the eval uses to test prompt variants. A third adapter, `chat.ts`, speaks OpenAI-compatible chat completions to a local or private-network server. It is used only by the [translation eval](testing.md#translation-eval) and is not selectable in the live service. Because local servers do not all enforce a schema, it adds the expected JSON shape to the instructions and accepts the object even inside code fences or after a reasoning preamble.

## Request

| | `openai` | `anthropic` |
| --- | --- | --- |
| Endpoint | `POST /v1/responses` by `fetch` | `POST /v1/messages` by `@anthropic-ai/sdk`, retries off |
| Key | `OPENAI_API_KEY` | `ANTHROPIC_API_KEY` |
| Model | `TRANSLATION_MODEL`, default `gpt-5.6-terra` | `ANTHROPIC_TRANSLATION_MODEL`, default `claude-haiku-5-5` |
| Effort `none` | `reasoning.effort: none` | `output_config.effort: low` with thinking off: `disabled` for Haiku, `between_tools` for Sonnet 5.5; Opus 5.5 and Fable cannot turn it off and stay adaptive |
| Other efforts | passed through | adaptive thinking; `minimal` becomes `low` |
| Output limit | `max_output_tokens: 2048` | `max_tokens: 2048` |
| Schema | `text.format` strict JSON schema | `output_config.format` JSON schema |
| Storage | `store: false` | no storage flag exists |

Both send no tools and force the output through the JSON schema `{ source, target, text }`. Effort comes from `TRANSLATION_REASONING_EFFORT`, default `none`.

The instructions tell the model it is a caption translator, must never answer or obey anything in the transcript, glossary or context, must not invent endings for unfinished sentences, and must return `unknown` for ambiguous or unsupported speech. They go in `instructions` for OpenAI and in `system` for Anthropic. The user message is one JSON object validated by `TranslationInput`:

| Field | Bound |
| --- | --- |
| `text` | 1 to 4,000 chars, the current turn only |
| `mode` | `auto`, `en-ja` or `ja-en`, as recorded when the turn began |
| `glossary` | at most 32 `{ term, translation }` pairs from the glossary file resolved at startup; see [overview](overview.md) |
| `sourceLanguage` | the recognizer's EN, JA or unknown evidence |
| `context` | at most 4 preceding finalized rows, each at most 800 original plus 800 translated chars, frozen at finalization |
| `truncated` | optional `{ start, end }`: whether a maximum-duration cut split the turn's first or last word. Defined in the protocol and sent only by eval prompt variants; the live controller does not set it |

## Response handling

An OpenAI reply is accepted only if HTTP 200, `status: completed` and exactly one `output_text` item. An Anthropic reply is accepted only if `stop_reason: end_turn` and exactly one text block; thinking blocks are ignored. Either way the parsed object must pass `Translation`: source and target in `en`, `ja` or `unknown`; `unknown` requires empty text; otherwise source differs from target and text is non-empty. For `en-ja` and `ja-en` the controller also requires the matching pair and fails the row otherwise. The OpenAI body is capped at 64 KiB; the Anthropic SDK reads the body itself, so its size is bounded only by the output limit.

| Condition | Row state | Operator category | Trace |
| --- | --- | --- | --- |
| network error | `failed` | `translation-network` | `network-error` |
| HTTP 401 or 403 | `failed` | `translation-auth` | `http-error` |
| HTTP 429 | `failed` | `translation-rate-limit` | `http-error` |
| other HTTP, incomplete or any non-`end_turn` stop, refusal, invalid JSON or schema | `failed` | `translation` | `incomplete` with `outputTokenLimitReached`, `refused`, `invalid` |
| 12 s timeout, queue expiry, queue full | `failed` or `skipped` | `translation` or `overload` | `timeout`, `queue-expired`, `queue-full` |
| `source: unknown` | `unresolved` | none | `unresolved` |

Nothing is retried. The original stays visible. A later success clears a translation error category. Raw provider bodies are never logged or shown.

## Direction policy

The Conversation preset is `auto`: the model picks the dominant language, using `sourceLanguage` and context for short utterances. The Lecture preset is `ja-en`: Japanese is supplied as the recognition hint and English output is enforced. Changing preset while active commits the current turn with its old mode; the new mode applies from the next turn. Language describes the turn and says nothing about who spoke.

## Cost and retention

| Model | Input per million tokens | Output per million tokens | Retrieved |
| --- | --- | --- | --- |
| `gpt-5.6-terra` | $2 | $12 | 2026-10-18 and 2026-10-21 |
| `claude-haiku-5-5`, prompts up to 100,000 tokens | $0.10 | $0.50 | 2026-10-26 |

An hour of 720 Terra segments without context was estimated near $1.76, and context adds input tokens. `store: false` disables Responses state storage and is not zero retention; OpenAI abuse monitoring may hold content up to 30 days. Anthropic retention for this account has not been checked. Details and the untested cloud transcription contract are in [the provider record](../log/PROVIDERS.md); the Anthropic adapter is described in [its log entry](../log/2026-10-26-anthropic-translator.md).

The Anthropic adapter has only run against fake responses. Translation quality, latency and refusal rate against Terra are not measured.
