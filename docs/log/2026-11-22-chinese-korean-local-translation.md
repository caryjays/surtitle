# Chinese and Korean: the local translator in both pairs

2026-11-22, the translation steps for `en-zh` and `en-ko`: required terms, the local translator on the public clips, offline browser smokes, read-throughs in all four directions and part 6. Uncommitted tree on `main` at `36c717a`. No paid calls. Local recognition `turbo-q4`, rolling segmentation, local translator `qwen3.5-4b-q4`, on the Air on mains power.

## What was built

- `benchmarks/translation-terms-zh.json`, 109 term groups, and `benchmarks/translation-terms-ko.json`, 111 groups, written from the public references before any translation ran. On the English side they cover the 25 English clips of `translation-terms-es.json`. On the other side they cover 25 clips of the gate's public set. A Chinese group accepts both scripts.
- `pnpm gate:delay --gates` accepts `zh` and `ko`. Mandarin replays in `en-zh-Hant`, the script of its held-out lectures. The default stays `ja,es,fr,it,pt`.

## Local translator on the public clips

`pnpm eval:translation-cases --gate zh` and `--gate ko` froze 120 cases each, with no case rejected and none detected outside the clip's language. `pnpm eval:translation --candidate mlx:qwen3.5-4b-q4 --no-judge --repeats 1` then ran in each pair, `en-zh-Hant` and `en-zh-Hans` over the same cases. Nothing was judged.

| Pair | Valid | Wrong direction | Request time p50 / p90 / max | Terms into English | Terms out of English |
| --- | --- | --- | --- | --- | --- |
| `en-zh-Hant` | 120/120 | 0 | 0.77 / 1.10 / 1.44 s | 54/60 | 39/49 |
| `en-zh-Hans` | 120/120 | 0 | 0.81 / 1.12 / 1.45 s | 55/60 | 40/49 |
| `en-ko` | 120/120 | 0 | 0.94 / 1.46 / 2.53 s | 48/62 | 35/49 |

Each missed term group was read against the recognized text and sorted by cause:

| Direction | Translation errors | Recognition errors carried over | Correct, but outside the term list |
| --- | --- | --- | --- |
| Chinese to English | 1 to 2 | 4 | 0 |
| English to Chinese | 2 | 3 | 4 to 5 |
| Korean to English | 4 | 8 | 2 |
| English to Korean | 8 | 3 | 3 |

"Outside the term list" means spaced dates and ratios, and valid name spellings the list does not hold. The lists stay as written, since they were fixed before any translation ran. Out of English, the Korean replies swap common nouns: one animal becomes another, and a region loses part of its name. 3 of 60 Korean replies switch into Chinese mid-sentence, and 4 leave an English word in place. The Chinese replies hold none of either.

`pnpm exec tsx scripts/local-browser-smoke.ts --offline --rolling --pair <pair>` passes in `en-zh-Hant`, `en-zh-Hans` and `en-ko`.

## Read-throughs

`scripts/local/review_export.py --gate zh`, then `--gate ko`, replayed each gate's held-out talks in real time with the local translator. Mandarin covered 8 talks and 483 rows, in `en-zh-Hant`. Korean covered 10 talks and 497 rows.

