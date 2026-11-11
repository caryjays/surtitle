# Decode cadence, and streamed local translation

2026-11-09. The [row length](2026-11-08-row-length.md) entry left the lock and the translation request, about 2 s each, as the next levers. This entry measures a faster decode cadence and adds streaming to the local translator.

## What changed

- The local adapter takes a `cadence` option, the decode interval and the settle time, set only by `pnpm replay:contention --cadence interval,settle`. The live cadence is unchanged: 1000, 1000.
- The local translation worker sends the reply so far, at most every 100 ms, while it generates. The adapter reads source, target and the text so far from the unfinished JSON object. The controller shows that text as the row's translation while the row is pending, only in a direction the finished reply could take and only up to four times the original's length plus 40 characters. The finished reply is validated as before and replaces it; a failure or a wrong direction clears it. A streaming row is never context. The cloud translators do not stream.
- `pnpm diag:latency` adds translation request to first translated text, and speech to first translated text for the last word and the middle of each row.
- An early length close was tried and reverted before any run: closing on text two decodes agree on, without waiting for it to settle. A segment can agree only once the decode before held all of it, a full interval earlier, so agreement already implies the 1 s settle and the change would save nothing.

## Run

The same four held-out talks with the local `qwen3.5-4b-q4` and the live row rules, back to back on one Mac, in the order 700/700 ms, 500/500 ms, then the live 1000/1000 ms again. The 700 ms run used the translator before streaming; the 500 ms run and the second live run used the streaming one. The previous entry's live run is a second baseline. Recognition error against the held-out references, scored by a scratch script with the gate's `edits` and printed as aggregates only, stayed within 0.7 points of the first live run on every talk, under every cadence and row rule in both entries, except the 700 ms streaming run below, 0.9 points worse on the first Japanese talk.

Lock lag and speech end to final text, p50 in seconds:

| Talk | Lock lag: live / live again / 700 / 500 | Speech end to final: live / live again / 700 / 500 |
| --- | --- | --- |
| English 1 | 2.3 / 2.4 / 1.7 / 1.8 | 2.0 / 2.0 / 1.7 / 1.8 |
| English 2 | 2.1 / 2.1 / 1.7 / 1.7 | 1.8 / 1.9 / 1.7 / 1.8 |
| Japanese 1 | 2.1 / 2.2 / 1.7 / 1.6 | 1.6 / 1.6 / 1.5 / 1.6 |
| Japanese 2 | 2.0 / 2.1 / 1.5 / 1.3 | 1.8 / 1.9 / 1.4 / 1.2 |

Translation request, and request to first translated text where it streamed, p50 in seconds:

| Talk | 700, not streaming | 500: request / first text | live again: request / first text |
| --- | --- | --- | --- |
| English 1 | 2.1 | 2.5 / 1.5 | 2.4 / 1.4 |
| English 2 | 1.9 | 2.3 / 1.4 | 1.8 / 1.2 |
| Japanese 1 | 1.8 | 2.0 / 1.3 | 1.8 / 1.0 |
| Japanese 2 | 2.2 | 2.7 / 1.4 | 2.1 / 1.0 |

Speech to translation from the middle of a row, p50 in seconds; for the streaming runs, to the first translated text:

| Talk | live | 700 | 500, streaming | live again, streaming |
| --- | --- | --- | --- | --- |
| English 1 | 7.5 | 6.9 | 6.4 | 6.9 |
| English 2 | 5.9 | 5.7 | 5.8 | 5.7 |
| Japanese 1 | 6.5 | 6.3 | 5.9 | 5.6 |
| Japanese 2 | 8.3 | 8.0 | 7.1 | 7.5 |

From the last word to the first translated text, the streaming live run took 3.6, 3.2, 2.6 and 2.9 s at the median.

## 700 ms with streaming

Run last, after the three above. Lock lag p50 1.7, 2.2, 1.9 and 1.7 s; translation request p50 2.4, 2.1, 2.0 and 2.7 s, with the first translated text at 1.5, 1.4, 1.2 and 1.3 s. Speech to first translated text from the middle of a row, p50: 6.5, 5.9, 6.0 and 7.2 s, against 6.9, 5.7, 5.6 and 7.5 s for the streaming live run. The second Japanese talk failed one row, which no other run did.

## Findings

- A 700 ms cadence cuts lock lag by 0.4 to 0.6 s at the median against both live runs, and speech end to final by up to 0.4 s. A 500 ms cadence gains no more: the decode itself takes about 0.7 s and one decode is in flight at a time, so requests cannot come faster. It also slows translation, 2.0 to 2.7 s per request against 1.8 to 2.4 s.
- Streaming shows the first translated text 0.6 to 1.1 s before the finished reply at the median, with no failure added: the first Japanese talk failed 6, 6 and 3 rows across the three runs, as before. The display's pacer releases a translation at reading pace, so text that arrives earlier starts showing earlier.
- The two do not add up. At 700 ms with streaming, lock lag fell less than in the first 700 ms run, and translation slowed by up to 0.6 s, so speech to first translated text matched the streaming live run within half a second either way. More decodes share the GPU with each translation; the faster cadence's gain in the first run may also owe something to running first, when the Mac was coolest.
- Neither changes the row's length, which is still most of the wait from its middle and its first word.
- Run order was not alternated; the second live run, last, had slightly higher lock lag than the first, about 0.1 s.

## Open

- The live cadence stays at 1000/1000: with local translation on, 700 ms showed no net gain. With translation off or in the cloud, the GPU is not shared and 700 ms may still help; not measured.
- Streamed text that is then withdrawn on failure has not been seen on a display; the maintainer's rehearsal with `pnpm dev:offline` is the check.
