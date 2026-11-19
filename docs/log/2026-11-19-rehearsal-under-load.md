# Rehearsal under load: Japanese passes part 6, French slows partway through

2026-11-19. The first rehearsal by the checklist in [operations](../wiki/operations.md#rehearsal-under-load), run by the maintainer with `pnpm dev:offline` on commit a5cf4ab, OBS running. No paid calls. The maintainer downloaded the diagnostics and an agent read it with `pnpm diag:latency` and a count of its events; nothing here comes from the text of the rows except where said.

## What ran

Two Starts, both Auto, rolling, reply opening on:

| Start | Pair | Length | Rows | Translated |
| --- | --- | --- | --- | --- |
| 1 | en-ja | 597 s | 70: 39 Japanese, 31 English | 70 |
| 2 | en-fr | 510 s | 63: 49 French, 14 English | 62, 1 failed |

The speech was mostly played recordings through the microphone rather than live speech, so rows run longer than in a live talk: a median of 108 characters in the French Start. Chrome applied echo cancellation, noise suppression and automatic gain in both. Input level per row had an RMS median of 0.066 of full scale. No row was rejected, no recognizer restarted, the speech gate rejected one turn and the confidence filter one decode.

Not in the log: no Mark problem now, no separate Starts with Voice Isolation on and off, no distance check and no OBS source reload. Steps 2, 4 and 5 of the checklist are not covered.

## Translation delay

Last word of a row to its first translated text, against part 6's targets of a 3.0 s median and 4.5 s p90:

| Start | Median | p90 | Lock lag median | Translation request median | Request to first text median |
| --- | --- | --- | --- | --- | --- |
| en-ja | 2.5 s | 4.0 s | 2.4 s | 1.8 s | 0.4 s |
| en-fr | 5.3 s | 8.4 s | 4.1 s | 3.5 s | 1.3 s |

Japanese passes. French fails, by a step partway through: its first rows took 0.3 to 1.0 s per translation request, as in replays, and from about the nineteenth row on every request took 3 to 6 s, short rows included, until the end. Lock lag rose with it. A step that does not follow row length points to something outside the application taking the GPU. The maintainer noticed the slowdown live; nothing significant should have changed, and opening the OBS window is the one candidate they recall. Not established.

The failed row was English, 24.6 s and 483 characters, closed by length; it most likely hit the 12 s translation timeout. Its original stayed on screen.

Last word to the whole translation released on the overlay, with pacing on, was a median 9.3 s in Japanese and 12.0 s in French.

## Reading

From the maintainer's screen, not graded: most French rows read well; a few idioms came out literally, one exclamation stayed untranslated, and some errors were recognition errors translated faithfully.

## Next

1. Repeat the French Start, or replay a French held-out talk in real time, with the OBS window open and showing its preview against hidden, to see whether the OBS window moves part 6.
2. The checklist steps not covered: Voice Isolation, distance, OBS reload, with Mark problem now in use.
