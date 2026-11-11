# Status

Verified: 2026-11-11 · Sources: none

This is the handoff page. Rewrite it at the end of every session; `pnpm docs:check` warns when it is older than 14 days. Personal observations belong in `private/`, technical ones here.

## Where things stand

Direction is set in the [roadmap](roadmap.md): a presenter-controlled caption layer pairing English with one other language per session, Japanese first. No language is added until Japanese passes its [gate](gates.md).

What runs today:

- Local Turbo Q4 recognition in two segmentation modes, turns and rolling. Rolling decodes every second, shows text two decodes agree on, and is what the maintainer rehearses with.
- Three translation profiles: off (the default), cloud (`pnpm dev:listen`, used at a live conference), and offline (`pnpm dev:offline`, a pinned local Qwen3.5-4B with streaming replies).
- The operator console at `/control` with an audience view, overlay URL builder, health, shortcuts and runtime settings; the roll-up overlay with a reading-pace pacer; opt-in content-free diagnostics and `pnpm diag:latency`.
- Rehearsed by the maintainer in OBS with English, Japanese and off-pair speech: captions held, rows outside the pair no longer show, and speech heard but not captioned leaves a marker row; see [other languages](../log/2026-11-10-other-languages.md).

The Japanese gate, part by part:

1. Public and non-speech material: rolling passes every target; see [settle at lock](../log/2026-11-04-settle-at-lock.md) and [noise confirm](../log/2026-11-04-noise-confirm.md).
2. Held-out material, live minus the model's one-pass decode: English passes; Japanese fails, mostly on one talk with frequent pauses at low level. The 2026-11-11 run in both modes repeats that, with rolling ahead of turns on every held-out measure; rolling also fails English lock lag and first text on continuous speech, and showed one non-speech row, not yet examined; see [the entry](../log/2026-11-11-outlier-talk-and-settle-pair.md). The maintainer accepted this part with that talk as a known limit; see [gates](gates.md).
3. Stock phrases: the rule is in; the review of new Japanese phrases is the maintainer's, since held-out rows sit under `.local/`.
4. Translation: not run against the gate; it is paid and needs authorization.
5. Field session: not done. The calibration warning it asks for is built and tested with synthetic levels only; see [the entry](../log/2026-11-11-outlier-talk-and-settle-pair.md).

Recognition tuning is paused again. The maintainer lifted the pause on 2026-11-11 for the failing talk under a stop rule, and nothing tested cut its loss by half: input level, loop recovery, a text prompt, forced Japanese, a longer quiet before a stretch closes, and audio left context. The loss is fragmentation into short stretches, which rolling's short windows decode badly; see [the entry](../log/2026-11-11-outlier-talk-and-settle-pair.md).

Latency in rolling with offline translation, from real-time replays: about 2 to 3 s from the end of speech to final text, 3 to 5 s from a row's last word to the first translated text, and 6.5 to 8 s or more from the middle of a row. Lock lag is the largest part. The settle time is now 0.5 s, from 1.0 s, by the maintainer's call: faster in two replay pairs run in opposite orders, with error 0.1 to 1.1 points higher in the one pair that scored it and run-to-run noise unmeasured; see [the entry](../log/2026-11-11-outlier-talk-and-settle-pair.md). No gate run has used 0.5 yet.

Observed in the field by the maintainer:

- Lecture and Q&A with about 50 people on shared Wi-Fi: local recognition smooth; most translations readable; translation lag of 2 to 3 s acceptable; some loanword phrases upset language detection; proper names confused.
- Breakout and group sessions: heavy false rejection, most of it by the speech gate before Whisper with the energy gate at its floor. Raising the hardware input level helped noticeably.

Not verified: automatic recognizer restart with the real worker and a real microphone, which is tested with fake providers only; a gate run at settle 0.5; the masked-speech warning in a real room; any of the 2026-11-10 diagnostics read from a real session; local translation quality under a judge; Haiku 5.5 against Terra on held-out cases; the fixed physical-microphone silence path; a lecture-length soak under thermal load; real-model browser checks since [the review](../log/2026-10-26-review-and-wiki.md).

## Open problems, ranked

1. Group-speech false rejection. Hypotheses: Chrome's echo cancellation and noise suppression attenuate distant speech, and audio reaches Silero with no level normalization. Diagnostics carry per-turn input level and the capture settings the browser applied, and the operator page warns when speech-like sound stays under the noise gate. Next: read these from a room session.
2. The held-out Japanese talk with frequent pauses. A known limit, kept in the set. And one non-speech row in each mode of the 2026-11-11 gate run, where earlier runs had none.
3. Recognizer failures under load. A third queued final or a missed inference deadline now restarts the recognizer on its own, visibly, at most twice in five minutes; each restart reloads the model, and speech during it is lost. Whether to drop the oldest queued final instead of restarting is open.
4. Translation still feels late in rehearsal. Row length and lock lag dominate; pieces translated before a row closes read worse and stay off; see [piece quality](../log/2026-11-10-piece-quality.md).
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

1. A room session of at least 30 minutes with diagnostics on, which is gate part 5 and the evidence for problem 1. Read the input levels, applied capture settings, the masked-speech warning and display pacing from the download.
2. Find the input behind the non-speech row in the 2026-11-11 gate runs and whether it repeats.
3. A held-out gate run in rolling at settle 0.5, on an idle Mac, to confirm the new default against the 2026-11-11 run at 1.0. Then force a recognizer failure in a rehearsal and watch the restart.
4. The judged translation eval, gate part 4, is paid and the maintainer declined it for now; translation defaults stay frozen.
5. The maintainer's reading of the row-length review files and the pacing rates; see [row length](../log/2026-11-08-row-length.md) and [pacing](../log/2026-11-06-pacing.md).
6. Parked: source profiles per [lanes](lanes.md); the faint-level sweep; the vocabulary prompt; the −0.5 noise-confirm threshold against faint far-field speech; two defective development-corpus picks.
7. The Spanish pilot, after the Japanese gate, in order: a `--language` path in `prepare_gate_fixtures.py` that writes a public manifest per language without touching `gate-fleurs.json`; a held-out source with human references, its licence checked first; `benchmarks/gate-es.json` and its wiki table, written before any run; the Spanish profile with a stock-phrase sweep; French and Italian clips in the third-language set; translation cases and terms for the pair.
