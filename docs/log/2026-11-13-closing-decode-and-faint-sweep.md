# Closing decode, Japanese held-out at settle 0.5, faint-level sweep

2026-11-13. Four items from the status page's list, all local. No paid calls. Aggregates only.

## 1. A decode sent during the quiet becomes the closing decode

A stretch closes after 700 ms of quiet, and its final then waits for the rolling decode in flight before its own closing decode can start. The change: once the stretch has been quiet for 300 ms, a decode is sent at that mark instead of on the 1 s interval, and if the stretch closes while it is in flight it is the closing decode. Its audio already ends in the quiet, so no speech is missing from it. A decode that left before the mark is not promoted. `pnpm replay:contention --pause <ms>|off` sets the mark.

Two rounds of real-time replays on four held-out talks, two English and two Japanese, with local translation. The rounds ran hours apart and the second was about a second slower with the change off as well, so only arms inside one round compare.

Last word of a row to its first translated text, seconds, median (p90):

| Talk | Round 1 off | Round 1, 300 ms | Round 2 off | Round 2, 500 ms | Round 2, 300 ms |
| --- | --- | --- | --- | --- | --- |
| English 1 | 3.6 (4.8) | 2.8 (4.1) | 4.5 (6.1) | 3.0 (5.1) | 4.4 (6.2) |
| English 2 | 3.0 (3.9) | 2.7 (4.0) | 4.1 (6.6) | 3.6 (6.4) | 3.3 (5.6) |
| Japanese 1 | 2.3 (3.3) | 2.0 (3.6) | 3.3 (4.5) | 2.4 (4.4) | 2.7 (4.3) |
| Japanese 2 | 2.3 (3.4) | 2.5 (3.0) | 2.7 (3.8) | 2.5 (3.3) | 2.5 (3.9) |

Stretch close to final text on closes by quiet, median in ms:

| Talk | Round 1 off | Round 1, 300 ms | Round 2 off | Round 2, 500 ms | Round 2, 300 ms |
| --- | --- | --- | --- | --- | --- |
| English 1 | 1390 | 399 | 2018 | 1111 | 1634 |
| English 2 | 1208 | 809 | 2070 | 1495 | 1077 |
| Japanese 1 | 792 | 494 | 1543 | 802 | 893 |
| Japanese 2 | 599 | 464 | 1486 | 686 | 1133 |

Recognition error against the references, percent:

| Talk | Round 1 off | Round 1, 300 ms | Round 2 off | Round 2, 500 ms | Round 2, 300 ms |
| --- | --- | --- | --- | --- | --- |
| English 1 | 11.21 | 11.11 | 11.21 | 10.92 | 10.64 |
| English 2 | 16.67 | 16.94 | 17.35 | 17.35 | 16.94 |
| Japanese 1 | 22.44 | 24.51 | 24.81 | 24.45 | 24.87 |
| Japanese 2 | 6.00 | 5.33 | 5.85 | 5.81 | 5.90 |

Reading:

- The share of closes by quiet that found the worker free or already holding their decode rose from 0.06 to 0.67 with the change off to 0.39 to 1.0 with it on, and the close-to-final median fell on every talk in both rounds.
- The delay to first translated text is lower with the change in 10 of 12 comparisons at the median, by 0.1 to 1.5 s. In round 1 all four talks meet gate part 6 with the change, where English 1 missed without it. Round 2 misses on most talks in every arm, including off; the machine was not idle enough for that round to count against the target.
- Japanese 1 lost 2.1 points in round 1, which looked like sentence ends lost in the quiet. Round 2 does not repeat it: the talk scores 24.8% with the change off and 24.5% and 24.9% with it on. The 22.4% was the outlier.
- Lock lag p90 rose on three talks in round 1 (3.7 to 4.4, 3.0 to 3.5, 3.2 to 4.1 s) and not in round 2 (off 4.4, 6.2, 4.0, 3.4; 500 ms 3.6, 5.7, 4.2, 2.6; 300 ms 4.5, 4.0, 4.3, 3.9), on 17 to 38 locks per talk.
- 300 and 500 ms do not separate in this data. 300 ms stays, since it gives the closing decode the longer start.

