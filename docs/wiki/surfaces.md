# Operator page and overlay

Verified: 2026-11-06 · Sources: apps/web/control.ts, apps/web/control.html, apps/web/overlay.html, apps/web/client.ts, apps/web/history.ts, apps/web/reading.ts, apps/web/visibility.ts, apps/web/pacer.ts, apps/web/overlay.ts, apps/web/style.css, packages/protocol/index.ts, profiles/languages.json, apps/service/server.ts

## /control

The only page that touches the microphone. One control socket may be connected; a second tab is refused. Closing or hiding the tab, a heartbeat gap of 6 s, a stalled audio send or a track ending all stop capture and send `capture-failed`.

Capture request: selected device or System default, mono, `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl` from the checkbox, off by default. The actual track label is shown on the page after Start and never exported. Reload resets the device selection to System default.

| Control | Effect |
| --- | --- |
| Conversation / Lecture | `auto` / the other language into English, `ja-en` for the Japanese pair; labels follow the snapshot's pair; sends `set-mode` while active |
| Start microphone | opens the input, sends `start` with the selected mode |
| Pause | stops the input, sends `pause` |
| Translate now | `flush`: finalize the current turn, keep listening |
| Clear screen | `clear`: drop history and in-flight work |
| Recalibrate room noise | `calibrate`: listen mode only, clears history |
| Direction select, New session, Automatic mic gain, Refresh inputs | under the diagnostics disclosure |

Reading history shows up to 60 rows with keyed DOM updates, Follow latest, Jump to latest, search across originals and translations, and a labeled fictional layout preview that is disabled while capturing. Text & spacing saves only validated display preferences under the local storage key `captions.reading.v1`: translation size 18 to 48 px, original size 12 to 32 px and at least 4 px smaller, spacing, width, the caption diagnostics toggle, and Pace text at reading speed, on by default. Reading focus hides setup controls.

The page shows every row's whole text: what the pacer has released in the normal style, and the rest in a lighter one, which includes text locked but not yet released and, in rolling mode, a partial row's unlocked tail. With pacing off, all locked text is released at once and only the tail stays lighter. Text already in the snapshot when the page connects is shown released.

The Diagnostic log disclosure holds the opt-in content-free log; see [diagnostics](diagnostics.md).

## /overlay

Read-only, no controls, `Permissions-Policy: microphone=()`, and its script imports no capture code. It shows only released text: never a partial row's unlocked tail, and never text the pacer holds back. It renders up to the last six eligible rows with released text, rows that have not expired 20 s after finalization, while the snapshot is fresh within the 6 s heartbeat and capture is neither `connecting` nor `failed`.

The rows sit in a roll-up window anchored at the bottom: when released text adds a line, earlier lines slide up over 250 ms, or move at once with reduced motion, and the window clips the oldest text at its top. Defaults: original 24 px, translation 40 px, a window of about four translation lines, 6% side and 5% bottom margins, translucent dark panels. Settings go in the Browser Source URL, the only query the service accepts: `lines=1` to `8` sizes the window, and `pace=off` releases locked text at once. The operator page keeps full text.

## Pacing

`apps/web/pacer.ts` releases text in each client, so the protocol carries no timing and each surface sets its own. Originals and translations are separate lanes, each released in row order. A lane's rate drains its backlog over about 4 s, held between the floor and ceiling of the language being released, from `reading` in its profile: 8 to 25 characters per second in English, 3 to 10 in Japanese. Other rows' backlog converts by the ratio of ceilings. New text raises the rate smoothly over about half a second; a draining backlog keeps the rate it has until the lane is empty, so a row's end does not slow to the floor. Over 10 s of backlog at the ceiling, the ceiling rises by half again per second, up to three times, and falls back once caught up. English is shown in whole words, Japanese by character. A partial row in Auto has no language yet; its script picks the rates. A display generation or session change, or a lost connection, starts again with existing text shown at once. In turns mode a final can differ from its preview; released text that no longer matches is released again from where they diverge.

## Shared schema

| Schema | Values |
| --- | --- |
| `Command` | `start{mode}`, `set-mode{mode}`, `flush`, `calibrate`, `pause`, `clear`, `new-session`, `capture-failed` |
| `Snapshot.capture` | `paused`, `connecting`, `active`, `stopping`, `failed` |
| `Segment.state` | `partial`, `pending`, `ready`, `failed`, `unresolved`, `skipped`, `original` |
| `Segment.stable` | Optional: the number of leading characters of a partial original that are locked; absent means all of it |
| `Snapshot.processing` | `local-only`, `local-audio-cloud-text`, `cloud-audio-and-text`, `cloud-audio-only` |
| `Failure` | `credentials`, `transcription`, `translation`, `translation-auth`, `translation-rate-limit`, `translation-network`, `capture`, `overload`, `protocol`, `session-limit` |
| `AudioGate` | `calibrating`, `quiet` or `speech`; level; threshold; remaining ms |

Every snapshot carries the full row list and the 60 most recent `TurnTrace` records; the browser validates each one before use.
