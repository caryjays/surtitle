# Status

Verified: 2026-11-18 · Sources: none

This is the handoff page. Rewrite it at the end of every session; `pnpm docs:check` warns when it is older than 14 days. Personal observations belong in `private/`, technical ones here. Measurements are in the linked log entries.

## Where things stand

Direction is set in the [roadmap](roadmap.md): a presenter-controlled caption layer pairing English with one other language per session. Japanese is the first pair and Spanish a pilot; French, Italian and Portuguese have profiles and gates in the pilot's shape. Other languages no longer wait for the Japanese [gate](gates.md); each ships by passing its own.

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
| 2. Held-out material | English passes accuracy. Japanese fails on one talk with frequent pauses at low level, accepted as a known limit in [gates](gates.md). Lock lag and first text failed for English under the targets of the runs so far; since 2026-11-16 they are reported, not gated |
| 3. Stock phrases | The rule is in. The review of new Japanese phrases is the maintainer's, since held-out rows sit under `.local/` |
| 4. Translation | Not run. It is paid, and the maintainer has declined it for now. A read-through by one agent judge, reported and not gated, puts the offline profile under the part's targets in both directions; see below |
| 5. Field session | Accepted as met by the maintainer, with two limits recorded in [gates](gates.md). The calibration warning is built and tested with synthetic levels only |
| 6. Translation delay, offline | Met on all four talks under sustained load on a committed tree, with the reply's opening; see [the run of 2026-11-18](../log/2026-11-18-translation-delay-opening-run.md). Since 2026-11-16 the only target on how soon captions appear, in every gate |

The latest gate run is in [the entry of 2026-11-15](../log/2026-11-15-japanese-gate-shown-text.md), and the latest translation-delay run in [the run of 2026-11-18](../log/2026-11-18-translation-delay-opening-run.md).

## Translation quality