## 2. Japanese held-out talks at settle 0.5

A full real-time gate run in rolling at the live settings, from a clean tree, load median 1.9.

| Measure | Japanese | English |
| --- | --- | --- |
| Held-out error over one-pass, points | 2.18, fail | 0.44, pass |
| Held-out deletions over one-pass, points | 3.26, fail | 0.02, pass |
| Held-out error | 14.58% | 11.83% |
| One-pass error | 12.40% | 11.38% |
| Public error | 5.62% | 4.63% |
| Public error over full clip, points | 0.50 | 0.32 |
| Wrong-language rows | 0.55% | 0 |
| Lock lag p90 | 2.47 s, pass | 3.36 s, fail |
| First text p90 | 6.41 s, pass | 8.57 s, fail |

Non-speech rows, stock or repetitive rows and third-language rows: 0. At settle 1.0 the Japanese figures were 2.10 and 2.97 over, and English lock lag and first text 4.28 s and 9.48 s.

Per Japanese talk, error and deletions over one-pass in points: 4.44 and 2.78; 5.05 and 15.14; 0.85 and 0.13; 2.37 and 0.91; −0.81 and −0.52. The second is the talk with frequent pauses at low level, the known limit. Without it the other four are 1.58 and 0.76 over, against 1.51 and 0.70 at settle 1.0. The shorter settle time costs Japanese nothing measurable, and the part still fails on the one talk.

## 3. Faint-level sweep

`scripts/faint-sweep.ts`: 16 tuning clips, 12 Japanese and 4 English, from the public set and the noisy Japanese set, leveled to a p90 frame RMS of 0.1, attenuated in 6 dB steps, with no noise bed and with one at RMS 0.001, each clip replayed alone in real time through the rolling provider after calibration on its bed.

| Level | Clips with no row opened, no bed / bed | Japanese error, no bed / bed | English error, no bed / bed |
| --- | --- | --- | --- |
| 0 dB | 0 / 0 | 7.5% / 7.7% | 6.8% / 6.8% |
| −6 dB | 0 / 0 | 7.2% / 6.8% | 6.8% / 6.8% |
| −12 dB | 0 / 0 | 6.8% / 7.0% | 6.8% / 6.8% |
| −18 dB | 0 / 0 | 7.2% / 7.3% | 6.8% / 8.0% |
| −24 dB | 0 / 0 | 7.9% / 7.9% | 6.8% / 8.0% |
| −30 dB | 6 / 5 | 50.4% / 50.5% | 98.9% / 86.4% |
| −36 dB | 16 / 16 | 100% / 100% | 100% / 100% |

- Recognition does not change down to 24 dB under a normal level. Japanese deletions stay between 0.7% and 1.6%.
- The loss at −30 dB is the energy gate: clips never open a row. Of the rows that did open at −24 and −30 dB, the speech gate emptied 0 to 1 per condition and the filters at most 1.
- The speech gate emptied 3 to 5 rows per condition at 0 to −18 dB. Every clip still produced its text, so these are extra stretches, not lost speech.
- On clean clips, then, the speech gate is not what loses a quiet talker on a close microphone. The field rejections came with a room's noise and several talkers, which this sweep does not reproduce; a louder or speech-like bed is the next variable if the question comes back.

## 4. Applause with Show text early

The applause stream, one clip of 6.5 s, replayed as the other non-speech streams were in [the default](2026-11-12-early-text-default.md): one row opened and was rejected, and no text showed. That entry says the file on disk was a leftover from a smoke run and skips it. That was wrong; the file is the gate's applause material.

## Checks and state

`pnpm check` passes with the change in the tree: two new tests cover a decode sent in the quiet becoming the closing decode, and no decode in a pause shorter than the mark. `pnpm test:browser` passes.

