# 2026-10-27: rolling mode replayed on the held-out set, rolling step 3

Step 3 of the [rolling recognition design](2026-10-26-rolling-recognition-design.md): the seven held-out recordings, about 29 minutes, replayed in real time through the real code path. Same Turbo Q4 worker, energy detector and listen-mode calibration as live. Command, per recording:

```
pnpm exec tsx scripts/replay-cases.ts --audio <recording> --out <cases.json> --calibrate --room-tone silence --segmentation rolling
```

`scripts/replay-cases.ts` gained `--segmentation` and, in rolling mode, records each row's decodes, forced locks, time to first text and lock lag. Scoring used the same silver references and scorer as the [held-out entry](2026-10-26-held-out-transcription.md). Recordings and outputs stay private.

## Accuracy

| | English WER | Japanese CER |
| --- | --- | --- |
| Live turns, 12 s cap | 4.8% | 10.6% |
| Rolling simulation | 1.4% | 3.9% |
| Rolling, real code path | 2.3% | 4.2% |

- Deletions fell from 2.9% to 0.7% in English and from 7.4% to 1.8% in Japanese against live turns.
- The English gap to the simulation is single-word slips spread across rows, one of them dropping a negation. None clusters at row or stretch boundaries. The live path decodes different windows from the simulation, because of detector timing and pre-roll, so slips land in different places.
- No forced locks, no worker failures, one rejected stretch.

## Timing and rows

| | English | Japanese |
| --- | --- | --- |
| Rows | 64 | 112 |
| Closed by `length` / by a pause | 58 / 6 | 101 / 11 |
| Row audio p10 / p50 / p90 | 3.8 / 8.6 / 13.7 s | 8.1 / 9.5 / 12.2 s |
| Row characters p10 / p50 / p90 | 62 / 164 / 212 | 46 / 63 / 85 |
| Lock lag, per-row medians, p50 / p90 | 1.9 / 2.4 s | 2.1 / 3.0 s |
| Row start to first locked text, p50 / p90 / max | 5.0 / 8.1 / 12.1 s | 3.1 / 6.0 / 15.2 s |

- Rows run past 8 s because one lock can add several segments. English rows hold a median of 164 characters, longer than a display row; the roll-up rendering in step 4 has to wrap them.
- A slow first text comes from a long Whisper segment: a segment cannot lock until it has ended and settled. The worst case, 15 s, is the opening of one recording that Whisper decoded as one 12.8 s segment; the simulation was just as slow there. 17 of 176 rows waited more than 8 s.
- Only 2 of 176 rows closed by a pause were short: under 2 s or 15 characters. This material is fast scripted speech; lectures pause more.

## Against the step 3 criteria

- Japanese CER at or below 5%: met, 4.2%.
- No forced locks: met.
- Display lag p90 at or below 2 s: no longer measurable as written. The criterion predates the decision to show only locked text, and the provisional tail is not displayed until step 4. Lock lag, from segment end to lock, matches the simulation: median 2.0 s against 2.1 s.

## Decisions

- Merging short pause-closed rows stays unbuilt: 2 of 176 rows would qualify. Revisit if rehearsal speech produces many.
- Proceed to step 4: the `stable` protocol field, the reading-pace pacer and roll-up rendering.
