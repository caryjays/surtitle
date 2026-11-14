# Operator page and overlay

Verified: 2026-11-14 · Sources: apps/web/control.ts, apps/web/control.html, apps/web/overlay.html, apps/web/client.ts, apps/web/history.ts, apps/web/reading.ts, apps/web/visibility.ts, apps/web/pacer.ts, apps/web/overlay.ts, apps/web/audience.ts, apps/web/console.ts, apps/web/style.css, packages/protocol/index.ts, profiles/languages.json, apps/service/server.ts

## /control

The operator console and the personal reader, on one page, since only one control socket may be connected; a second tab is refused. It is the only page that touches the microphone. Closing or hiding the tab, a heartbeat gap of 6 s, a stalled audio send or a track ending all stop capture and send `capture-failed`.

Capture request: selected device or System default, mono, `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl` from the Automatic mic gain checkbox, on by default. The actual track label is shown in the status line after Start and never exported, followed by what the browser applied: echo cancellation, noise suppression, automatic gain and sample rate, which can differ from the request. Reload resets the device selection to System default.

Layout: a top bar with the capture state, the listening presets, the capture controls and the input level; a status line with what is processed where, the direction, the actual input, the service status, the current activity and errors; the transcript; and a sidebar of panels. Reading focus hides the presets, the service status, the input level and the sidebar, and gives the transcript the full width. Below 900 px wide the sidebar stacks under the transcript.

| Control | Where | Effect |
| --- | --- | --- |
| Conversation / Lecture | top bar | `auto` / the other language into English, `ja-en` for the Japanese pair; labels, the page heading and the tab title follow the snapshot's pair; sends `set-mode` while active |
| Start microphone | top bar | opens the input, sends `start` with the selected mode |
| Pause | top bar | stops the input, sends `pause` |
| Translate now | top bar | `flush`: finalize the current turn, keep listening |
| Clear screen | top bar | `clear`: drop history and in-flight work |
| Microphone, Refresh inputs, Recalibrate room noise, Automatic mic gain | Input panel | device choice; `calibrate`, listen mode only, keeps finished rows and cancels pending translations |
| Direction, New session | Session panel | any of the three modes; `new-session` |
| Language pair | Session panel, when the service offers more than one pair | `set-pair`: English with any profiled language, only while capture is off; starts a new session in Auto, so the screen and translation context are cleared, and the page relabels itself. Not remembered across a restart, which returns to `LANGUAGE_PAIR` |
| Segmentation | Session panel, when the recognizer offers the choice | `set-segmentation`: turns or rolling, only while capture is off, from the next Start |
| Translate finalized text | Session panel, when a translator is configured; labeled on this Mac or paid cloud requests | `set-translation`: off drops queued requests and keeps originals; a request already sent finishes |

The transcript shows up to 60 rows with keyed DOM updates, Follow latest, Jump to latest, search across originals and translations, and a labeled fictional layout preview that is disabled while capturing. Text & spacing saves only validated display preferences under the local storage key `captions.reading.v1`: translation size 18 to 48 px, original size 12 to 32 px and at least 4 px smaller, spacing, width, the caption diagnostics toggle, and Pace text at reading speed, on by default.

The transcript shows every row's whole text: what the pacer has released in the normal style, and the rest in a lighter one, which includes text locked but not yet released and, in rolling mode, a partial row's unlocked tail. With pacing off, all locked text is released at once and only the tail stays lighter. Text already in the snapshot when the page connects is shown released.

Sidebar panels:

- Audience view: what the overlay shows now, rendered by the overlay's own code on a 1920 × 1080 stage scaled to the panel, with the overlay settings below. It is computed in this page and opens no overlay socket.
- Input and Session: the controls in the table above, and the noise gate's state, level and threshold. A notice appears when sound that rises and falls like speech has stayed under the gate for 10 s, the sign of a calibration that left the threshold above the speech.
- Overlay for OBS: caption window lines, pacing and Show text early, saved as validated settings under `captions.overlay.v1`, and the Browser Source URL that carries them, with Copy and Open.
- Health: connection, capture, recognizer and segmentation, translation, queue, filtered rows, and medians over the last 10 rows of decode time, first text and lock lag in rolling mode or commit to final in turns mode, translation request time, and failed or skipped rows. No speech text.
- Diagnostic log: the opt-in content-free log; see [diagnostics](diagnostics.md).
- Help & notes.

Keyboard shortcuts, ignored while typing in a field or with a modifier key: S starts the microphone or pauses, T is Translate now, 1, 2 and 3 choose automatic, Lecture and the other fixed direction, R toggles Reading focus, L jumps to the latest row, / focuses search, and ? lists them. Clear screen and New session have none, since they destroy text.