The maintainer does not read the gate languages, so an agent session grades the offline profile by reading whole held-out talks; the method is in [gates](gates.md#translation-read-through). In the first read-through, long complete sentences translate well in all four directions and the mean grade on correctly recognized rows runs from 3.8 to 4.3 of 5, English to Japanese lowest on jargon-heavy earnings calls. The losses are subjects the 4B model gets wrong where the source language leaves them out, terms and names that change within a talk, and recognition errors translated faithfully. Rewording how the translator uses its context fixed few of them. See [the read-through](../log/2026-11-14-translation-read-through.md).

## The Spanish pilot

It has a profile, public and held-out sets, a gate file and one full gate run in rolling: every measured accuracy target passes for Spanish and English; lock lag and first text missed narrowly under the run's targets, which are reported, not gated, since 2026-11-16. Translation delay, part 6, passes on 6 of 8 talks under sustained load; two miss, one by 0.1 s; see [the run of 2026-11-18](../log/2026-11-18-translation-delay-opening-run.md). The share of held-out rows rated major or hallucinated is a target too and is not measured until the rows are rated. Open: a rating of held-out rows for recognition, a spot check of the references, which are unchecked, and a judged translation run. See [the pilot](../log/2026-11-11-spanish-pilot.md) and [its further steps](../log/2026-11-12-spanish-pilot-steps.md).

## French, Italian and Portuguese

Each has a profile, public and held-out sets, swept stock phrases, a gate file and one full gate run in rolling. Italian passes every measured accuracy target; the rated share of major rows is not measured in any of the three. French fails held-out error over one-pass, on two talks cut into many rows; Portuguese fails held-out deletions narrowly, on one talk. Lock lag missed in all three and first text in Italian under the runs' targets, now reported, not gated. Translation delay, part 6, passes on every talk in French and Portuguese under sustained load, and on 7 of 8 in Italian; see [the run of 2026-11-18](../log/2026-11-18-translation-delay-opening-run.md). No neighbour language shows a row in any of the pairs. See [the entry](../log/2026-11-14-french-italian-portuguese.md).

The two French talks have the shape of the Japanese talk with frequent pauses: nearly every row closed by a pause and many under two seconds. The Portuguese talk loses whole phrases in its first two minutes, where the speech gate rejects decodes at a normal level; the cause was not listened for. Whether to accept either as a limit is the maintainer's decision. The local translator returns valid replies in the right direction on every public clip of the three pairs, and the offline browser smoke passes in each. A read-through of Italian puts Italian to English at a mean of 4.4 of 5 on correctly recognized rows and English to Italian at 4.1, neither meeting part 4's targets. No microphone session has run in the three pairs. See [the trace and read-through](../log/2026-11-15-failing-talks-and-italian-read-through.md).

## Known limits

- The held-out Japanese talk with frequent pauses. Its loss is fragmentation into short stretches, which rolling's short windows decode badly; nothing tested cut it by half. The closing decode makes it slightly worse in most runs.
- A change of language inside a row without a pause: when the first language's decode of the second stays confident, the rest of the row shows the new speech as text in the old language. The maintainer decided not to build detection inside a row for now.
- Overlapping talkers and far-field group speech are not supported. A microphone near the speaker is the supported setup.

## Open problems, ranked

1. Faint speech in rooms. Field rejections in breakout sessions came mostly from the speech gate with the energy gate at its floor. A sweep on clean clips did not reproduce them: recognition holds down to 24 dB under a normal level, and below that the energy gate stops rows from opening. A room's noise under faint speech is untested. The operator page warns when speech-like sound stays under the noise gate.
2. Recognizer failures under load. Each automatic restart reloads the model and loses the speech during it. Whether to drop the oldest queued final instead is open.
3. Translation quality of the local 4B model. It picks the wrong subject where Spanish, Italian or Japanese leaves it out, with the preceding rows in front of it, and terms and names change within a talk. A reworded context instruction fixed about a fifth of the low rows on two talks. Left for now by the maintainer's call. Candidates when it is taken up, each testable by re-translating the stored transcripts: a larger local model, a term list kept during the talk.
4. Translation delay in Spanish and Italian, where three talks still miss part 6 with the reply's opening. Left to try: a length close that takes the fresh decode's text. See [translation latency](../log/2026-11-11-translation-latency.md).
5. Proper names and product names are misrecognized in several spellings, which the translation glossary cannot fix. The vocabulary prompt is the candidate, with silence checks.
6. Turns mode: first text waits up to 12 s on continuous speech, and a third-language final still shows as `unknown`. It loses to rolling on every held-out measure; whether to retire it is open.
7. Minor: snapshots are serialized once per client per tick; a pause that exceeds its drain window reports "recognition unavailable"; torch is installed only for a 2 MB VAD model.

## Not verified

- Rolling as the default and the closing decode, in a microphone session.
- Show text early with three decodes, in a session.
- Automatic recognizer restart with the real worker and a real microphone; it is tested with fake providers.
- The masked-speech warning in a real room, and the fixed physical-microphone silence path.
- The diagnostics of 2026-11-10 read from a real session with Japanese speech.
- A microphone session, or any speech but replayed recordings, in `en-fr`, `en-it` or `en-pt`.
- Translation quality in French and Portuguese under any judge.
- Translation quality under a second judge from another model family, and the cloud translators under any judge.
- A lecture-length soak under thermal load.
- Real-model browser checks since [the review](../log/2026-10-26-review-and-wiki.md).

## Standing priorities

- Local recognition stays a hard requirement. Cloud recognition is not a substitute.
- Live defaults stay frozen until a controlled comparison shows a benefit. Recognition tuning is paused. Timing work is judged by speech to translated text, which part 6 gates.
- No paid calls, audience recording, remote exposure or pushing to the public repository without explicit authorization.
- The OBS presentation stack comes after the personal companion is reliable.

## Housekeeping

The work on French, Italian and Portuguese is merged into `main` and pushed. Dates in the docs follow the Mac's clock; see [the corrections](../log/2026-11-15-docs-corrections.md). The repository is public on GitHub. Personal context lives in the ignored `private/` overlay, and the leak scan runs inside `pnpm check`. Dev dependencies `typescript`, `esbuild` and `@types/node` are behind by major versions; not urgent.

## Next session

1. A microphone session in rolling with Japanese speech, diagnostics on: the first with rolling as the default, the closing decode and three-decode early text. Read input levels, applied capture settings, the masked-speech warning and display pacing from the download; macOS Voice Isolation on and off is worth ten minutes of it.
2. Translation delay, part 6, measured under sustained load since 2026-11-17: reduce what recognition and the translator cost each other on the shared GPU. Holding rolling decodes while the translator starts gave no clear gain ([decode hold](../log/2026-11-17-decode-hold.md)); giving the model the known opening of its reply instead of generating it cut about 1 s in French under sustained load ([reply opening](../log/2026-11-17-reply-opening.md)), and is live since 2026-11-18 after a read over the same recognized text in French and Japanese ([made live](../log/2026-11-18-reply-opening-live.md)). With it, 33 of 36 talks pass in the full sustained run; Spanish misses on two talks and Italian on one ([the run of 2026-11-18](../log/2026-11-18-translation-delay-opening-run.md)). The translator alone takes about 0.5 s to its first text, 1 to 2 s in a replay. Open: whether a gate run adds a presentation-like load such as OBS, and how many replays each talk needs, since one talk moves by about 1 s between replays and two of the misses are by 0.1 s. See [the breakdown](../log/2026-11-17-translation-delay-breakdown.md). A full run takes about 3 hours and 20 minutes; see [the runner](../log/2026-11-17-translation-delay-runner.md). It is the only target on how soon captions appear since [the decision of 2026-11-16](../log/2026-11-16-translation-delay-gated.md).
3. French and Portuguese: the maintainer's decision on the failing talks, after listening to the opening of the Portuguese one, recorded in [decisions](decisions.md) and under accepted limits in [gates](gates.md) if accepted. Then a translation read-through of each, as done for Italian: `review_export.py --gate fr`, about an hour of replay, and one grading session per direction.
4. Spanish: the maintainer rates a sample of held-out rows and spot-checks the references.
5. Force a recognizer failure in a rehearsal and watch the restart.
6. The maintainer's reading of the row-length review files and the pacing rates; see [row length](../log/2026-11-08-row-length.md) and [pacing](../log/2026-11-06-pacing.md).

Parked: translation quality of the local model, with a larger model as the first thing to try; the judged translation eval; source profiles per [lanes](lanes.md); the vocabulary prompt; the faint-level sweep with a noise bed closer to a room's; the −0.5 noise-confirm threshold against faint far-field speech; two defective development-corpus picks.
