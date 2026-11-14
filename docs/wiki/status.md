# Status

Verified: 2026-11-13 · Sources: none

This is the handoff page. Rewrite it at the end of every session; `pnpm docs:check` warns when it is older than 14 days. Personal observations belong in `private/`, technical ones here.

## Where things stand

Direction is set in the [roadmap](roadmap.md): a presenter-controlled caption layer pairing English with one other language per session, Japanese first. A Spanish pilot runs beside the open parts of the Japanese [gate](gates.md), by the maintainer's call of 2026-11-11.

What runs today:

- Local Turbo Q4 recognition in two segmentation modes, turns and rolling. Rolling decodes every second, shows text two decodes agree on, and is what the maintainer rehearses with.
- Three translation profiles: off (the default), cloud (`pnpm dev:listen`, used at a live conference), and offline (`pnpm dev:offline`, a pinned local Qwen3.5-4B with streaming replies).
- The operator console at `/control` with an audience view, overlay URL builder, health, shortcuts and runtime settings; the roll-up overlay with a reading-pace pacer; opt-in content-free diagnostics and `pnpm diag:latency`.
- Rehearsed by the maintainer in OBS with English, Japanese and off-pair speech: captions held, rows outside the pair no longer show, and speech heard but not captioned leaves a marker row; see [other languages](../log/2026-11-10-other-languages.md).

The Japanese gate, part by part:

1. Public and non-speech material: rolling passes every target, again on 2026-11-11 at settle 0.5 after a non-speech row that the pair rules had brought back was traced and fixed; see [the Spanish pilot](../log/2026-11-11-spanish-pilot.md).
2. Held-out material, live minus the model's one-pass decode: English passes; Japanese fails, mostly on one talk with frequent pauses at low level. The 2026-11-11 run in both modes repeats that, with rolling ahead of turns on every held-out measure; rolling also fails English lock lag and first text on continuous speech; see [the entry](../log/2026-11-11-outlier-talk-and-settle-pair.md). A run on 2026-11-13 at settle 0.5 gives the same picture: the shorter settle costs Japanese nothing measurable, the part still fails on the one talk, and English lock lag and first text are shorter but over target; see [the entry](../log/2026-11-13-closing-decode-and-faint-sweep.md). The maintainer accepted this part with that talk as a known limit; see [gates](gates.md).
3. Stock phrases: the rule is in; the review of new Japanese phrases is the maintainer's, since held-out rows sit under `.local/`.
4. Translation: not run against the gate; it is paid and needs authorization.
5. Field session: accepted as met by the maintainer on 2026-11-12, on a 24.5-minute microphone session in `en-es` with no capture failure and no recognizer restart; it is under 30 minutes and held no Japanese speech, both recorded in [gates](gates.md). The calibration warning the part asks for is built and tested with synthetic levels only; see [the entry](../log/2026-11-11-outlier-talk-and-settle-pair.md).

The Spanish pilot has a profile, public and held-out sets, a gate file with targets, and one full real-time gate run in rolling: every accuracy target passes for Spanish and English, with no row in the wrong language and no non-speech row; lock lag and first text miss narrowly for both, as English does in the Japanese gate. The held-out references are unchecked and its excerpts have digital silence between segments. Its stock phrases come from a sweep; French, Italian and Portuguese clips show no row; the local translator returns valid Spanish and English on every public case, read but not judged; and a session in `en-es` runs end to end in the real-model browser check and a real-time replay, with translation delay close to the Japanese pair's. The maintainer's first `en-es` session found the local translator losing its direction right after a language switch; two guards fixed it, confirmed in a second session with switches in the pair and one to French. The operator page can switch the pair while capture is off; the maintainer used it for a microphone session in `en-es`, stopped after nine minutes with two problems, both fixed, and a second session of 24.5 minutes then ran to the maintainer's satisfaction with every shown row translated and ten changes of language followed: short rows pushed a long translation out of the overlay window before it was read, so the window now follows the translation being read; and a change to English inside a Spanish row without a pause gave no rows until the pause, so a noise trim now closes a row that holds text and the stretch detects its language again. One case stays as a known limit: when the first language's decode of the second stays confident, the rest of that row shows the new speech as text in the old language. The maintainer decided on 2026-11-12 not to build detection inside a row for now, since changes of language were followed well in recent sessions. See [the session](../log/2026-11-12-en-es-microphone-session.md). Not yet: a judged translation run, and the maintainer's rating of held-out rows. See [the Spanish pilot](../log/2026-11-11-spanish-pilot.md) and [its further steps](../log/2026-11-12-spanish-pilot-steps.md).

