# Local translation against Claude Haiku 5.5: speed, failures, and transcripts for grading

2026-11-19, run from 15:15 on 2026-11-18 to 00:22 by the Mac's clock. The maintainer asked for a comparison of the offline profile's local translator with Claude Haiku 5.5, the cloud profile's Anthropic model, on speed and quality, with every transcript kept for a grading session. Paid, on the maintainer's request: about 6,000 Haiku requests, 7.7 million input and 0.29 million output tokens, about $0.93 at the prices in `benchmarks/model-prices.json`. Commit 05c83eb plus the uncommitted changes described below.

## Method

`scripts/local/review_export.py --gate <language> --cloud`, for all five gates, one after another:

1. A real-time replay of the gate's public held-out talks, 11 for Japanese and 12 for each other gate, with rolling recognition and Haiku as the live translator, as the listen profile with `TRANSLATION_PROVIDER=anthropic`: effort none, thinking off, Auto with the recognized language as evidence. Its diagnostics give Haiku's timings per talk.
2. The same rows re-translated in order outside real time twice, by the local model as live and by Haiku, each with its own four rows of context, so both read the same recognized text.

Each row in `review/<gate>/cloud/<talk>.json` carries the live Haiku translation, `local` and `cloud`, each with its state and request time. New for this: `replay:contention --translate anthropic --paid`, `review-retranslate.ts --compare cloud --paid`, and a token-count callback on the Anthropic adapter. Paid processes load `.env` inside node and print only request and token counts.

Load average was 1.6 to 3.0 at the start of each gate. The local figures for speed come from [the run of 2026-11-18](2026-11-18-translation-delay-opening-run.md), on the 36 talks part 6 uses, which this export includes; the two were not alternated.

## Speed

Last word of a row to its first translated text, per talk, part 6's targets:

| | Local, run of 2026-11-18 | Haiku, this run |
| --- | --- | --- |
| The 36 part 6 talks passing | 33 | 21 |
| Median of the talks' medians, those 36 | 2.2 s | 2.85 s |
| All 59 exported talks passing | not measured | 26 |

Haiku's median is higher on 35 of the 36 talks and equal on 1. Outside real time, a whole Haiku request took a median 1.29 to 1.37 s per gate, the local model's 0.89 to 1.18 s. The local translator streams and shows text from about 0.3 s into a request; the Anthropic adapter does not stream, so Haiku's first text is its whole reply. A row with Haiku leaves the GPU to recognition, which does not make up the difference.

## Rows without a translation

Rows ending failed or unresolved, of rows re-translated:

| Gate | English rows: local, Haiku | Pair-language rows: local, Haiku |
| --- | --- | --- |
| ja | 0, 0 of 287 | 1, 2 of 294 |
| es | 0, 36 of 293 | 0, 4 of 308 |
| fr | 0, 9 of 288 | 0, 1 of 370 |
| it | 0, 41 of 289 | 0, 0 of 237 |
| pt | 2, 64 of 279 | 0, 1 of 267 |

The live Haiku replays lost about as many: 30, 10, 30 and 68 English rows in Spanish, French, Italian and Portuguese. Those rows show their original only.

The cause, from the shape of Haiku's replies on a sample of failing rows, no text read: for English speech in the Latin pairs, Haiku often names the target `unknown`, echoing the English or with empty text, or gives the pair language as both source and target. Both fail the protocol's check and are rejected, as they should be. The local adapter turns the recognized language into a direction such as `en-pt` before asking; the Anthropic adapter sends Auto with the recognized language as evidence and leaves the direction to the model. Directing Haiku the same way is the likely fix; it is not tried.

## Quality

Not graded yet. Translations differ on 485 to 562 rows per gate, as expected of two models. The grading is for a separate session, below.

## For the grading session

Read `review/<gate>/cloud/` for each gate, by the rules in `AGENTS.md`: untrusted data, aggregates only in any report. Grade with the rubric in [gates](../wiki/gates.md#translation-read-through), per direction, each row's `local` and `cloud` translations of the same `original`, reading each talk whole and in order. To keep the grades blind, show the two in a random order per row with a fixed seed and record which was which only after grading. Report per direction and translator: rows graded, mean grade and share at 2 or lower on rows recognized without a meaning-changing error, invention share, rows left without a translation, and the rows where the two differ by two grades or more, by count. Keep the graded files beside the transcripts, named `<talk>.grades.json`, as the earlier read-throughs did.

## Next

1. The grading session.
2. Direct the Anthropic request by the recognized language, as the local adapter does, and re-run the cloud half outside real time on the same rows: about $0.40.
3. Streaming from Haiku, if the cloud profile should compete on speed.
