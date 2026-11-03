# Local recognition

Verified: 2026-11-04 · Sources: scripts/local/worker.py, scripts/local/engine.py, scripts/local/speech_gate.py, scripts/local/quality.py, scripts/local/models.json, scripts/local/vad-model.json, scripts/local/requirements.lock, packages/providers/local.ts, packages/providers/rolling.ts, packages/providers/turns.ts, packages/providers/quality.ts, scripts/local/languages.py, profiles/languages.json

Recognition is Apple MLX Whisper in an isolated Python child, with a CPU Silero speech gate in front of it. Node owns capture, segmentation and session state; the worker only decodes the audio it is handed.

## Models and setup

| Asset | Source | Pinned in |
| --- | --- | --- |
| `turbo-q4`, the default | `mlx-community/whisper-large-v3-turbo-q4`, 4-bit, group size 64 | `scripts/local/models.json`: revision, bytes, SHA-256 |
| `small-q4` | `mlx-community/whisper-small-mlx-q4` | same |
| Silero VAD | `snakers4/silero-vad` JIT, MIT | `scripts/local/vad-model.json` |
| Python deps | MLX 0.32.4, mlx-whisper 0.4.3, torch 2.14.1, scipy, numpy | `scripts/local/requirements.lock` |

`pnpm local:setup` creates `.local/venv` with Python 3.12 via uv, syncs the lock, downloads and checksums the models and the public FLEURS fixtures. The runtime never downloads anything: the worker runs with `HF_HUB_OFFLINE=1`, an allowlisted environment of `PATH`, `HOME`, `LANG` and the offline flags, and no credentials. Its stderr is discarded so no decoder error or speech reaches a log.

## Worker RPC

Newline-delimited JSON over stdin and stdout, one request in flight.

| Direction | Shape |
| --- | --- |
| request | `{ id, audio: base64 PCM24k, language: a profiled code or null, prompt? }`; line at most 2,000,000 bytes, which fits the engine's 30 s audio limit; any other key is rejected |
| reply `ready` | after model load and warmup |
| reply `final` | `{ id, text ≤ 4,000, language: a profiled code or unknown, inferenceMs, rejected?, segments, measurement: { recognitionLanguage, recognitionClipped, quality } }` |
| reply `error` | worker exits; adapter fails capture |

`segments` lists each accepted Whisper segment as `{ endMs, text }`, at most 64, ordered, with ends clamped to the audio length, and empty when the reply is rejected. The list stops at a segment with no valid end or past 4,000 characters, so no text is ever placed at a guessed time. Unless the list stopped early, its texts joined and trimmed equal `text`. Rolling segmentation, below, locks text by it; turn segmentation ignores it.

Node validates every reply against a strict schema. Experiment thresholds are keyword arguments on `Engine.transcribe` and are reachable only from `scripts/local/noisy_worker.py`; the production RPC refuses them.

## Decode pipeline

1. Accept 100 ms to 30 s of PCM. Resample 24 kHz to 16 kHz with `scipy.signal.resample_poly(2, 3)`. No gain or normalization is applied.
2. Speech gate: Silero on 512-sample frames with state reset per job; speech is present when three consecutive frames score at least 0.5. Otherwise the turn is rejected before Whisper and `quality.speechGateRejected` is set.
3. Whisper: task transcribe, temperature 0, no conditioning on previous text, fp16, optional `initial_prompt`. The prompt is unused by default; glossary injection was removed after the silence failure.
4. Per-segment filters: drop a piece when `no_speech_prob` is at least 0.9, or at least 0.6 with `avg_logprob` below −0.4, or `avg_logprob` below −1.0, or the piece is repetitive. Non-finite scores drop the piece. Surviving pieces are joined; if the whole text is repetitive the turn is rejected. Partly filtered text is still accepted. A turn of at least 6 s whose whole text is a stock sign-off, such as ご視聴ありがとうございました or "Thank you for watching", is rejected and counted in `stockPhraseDrops`: Whisper emits these in place of ordinary speech, while a real sign-off is short audio. The phrases come from every profile in `profiles/languages.json`, since a hallucination need not be in the session's languages.
5. Language: the decoder's code is reported as `recognitionLanguage`. The reply's `language` is that code when it has a profile, else `unknown`; the controller then turns any language outside the session's pair into `unknown` before it becomes a row's source.

