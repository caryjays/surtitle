# Cloud provider verification — 2026-10-18

**Update 2026-10-21:** these are the retained opt-in cloud adapters, **not the current default**. Current default is local MLX transcription + translation OFF; see [LOCAL-TRANSCRIPTION.md](LOCAL-TRANSCRIPTION.md). No authenticated cloud calls have been made. The prices below only apply if the corresponding cloud stages are explicitly enabled.

These are observations from public provider documentation retrieved during implementation, **not successful authenticated API calls**. No credentials were inspected or paid calls made. `platform.openai.com` returned HTTP 403; the current `developers.openai.com` pages were accessible. API reference redirects were followed. Models, pricing and account access can change.

## Owner test / silence correction

The owner reported successful MKE 200 capture with real EN→JA cloud output, but repeated silent-input hallucinations were also being translated. That is limited owner observation, not an agent-authenticated cloud evaluation or a quality acceptance. Local CPU speech verification and repetition/quality rejection now prevent suspect recognized text from entering the paid translation stage or its context. Default Whisper glossary prompting was disabled; the cloud glossary remains. No paid calls were made while implementing/testing this correction. The corrected physical setup still needs retesting.

## Personal companion update

The retained Responses adapter is now used by the explicit `dev:listen` / `start:listen` profile (local ASR + cloud MT). Credential presence passed safe preflight; **no authenticated/paid model request was made during development**. Public Responses creation, structured-output and `gpt-5.6-terra` model documentation were fetched again: Responses, structured outputs and `reasoning.effort: none` remain documented; pricing remains $2 input / $12 output per million tokens. Actual project access/limits remain unverified.

- Requests now include recognition-language evidence and at most four **preceding finalized** segments (up to 800 original + 800 translated characters each), frozen at finalization. Context is never sent as privileged chat turns and only the current segment is translated. The glossary remains at most 32 entries. This adds input tokens; the historical hourly example below is not an estimate for this new context configuration.
- Short speech may use consistent recognition/context evidence to resolve direction; genuine ambiguity remains original-only. Directions are not speaker identities and speakers need not alternate.
- Input is runtime-validated, including strict context shapes and bounds. Response bounds, strict output validation, cancellation and no-retry behavior remain. HTTP 401/403, 429 and network failures become safe operator categories; raw provider bodies/errors are never logged or propagated.
- Cloud ASR remains an optional, untested separate path; personal mode always uses local ASR. `--listen` does not upload audio. Ordinary defaults remain local/off.

See [the personal companion runbook](../wiki/operations.md). The no-context descriptions below are the historical milestone-one contract, superseded by this update.

## Selected contracts

### Transcription: OpenAI gpt-live-transcribe

Sources:

- [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [Model / rate limits / pricing](https://developers.openai.com/api/docs/models/gpt-live-transcribe)
- [VAD](https://developers.openai.com/api/docs/guides/realtime-vad)
- [Realtime API reference](https://developers.openai.com/api/reference/resources/realtime)
- [WebSocket transport](https://developers.openai.com/api/docs/guides/realtime-websocket)
- [Official SDK URL builder](https://github.com/openai/openai-node/blob/master/src/realtime/internal-base.ts): confirms `intent: 'transcription'`, no model query parameter for a transcription-only connection.

The live guide currently recommends `gpt-live-transcribe`, rather than the seed's candidate `gpt-4o-transcribe`. The selected model supports transcript deltas, final committed transcripts, context and plural language hints; it does not provide detected-language predictions, word timestamps, speaker labels or confidence scores.

- Server WebSocket: `wss://api.openai.com/v1/realtime?intent=transcription`.
- Server-only `Authorization: Bearer …`; GA protocol, **no beta header**. No browser-direct provider connection or ephemeral-token flow.
- Send `session.update`, `session.type: transcription`, `audio.input.format: {type: 'audio/pcm', rate: 24000}`. Wait for `session.updated` before forwarding audio.
- Raw mono PCM16 little-endian. Browser AudioWorklet resamples the actual AudioContext rate, packs 1,200-sample / 2,400-byte / 50 ms frames. This is not MediaRecorder/WebM.
- `audio.input.transcription`: configurable `model`, `languages: ['en','ja']` in auto (one hint in override), vocabulary `keywords`, short `prompt`, `delay: low`.
- `turn_detection: null`. The current live model guide explicitly says **no server_vad or semantic_vad**. Local VAD sends base64 `input_audio_buffer.append` and explicit `input_audio_buffer.commit`.
- `input_audio_buffer.committed` provides `item_id` and optional predecessor. Map ordered commit acknowledgements to locally allocated audio turns. Final transcription completion order is **not guaranteed**. Never order captions by final-arrival time.
- Accept `conversation.item.input_audio_transcription.delta` and `.completed`; only completed text is translated. Failures/errors are reduced to a safe category.
- Early deltas/finals are buffered by item ID until its commit acknowledgement establishes ordering. This deliberately means original preview can wait for a pause/commit even though the provider supports earlier streaming. Improving pre-commit preview without guessing item identity is deferred.

**Documentation inconsistency / untested assumptions:** the current generic reference still describes some transcription behavior in older terms (e.g. its `delay` note mentions only `gpt-realtime-whisper`, while the live guide explicitly shows `gpt-live-transcribe` with `delay: low`). Implementation follows the dedicated live transcription guide. Actual account model access, effective configuration, EN/JA recognition, commit acknowledgements and latency must be verified in the first paid rehearsal. Do not switch to a legacy model merely by changing its ID: singular language and server-VAD contracts differ. The 25-minute application session cap is a conservative implementation limit, not a claim about the provider's maximum session duration.

### Translation: OpenAI gpt-5.6-terra

Sources:

- [Model / supported reasoning effort / structured outputs / rate limits](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Pricing](https://developers.openai.com/api/docs/pricing)

The retrieved GPT-4.1 mini, GPT-4o mini and GPT-5 mini model pages mark those models deprecated. GPT-5 mini's page recommends GPT-5.6 Terra for new low-latency workloads. Selected Terra to follow the current recommendation, with `reasoning.effort: none` (documented supported), **not** because its translation quality/latency has been measured here.

- `POST https://api.openai.com/v1/responses`, service-only Bearer authentication.
- Nonstreamed bounded request per final segment, `store: false`, `max_output_tokens: 2048`, no tools.
- Strict `text.format` JSON Schema with `source`, `target`, `text`. Parse the raw HTTP response's `output[].content[]`; only a completed response with one output-text JSON object is accepted. Refusal, incomplete generation, HTTP error, invalid direction/schema, or timeout leaves original text intact.
- Source/target are `en`, `ja`, or `unknown`. Unknown requires empty translated text. Explicit overrides are revalidated outside the model. Auto uses dominant language; ambiguous short/mixed or unrelated speech is unresolved, never asserted as certain.
- Transcript and glossary are JSON **data** in a user message. Fixed higher-priority instructions prohibit answering questions, following spoken commands or inventing unfinished endings. No application tools are exposed to the model.
- No preceding transcript context in milestone 1, intentionally avoiding unbounded retention and cross-speaker leakage. Glossary is bounded to 32 entries.
- Model ID and supported reasoning effort are configurable via `.env`, not the browser. Changing models requires compatibility verification; it is not automatic failover.

## Billing and limits

Retrieved prices (USD; estimates, not budget guarantees):

| Stage | Unit | Listed price |
| --- | --- | --- |
| gpt-live-transcribe | Realtime audio duration | $0.017/minute |
| gpt-5.6-terra | Uncached input text | $2.00 / million tokens |
| gpt-5.6-terra | Output text | $12.00 / million tokens |
| gpt-5.6-terra | Cached input | $0.20 / million tokens; not assumed here |

Example only: 60 billed audio minutes ≈ **$1.02**. 720 translation segments × (500 input tokens + 120 output tokens) ≈ **$1.76**, total ≈ **$2.78/hour**. Actual segment count, Japanese tokenization, glossary/prompt tokens, submitted silence/padding, retries, account terms and pricing can differ. The app omits idle silence but sends pre-roll and trailing silence within turns. No automatic retries are performed.

The retrieved model tables list no free tier. Their Build tier lists transcription 2,000 RPM / 210,000 TPM; translation 5,000 RPM / 1,000,000 TPM. These are documentation values, **not a claim about this user's quota or a sufficient audio-duration capacity calculation**. Check the project's Limits/Billing pages before use. Local concurrency (2), queue (8), expiry, timeouts and fail-visible behavior bound this app; they do not reserve provider capacity. Rate-limit/auth errors require operator intervention; raw provider error bodies are never logged.

## Retention

[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) says API data is not used for training by default, but default abuse-monitoring logs can include customer content and be retained for up to 30 days (with listed exceptions). `store: false` avoids Responses application-state storage; it is **not** a promise of zero provider retention. Zero Data Retention / Modified Abuse Monitoring require eligibility/approval. Verify account policy and audience notice independently. Local audio/transcript persistence is not implemented.
