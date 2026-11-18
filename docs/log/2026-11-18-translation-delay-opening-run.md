# Translation delay in all five pairs with the reply's opening: 33 of 36 talks pass

2026-11-18. The second full `pnpm gate:delay` run, the first with the local model given its reply's opening, live since [the entry of today](2026-11-18-reply-opening-live.md). No paid calls. Run `delay-20261118T114000`, started at 11:40 by the Mac's clock and finished at about 15:03, on commit 05c83eb with no uncommitted changes, on mains power throughout. The pairs ran back to back with no cooling pause, as part 6 is measured since [the decision of 2026-11-17](2026-11-17-translation-delay-breakdown.md). Load average 2.0 to 3.7 before and after each pair, from other work on the Mac as in normal use.

## Results

Last word of a row to its first translated text, per talk; target median ≤ 3.0 s and p90 ≤ 4.5 s. The first run, [of 2026-11-17](2026-11-17-translation-delay-run.md), for comparison.

| Pair | Talks passing | Medians | p90s | First run: passing, medians |
| --- | --- | --- | --- | --- |
| en-ja | 4 of 4 | 1.8 to 2.2 s | 3.1 to 3.8 s | 2 of 4, 2.4 to 3.0 s |
| en-es | 6 of 8 | 1.6 to 3.1 s | 2.5 to 4.6 s | 3 of 8, 2.4 to 4.0 s |
| en-fr | 8 of 8 | 1.7 to 2.7 s | 2.6 to 3.7 s | 0 of 8, 3.5 to 4.7 s |
| en-it | 7 of 8 | 2.1 to 3.4 s | 3.0 to 4.9 s | 1 of 8, 3.0 to 4.9 s |
| en-pt | 8 of 8 | 1.6 to 2.8 s | 2.3 to 4.2 s | 2 of 8, 2.0 to 4.3 s |

33 of 36 talks pass, against 8 of 36. Each talk had between 33 and 78 rows translated.

The three misses:

| Pair | Talk | Median | p90 |
| --- | --- | --- | --- |
| en-es | held-es-9hUjhIfs-bw | 3.1 s | 4.2 s |
| en-es | held-es-HLIJkmy3vy8 | 2.5 s | 4.6 s |
| en-it | held-it-7TqiEZn5uBE | 3.4 s | 4.9 s |

- Two of the three miss by 0.1 s, under the 1 s spread between two replays of one talk seen in [the breakdown](2026-11-17-translation-delay-breakdown.md). The Italian talk misses by more.
- The English talk `held-en-4320211`, which had a median of 4.0 to 4.3 s in every pair after Japanese in the first run, has 1.8 to 2.7 s here.
- The first run's tree was uncommitted and its first two pairs ran at higher load, so the two runs are not a controlled comparison; the controlled one is in [the reply opening](2026-11-17-reply-opening.md). The direction agrees with it.

## Standing

As a gate result for part 6, on a committed tree under sustained load: Japanese, French and Portuguese meet it; Spanish and Italian do not, by the talks above. This is the clean Japanese repeat the status page owed.

## Next

The three missing talks: whether a single replay decides them, given the spread between replays, is open. Part 6 does not say how many replays a talk gets.