Four agent sessions graded them, one per direction. Each read every talk whole against its reference and applied the rubric in [gates](../wiki/gates.md#translation-read-through). There is one judge, from one model family, the family of the session that wrote this entry. The grades are kept as `<id>.grades.json` beside each transcript. The totals below were recomputed from those files.

| Direction | Talks | Rows graded | Rows with a recognition error | Mean grade, clean rows | Clean rows at 2 or lower | Invention, all rows | Rows without a translation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chinese (Taiwan) to English | 2 | 215 | 62 (29%) | 4.44 | 4 (2.6%) | 15 (7.0%) | 0 |
| English to Chinese (Taiwan) | 6 | 266 | 28 (11%) | 4.12 | 12 (5.0%) | 3 (1.1%) | 2 |
| Korean to English | 4 | 233 | 25 (11%) | 3.98 | 13 (6.3%) | 7 (3.0%) | 0 |
| English to Korean | 6 | 262 | 30 (11%) | 3.46 | 42 (18.1%) | 2 (0.8%) | 2 |

- **Chinese to English.** Above part 4's mean of 4.3, below Portuguese and French into English, and over 2% invention. 29% of its rows carry a recognition error, against 11 to 13% in the other directions here and in French and Portuguese: English technical terms in Mandarin speech are misheard and take several forms within a lecture. The inventions cluster in one anecdote and in a row that repeats the one before it. Clean technical explanation grades 4 to 5.
- **English to Chinese.** No character falls outside Big5, and two rows use a character in its Simplified role. Mainland rather than Taiwan vocabulary is spread through every talk, for example 數據, 計劃, 項目, 早上好 and 可持續. The core term of an earnings call takes several renderings in a talk, as in the other languages.
- **Korean to English.** Most low rows lose a subject that Korean leaves out: a daughter, the children or a teacher becomes "I" or "we". Where a sentence-final verb falls in the next row, the first row becomes a confident sentence of its own. Recognition errors on a talk's central term leave it with no stable English rendering.
- **English to Korean.** Every talk opened in the wrong language. The first 3 to 9 rows came out in Japanese, and a few in Chinese, before the output settled into Korean: 33 of 262 rows. Without them the clean rows that came out in Korean average 3.84, and 11 are at grade 2 or lower. After the opening, 10 rows switch into Chinese mid-sentence and 10 leave an English word. Speech level drifts between 합니다체, 해요체 and plain forms within a talk.
- Two translations, one Chinese and one Korean of 980, end with a stray `}` after a quoted phrase. The model wrote it inside the text; parsing reads the reply correctly.

## The Japanese opening

The replay scripts send `profiles/glossary.example.json` with every request, as the service does when no private glossary exists. Every entry in that file is English to Japanese. Until a talk has Korean rows in its context, the model follows the glossary's language.

A check re-translated each English talk's first 12 rows in `en-ko`, as live, with context from the rows before. With the example glossary, 29 of 72 rows held kana. With no glossary, none did. Chinese characters still appeared in 5 and 6 rows, so the mid-sentence switching is separate. One request without a glossary hit the reply's token limit. No kana appeared in any Chinese, Spanish, French, Italian or Portuguese read-through. The Japanese glossary is the same in every pair, but only Korean output follows it.

Nothing was changed. The glossary has no languages, so a glossary for one pair is sent in every pair. The candidates are a glossary per pair, or sending only entries whose translation is in the pair's other language. Either changes a live default and needs the maintainer's decision.

## Part 6

`pnpm gate:delay --gates zh,ko` ran right after the read-through replays, so the Mac had been under translation load for over two hours. Load average was 1.9 before and 2.5 to 2.7 after, on mains power. The replays used the example glossary, so the Korean run's English talks opened in Japanese as above.

| Pair | Talk | Rows | Median | p90 | Result |
| --- | --- | --- | --- | --- | --- |
| `en-zh-Hant` | held-en-4320211 | 55 | 2.3 s | 3.4 s | pass |
| `en-zh-Hant` | held-en-4346818 | 50 | 2.0 s | 2.5 s | pass |
| `en-zh-Hant` | held-zh-week10_1 | 101 | 2.3 s | 3.8 s | pass |
| `en-zh-Hant` | held-zh-week10_2 | 111 | 2.3 s | 3.6 s | pass |
| `en-ko` | held-en-4320211 | 49 | 2.7 s | 4.7 s | fail |
| `en-ko` | held-en-4346818 | 48 | 2.5 s | 4.2 s | pass |
| `en-ko` | held-ko-lvIVLOef9AM | 55 | 2.3 s | 4.2 s | pass |
| `en-ko` | held-ko-ZBNO2Drz36c | 55 | 2.8 s | 4.4 s | pass |
| `en-ko` | held-ko-jUe7EdiQP1c | 78 | 2.0 s | 3.3 s | pass |
| `en-ko` | held-ko-zRvDWVfib2c | 48 | 2.2 s | 3.8 s | pass |

Mandarin passes on every talk. Korean misses on one English talk, by 0.2 s at p90, and its other talks sit closer to the target than Mandarin's. Korean replies are slower on the public clips too. Run: `benchmarks/results/delay-20261122T190818`.

## Open

- The maintainer's decision on the glossary across pairs, then a repeat of English to Korean with it settled.
- Chinese characters inside Korean replies, and the noun swaps. A larger local model is the standing candidate for translation quality.
- Taiwan vocabulary in Traditional output. The instructions name the script but not the locale's vocabulary.
- A second part 6 run in `en-ko`.
- No microphone session in either pair.

```sh
pnpm eval:translation-cases --gate zh
pnpm eval:translation --pair en-zh-Hant --cases benchmarks/results/translation-cases-zh.json --terms benchmarks/translation-terms-zh.json --candidate mlx:qwen3.5-4b-q4 --no-judge --repeats 1
pnpm eval:translation --pair en-zh-Hans --cases benchmarks/results/translation-cases-zh.json --terms benchmarks/translation-terms-zh.json --candidate mlx:qwen3.5-4b-q4 --no-judge --repeats 1
pnpm eval:translation-cases --gate ko
pnpm eval:translation --pair en-ko --cases benchmarks/results/translation-cases-ko.json --terms benchmarks/translation-terms-ko.json --candidate mlx:qwen3.5-4b-q4 --no-judge --repeats 1
.local/venv/bin/python scripts/local/review_export.py --gate zh
.local/venv/bin/python scripts/local/review_export.py --gate ko
pnpm gate:delay --gates zh,ko
for p in en-zh-Hant en-zh-Hans en-ko; do pnpm exec tsx scripts/local-browser-smoke.ts --offline --rolling --pair $p; done
```
