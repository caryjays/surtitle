# Japanese gate targets

2026-10-28. The targets were written before any gate measurement, as the roadmap requires. Gate tooling was then built and the public and non-speech parts were run once in each segmentation mode.

## What was done

The roadmap's five gate parts now have numbers in [gates](../wiki/gates.md), with the reason recorded in [decisions](../wiki/decisions.md).

## How the numbers were chosen

| Target | Basis |
| --- | --- |
| Held-out JA CER ≤ 5.0%, deletions ≤ 2.0% | Rolling replay on the seven recordings: 4.2% CER, 1.8% deletions, against silver references ([rolling replay](2026-10-27-rolling-replay.md)). Live turns at the 12 s cap were 10.6% and 7.4% |
| Held-out EN WER ≤ 4.0%, deletions ≤ 1.0% | Rolling replay: 2.3% WER, 0.7% deletions. Live turns were 4.8% and 2.9% |
| Public JA CER ≤ 6.0%, EN WER ≤ 8.0%, live within 1.5 points of full-clip | Tuning full-clip decode: 4.44% CER and 6.82% WER on eight clips ([local transcription](LOCAL-TRANSCRIPTION.md)). FLEURS scores numbers and names strictly, so the gap to the full-clip decode is the sharper test of segmentation |
| Major or hallucinated rows ≤ 5% | Live turns had 15 of 144, about 10%, before rolling and the stock-phrase rule |
| Lock lag p90 ≤ 3.0 s, first text p90 ≤ 8.0 s | Rolling replay: lock lag p90 2.4 s EN and 3.0 s JA; first text p90 8.1 s EN and 6.0 s JA |
| Translation fidelity ≥ 4.3 on correctly recognized inputs, under two judges | The first eval's 3.56 mean for Haiku and Terra mixed in cases with recognition errors that no translator repaired; clean inputs should score clearly higher. The single-family judge was its stated limit ([first eval](2026-10-26-first-translation-eval.md)) |
| Translation p90 ≤ 2.5 s | First eval p90 about 2.0 to 2.1 s for Haiku and Terra on a home connection; field median near 2.1 s |

Targets sit at or just above what rolling achieved on silver references, so passing means rolling holds on new material. Silver references understate error, which is why held-out references for the gate are corrected by hand with unresolved spans excluded and reported.

The seven recordings shaped the rolling design and are excluded from the gate. The gate needs new held-out material.

## Tooling

- `pnpm gate:fixtures` selects 60 English and 60 Japanese FLEURS test clips of 4 to 16 s at the pinned revision, taking the first distinct sentence IDs in archive order outside the tuning and noisy sets: 21.0 minutes in all, 9.2 English and 11.8 Japanese. It also pins 38 MUSAN files: 35 free-sound background noises, one applause file and three instrumental music files, 37.3 minutes in all. Manifests are `benchmarks/gate-fleurs.json` and `benchmarks/gate-nonspeech.json`; sources and licenses are in `benchmarks/README.md`. A cached rerun takes under a second.
- `pnpm gate:run` builds the streams, replays each in real time, runs `local:silence` and decodes every public clip whole. A full run without held-out material takes about an hour.
- `pnpm gate:score` checks a run against `benchmarks/gate-ja.json`. Held-out alignment treats `{{ }}` spans as free. A unit test keeps the JSON equal to the wiki table.

### Level matching

The first smoke run lost two of three English clips: no turn opened. 40 of the 60 English clips and 7 of the 60 Japanese clips have a 90th-percentile frame RMS below the energy gate's 0.004 floor, so FLEURS played at its recorded level tests faint input, which is problem 1 and has its own sweep. Gate streams now scale each clip to a 90th-percentile 50 ms RMS of 0.1 without clipping. Gains ran from 0.54 to 194 for English and 0.41 to 99 for Japanese, so the quietest clips carry amplified recording noise. Non-speech clips are leveled the same way, at gains of 0.24 to 1.0, which makes the hallucination check stricter. Held-out recordings keep their level. A rolling replay of the leveled smoke stream recovered all three clips. This is recorded in [decisions](../wiki/decisions.md).

## First run

Commit `b72108d` with the gate tooling uncommitted, Turbo Q4, Apple silicon. Public and non-speech parts only; held-out, ratings and the timing targets were not measured.

| Measure | Rolling JA | Rolling EN | Turns JA | Turns EN | Target JA / EN |
| --- | --- | --- | --- | --- | --- |
| Public error rate, live | 10.48% fail | 5.59% | 6.23% fail | 4.47% | ≤ 6.0% / ≤ 8.0% |
| Live minus full-clip | 5.37 pts fail | 1.28 pts | 1.12 pts | 0.16 pts | ≤ 1.5 pts |
| Wrong language in Auto | 0% | 0% | 0% | 0% | ≤ 2% |
| Stock or repetitive rows | 0 | 0 | 0 | 0 | 0 |
| Rows kept / rejected or empty | 62 / 16 | 64 / 10 | 66 / 16 | 64 / 3 | |

The full-clip decode of the same clips scored 5.11% CER and 4.31% WER.

Non-speech failed in both modes with one displayed row each, both from the background-noise stream and both English: a 4.2 s row reading "You" in rolling and a 12 s row reading "Oh my god." in turns. Applause, music and `local:silence` displayed nothing. Turns rejected 136 background-noise and 66 music turns before or after Whisper; rolling rejected 33 and 3.

Recognition verdict: FAIL in both modes.

Readings, not yet investigated:

- Rolling loses 5.4 points of Japanese CER on read FLEURS that the full-clip decode does not, while on the held-out lecture recordings it beat turns by a wide margin. The difference between the two sets is not explained yet. Short read clips with one-second gaps may suit the 12 s turn boundary and cut rolling's agreement windows; this is a hypothesis.
- Turns misses the Japanese public target by 0.23 points with a 1.1-point gap to the full-clip decode, so the full-clip error of 5.1% leaves little margin under the 6.0% target.
- Neither non-speech row is a stock phrase in `profiles/languages.json`. A single-word "You" is a known Whisper output on noise; adding whole-row phrases to the profile would be a fix to rerun under the gate rules, not a change to the gate.

## Open

- Find where rolling loses Japanese text on the public set: compare rolling and full-clip output per clip.
- Decide whether whole-row "you" and similar outputs join the English stock phrases, then rerun.
- Held-out material: at least 20 minutes per language of new speech with hand-corrected references, under `private/`. Until then the held-out, rating and timing targets cannot be measured.
- `scripts/replay-cases.ts` still maps detected language and a Japanese-text check for English and Japanese only, left over from stage 0. It needs the profile list before a second pair can run a gate.
- The overlay lag after the step 4 pacer is not gated yet; a target is added by decision once the pacer exists and before its gate run.