The maintainer lifted the tuning pause on 2026-11-12 for lock lag and first text on continuous speech. One lever was found and built as an overlay setting, Show text early: it shows the part of a rolling row that decodes agree on before its Whisper segment locks. The maintainer found the first version, two decodes, noisy in a session; it now needs three and swaps changed words in place. In real-time replays text then shows 1.0 to 1.8 s sooner at the median and 3 to 5 s sooner in slow rows, with a word change under once a minute. The maintainer made it the default on 2026-11-12; the third-language and non-speech streams replayed with it, applause included, show no text early. The three-decode version has not been seen in a session, and the gate's two timing targets still measure locked text and still fail; see [early text](../log/2026-11-12-early-text.md) and [the default](../log/2026-11-12-early-text-default.md). Other recognition tuning stays paused. The maintainer lifted the pause on 2026-11-11 for the failing talk under a stop rule, and nothing tested cut its loss by half: input level, loop recovery, a text prompt, forced Japanese, a longer quiet before a stretch closes, and audio left context. The loss is fragmentation into short stretches, which rolling's short windows decode badly; see [the entry](../log/2026-11-11-outlier-talk-and-settle-pair.md).

Latency in rolling with offline translation, from real-time replays: about 2 s from the end of speech to final text, 2 to 3.5 s from a row's last word to the first translated text, and 5.5 to 7 s from the middle of a row, about half a row of which is waiting for the sentence to end. The delay now has a target, gate part 6: last word to first translated text at most 3.0 s at the median and 4.5 s at p90; the two Japanese replay talks meet it and the two English ones miss by 0.1 to 0.3 s. Two changes of 2026-11-11 are in: the settle time is 0.5 s, from 1.0 s, by the maintainer's call, and the local translator reuses the shared start of its prompts, 0.2 to 0.5 s faster to first text. Speculative translation at the pause was tried and rejected. See [translation latency](../log/2026-11-11-translation-latency.md) and [the settle pair](../log/2026-11-11-outlier-talk-and-settle-pair.md). All gate material has run at settle 0.5. A change of 2026-11-13 is in the working tree: a decode sent 300 ms into a quiet becomes the closing decode when the stretch closes, so the final does not queue behind a rolling decode. In two rounds of replays the close-to-final median fell on every talk and first translated text came 0.1 to 1.5 s sooner in 10 of 12 comparisons, with recognition error unchanged. Two full gate runs with it match the run without on every gated measure, except that the first held one row flagged repetitive on the talk with frequent pauses, where the target is zero; the second, on a quieter machine, had none, and neither do the other seven runs of that talk. That talk is 0.6 to 0.9 points worse with the change in three runs of four. See [the entry](../log/2026-11-13-closing-decode-and-faint-sweep.md).

Observed in the field by the maintainer:

- Lecture and Q&A with about 50 people on shared Wi-Fi: local recognition smooth; most translations readable; translation lag of 2 to 3 s acceptable; some loanword phrases upset language detection; proper names confused.
- Breakout and group sessions: heavy false rejection, most of it by the speech gate before Whisper with the energy gate at its floor. Raising the hardware input level helped noticeably.