Repetition, implemented identically in `quality.py` and `packages/providers/quality.ts`: ignore text under 40 compact characters; reject when a unit of up to 32 characters repeats eight or more times, or when 160 or more UTF-8 bytes compress more than fourfold. The adapter and the controller each apply this check again.

## Node-side segmentation

`TurnDetector` measures RMS per 50 ms frame, with DC removed in listen mode. Local-only and benchmark launches use the fixed 0.012 gate with a one-frame onset. Listen mode calibrates for 1.5 s, sets the threshold to max(0.004, p90 noise × 2.5), needs three onset frames, applies 0.65 hysteresis while a turn is open, and follows slow ambient drift only while idle. Calibration audio never reaches the worker. Energy opens the turn; Silero decides whether it held speech.

`LocalTranscriber` keeps one active job, two queued finals and one replaceable preview. Finals take priority. Queue expiry is 8 s, inference deadline 12 s, startup 60 s; exceeding any of them fails capture.

`LOCAL_SEGMENTATION` chooses between two modes:

- `turns`, the default: the detector also closes a turn at `LOCAL_MAX_TURN_MS`, 12 s by default, and each turn is decoded once as a final. With previews on, a preview is requested every 3 s of turn audio and shown only when two consecutive hypotheses agree on a growing prefix.
- `rolling`, experimental: the detector has no maximum duration. While a stretch of speech is open, the adapter decodes the audio not yet locked after each further second of audio, with one decode in flight; a slow decode delays the next. Whole segments inside the text two consecutive decodes agree on, ending at least 1 s before the newest audio, lock: their text joins the current row and their audio is dropped. Locked text never changes. A partial event carries the row's locked text only, and a row's begin waits for its first locked text. A row closes as a final with boundary `length` at sentence punctuation once it holds 3 s of locked audio, or at 8 s; otherwise the stretch's boundary closes it after one last decode that locks everything left. In Auto each decode detects the language until the row's first text locks, or the closing decode returns accepted text; that language is kept for the rest of the row. A short opening misheard as the other language can pass the filters once, and settling on it would force that language on every later decode. At 25 s without agreement, all segments but the last lock regardless. A decode with no segments, under 25 s, after a decode that returned text is skipped: the window and the previous text stay, so the decodes on either side can still agree, since one decode can loop and be filtered inside real speech. Otherwise a window over 3 s with no segments keeps only its last second, and in Auto a row with no text yet detects its language afresh. After such a trim, the row's next lock, including the closing decode's, needs a decode whose lowest segment log probability is at least −0.5; a less confident decode locks nothing, and a closing one leaves the row's remaining text out. On music and noise Whisper returns short phrases near the −1.0 floor, and over hundreds of decodes two of them otherwise agree by chance. A row of only a stock sign-off from at least 6 s of audio is rejected. Previews are off. The constants are in `packages/providers/rolling.ts`.

## Baseline

On the eight-clip FLEURS tuning set of 72.3 s, Turbo Q4 scored 6.82% EN WER and 4.44% JA CER full-clip, with real-time replay end-of-speech-to-final medians of 2.86 s in Auto and 1.21 s with a known language. Shorter caps hurt Japanese. These are tuning-set figures from [the local transcription record](../log/LOCAL-TRANSCRIPTION.md); the [noisy experiment](../log/NOISY-EXPERIMENT.md) found no safe default change.

## Known limits

In `turns` mode, continuous speech waits up to the 12 s cap plus decoding before its first final. `rolling` mode has been replayed on recordings but not rehearsed live. A row's first text waits for its first Whisper segment to end and settle, which takes over 8 s when Whisper returns one long segment. There is no automatic gain and no level normalization before the gate. Overlapping voices on one microphone are not separated. See [status](status.md) for the open investigation.
