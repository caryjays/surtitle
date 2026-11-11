# The outlier talk, the confirming settle pair, and a masked-speech warning

2026-11-11. The maintainer lifted the recognition-tuning pause for one question: can the held-out talk that fails the Japanese gate, 0KTVqevvEjo, be fixed, with a stop rule of re-pausing if nothing cuts its deletion gap over the one-pass decode by at least half. Also run: the confirming settle pair from [settle time](2026-11-11-settle-time.md), and a held-out gate run in both modes. No paid calls. Everything offline is content-free: scripts printed counts and rates only.

## Simulator

`scripts/local/held_out_sim.py` replays the held-out recordings in virtual time through the live rolling rules, over the stretches the energy detector opens after calibrating on digital silence, and scores with the gate's `edits` beside a one-pass decode. On the outlier talk the live rules give error 29.40% and deletions 18.96% against 25.31% and 5.46% one-pass, close to the 2026-11-06 gate run: 84 stretches in 300 s, 329 decodes, 12 with a repetition drop, 12 speech-gate rejections, 6 stretches closed empty, 19 s of audio lost to trims and empty closes. Over the five Japanese talks the simulator's live rules sit 2.11 points of error and 3.11 points of deletions over one-pass, against targets of 1.5 and 1.0.

## What did not fix the talk

One run each on the outlier talk; error, deletions:

| Variant | Error | Deletions |
| --- | --- | --- |
| Live rules | 29.40% | 18.96% |
| Recording scaled to 0.1 RMS at its 90th percentile (peak-limited to a gain of 1.6) | 27.56% | 17.19% |
| Slow automatic gain, at most 20 dB | 29.47% | 20.12% |
| Each decode window scaled the same way | 31.86% | 19.30% |
| After a repetition drop, decode again at temperature 0.2 to 0.6 | 30.83% | 20.26% |
| After a repetition drop, decode again from the loop's start, shifted up to 1 s | 32.26% | 11.94% |
| After a repetition drop, decode the tail again unshifted | 31.11% | 20.87% |
| Prompt of the last 200 locked characters | 34.86% | 25.31% |
| Forced Japanese instead of Auto | 28.99% | 19.10% |

These runs overlapped other CPU work, which moves the virtual clock, so differences under a point or two are noise. Level, loop recovery, a text prompt and the per-row language are not the cause. The loop hypothesis of [other languages](2026-11-10-other-languages.md) explains a small part: 12 of 329 decodes.

## Where the loss is

A probe decoded each stretch once, after merging stretches separated by less than a gap G:

| Talk | G = 0 | G = 1.5 s | G = 3 s | G = 6 s |
| --- | --- | --- | --- | --- |
| 0KTVqevvEjo: spans; error; deletions | 84; 30.01%; 18.83% | 11; 22.03%; 8.19% | 21.35%; 9.00% | 22.10%; 9.41% |
| -6K2nN9aWsg | 50; 21.14%; 7.22% | 22.44%; 5.21% | 22.62%; 4.97% | not run |
| 0L8zz6v-3lw, control | 9; 6.25%; 2.21% | merged: 8.34%; 2.15% | | |

The probe cuts spans over 29 s into hard chunks, which is what raises the control talk's error when merged. The talk's loss is fragmentation: the speaker pauses often, the detector closes a stretch after 0.7 s of quiet, and Whisper loses much more on many short isolated clips than on the same audio decoded together.

Rolling does not recover that by waiting longer. Closing a stretch after more quiet, in the simulator, all five Japanese talks:

| Quiet to close | 0KTVqevvEjo: stretches; error; deletions | -6K2nN9aWsg | Japanese total over one-pass: error, deletions | Stretch end to final text p50, worst talk |
| --- | --- | --- | --- | --- |
| 0.7 s, live | 84; 29.40%; 18.96% | 24.81%; 8.64% | 2.11, 3.11 | 2.6 |
| 1.5 s | 28; 31.92%; 20.19% | 22.32%; 5.15% | 2.19, 2.69 | 3.3 |
| 2.0 s | 12; 29.47%; 17.74% | 21.02%; 5.62% | 1.40, 2.32 | 3.8 |
| 3.0 s | 6; 26.60%; 16.44% | 22.79%; 6.10% | 1.42, 2.23 | 4.9 |

