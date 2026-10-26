# Operator page and overlay

Verified: 2026-10-26 · Sources: apps/web/control.ts, apps/web/control.html, apps/web/overlay.html, apps/web/client.ts, apps/web/history.ts, apps/web/reading.ts, apps/web/visibility.ts, apps/web/style.css, packages/protocol/index.ts

## /control

The only page that touches the microphone. One control socket may be connected; a second tab is refused. Closing or hiding the tab, a heartbeat gap of 6 s, a stalled audio send or a track ending all stop capture and send `capture-failed`.

Capture request: selected device or System default, mono, `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl` from the checkbox, off by default. The actual track label is shown on the page after Start and never exported. Reload resets the device selection to System default.

| Control | Effect |
| --- | --- |
| Conversation / Lecture | `auto` / `ja-en`; sends `set-mode` while active |
| Start microphone | opens the input, sends `start` with the selected mode |
| Pause | stops the input, sends `pause` |
| Translate now | `flush`: finalize the current turn, keep listening |
| Clear screen | `clear`: drop history and in-flight work |
| Recalibrate room noise | `calibrate`: listen mode only, clears history |
| Direction select, New session, Automatic mic gain, Refresh inputs | under the diagnostics disclosure |

Reading history shows up to 60 rows with keyed DOM updates, Follow latest, Jump to latest, search across originals and translations, and a labeled fictional layout preview that is disabled while capturing. Text & spacing saves only validated display preferences under the local storage key `captions.reading.v1`: translation size 18 to 48 px, original size 12 to 32 px and at least 4 px smaller, spacing, width, and the caption diagnostics toggle. Reading focus hides setup controls.

The Diagnostic log disclosure holds the opt-in content-free log; see [diagnostics](diagnostics.md).

## /overlay

Read-only, no controls, `Permissions-Policy: microphone=()`, and its script imports no capture code. It renders the last two eligible segments: rows with an original that have not expired 20 s after finalization, while the snapshot is fresh within the 6 s heartbeat and capture is neither `connecting` nor `failed`. Defaults: original 24 px, translation 40 px, two and three line clamps, 6% side and 5% bottom margins, translucent dark panel. The operator page keeps full text when the overlay clips.

## Shared schema

| Schema | Values |
| --- | --- |
| `Command` | `start{mode}`, `set-mode{mode}`, `flush`, `calibrate`, `pause`, `clear`, `new-session`, `capture-failed` |
| `Snapshot.capture` | `paused`, `connecting`, `active`, `stopping`, `failed` |
| `Segment.state` | `partial`, `pending`, `ready`, `failed`, `unresolved`, `skipped`, `original` |
| `Snapshot.processing` | `local-only`, `local-audio-cloud-text`, `cloud-audio-and-text`, `cloud-audio-only` |
| `Failure` | `credentials`, `transcription`, `translation`, `translation-auth`, `translation-rate-limit`, `translation-network`, `capture`, `overload`, `protocol`, `session-limit` |
| `AudioGate` | `calibrating`, `quiet` or `speech`; level; threshold; remaining ms |

Every snapshot carries the full row list and the 60 most recent `TurnTrace` records; the browser validates each one before use.
