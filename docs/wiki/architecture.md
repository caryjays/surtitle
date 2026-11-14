# Architecture

Verified: 2026-11-14 · Sources: packages/providers/local-translator.ts, apps/service/controller.ts, apps/service/server.ts, apps/service/main.ts, packages/protocol/index.ts, packages/providers/turns.ts, packages/providers/local.ts, packages/providers/openai.ts, packages/providers/anthropic.ts, packages/providers/translation.ts, packages/providers/chat.ts, apps/web/control.ts, apps/web/client.ts, apps/web/visibility.ts, apps/web/pacer.ts, apps/web/overlay.ts, apps/web/audience.ts, apps/web/console.ts, packages/protocol/languages.ts, profiles/languages.json

One Node process serves two pages from one loopback origin and owns all state. Recognition runs in an isolated Python child. Translation, when enabled, is one request per finalized turn: HTTPS to a cloud provider, or stdio to a second Python child running a local model.

```text
Chrome /control   mic → AudioWorklet → 24 kHz PCM16 frames ───────────┐
                  ◀── snapshots ─────────────────────────────────────  │
                                                                       ▼
Node service 127.0.0.1:4317                                  server.ts (HTTP + WS)
  controller.ts   canonical rows, turn traces, translation queue
  turns.ts        energy turn detector
  local.ts  ───── stdio JSON ───▶ scripts/local/worker.py  (Silero gate → MLX Whisper → filters)
  openai.ts ───── HTTPS ───────▶ OpenAI Responses            (listen profile only)
  anthropic.ts ── HTTPS ───────▶ Anthropic Messages          (TRANSLATION_PROVIDER=anthropic)
  local-translator.ts ─ stdio ─▶ scripts/local/translate_worker.py  (offline profile: MLX Qwen3.5-4B)
                                                                       │
OBS Browser Source /overlay   ◀── snapshots ───────────────────────────┘
```


## Language pair

A session pairs two languages. `LANGUAGE_PAIR` (default `en-ja`) sets the pair the service starts in, checked against `profiles/languages.json`; English, Japanese and Spanish have profiles. While capture is off the operator can switch to English with any other profiled language: the controller starts a new session in Auto, tells the translator the pair, and hands it to the next recognizer stream. The server closes a control socket that asks for a pair not offered. The snapshot carries the pair and the pairs offered. Modes are `auto` and the two directions written `source-target`. Schemas accept any two- or three-letter code, and the controller enforces the pair: the server closes a control socket that sends a mode outside it, a recognized language outside it becomes `unknown`, and an automatic translation into or out of another language fails the row with its original kept. Translation instructions, the output schema and cloud recognition hints are generated from the pair; for `en-ja` the instructions are unchanged text. The control page labels its presets and direction menu from the snapshot's pair, with English first, so Lecture reads the other language into English.
## Components