The second talk's deletions reach its one-pass rate at 1.5 s, but the outlier's barely move while its decodes with a repetition drop rise from 12 to between 28 and 38: with the stretch held open, rolling still restarts its window after every lock, and the short windows that follow loop or drop. The last row's final text waits the extra quiet. Deletions over one-pass stay above 2 points at every setting.

Left context, `--left 5`: each decode window starts up to 5 s early, over audio already locked or between stretches, and only segments whose middle falls in the new audio are kept. On the outlier talk: error 36.43%, deletions 28.17%, 23 stretches closed empty. Whisper segments the context and the new audio together, so the rule drops real text. A version that works would need word timestamps or a forced decoder prefix; not built.

## Stop rule

The talk's deletion gap over one-pass is 13.5 points. Nothing tested in rolling cut it by half: the best, quiet to close 3.0 s, leaves 11.0 and makes the last row of every stretch wait 2.3 s longer for its final text. Recognition tuning is paused again. No live recognition setting changed for this talk. The talk remains a real limit: frequent pauses at low level, where a short window decodes badly. A longer quiet to close does help the second talk and the Japanese total's error, and is the candidate to revisit if tuning resumes, with an early row close so the final text does not wait.

## Confirming settle pair

`pnpm replay:contention --translate local --units row --review <file>` on the same four talks, live 1.0 s first, then 0.5 s, the opposite order to the first pair. The Mac was not idle: a system media-analysis job ran throughout, load average 4.4 to 7.5. Error and deletions score the review files with the gate's `edits`. Medians in seconds, 1.0 then 0.5:

| Talk | Lock lag p50 (p90) | Speech end to final text | Last word to first translated text | Error | Deletions |
| --- | --- | --- | --- | --- | --- |
| held-en-4320211 | 2.6 (4.4), 2.4 (3.8) | 2.5, 2.2 | 4.6, 4.5 | 10.73%, 11.86% | 6.59%, 7.06% |
| held-en-4346818 | 3.2 (4.9), 2.5 (4.1) | 2.8, 2.2 | 4.8, 4.0 | 16.94%, 17.35% | 6.83%, 7.10% |
| held-ja--6K2nN9aWsg | 2.5 (3.5), 2.2 (3.3) | 2.1, 2.0 | 3.7, 3.5 | 24.45%, 24.57% | 8.41%, 8.11% |
| held-ja-0jJLyvNn_to | 2.1 (3.2), 1.9 (2.6) | 1.9, 1.8 | 3.3, 3.1 | 5.62%, 5.90% | 1.67%, 1.67% |

- Speed confirms in the opposite order: English lock lag 0.2 to 0.7 s shorter and speech end to final text 0.3 to 0.6 s, Japanese 0.1 to 0.3 s. The p90 that was worse at 0.5 in the first pair is better here.
- Error is higher at 0.5 on all four talks, by 0.12 to 1.13 points. One run per arm, and run-to-run variation of a real-time replay's error has not been measured, so this may be noise; it is not "error holds".
- At 0.5 the first Japanese talk had 2 rows left untranslated and 1 unresolved, against none at 1.0.

At this point `ROLLING.settleMs` stayed 1000, pending the maintainer's call below.

## Masked-speech warning

Gate part 5 asks that a calibration which leaves the noise gate above the speech that follows is visible to the operator. `TurnDetector`, when calibrated and idle, now watches the last 10 s of sub-threshold levels and reports `masked` when their 90th percentile is at least 0.002, at least 0.3 of the threshold, and at least three times their 10th percentile: sound that swings like speech under the gate. The flag travels in the snapshot's gate status and the health diagnostics event, and the operator page shows a notice telling the operator to raise the input level or recalibrate. A turn opening or a calibration clears it. Tested with synthetic levels only: it fires on alternating loud and quiet frames under the gate and not on steady noise. The constants are untested against a real room.

## Held-out gate, both modes