## /overlay

Read-only, no controls, `Permissions-Policy: microphone=()`, and its script imports no capture code. It shows only released text: never a partial row's unlocked tail, and never text the pacer holds back. With Show text early, on by default and rolling only, a partial row's agreed text counts as releasable too: the start of the unlocked tail that three consecutive decodes agree on. It appears seconds before its Whisper segment locks, and unlike locked text it can change; a change is swapped in place, and what was released stays released. A translation streamed by the local translator is released as it grows, and is withdrawn if the request then fails. It renders up to the last six eligible rows with released text, rows that have not expired 20 s after finalization, while the snapshot is fresh within the 6 s heartbeat and capture is neither `connecting` nor `failed`.

The rows sit in a roll-up window anchored at the bottom: when released text adds a line, earlier lines slide up over 250 ms, or move at once with reduced motion, and the window clips the oldest text at its top. The window follows the translation being read: while a shown row's translation is pending or not all released, the roll stays low enough to keep that text in the window, all of it if it fits and its end otherwise, and later rows that would show only in part below the window wait there unseen. Once it is released the roll returns to its bottom anchor. With translation off nothing is held. Defaults: original 24 px, translation 40 px, a window of about four translation lines, 6% side and 5% bottom margins, translucent dark panels. Settings go in the Browser Source URL, the only query the service accepts: `lines=1` to `8` sizes the window, `pace=off` releases locked text at once, and `early=off` holds a rolling row's text until it locks. The operator page keeps full text.

Speech that was heard but is not captioned leaves a marker row instead of empty space: a muted italic line holding both pair languages' `uncaptioned` labels from the profiles, `[ not captioned · 字幕なし ]`, which never names the speech's language. The overlay and audience view show it for speech outside the pair; the operator page also shows it for speech the recognition filters rejected, with the reason in the row details. Non-speech leaves nothing. A marker fades with its row like any other.

## Pacing

`apps/web/pacer.ts` releases text in each client, so the protocol carries no timing and each surface sets its own. Originals and translations are separate lanes, each released in row order. A lane's rate drains its backlog over about 4 s, held between the floor and ceiling of the language being released, from `reading` in its profile: 8 to 25 characters per second in English, 3 to 10 in Japanese. Other rows' backlog converts by the ratio of ceilings. New text raises the rate smoothly over about half a second; a draining backlog keeps the rate it has until the lane is empty, so a row's end does not slow to the floor. Over 10 s of backlog at the ceiling, the ceiling rises by half again per second, up to three times, and falls back once caught up. A language written with spaces, `spaced` in its profile, is shown in whole words; Japanese is shown by character. A partial row in Auto has no language yet; its script picks the rates. A display generation or session change, or a lost connection, starts again with existing text shown at once. In turns mode a final can differ from its preview; released text that no longer matches is released again from where they diverge. A display that shows text early instead keeps its released length when an original changes.

## Shared schema

| Schema | Values |
| --- | --- |
| `Command` | `start{mode}`, `set-mode{mode}`, `flush`, `calibrate`, `pause`, `clear`, `new-session`, `capture-failed`, `set-segmentation{segmentation}`, `set-translation{enabled}`, `set-pair{pair}` |
| `Snapshot.segmentation` | `turns`, `rolling`, or null when the recognizer has one fixed segmentation |
| `Snapshot.translation` | `available`: a translator was configured at startup; `enabled`: it is on for this session |
| `Snapshot.capture` | `paused`, `connecting`, `active`, `stopping`, `failed`; `restarting` is set while `connecting` after a recognizer failure, and `restarts` counts those since Start |
| `Segment.state` | `partial`, `pending`, `ready`, `failed`, `unresolved`, `skipped`, `original` |
| `Segment.stable` | Optional: the number of leading characters of a partial original that are locked; absent means all of it |
| `Segment.agreed` | Optional, only when more than `stable`: the number of leading characters three consecutive decodes agree on, which a display may show early and which can change |
| `Snapshot.processing` | `local-only`, `local-audio-local-text`, `local-audio-cloud-text`, `cloud-audio-and-text`, `cloud-audio-only` |
| `Failure` | `credentials`, `transcription`, `translation`, `translation-auth`, `translation-rate-limit`, `translation-network`, `capture`, `overload`, `protocol`, `session-limit` |
| `AudioGate` | `calibrating`, `quiet` or `speech`; level; threshold; remaining ms |

Every snapshot carries the full row list and the 60 most recent `TurnTrace` records; the browser validates each one before use.
