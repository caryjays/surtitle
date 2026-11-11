# Translating locked pieces before a row closes

2026-11-09. Implements the [piece translation design](2026-11-09-piece-translation-design.md) behind a replay-only option and compares it with row translation on the four held-out talks.

## What changed

- Rolling partial events carry `locked`: the row's locked audio, the lag of its latest lock and the row's language.
- The controller takes `translationUnit`, `row` by default and in every live profile; only `pnpm replay:contention --units piece` sets `piece`. The rules are as designed, cut only while no request runs, at least 1.5 s of locked audio, a clause or sentence mark or 4 s, with one change: a failed piece's text is retried only once more text has locked. The first smoke run retried a failed piece at once, which at temperature 0 repeats the same request. The [translation](../wiki/translation.md) page has the full behaviour.
- `TranslationInput` gains `continues`. The system message gains one line only for such a piece, so a whole row's prompt is unchanged.
- Turn traces gain `pieces`, content-free timing for each piece request. `pnpm diag:latency` reports pieces and speech to first translated text taken from the piece that translated each word.
- Fixed in `pnpm diag:latency`: a turn's time in an outcome was the last event with that outcome, not the first. A trace that changes while translating, as piece traces do, made speech to translation look shorter. On row runs the fix moves earlier entries' numbers by 0.2 s at most; the tables below use the fixed script.

## Run

The same four held-out talks with `qwen3.5-4b-q4` and the live row rules and cadence, back to back on one Mac in the order piece, row, row, piece. All four runs were slower than the streaming live run of the [cadence entry](2026-11-09-cadence-streaming.md), with lock lag 0.1 to 1.3 s higher on the English talks, likely from heat. Recognition error, scored by the scratch script with the gate's `edits` and printed as aggregates only, stayed within 1.0 point between runs on every talk.

Speech to first translated text, p50 in seconds, row a, row b → piece a, piece b:

| Talk | Last word | Middle of row | First word | Middle, p90 |
| --- | --- | --- | --- | --- |
| English 1 | 4.0, 4.8 → 4.5, 4.6 | 7.3, 8.1 → 7.5, 7.6 | 10.7, 11.4 → 10.3, 10.5 | 10.0, 11.0 → 10.5, 13.1 |
| English 2 | 4.3, 4.6 → 4.4, 3.7 | 7.3, 7.1 → 6.9, 6.1 | 9.5, 9.4 → 9.0, 8.1 | 8.5, 10.7 → 9.7, 8.0 |
| Japanese 1 | 3.1, 3.2 → 3.6, 3.0 | 6.3, 6.4 → 5.9, 5.6 | 9.5, 9.5 → 8.4, 8.5 | 7.8, 7.8 → 8.1, 7.5 |
| Japanese 2 | 3.1, 3.1 → 3.4, 3.5 | 7.5, 7.5 → 5.5, 5.3 | 12.1, 11.9 → 9.3, 9.2 | 9.5, 8.5 → 8.1, 8.4 |

Supporting numbers, piece a, piece b:

| Talk | Rows closed by length | Piece requests / rows | Failed pieces | Piece speech end to request p50 (s) | Piece request to first text p50 (s) |
| --- | --- | --- | --- | --- | --- |
| English 1 | 20 of 46, 20 of 47 | 63 / 46, 59 / 47 | 0, 0 (1 unresolved) | 2.8, 2.7 | 1.9, 1.9 |
| English 2 | 15 of 48, 15 of 48 | 58 / 48, 60 / 48 | 0, 0 | 2.7, 2.3 | 1.7, 1.5 |
| Japanese 1 | 8 of 53, 6 of 53 | 75 / 53, 73 / 53 | 5, 4 | 2.0, 1.9 | 1.5, 1.3 |
| Japanese 2 | 35 of 41, 36 of 42 | 70 / 41, 72 / 42 | 0, 0 | 2.0, 2.1 | 1.5, 1.6 |

Every failed piece was a row's last one: the first Japanese talk failed 5 and 4 rows with pieces, 3 and 2 with rows. Lock lag p50 with pieces was within 0.4 s of the row runs on three talks; on the second English talk it was 3.4 and 2.5 s against 3.0 and 2.8 s.

As a content-free check on seams, translation length relative to the original, and the count of sentence ends in the translations, were compared per talk. Length stayed within the spread of the two row runs. Sentence ends did too on the English talks; on the Japanese talks one piece run fell outside it each way: 66 against 77 and 79 on the first, 83 against 77 and 79 on the second. Pieces closed off as whole sentences would raise that count, so this shows no systematic seam, only that the check is coarse. Quality was not judged; the review files are under `.local/experiments/units-*-review.json` for the maintainer.

## Findings

- Pieces help where rows are long and speech is continuous. The second Japanese talk, whose rows close by length at about 9 s, gained about 2 s at the middle of a row and 2.7 s at the first word. The second English talk and the first Japanese talk gained 0.6 to 1.1 s at the middle and first word. The first English talk gained about 0.6 s at the first word and nothing at the middle.
- Most rows get one piece, 1.2 to 1.7 requests per row. A row that ends at a pause closes before its locked text past the first lock reaches 1.5 s, and while the previous row's last piece runs no piece can be cut.
- The design's estimate of about 4.5 s from the middle of a row was not reached: 5.3 to 7.6 s at the median. A piece waits for its lock, 1.9 to 2.8 s from its speech end to the request, and then 1.3 to 1.9 s for its first text. Lock lag is now the largest part of the wait.
- The last word costs up to 0.5 s more on some runs, when a row's last piece waits behind a running piece. Failures did not change beyond run to run spread.

## Open

- Quality: the maintainer's reading of the piece and row review files, especially Japanese to English, decides whether pieces go further.
- The live default stays `row`. Pieces are a candidate for lectures in continuous speech, the case where they gained most.
- Smaller pieces cannot beat the lock. Lowering lock lag, or showing translated unlocked text, are the remaining levers, and the second breaks the settled-text rule of 2026-10-26.
