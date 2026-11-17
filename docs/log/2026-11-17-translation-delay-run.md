# Translation delay in all five pairs: most talks miss

2026-11-17. The first full `pnpm gate:delay` run, part 6 in every pair. No paid calls. Run `delay-20261117T004002`, started at 00:40 by the Mac's clock and finished at about 03:50, on commit 02aff7c plus the uncommitted runner, preview and docs of [the runner entry](2026-11-17-translation-delay-runner.md); none of those touch the replay path. On mains power throughout.

It does not count as a gate result. The tree was uncommitted, and the Mac was not idle for the first two pairs: load average 3.0 before Japanese and 4.0 after it, falling to 1.1 by the end of Spanish. French, Italian and Portuguese ran at load averages between 1.1 and 2.0, close to the smoke run's 1.9. The misses are large enough that the direction is clear anyway.

## Results

Last word of a row to its first translated text, per talk; target median ≤ 3.0 s and p90 ≤ 4.5 s.

| Pair | Talks passing | Medians | p90s |
| --- | --- | --- | --- |
| en-ja | 2 of 4 | 2.4 to 3.0 s | 4.0 to 5.2 s |
| en-es | 3 of 8 | 2.4 to 4.0 s | 3.9 to 5.8 s |
| en-fr | 0 of 8 | 3.5 to 4.7 s | 5.0 to 6.8 s |
| en-it | 1 of 8 | 3.0 to 4.9 s | 4.4 to 7.7 s |
| en-pt | 2 of 8 | 2.0 to 4.3 s | 4.1 to 6.3 s |

8 of 36 talks pass. Each talk had between 32 and 73 rows translated.

- Japanese: both Japanese talks pass, as in the rounds of [2026-11-11](2026-11-11-translation-latency.md). Both English talks miss on p90 (4.7 and 5.2 s), with medians at the 3.0 s limit. This ran under the highest load of the night, so it is not the owed clean repeat.
- French misses on every talk, and on both median and p90 for seven of them.
- The same English talk, `held-en-4320211`, was first in every pair after Japanese and had a median of 4.0 to 4.3 s each time. In the Spanish smoke run of the same day it had 2.1 s, at a similar load. That difference is not explained. A one-talk repeat in Spanish would tell whether the smoke figure or this one is typical.

## What it means

Part 6 fails in every pair outside Japanese, and the English side of Japanese is at its limit. Translation works on closed rows, so the delay is row close plus translation time; this run does not separate the two. `pnpm diag:latency` on the per-pair files in the run folder gives the full breakdown.

## Next

1. A repeat on a committed tree and an idle Mac, starting with Japanese, to settle the owed Japanese repeat: `pnpm gate:delay --gates ja`.
2. Find where the time goes in the Latin pairs, row close or translation, from the run's diagnostics, before changing anything.
