# Part 6 again, with the host probe beside the replay

2026-11-19, after [the host probe](2026-11-19-host-probe-and-read-throughs.md). No paid calls. Timings, counts and shares only.

`pnpm replay:contention` now runs the host probe on macOS and writes its sample every 2 s as a `health` event. `pnpm diag:latency` reads these events from a replay as it does from the console. Its `ours` group is the replay's children, the recognizer and translator workers.

## The run

`pnpm gate:delay`, all five pairs back to back under sustained load, on the Air on mains power. OBS was not running and nothing else was open. Commit d9101e0 plus the replay change above. It ran from 14:50 to 18:14, about 3 hours 25 minutes. Results are in the ignored `benchmarks/results/delay-20261119T144958/`.

**35 of 36 talks pass** part 6 (last word of a row to first translated text, median ≤3.0 s and p90 ≤4.5 s). [The run of 2026-11-18](2026-11-18-translation-delay-opening-run.md) passed 33 on the same code apart from the probe.

| | 2026-11-18 | 2026-11-19 |
| --- | --- | --- |
| Talks passing | 33 of 36 | 35 of 36 |
| Median of the talks' medians | 2.2 s | 2.1 s |
| Spanish, held-es-9hUjhIfs-bw | FAIL 3.1 / 4.2 s | PASS 2.1 / 3.4 s |
| Spanish, held-es-HLIJkmy3vy8 | FAIL 2.5 / 4.6 s | PASS 2.1 / 3.6 s |
| Italian, held-it-7TqiEZn5uBE | FAIL 3.4 / 4.9 s | FAIL 2.8 / 6.0 s |

Comparing each talk with its own result the day before:

- The median change was −0.2 s on the median and −0.3 s on the p90.
- The p90 moved by up to 1.1 s in either direction.

So one replay of a talk is good to about a second at p90. Both earlier Spanish misses fall inside that spread. The Italian talk fails in both runs. In this run, 33 of its 40 rows closed on length, and its lock lag p90 was 5.5 s. Its translation requests took a median of 0.7 to 1.9 s a minute. The time goes to recognition of continuous speech, not to the translator.

## Host load

All 6,070 samples read thermal state **fair**, apart from 28 nominal samples (about a minute) early in Portuguese, the last pair. None read serious or critical. Low Power Mode stayed off and the Mac stayed on mains power.

| Per minute of each Start | Range |
| --- | --- |
| Captions workers' GPU busy share, mean | 29 to 93%, lowest in each talk's last part-minute |
| OBS, browser, display server | 0% |
| Everything else | at most 3% a minute; 11% in the highest single sample |
| Median translation request | 0.6 to 2.3 s, with no step within any talk |

At least on this run, sustained replay on this fanless Mac settles at fair within minutes and stays there for over three hours without slowing translation. Fair alone doesn't explain the rehearsal's step from under 1 s to 3 to 6 s. What is left is OBS, another app, a state above fair the rehearsal reached, or something only the live path does. The probe tells these apart in the next rehearsal.

## Next

1. Repeat the French Start of [the rehearsal](2026-11-19-rehearsal-under-load.md) with the probe running, OBS's preview shown against hidden, and read the per-minute table.
2. If OBS shows the step, a gate run with OBS open is the presentation-like load that part 6 still lacks.