Not verified: automatic recognizer restart with the real worker and a real microphone, which is tested with fake providers only; the closing decode in a session; a change of language inside a row in a real session; the three-decode Show text early in a session; Spanish translation under a judge; the masked-speech warning in a real room; any of the 2026-11-10 diagnostics read from a real session; local translation quality under a judge; Haiku 5.5 against Terra on held-out cases; the fixed physical-microphone silence path; a lecture-length soak under thermal load; real-model browser checks since [the review](../log/2026-10-26-review-and-wiki.md).

## Open problems, ranked

1. Group and breakout sessions. The maintainer's position: overlapping talkers are out of reach for the current model, and a microphone near the speaker, passed around or a beamforming speakerphone, is the supported setup; far-field group speech is not supported. A separate, smaller question stays open: the field rejections were mostly the speech gate on faint audio, which may also hit a quiet speaker on a proper microphone; the faint-level sweep of 2026-11-13 did not find it on clean clips: recognition is unchanged down to 24 dB under a normal level, and below that the energy gate, not the speech gate, stops rows from opening. A room's noise under faint speech is untested. The operator page warns when speech-like sound stays under the noise gate.
2. The held-out Japanese talk with frequent pauses. A known limit, kept in the set.
3. Recognizer failures under load. A third queued final or a missed inference deadline now restarts the recognizer on its own, visibly, at most twice in five minutes; each restart reloads the model, and speech during it is lost. Whether to drop the oldest queued final instead of restarting is open.
4. Translation delay. The closing decode is built and all four replay talks met the target with it in the one round run on an idle machine. Left to try: a length close that takes the fresh decode's text. Row length cuts the tail only; pieces read worse and stay off; see [translation latency](../log/2026-11-11-translation-latency.md).
5. Proper names and product names are misrecognized in several spellings, which the translation glossary cannot fix. The vocabulary prompt is the candidate, with silence checks.
6. Turns mode: first text waits up to 12 s on continuous speech, and a third-language final still shows as `unknown`.
7. Minor: snapshots are serialized once per client per tick; a pause that exceeds its drain window reports "recognition unavailable"; torch is installed only for a 2 MB VAD model.

## Standing priorities

- Local recognition stays a hard requirement. Cloud recognition is not a substitute.
- Live defaults stay frozen until a controlled comparison shows a benefit.
- No paid calls, audience recording, remote exposure or publishing without explicit authorization.
- The OBS presentation stack comes after the personal companion is reliable.

## Housekeeping

The project is named Surtitle throughout. Personal context lives in the ignored `private/` overlay, and the leak scan runs inside `pnpm check`. Whether `origin` has been pushed was not checked. Dev dependencies `typescript`, `esbuild` and `@types/node` are behind by major versions; not urgent.

## Next session

In order:

1. Nothing is owed for gate part 5. The next microphone session with Japanese speech is still worth its diagnostics download, since the accepted session held none: read the input levels, applied capture settings, the masked-speech warning and display pacing from the download; macOS Voice Isolation on and off is worth ten minutes of it.
2. Spanish: the maintainer rates a sample of held-out rows for the major-error share and spot-checks the references. A judged translation run for the pair is paid and waits with the Japanese one.
3. Whether the gate's lock lag and first text should measure shown text, now that Show text early is the default; that is a change to the gate, made by a dated decision before the run it applies to. The closing decode is in the working tree, uncommitted, with two gate runs behind it. Repeat the replay on an idle Mac for gate part 6. Then force a recognizer failure in a rehearsal and watch the restart.
4. The judged translation eval, gate part 4, is paid and the maintainer declined it for now; translation defaults stay frozen.
5. The maintainer's reading of the row-length review files and the pacing rates; see [row length](../log/2026-11-08-row-length.md) and [pacing](../log/2026-11-06-pacing.md).
6. Parked: the faint-level sweep with a louder or speech-like noise bed; source profiles per [lanes](lanes.md); the vocabulary prompt; the −0.5 noise-confirm threshold against faint far-field speech; two defective development-corpus picks; whether to retire turns mode, which loses to rolling on every held-out measure.
