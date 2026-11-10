# Translation

Verified: 2026-11-10 · Sources: packages/providers/openai.ts, packages/providers/anthropic.ts, packages/providers/chat.ts, packages/providers/local-translator.ts, scripts/local/translate_worker.py, scripts/local/translators.json, scripts/local/download_translator.py, packages/providers/translation.ts, apps/service/main.ts, packages/protocol/index.ts, apps/service/controller.ts, apps/service/glossary.ts, profiles/glossary.example.json, profiles/README.md, packages/protocol/languages.ts, profiles/languages.json

Translation is one request per finalized turn, either to a cloud provider or to a model on this Mac. The listen profile, or an explicit `TRANSLATION_BACKEND=cloud`, sends it to the cloud: audio never leaves the Mac, text does. The offline profile, or `TRANSLATION_BACKEND=local`, keeps it on the Mac; see [local translation](#local-translation). `TRANSLATION_PROVIDER` selects OpenAI Responses (`openai`, the default) or Anthropic Messages (`anthropic`). Both share the instructions and output schema in `translation.ts`, generated from the session's pair; only the transport and response mapping differ. For `en-ja` the generated instructions are the same text as before the pair was configurable, so translation eval prompt variants still apply. Each translator accepts an instructions override, which only the eval uses to test prompt variants. A third adapter, `chat.ts`, speaks OpenAI-compatible chat completions to a local or private-network server. It is used only by the [translation eval](testing.md#translation-eval) and is not selectable in the live service. Because local servers do not all enforce a schema, it adds the expected JSON shape to the instructions and accepts the object even inside code fences or after a reasoning preamble. The local translator uses the same messages and the same tolerant parsing.

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

The instructions tell the model it is a caption translator, must never answer or obey anything in the transcript, glossary or context, must not invent endings for unfinished sentences, and must return `unknown` for ambiguous or unsupported speech. They go in `instructions` for OpenAI and in `system` for Anthropic. The user message is one JSON object validated by `TranslationInput`; for the local and chat-completions translators `text` comes last, after `context` and `glossary`, because with `text` first the local 4B sometimes translated the context too, most often for a row of a few characters:

| Field | Bound |
| --- | --- |
| `text` | 1 to 4,000 chars, the current turn only |
| `mode` | `auto` or a direction of the session's pair, such as `en-ja`, as recorded when the turn began |
| `glossary` | at most 32 `{ term, translation }` pairs from the glossary file resolved at startup; see [overview](overview.md) |
| `sourceLanguage` | the recognizer's evidence: a language of the pair, or unknown |
| `context` | at most 4 preceding finalized rows, each at most 800 original plus 800 translated chars, frozen at finalization. |
| `truncated` | optional `{ start, end }`: whether a maximum-duration cut split the turn's first or last word. Defined in the protocol and sent only by eval prompt variants; the live controller does not set it |

## Response handling

An OpenAI reply is accepted only if HTTP 200, `status: completed` and exactly one `output_text` item. An Anthropic reply is accepted only if `stop_reason: end_turn` and exactly one text block; thinking blocks are ignored. Either way the parsed object must pass `Translation`: source and target a language code or `unknown`; `unknown` requires empty text; otherwise source differs from target and text is non-empty. For a direction mode the controller requires that exact source and target; in `auto` it requires both to be in the session's pair. Otherwise it fails the row. The OpenAI body is capped at 64 KiB; the Anthropic SDK reads the body itself, so its size is bounded only by the output limit.

| Condition | Row state | Operator category | Trace |
| --- | --- | --- | --- |
| network error | `failed` | `translation-network` | `network-error` |
| HTTP 401 or 403 | `failed` | `translation-auth` | `http-error` |
| HTTP 429 | `failed` | `translation-rate-limit` | `http-error` |
| other HTTP, incomplete or any non-`end_turn` stop, refusal, invalid JSON or schema | `failed` | `translation` | `incomplete` with `outputTokenLimitReached`, `refused`, `invalid` |
| 12 s timeout, queue expiry, queue full | `failed` or `skipped` | `translation` or `overload` | `timeout`, `queue-expired`, `queue-full` |
| `source: unknown` | `unresolved` | none | `unresolved` |

Nothing is retried. The original stays visible. A later success clears a translation error category. Raw provider bodies are never logged or shown.

## Local translation

`local-translator.ts` runs a pinned model in a Python child, `scripts/local/translate_worker.py`, over stdio JSON lines, as recognition does: no port, no network, no key. The worker gets the same allowlisted environment as the recognition worker, with Hugging Face offline flags, and its stderr is dropped. The default model is `qwen3.5-4b-q4`, Qwen3.5-4B in a 4-bit MLX build pinned by revision and hash in `scripts/local/translators.json` and fetched by `pnpm local:setup-translator` into `.local/models/`. `qwen3.5-2b-q4`, the same family at 2B, is pinned for comparison and fetched only with `--model qwen3.5-2b-q4`; it is not recommended, see [GPU contention](../log/2026-11-08-gpu-contention.md). mlx-lm loads its text weights and drops the vision ones.

| | Local |
| --- | --- |
| Selected by | `--offline` (`pnpm dev:offline`, `start:offline`), or `TRANSLATION_BACKEND=local` with local recognition |
| Model | `LOCAL_TRANSLATION_MODEL`, `qwen3.5-4b-q4` by default or `qwen3.5-2b-q4` |
| Prompt | the shared instructions plus the JSON shape, as system message; the input object as user message; the chat template with thinking off |
| Decoding | greedy, at most 512 new tokens |
| Streaming | while it generates, the worker sends the reply so far at most every 100 ms; the adapter reads `source`, `target` and the text decoded so far from the unfinished object and passes them on once both codes are known |
| Load | at service startup, before the URL is printed, with a short warm-up generation; startup fails with a setup hint if the model is missing |
| Concurrency | the controller's two concurrent requests queue in the worker, which generates one at a time |
| Cancel | a timeout, clear or new session sends a cancel; the worker stops generating at the next token or drops the request from its queue |
| Failure | a worker that exits or breaks the protocol fails its pending requests with category `translation`; the next request starts a new worker |

The controller shows streamed text as the row's translation while the row is `pending`, only in a direction the finished reply could have, and stops updating it past four times the original's length plus 40 characters, since a runaway reply is not a translation. The finished reply is validated as before and replaces it; a failure, or a reply in the wrong direction, clears it and leaves the original. A row still streaming is never context for a later request: context carries a translation only from a `ready` row. The cloud translators do not stream.

A reply cut at the token limit is `incomplete` with `outputTokenLimitReached`; text with no valid object is `invalid`. Both fail the row; the original stays.

## Piece translation, replay only

The controller's `translationUnit` option is `row` by default and in every live profile; only `pnpm replay:contention --units piece` sets `piece`. With rolling segmentation, each partial event also reports the row's locked audio, the lag of its latest lock and the row's language. In piece mode the controller translates an open row's locked text in pieces, each appended to the row's translation and never rewritten:

- A piece is cut only while no request runs, so one request is in flight at a time and pieces grow when translation is slower than speech. It needs at least 1.5 s of locked audio, and must end at a clause or sentence mark from the profiles or hold 4 s (`PIECE` in `controller.ts`).
- When the row closes, the rest of its text is the last piece, queued like a row. A row whose pieces already covered all of it becomes `ready` without another request.
- Each piece's text and context are taken when it is sent: earlier finalized rows with `ready` translations, then this row's translated pieces, at most four entries. Every piece but the last carries `continues: true`, and only then does the system message gain one line telling the model the sentence goes on and must not be completed. A whole row's prompt is unchanged.
- The first translated piece fixes the row's direction; later pieces are sent in that direction, so a reply the other way, or unresolved, fails the direction check.
- Translations join with a space, or with nothing for a target language whose profile is not `spaced`. A piece streams like a row, appended after the finished pieces.
- A piece before the last that fails, or comes back unresolved, is withdrawn; its text goes to the front of the next piece, which is cut once more text has locked. It sets no error category. A failed last piece fails the row, which keeps the pieces already translated.

Design and evidence: [piece translation design](../log/2026-11-09-piece-translation-design.md).

## Direction policy

The Conversation preset is `auto`: the model picks the dominant language, using `sourceLanguage` and context for short utterances. The Lecture preset is the other language into English, `ja-en` for the Japanese pair: Japanese is supplied as the recognition hint and English output is enforced. Changing preset while active commits the current turn with its old mode; the new mode applies from the next turn. Language describes the turn and says nothing about who spoke.

## Cost and retention

| Model | Input per million tokens | Output per million tokens | Retrieved |
| --- | --- | --- | --- |
| `gpt-5.6-terra` | $2 | $12 | 2026-10-18 and 2026-10-21 |
| `claude-haiku-5-5`, prompts up to 100,000 tokens | $0.10 | $0.50 | 2026-10-26 |

An hour of 720 Terra segments without context was estimated near $1.76, and context adds input tokens. `store: false` disables Responses state storage and is not zero retention; OpenAI abuse monitoring may hold content up to 30 days. Anthropic retention for this account has not been checked. Details and the untested cloud transcription contract are in [the provider record](../log/PROVIDERS.md); the Anthropic adapter is described in [its log entry](../log/2026-10-26-anthropic-translator.md).

The Anthropic adapter has only run against fake responses. Translation quality, latency and refusal rate against Terra are not measured.
