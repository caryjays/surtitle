# Where the translation delay goes

2026-11-17. A breakdown of [the first full part 6 run](2026-11-17-translation-delay-run.md), with two checks run afterwards. No paid calls. Replays used the run's commit plus uncommitted docs; load average 1.2 to 2.9.

## The two halves

From a row's last word to its first translated text, the run's delay is two stages of about the same size. Medians per talk, from `pnpm diag:latency` on the run's files:

- Closing the row, from speech end to final text: 1.3 to 2.8 s. That is 0.7 s of closing quiet, which is fixed, plus the closing decode, 0.7 to 1.6 s.
- The translator's first text, from request to first translated text: 0.7 to 2.1 s. The translation queue is empty in every pair, so no row waits behind another.

The rows closed by length take longer to close than those closed by silence: 2.4 s against 1.9 s at the median over all pairs.

## The translator alone

A scratch script timed the local translator with nothing else on the GPU: six sentences per direction, the example glossary, up to four rows of context, about 550 prompt tokens. Its first text came in 0.46 to 0.69 s at the median in all ten directions, and a whole request took 0.74 to 1.14 s. In the replays, which run recognition at the same time, the same stage takes 1.5 to 4 times as long. The language makes little difference alone; sharing the GPU with recognition makes most of it.

## The same talk, replayed again

One English talk, `held-en-4320211`, replayed alone in three pairs this morning, twice, in opposite orders. Last word of a row to first translated text, median and p90:

| Pair | Overnight run | Morning, first order | Morning, reversed |
| --- | --- | --- | --- |
| en-es | 4.0 / 5.8 s | 2.1 / 3.5 s, run first | 3.2 / 4.5 s, run last |
| en-it | 4.3 / 6.5 s | 2.9 / 4.4 s | 3.2 / 5.1 s |
| en-ja | 3.0 / 4.7 s | 2.8 / 4.1 s, run last | 2.8 / 4.4 s, run first |

The Spanish smoke run of the same day, on the same talk, had 2.1 / 3.9 s.

- The same talk in the same pair moves by about 1 s at the median between replays, as much as the gap to the target. One replay per talk cannot settle a pass or a fail near the limit.
- Spanish was fastest when it ran first and slower when it ran last. Both the closing decode and the translator slow down together. The system log holds no thermal records for the night, so the cause is not confirmed; the Mac slowing under sustained load fits.
- In the overnight run, every pair after the first was slower than any of these morning replays.

## What it means

The Latin pairs' overnight misses are partly the machine and the order of the run, not the languages: a fresh replay of the same English talk passes in Spanish and Italian. A long live session is sustained load too, so the slower figures are not unfair, but the run as built mixes pair with position in the run.

Where to work: the translator's share on a shared GPU, 0.5 s alone against 1 to 2 s in the replay, and the closing decode. The 0.7 s of closing quiet is a recognition setting with costs of its own.

## Decision

The maintainer's call, the same day: part 6 is measured under sustained load. In a presentation, with slides and OBS running, the Mac is always under load, so the slower figures of a long run are the real ones and a fresh replay is not. Recorded in [decisions](../wiki/decisions.md) and [gates](../wiki/gates.md#6-translation-delay-offline-profile). Under it, the overnight run's misses in the Latin pairs stand as the picture, though the run itself is still not a gate result.

## Next

1. Reduce what recognition and the translator cost each other on the shared GPU. First try: holding rolling decodes while the translator processes its prompt, measured over a sustained run, not a single talk.
2. Still open: whether a gate run adds a load like a presentation's, such as OBS with a slide scene, and how many replays each talk needs, since one talk moves by about 1 s between replays.