| Path | Responsibility |
| --- | --- |
| `apps/web/control.ts`, `control.html` | Operator console and reader: microphone selection and capture, commands, reading history, settings, diagnostics |
| `apps/web/console.ts` | Console panels: audience view and overlay settings, session settings, health, keyboard shortcuts |
| `apps/web/worklet.ts`, `audio.ts` | AudioWorklet downmix and area resampling to 24 kHz mono PCM16, 50 ms frames |
| `apps/web/client.ts` | WebSocket connect with reconnect, audio send with backpressure, keyed caption rendering of released text and, for the operator, the rest |
| `apps/web/pacer.ts` | Releases text at a reading pace in each client; see [surfaces](surfaces.md#pacing) |
| `apps/web/history.ts`, `reading.ts`, `diagnostics.ts` | 60-row history with search and layout preview, saved display preferences, opt-in content-free log |
| `apps/web/overlay.ts`, `audience.ts`, `visibility.ts` | OBS overlay and its preview on the console: released text of the latest unexpired rows in a roll-up window, hidden on stale heartbeat; overlay settings in the URL |
| `apps/service/main.ts`, `glossary.ts` | Config validation, launch flags, preflight, glossary resolution, wiring |
| `apps/service/server.ts` | Loopback HTTP and WebSocket, origin checks, one control owner, snapshot broadcast |
| `apps/service/controller.ts` | Session, generation and epoch, rows and traces, translation queue |
| `packages/protocol/` | Zod schemas shared by service and browser: `Command`, `Snapshot`, `Segment`, `Translation`, `TurnTrace`; `languages.ts` holds language codes, modes, the pair and the profiles |
| `profiles/languages.json` | One profile per language, read by Node and the Python worker: name, scoring unit, whether it writes spaces, sentence-end and clause-end characters, stock phrases, display release rates |
| `packages/providers/turns.ts` | Energy turn detector, fixed or calibrated |
| `packages/providers/local.ts` | Local adapter: worker lifecycle, job queue, previews, repetition check |
| `packages/providers/openai.ts` | Cloud transcriber, opt-in and never run live, plus the Responses translator |
| `packages/providers/anthropic.ts` | Messages translator, selected by `TRANSLATION_PROVIDER=anthropic` |
| `packages/providers/translation.ts` | Translator instructions and output schema shared by every translator |
| `packages/providers/chat.ts` | Chat-completions translator for local servers, used only by the translation eval; its message building and parsing serve the local translator too |
| `packages/providers/local-translator.ts` | Local translator: a stdio worker running a pinned MLX model, selected by the offline profile |
| `packages/providers/quality.ts` | Language-independent repetition rejection |
| `scripts/local/*.py` | Worker RPC, engine, speech gate, decoder output filters |

## One turn, end to end

1. The operator clicks Start. The page opens the selected input with mono, echo cancellation and noise suppression on, automatic gain on unless the operator unchecks it, shows what the browser applied to the track, loads the worklet and sends `start`. The service opens a transcriber stream; local mode spawns and warms the worker before reporting ACTIVE.
2. Each 50 ms frame travels as a binary WebSocket message to the controller, then to the detector. In listen mode the first 1.5 s calibrate the noise floor and never reach recognition.
3. The detector opens a turn on onset, replays 300 ms of pre-roll, and commits on 700 ms of quiet, at the 12 s cap, or on flush, direction change or pause. A recalibration ends the turn without committing it. The commit carries its boundary reason and durations. With rolling segmentation, the default, there is no cap and steps 4 to 6 repeat about once a second within the turn, and a decode sent 300 ms into a quiet serves as the closing decode when the turn then commits; see [recognition](recognition.md#node-side-segmentation).
4. The local adapter queues a final job and writes base64 PCM to the worker. In listen mode it also requests a preview every 3 s of turn audio; a preview shows only the prefix two consecutive hypotheses agree on.
5. The worker resamples to 16 kHz, runs the Silero speech gate, decodes with Whisper at temperature 0, drops low-confidence, no-speech and repetitive pieces, and replies with text, language, timing and quality counters. See [recognition](recognition.md).
6. The adapter rejects repetitive output again and emits a final event with a turn measurement. The controller finalizes the row, drops it if rejected or empty, or marks it original-only when translation is off. A rejected final with `uncaptioned`, `language` or `filtered`, stays as a final marker row with an empty original, never translated and never context.
7. With translation on, the controller freezes up to four preceding finalized rows as context and queues the turn. The translator posts a strict JSON schema request and validates the reply. The local translator also streams the reply so far, which the row shows while pending. With `translationUnit: piece`, set only by a replay, the controller instead translates locked pieces of the open row, one request at a time. See [translation](translation.md).
8. Every change produces a snapshot, coalesced to 50 ms and repeated with a 2 s heartbeat, to the control socket and all overlays. Each page releases new text at a reading pace; the overlay shows only released, locked text in a roll-up window. See [surfaces](surfaces.md).

## Identity and invalidation

| Token | Changes on | Guards |
| --- | --- | --- |
| `sessionId` | Start, New session | Browser diagnostics session numbering |
| `generation` | Start, Clear, New session | Rows, traces, rejected counter and gate reset |
| `epoch` | Same as generation, and Recalibrate | Late translation results and diagnostics are discarded |
| `streamToken` | Any transcriber open or close | Late transcriber callbacks are ignored |
| `sequence` | Each new turn | Monotonic row order; context uses only lower sequences, and none from before the last Recalibrate |

Operations: Start begins a fresh session. Pause finishes the current turn, waits up to 8 s for finals, then releases the microphone. Translate now flushes the current turn and keeps listening. Set mode commits the current turn with its old hint and applies the new one to later turns without reloading the worker; a rolling row keeps the mode it was heard in, although its begin event can follow the change. Clear invalidates everything and recreates the worker if capture was active. Set segmentation, refused while capture is on, applies at the next Start; local recognition starts with `LOCAL_SEGMENTATION`, `rolling` by default. Set translation switches a configured translator off or on for the session: off drops queued requests and marks their rows original, and changes the reported processing. Recalibrate keeps finalized rows as reading history and the worker: it removes open rows, cancels queued and running translations, whose rows keep their original as `skipped`, and stops earlier rows being translation context; the adapter drops the open turn, its queued decodes and the reply to a decode in flight, so audio heard before it never becomes a row. New session stops capture and clears all text.

## Bounds

| Item | Value |
| --- | --- |
| Audio frame | 50 ms, 1,200 samples, 2,400 bytes, 24 kHz mono PCM16 LE |
| Control socket limits | 40 audio frames/s, 10 commands/s, 4 KiB payload, 128 KiB send buffer |
| WebSocket clients | 16, one control owner, overlays read-only |
| Pre-roll | 6 frames, 300 ms |
| Quiet boundary | 700 ms |
| Maximum turn | 12,000 ms; `LOCAL_MAX_TURN_MS` accepts 1,000 to 12,000; none in rolling segmentation |
| Minimum committed audio | 100 ms, zero padded |
| Fixed gate, local-only and benchmarks | RMS 0.012, one onset frame |
| Calibrated gate, listen mode | 1.5 s calibration; threshold max(0.004, p90 noise × 2.5); three onset frames; 0.65 hysteresis while open; slow drift while idle |
| Masked-speech warning, calibrated gate | over 10 s with no turn, the 90th-percentile level is at least max(0.002, 0.3 × threshold) and at least 3 × the 10th percentile |
| Local jobs | 1 active, 2 queued finals, 1 replaceable preview; 8 s queue expiry; 12 s inference deadline; 60 s startup |
| Previews | every 3 s of turn audio in listen mode, two agreeing hypotheses; off in rolling mode |
| Rolling mode | a decode per further 1 s of audio, one in flight; window under 29 s; forced lock at 25 s; rows close at 3 s with sentence punctuation or 8 s |
| History | 60 rows and 60 turn traces |
| Translation | queue 8, 8 s TTL, 2 concurrent, 12 s timeout, text 4,000 chars, context 4 rows × 800 + 800 chars, glossary 32 entries |
| Session cap | none for local recognition; 25 min for cloud recognition |
| Stall | capture fails after 5 s without audio while active |
| Overlay | last 2 segments, hidden 6 s after last heartbeat, finals expire after 20 s |
| Snapshot | coalesced 50 ms, heartbeat 2 s |

## Failure policy

A lost control socket, 5 s without audio, a failed start or the session limit puts capture in `failed` with a safe category; the operator clicks Start. Finalized rows stay visible; provisional rows disappear.

A recognizer failure while capturing, which covers any adapter error, malformed worker output, a third queued final and a missed inference deadline, restarts the recognizer on its own: capture shows `connecting` with `restarting` set, the operator page says so, finalized rows stay, open rows are dropped, and the new stream starts from the old noise gate threshold instead of calibrating again. Speech during the restart is not captioned. `Snapshot.restarts` counts restarts since Start. A third such failure within five minutes, or a failure while restarting, puts capture in `failed`. The microphone is never reopened and paid work never restarts on its own. Translation failures mark only their own row and later turns proceed. Whether this policy should soften is tracked in [status](status.md).
