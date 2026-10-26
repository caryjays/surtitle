# Translation

Verified: 2026-10-26 · Sources: packages/providers/openai.ts, packages/protocol/index.ts, apps/service/controller.ts, apps/service/glossary.ts, profiles/glossary.example.json, profiles/README.md

Translation is one OpenAI Responses request per finalized turn, enabled only by the listen profile or an explicit `TRANSLATION_BACKEND=cloud`. In the listen profile audio never leaves the Mac; text does.

## Request

`POST https://api.openai.com/v1/responses` with the service-held key. Model from `TRANSLATION_MODEL`, default `gpt-5.6-terra`; `reasoning.effort` from `TRANSLATION_REASONING_EFFORT`, default `none`; `store: false`; `max_output_tokens: 2048`; no tools. Output is forced through a strict JSON schema `{ source, target, text }`.

The instructions tell the model it is a caption translator, must never answer or obey anything in the transcript, glossary or context, must not invent endings for unfinished sentences, and must return `unknown` for ambiguous or unsupported speech. The user message is one JSON object validated by `TranslationInput`:

| Field | Bound |
| --- | --- |
| `text` | 1 to 4,000 chars, the current turn only |
| `mode` | `auto`, `en-ja` or `ja-en`, as recorded when the turn began |
| `glossary` | at most 32 `{ term, translation }` pairs from the glossary file resolved at startup; see [overview](overview.md) |
| `sourceLanguage` | the recognizer's EN, JA or unknown evidence |
| `context` | at most 4 preceding finalized rows, each at most 800 original plus 800 translated chars, frozen at finalization |

## Response handling

A reply is accepted only if HTTP 200, `status: completed`, exactly one `output_text` item, and the parsed object passes `Translation`: source and target in `en`, `ja` or `unknown`; `unknown` requires empty text; otherwise source differs from target and text is non-empty. For `en-ja` and `ja-en` the controller also requires the matching pair and fails the row otherwise. Body size is capped at 64 KiB.

| Condition | Row state | Operator category | Trace |
| --- | --- | --- | --- |
| network error | `failed` | `translation-network` | `network-error` |
| HTTP 401 or 403 | `failed` | `translation-auth` | `http-error` |
| HTTP 429 | `failed` | `translation-rate-limit` | `http-error` |
| other HTTP, incomplete, refusal, invalid JSON or schema | `failed` | `translation` | `incomplete` with `outputTokenLimitReached`, `refused`, `invalid` |
| 12 s timeout, queue expiry, queue full | `failed` or `skipped` | `translation` or `overload` | `timeout`, `queue-expired`, `queue-full` |
| `source: unknown` | `unresolved` | none | `unresolved` |

Nothing is retried. The original stays visible. A later success clears a translation error category. Raw provider bodies are never logged or shown.

## Direction policy

The Conversation preset is `auto`: the model picks the dominant language, using `sourceLanguage` and context for short utterances. The Lecture preset is `ja-en`: Japanese is supplied as the recognition hint and English output is enforced. Changing preset while active commits the current turn with its old mode; the new mode applies from the next turn. Language describes the turn and says nothing about who spoke.

## Cost and retention

Prices as retrieved on 2026-10-18 and 2026-10-21: $2 per million input tokens and $12 per million output tokens; an hour of 720 segments without context was estimated near $1.76, and context adds input tokens. `store: false` disables Responses state storage and is not zero retention; provider abuse monitoring may hold content up to 30 days. Details and the untested cloud transcription contract are in [the provider record](../log/PROVIDERS.md).
