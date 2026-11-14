# Status

Verified: 2026-11-14 · Sources: none

This is the handoff page. Rewrite it at the end of every session; `pnpm docs:check` warns when it is older than 14 days. Personal observations belong in `private/`, technical ones here. Measurements are in the linked log entries.

## Where things stand

Direction is set in the [roadmap](roadmap.md): a presenter-controlled caption layer pairing English with one other language per session. Japanese is the first pair; Spanish runs as a pilot beside the open parts of the Japanese [gate](gates.md).

What runs:

- Local Turbo Q4 recognition. Rolling segmentation is the default: it decodes every second, locks text two decodes agree on, and by default shows text three decodes agree on before it locks. Turns mode remains as an option.
- Three translation profiles: off (the default), offline (`pnpm dev:offline`, a pinned local Qwen3.5-4B with streaming replies) and cloud (`pnpm dev:listen`).
- The operator console at `/control`, with an audience view, overlay URL builder, health, shortcuts, runtime settings and a switch between the pairs while capture is off; the roll-up overlay with a reading-pace pacer; opt-in content-free diagnostics read with `pnpm diag:latency`.
- Speech outside the pair is not captioned and leaves a marker row. A recognizer that falls behind restarts on its own, visibly.

The maintainer has rehearsed it in OBS with English, Japanese and off-pair speech, and has run microphone sessions in `en-es` with offline translation; see [other languages](../log/2026-11-10-other-languages.md) and [the session](../log/2026-11-12-en-es-microphone-session.md).

## The Japanese gate

| Part | Standing |
| --- | --- |
| 1. Public and non-speech material | Passes in rolling |
| 2. Held-out material | English passes accuracy. Japanese fails on one talk with frequent pauses at low level, accepted as a known limit in [gates](gates.md). Lock lag and first text on locked text fail for English on continuous speech |
| 3. Stock phrases | The rule is in. The review of new Japanese phrases is the maintainer's, since held-out rows sit under `.local/` |
| 4. Translation | Not run. It is paid, and the maintainer has declined it for now |
| 5. Field session | Accepted as met by the maintainer, with two limits recorded in [gates](gates.md). The calibration warning is built and tested with synthetic levels only |
| 6. Translation delay, offline | Met on four replay talks in the one round run on an idle machine with the closing decode; a second round on a loaded machine does not count. One clean repeat is owed |

The latest runs are in [the entry of 2026-11-13](../log/2026-11-13-closing-decode-and-faint-sweep.md).

## The Spanish pilot

It has a profile, public and held-out sets, a gate file and one full gate run in rolling: every accuracy target passes for Spanish and English, and lock lag and first text miss narrowly, as English does in the Japanese gate. French, Italian and Portuguese clips show no row. The local translator returns valid text on every public case, read but not judged. Open: the maintainer's rating of held-out rows, a spot check of the references, which are unchecked, and a judged translation run. See [the pilot](../log/2026-11-11-spanish-pilot.md) and [its further steps](../log/2026-11-12-spanish-pilot-steps.md).

## Known limits

- The held-out Japanese talk with frequent pauses. Its loss is fragmentation into short stretches, which rolling's short windows decode badly; nothing tested cut it by half. The closing decode makes it slightly worse in most runs.
- A change of language inside a row without a pause: when the first language's decode of the second stays confident, the rest of the row shows the new speech as text in the old language. The maintainer decided not to build detection inside a row for now.
- Overlapping talkers and far-field group speech are not supported. A microphone near the speaker is the supported setup.
- The gate's lock lag and first text measure locked text, though the overlay shows agreed text sooner by default.

## Open problems, ranked

1. Faint speech in rooms. Field rejections in breakout sessions came mostly from the speech gate with the energy gate at its floor. A sweep on clean clips did not reproduce them: recognition holds down to 24 dB under a normal level, and below that the energy gate stops rows from opening. A room's noise under faint speech is untested. The operator page warns when speech-like sound stays under the noise gate.
2. Recognizer failures under load. Each automatic restart reloads the model and loses the speech during it. Whether to drop the oldest queued final instead is open.
3. Translation delay. Left to try: a length close that takes the fresh decode's text. See [translation latency](../log/2026-11-11-translation-latency.md).
4. Proper names and product names are misrecognized in several spellings, which the translation glossary cannot fix. The vocabulary prompt is the candidate, with silence checks.
5. Turns mode: first text waits up to 12 s on continuous speech, and a third-language final still shows as `unknown`. It loses to rolling on every held-out measure; whether to retire it is open.
6. Minor: snapshots are serialized once per client per tick; a pause that exceeds its drain window reports "recognition unavailable"; torch is installed only for a 2 MB VAD model.

## Not verified

- Rolling as the default and the closing decode, in a microphone session.
- Show text early with three decodes, in a session.
- Automatic recognizer restart with the real worker and a real microphone; it is tested with fake providers.
- The masked-speech warning in a real room, and the fixed physical-microphone silence path.
- The diagnostics of 2026-11-10 read from a real session with Japanese speech.
- Translation quality under a judge, local or cloud, for either pair.
- A lecture-length soak under thermal load.
- Real-model browser checks since [the review](../log/2026-10-26-review-and-wiki.md).

## Standing priorities

- Local recognition stays a hard requirement. Cloud recognition is not a substitute.
- Live defaults stay frozen until a controlled comparison shows a benefit. Recognition tuning is paused except for lock lag and first text on continuous speech.
- No paid calls, audience recording, remote exposure or pushing to the public repository without explicit authorization.
- The OBS presentation stack comes after the personal companion is reliable.

## Housekeeping

The repository is public on GitHub. Personal context lives in the ignored `private/` overlay, and the leak scan runs inside `pnpm check`. Dev dependencies `typescript`, `esbuild` and `@types/node` are behind by major versions; not urgent.

## Next session

1. A microphone session in rolling with Japanese speech, diagnostics on: the first with rolling as the default, the closing decode and three-decode early text. Read input levels, applied capture settings, the masked-speech warning and display pacing from the download; macOS Voice Isolation on and off is worth ten minutes of it.
2. Repeat the translation-delay replay on an idle Mac for gate part 6.
3. Decide whether the gate's lock lag and first text should measure shown text. That is a change to the gate, made by a dated decision before the run it applies to.
4. Spanish: the maintainer rates a sample of held-out rows and spot-checks the references.
5. Force a recognizer failure in a rehearsal and watch the restart.
6. The maintainer's reading of the row-length review files and the pacing rates; see [row length](../log/2026-11-08-row-length.md) and [pacing](../log/2026-11-06-pacing.md).

Parked: the judged translation eval; source profiles per [lanes](lanes.md); the vocabulary prompt; the faint-level sweep with a noise bed closer to a room's; the −0.5 noise-confirm threshold against faint far-field speech; two defective development-corpus picks.
