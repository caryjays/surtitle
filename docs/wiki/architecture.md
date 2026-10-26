# Architecture

Verified: 2026-10-26 · Sources: apps/service/controller.ts, apps/service/server.ts, apps/service/main.ts, packages/protocol/index.ts, packages/providers/turns.ts, packages/providers/local.ts, packages/providers/openai.ts, apps/web/control.ts, apps/web/client.ts, apps/web/visibility.ts

One Node process serves two pages from one loopback origin and owns all state. Recognition runs in an isolated Python child. Translation, when enabled, is one HTTPS request per finalized turn.

```text
Chrome /control   mic → AudioWorklet → 24 kHz PCM16 frames ───────────┐
                  ◀── snapshots ─────────────────────────────────────  │
                                                                       ▼
Node service 127.0.0.1:4317                                  server.ts (HTTP + WS)
  controller.ts   canonical rows, turn traces, translation queue
  turns.ts        energy turn detector
  local.ts  ───── stdio JSON ───▶ scripts/local/worker.py  (Silero gate → MLX Whisper → filters)
  openai.ts ───── HTTPS ───────▶ OpenAI Responses            (listen profile only)
                                                                       │
OBS Browser Source /overlay   ◀── snapshots ───────────────────────────┘
```

## Components

| Path | Responsibility |
| --- | --- |
| `apps/web/control.ts`, `control.html` | Operator page: microphone selection and capture, commands, reading history, settings, diagnostics |
| `apps/web/worklet.ts`, `audio.ts` | AudioWorklet downmix and area resampling to 24 kHz mono PCM16, 50 ms frames |
| `apps/web/client.ts` | WebSocket connect with reconnect, audio send with backpressure, keyed caption rendering |
| `apps/web/history.ts`, `reading.ts`, `diagnostics.ts` | 60-row history with search and layout preview, saved display preferences, opt-in content-free log |
| `apps/web/overlay.ts`, `visibility.ts` | OBS overlay: last two unexpired segments, hidden on stale heartbeat |
| `apps/service/main.ts`, `glossary.ts` | Config validation, launch flags, preflight, glossary resolution, wiring |
| `apps/service/server.ts` | Loopback HTTP and WebSocket, origin checks, one control owner, snapshot broadcast |
| `apps/service/controller.ts` | Session, generation and epoch, rows and traces, translation queue |
| `packages/protocol/` | Zod schemas shared by service and browser: `Command`, `Snapshot`, `Segment`, `Translation`, `TurnTrace` |
| `packages/providers/turns.ts` | Energy turn detector, fixed or calibrated |
| `packages/providers/local.ts` | Local adapter: worker lifecycle, job queue, previews, repetition check |
| `packages/providers/openai.ts` | Cloud transcriber, opt-in and never run live, plus the Responses translator |
| `packages/providers/quality.ts` | Language-independent repetition rejection |
| `scripts/local/*.py` | Worker RPC, engine, speech gate, decoder output filters |

## One turn, end to end

1. The operator clicks Start. The page opens the selected input with mono, echo cancellation and noise suppression on, automatic gain off unless enabled, loads the worklet and sends `start`. The service opens a transcriber stream; local mode spawns and warms the worker before reporting ACTIVE.
2. Each 50 ms frame travels as a binary WebSocket message to the controller, then to the detector. In listen mode the first 1.5 s calibrate the noise floor and never reach recognition.
3. The detector opens a turn on onset, replays 300 ms of pre-roll, and commits on 700 ms of quiet, at the 12 s cap, or on flush, direction change, pause or recalibration. The commit carries its boundary reason and durations.
4. The local adapter queues a final job and writes base64 PCM to the worker. In listen mode it also requests a preview every 3 s of turn audio; a preview shows only the prefix two consecutive hypotheses agree on.
5. The worker resamples to 16 kHz, runs the Silero speech gate, decodes with Whisper at temperature 0, drops low-confidence, no-speech and repetitive pieces, and replies with text, language, timing and quality counters. See [recognition](recognition.md).
6. The adapter rejects repetitive output again and emits a final event with a turn measurement. The controller finalizes the row, drops it if rejected or empty, or marks it original-only when translation is off.
7. With translation on, the controller freezes up to four preceding finalized rows as context and queues the turn. The translator posts a strict JSON schema request and validates the reply. See [translation](translation.md).
8. Every change produces a snapshot, coalesced to 50 ms and repeated with a 2 s heartbeat, to the control socket and all overlays. The overlay shows the last two unexpired finals.

## Identity and invalidation

| Token | Changes on | Guards |
| --- | --- | --- |
| `sessionId` | Start, New session | Browser diagnostics session numbering |
| `generation` | Start, Clear, Recalibrate, New session | Rows, traces, rejected counter and gate reset |
| `epoch` | Same as generation | Late translation results and diagnostics are discarded |
| `streamToken` | Any transcriber open or close | Late transcriber callbacks are ignored |
| `sequence` | Each new turn | Monotonic row order; context uses only lower sequences |

Operations: Start begins a fresh session. Pause finishes the current turn, waits up to 8 s for finals, then releases the microphone. Translate now flushes the current turn and keeps listening. Set mode commits the current turn with its old hint and applies the new one to later turns without reloading the worker. Clear invalidates everything and recreates the worker if capture was active. Recalibrate invalidates rows and pending translations and keeps the worker. New session stops capture and clears all text.

## Bounds

| Item | Value |
| --- | --- |
| Audio frame | 50 ms, 1,200 samples, 2,400 bytes, 24 kHz mono PCM16 LE |
| Control socket limits | 40 audio frames/s, 10 commands/s, 4 KiB payload, 128 KiB send buffer |
| WebSocket clients | 16, one control owner, overlays read-only |
| Pre-roll | 6 frames, 300 ms |
| Quiet boundary | 700 ms |
| Maximum turn | 12,000 ms; `LOCAL_MAX_TURN_MS` accepts 1,000 to 12,000 |
| Minimum committed audio | 100 ms, zero padded |
| Fixed gate, local-only and benchmarks | RMS 0.012, one onset frame |
| Calibrated gate, listen mode | 1.5 s calibration; threshold max(0.004, p90 noise × 2.5); three onset frames; 0.65 hysteresis while open; slow drift while idle |
| Local jobs | 1 active, 2 queued finals, 1 replaceable preview; 8 s queue expiry; 12 s inference deadline; 60 s startup |
| Previews | every 3 s of turn audio in listen mode, two agreeing hypotheses |
| History | 60 rows and 60 turn traces |
| Translation | queue 8, 8 s TTL, 2 concurrent, 12 s timeout, text 4,000 chars, context 4 rows × 800 + 800 chars, glossary 32 entries |
| Session cap | none for local recognition; 25 min for cloud recognition |
| Stall | capture fails after 5 s without audio while active |
| Overlay | last 2 segments, hidden 6 s after last heartbeat, finals expire after 20 s |
| Snapshot | coalesced 50 ms, heartbeat 2 s |

## Failure policy

Any adapter error, malformed worker output, a third queued final, a missed inference deadline, a lost control socket or 5 s without audio puts capture in `failed` with a safe category. Finalized rows stay visible; provisional rows disappear. Capture and paid work never restart on their own; the operator clicks Start. Translation failures mark only their own row and later turns proceed. Whether this policy should soften is tracked in [status](status.md).