## 5. Gate run with the closing decode

A full real-time gate run in rolling with the change in the working tree, uncommitted, beside the run of item 2 without it.

| Measure | Japanese, without / with | English, without / with |
| --- | --- | --- |
| Held-out error over one-pass, points | 2.18 / 1.59, fail | 0.44 / 0.24, pass |
| Held-out deletions over one-pass, points | 3.26 / 1.64, fail | 0.02 / 0.10, pass |
| Held-out error | 14.58% / 13.99% | 11.83% / 11.62% |
| Public error | 5.62% / 5.58% | 4.63% / 4.87% |
| Public error over full clip, points | 0.50 / 0.47 | 0.32 / 0.56 |
| Wrong-language rows | 0.55% / 0.55% | 0 / 0 |
| Lock lag p90 | 2.47 / 2.70 s, pass | 3.36 / 3.34 s, fail |
| First text p90 | 6.41 / 6.88 s, pass | 8.57 / 9.08 s, fail |
| Stock or repetitive rows | 0 / 1, fail | 0 / 0 |

Non-speech rows and third-language rows: 0 in both.

- Accuracy is no worse with the change on any measure that gates, and the four Japanese talks other than the known limit are 1.38 and 0.44 points over one-pass, against 1.58 and 0.76.
- The Japanese gain is the talk with frequent pauses, which scored 27.3% in this run. Eight runs of that talk are on disk: five without the change at 29.5% to 29.7%, and three with it at 30.3%, 30.4% and 27.3%. The change moves that talk in both directions; the two worse runs are the replays made to look for the backlog below.
- One row of that talk in this run is flagged repetitive: 11.7 s of audio locked over 11 decodes, closed by quiet. None of the other seven runs of the talk has one. The target is zero, so this run fails it. Whether the change made the row is not established; the worker's repetition filter sees each decode and no single decode tripped it.
- First text p90 is 0.5 s later for both languages and Japanese lock lag 0.2 s later, inside the spread between earlier runs.

A second run with the change, on the maintainer's word that the machine was cooler and quieter than during the first, which shared it with a desktop build:

| Measure | Japanese | English |
| --- | --- | --- |
| Held-out error over one-pass, points | 2.29, fail | 0.32, pass |
| Held-out deletions over one-pass, points | 3.43, fail | 0.24, pass |
| Held-out error | 14.69% | 11.70% |
| Public error | 5.58% | 4.71% |
| Public error over full clip, points | 0.47 | 0.40 |
| Wrong-language rows | 0.55% | 0 |
| Lock lag p90 | 2.62 s, pass | 3.59 s, fail |
| First text p90 | 6.40 s, pass | 8.97 s, fail |
| Stock or repetitive rows | 0 | 0 |

- The repetitive row did not repeat: one run in four of that talk with the change, none in five without.
- This run matches the run without the change: the four Japanese talks other than the known limit are 1.56 and 0.79 points over one-pass, against 1.58 and 0.76. The first run's Japanese gain was the one good run of the talk with frequent pauses.
- That talk scores 30.4% here. With the change it is 30.3% to 30.4% in three runs of four, 0.6 to 0.9 points over its 29.5% to 29.7% without.
- English lock lag and first text are 0.2 and 0.4 s later than without the change, still inside the spread between runs, and still over target.

Two earlier attempts at this run did not reach the held-out talks, through wrong arguments, and a third stopped with `Local inference backlog` on the talk with frequent pauses. The maintainer traced that one: the power cord had come out and the Mac went to sleep during the replay. Four replays of the talk afterwards, two with the change and two from a clean tree, all completed. A sleeping Mac during a replay ends it with that error; a keep-awake on the gate process avoids it.

```sh
pnpm replay:contention --translate local --pause off --out <file> <audio>...
pnpm diag:latency <file>
tsx scripts/faint-sweep.ts --run
.local/venv/bin/python scripts/local/faint_sweep_score.py
```
