# 2026-10-26: prompt variants for damaged input

Backend: cloud candidates and judge, from the maintainer's laptop on a home connection, with explicit authorization. Recognition for case building was local Turbo Q4. The agent did not read `.env`. Recording content stays in `private/`; this entry reports aggregates and error categories only.

## What was built

- Two private recordings of mixed English and Japanese technical speech, about 2.6 minutes in total, one third-party. `scripts/replay-cases.ts` replays a recording in real time through the live recognizer and writes one draft case per turn with four turns of context and cut flags; `--calibrate` mirrors listen mode's room calibration and `--max-turn-ms` sets the turn cap. `scripts/local/full_clip.py` decodes the whole file in Whisper's own windows with the live decode settings.
- 11 turns at the live 12 s cap were reviewed by the maintainer against the full-file transcription. 28 more turns came from 6 s and 8 s caps with references aligned automatically from the corrected full transcription, not reviewed.
- Eval additions: prompt variants as checked edits to the live instructions (`benchmarks/prompt-variants.json`, `~name` on a candidate); an optional `truncated` field in the translation input, sent only by variants; a judge `invented` flag; instruction overrides on all three translators, used only by the eval.

## Recognition findings

| Recording | Full-file text | Live replay, no calibration | Live replay, calibrated |
| --- | --- | --- | --- |
| 1, Japanese with an embedded English clip | 623 chars | fragments, 11 turns of 1 to 2 s | 313 chars, about 50% |
| 2, English | 1256 chars | 3 fragments | 1118 chars, about 89% |

- Both recordings sat below the detector's starting threshold: frame RMS p90 0.008 and 0.007 against 0.012. Calibration lowers it toward the 0.004 floor and recovers most speech, but the quieter embedded clip was still lost.
- The opening speech of both recordings, 4 to 7 s, was never captured and never counted as rejected. This may be an artifact of splicing room tone before the recording; it needs checking in a live session.
- Seven of 11 turns ended at the 12 s cap, some mid-word. One cut changed a recognized word; the full-file decode got it right.
- Full-file decoding fixes one language per file and rendered the embedded English clip in Japanese. Per-turn detection in live mode got it right when the turn was captured. Conditioning on previous text invented a sentence and a repeated filler run, confirming the live setting.
- A spoken file-name term was misrecognized in every mode. No translator, under any variant, recovered it in 21 attempts.

## Translation results

Tuning set: 36 public and 28 re-cut cases, one repeat. Reviewed set: 11 turns, two repeats; it shares sentences with the re-cut cases, so it is not held out. Judge `anthropic:claude-opus-5-5`, blind, seeds 11 and 12.

| Candidate | p50 ms | p90 ms | Fidelity, tuning | Invented, tuning | Fidelity, reviewed | Invented, reviewed | $ / 1000 turns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Terra | 2055 | 2437 | 3.86 | 2/64 | 4.18 | 1/11 | 1.38 |
| Sonnet 5.5 | 1737 | 4740 | 3.97 | 2/64 | 4.27 | 0/11 | 2.30 |
| Haiku 5.5 | 1384 | 1929 | 3.75 | 7/64 | 3.91 | 1/11 | 0.12 |
| Haiku ~repair | 1335 | 2508 | 3.67 | 7/64 | 4.00 | 1/11 | 0.13 |
| Haiku ~cut | 1411 | 2009 | 3.69 | 3/64 | 3.73 | 0/11 | 0.12 |
| Haiku ~repair-cut | 1316 | 1924 | 3.63 | 4/64 | 3.91 | 0/11 | 0.14 |
| Haiku #low ~repair-cut | 1790 | 4340 | 3.64 | 4/64 | 4.00 | 0/11 | 0.21 |

Latency and cost are from the tuning run.

## Observed

- Most of Haiku's inventions complete a sentence cut off at the turn boundary. The cut flag roughly halved them, 7 to 3 of 64, at no latency cost. Counts this small are suggestive, not settled.
- The repair instruction did not raise fidelity or recovery and did not reduce invention. One repair the judge counted as invention completed a cut command name correctly across a turn boundary.
- Thinking at effort low added about 400 ms at p50 and a 4.3 s p90 with no quality gain.
- Fidelity differences between Haiku variants, 3.63 to 3.75, are within run-to-run noise.

## Next

- Held-out test: new recordings by the maintainer, reviewed the same way, with `~cut` against baseline Haiku, Terra and Sonnet.
- If `~cut` holds, set `truncated` from turn boundaries in the controller; that is a live change and needs the usual comparison.
- Segmentation: cutting at pauses instead of a fixed cap removes the condition that triggers most invention, and the vocabulary prompt is the only route to file-name terms. Both are recognition work.
