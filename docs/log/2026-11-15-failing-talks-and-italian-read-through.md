# The failing French and Portuguese talks traced; translation in the three pairs; an Italian read-through

2026-11-15, after [the gate runs](2026-11-15-french-italian-portuguese.md). Local recognition and the local translator only; no paid calls. Held-out talks were read by scripts as counts, and the Italian review transcripts by agent sessions under the rule for the `review/` folder. Aggregates only. No code changed.

## The three failing talks

From the gate runs' own results, by scratch scripts that print counts: per talk, rows, row lengths, the boundary that closed each row, and the shape of the alignment against the reference.

French, two talks 4.9 and 7.2 points over their one-pass decode:

| | The two failing talks | The other four |
| --- | --- | --- |
| Rows per talk | 77 and 79 | 45 to 70 |
| Rows closed by a pause | 76 of 77, 77 of 79 | 26 to 64 |
| Rows under 2 s | 31 and 30 | 1 to 18 |
| Median row | 2.7 and 2.8 s | 3.2 to 6.2 s |

On the worse talk the live path has 52 substituted words against 20 in one pass and 9 deleted against none, spread over the whole talk. No row was rejected for language or confidence beyond two to four per talk. This is the shape of the Japanese talk accepted as a known limit: speech cut into short stretches by pauses, which short windows decode worse. Whether a longer quiet boundary recovers it was not tried; `held_out_sim.py` is written for the Japanese pair.

Portuguese, one talk 6.1 points of deletions over its one-pass decode: 31 of its 34 deleted words fall in the first fifth of the talk, in four runs of 5 to 11 words. A diagnostic replay of that talk, `pnpm replay:contention --pair en-pt --translate off`, shows the first nine rows, about two minutes, carrying little text for their audio, one of them 16 characters for 22 s, with the speech gate rejecting decodes in eight of the nine and none of the later rows on record. Input level there equals the rest of the talk. No decode was dropped as outside the pair, and one segment in the talk was dropped for confidence. The counts fit sound other than plain speech under the talker at the start, which the gated live path hears less of than an ungated one-pass decode. Nobody listened to the audio, so that cause is inferred.

Neither is a rule specific to the two languages. Both failures stand until the maintainer decides whether to accept them as limits.

## Local translation and the app in the three pairs

`pnpm eval:translation-cases --gate <language>` froze each gate's 120 public clips; none was rejected. `pnpm eval:translation --pair en-<language> --candidate mlx:qwen3.5-4b-q4 --no-judge --repeats 1`:

| Pair | Valid replies | Wrong direction | Request time median, p90, maximum |
| --- | --- | --- | --- |
| `en-it` | 120 of 120 | 0 | 1.3 s, 1.8 s, 2.3 s |
| `en-fr` | 120 of 120 | 0 | 1.5 s, 2.0 s, 2.5 s |
| `en-pt` | 120 of 120 | 0 | 1.8 s, 2.3 s, 2.7 s |

No required-term file exists for the three pairs, so no terms were counted, and nothing was judged.

`pnpm exec tsx scripts/local-browser-smoke.ts --offline --rolling --pair en-<language>` passes in each pair: both originals and both translations reach the overlay, and the operator page's heading and lecture preset follow the pair.

## Italian read-through

`scripts/local/review_export.py --gate it` replayed the six Italian talks and the six English excerpts in real time in `en-it`, 521 rows. One agent session per direction graded every translated row by the rubric in [gates](../wiki/gates.md#translation-read-through), reading each talk whole. One judge, one model family, the family of the session that wrote this entry.

| Direction | Talks | Rows graded | Rows with a recognition error | Mean grade, clean rows | Clean rows at 2 or lower | Invention, all rows | Rows without a translation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Italian to English | 6 | 233 | 20 (9%) | 4.37 | 2 (0.9%) | 7 (3.0%) | 11 |
| English to Italian | 6 | 272 | 39 (14%) | 4.08 | 9 (3.9%) | 5 (1.8%) | 5 |

Against part 4's targets, a mean of at least 4.3, no clean row at 2 or lower and invention on at most 2%: Italian to English reaches the mean and misses the other two; English to Italian misses the mean and the low rows. This does not stand in for part 4.

- Italian to English is the best of the six directions read so far by mean and by low rows. A quarter of its clean rows sit at grade 3, so the low-row share flatters it. Nine of its eleven rows without a translation had recognized text and came back unresolved.
- Its main loss is the wrong subject or person where Italian leaves the subject out, as in Spanish and Japanese. Then words rendered by an English look-alike, and confident guesses on misrecognized names and loanwords, which hold most of the inventions.
- English to Italian loses most to domain terms given their everyday sense, on the same earnings calls that were weakest into Japanese; the two biotech calls grade clearly higher than the industrial ones. Finance terms change within a talk. Specific to Italian output: coined verbs, wrong gender or article on common nouns, address that mixes informal and formal forms within a question, and English words left in place.
- Numbers and percentages are carried accurately in both directions.

The graded files are in the ignored `review/it/`.

## Not done

- A decision on the three failing talks, and one on whether lock lag and first text should measure shown text; the second needs new measurement in the gate run.
- Read-throughs for French and Portuguese. Required terms for the three pairs. A microphone session in any of them.