`pnpm gate:run --held-out <manifest>` in real time at the live settings, rolling and then turns, about 2 h 15 min each, scored with `pnpm gate:score`. The system media-analysis job was still running at the start of the rolling run, load average about 4.5; about 2 afterwards. The working tree carried this session's uncommitted masked-speech warning, which the runs' implementation digests cover.

| Measure | Target | Rolling | Turns |
| --- | --- | --- | --- |
| Held-out error over one-pass, Japanese | ≤ 1.5 points | 2.10, fail | 2.41, fail |
| Held-out error over one-pass, English | ≤ 1.5 points | 0.20 | 1.54, fail |
| Held-out deletions over one-pass, Japanese | ≤ 1.0 point | 2.97, fail | 2.96, fail |
| Held-out deletions over one-pass, English | ≤ 1.0 point | −0.02 | 0.12 |
| Public error, Japanese | ≤ 6% | 5.83% | 6.23%, fail |
| Public error, English | ≤ 8% | 4.79% | 4.47% |
| Public error over full clip, Japanese | ≤ 1.5 points | 0.72 | 1.12 |
| Public error over full clip, English | ≤ 1.5 points | 0.48 | 0.16 |
| Wrong-language share, Japanese | ≤ 2% | 1.09% | 2.30%, fail |
| Wrong-language share, English | ≤ 2% | 0.00% | 0.00% |
| Lock lag p90, Japanese and English | ≤ 3 s | 2.82 s; 4.28 s, fail | not applicable |
| First text p90, Japanese and English | ≤ 8 s | 6.69 s; 9.48 s, fail | not applicable |
| Non-speech rows | 0 | 1, fail | 1, fail |
| Stock or repetitive rows | 0 | 0 | 0 |
| Third-language rows, reported only | | 0 | 42, shown as `unknown` |

Held-out error: Japanese 14.50% rolling and 14.80% turns against 12.40% one-pass; English 11.58% and 12.92% against 11.38%. The major-error share was not measured; it needs the maintainer's rating.

- Rolling is at or ahead of turns on every held-out measure and passes two targets turns fails, public Japanese error and Japanese wrong-language share. It shows no third-language row where turns shows 42.
- Against the 2026-11-06 rolling run, Japanese held-out error over one-pass is 2.10 against 2.28 and deletions 2.97 against 2.82: unchanged. The wrong-language share now passes, the effect of dropping decodes outside the pair.
- Rolling fails on the Japanese held-out differences, English lock lag and first text on continuous speech, as before, and on one non-speech row. The non-speech target passed in the 2026-11-04 runs; which input produced the row was not examined.

Runs: `benchmarks/results/gate-ja-rolling-20261111T093814` and `benchmarks/results/gate-ja-turns-20261111T115503`.

## Verification

`pnpm check` passes with one new test, for the warning; the Python unit tests and `pnpm test:browser` pass. The real-model browser checks were not rerun. The warning has not been seen in a browser with a real microphone.

## The maintainer's calls, same day

After reading the above, the maintainer decided:

- Settle 0.5. `ROLLING.settleMs` is 500, with the replay script's and the simulators' defaults following. The error rise in the scored pair is accepted for the latency. The gate runs above used 1.0.
- The gate's held-out part is accepted with the outlier talk as a known limit; [gates](../wiki/gates.md) says so, and targets and material are unchanged.
- Automatic restart, yes. A recognizer failure while capturing now restarts the recognizer: capture shows `connecting` with `restarting`, the operator page says recognition is restarting on its own, finalized rows stay, open rows are dropped, and the new stream starts from the old noise gate threshold, so no quiet is needed and speech during the restart is not calibrated as noise. At most two restarts in five minutes; a third failure, or a failure while restarting, fails capture as before. The session limit still counts from Start. `Snapshot.restarts` counts them and the health diagnostics event carries the count. Tested with fake providers: two controller tests and a detector test. Not yet seen with the real worker.
- The paid translation eval: no.

`pnpm check`, the Python unit tests and `pnpm test:browser` pass after these changes.

## Open

- A gate run at settle 0.5.
- The restart with the real worker: force a failure in a rehearsal.
- The masked-speech warning in a real room.
- The non-speech row in both gate runs: find the input and whether it repeats.
