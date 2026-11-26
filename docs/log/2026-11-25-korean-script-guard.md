# Korean script guard and joined particles; Taiwan vocabulary tested

2026-11-25. Uncommitted tree on `main` at `2221bd5`, on top of [term sets](2026-11-23-glossary-term-sets.md) and [word boundaries](2026-11-23-word-boundaries-and-smoke.md). No paid calls and no microphone. Local translator `qwen3.5-4b-q4` on the Air on mains power. Another project's test runs loaded the CPU during the first hour, so request times from the re-translations are not comparable between runs. Nothing here is a gate result except the part 6 run, which finished after midnight.

## Method

The stored read-through exports of 2026-11-22 hold each held-out talk's recognized rows. The English rows of the Korean and Mandarin exports, 262 and 266, were translated again in order, outside real time, with the context and the example term set as live, once per variant. Two variants over the same recognized text differ only in the translator. Rows a variant changed went to an agent grader as blind pairs, sides shuffled per row, under the rubric in [gates](../wiki/gates.md#translation-read-through). One judge, of the model family that wrote this entry.

## Baseline with term sets

| | English to Korean, 262 rows | English to Traditional Chinese, 266 rows |
| --- | --- | --- |
| Failed or unresolved | 0 | 0 |
| Rows holding kana | 0 | 0 |
| Rows holding Chinese characters | 14, of which 4 with no Hangul | all, as expected |
| Rows holding a mainland word from a list of 24 | n/a | 23 |

Term sets ended the Japanese openings: the export of 2026-11-22 held kana in 29 of these rows. Chinese inside Korean remained.

In Korean the model also leaves a space between a number or Latin word and what follows it. A particle stood apart from a number, a percent sign or a Latin word 63 times in the guarded run, and joined almost never. A number was followed by a space before Korean text 130 times in the baseline and by none 10 times; most of those are counters. Korean always joins a particle. A counter may be written either way.

## Variants

| Variant | Result | Blind grade of changed rows | Outcome |
| --- | --- | --- | --- |
| Script guard: no token holding a Chinese character or kana can be generated into Korean | Rows holding Chinese characters 14 to 0; each became Korean | 76 rows: mean 3.47 to 3.76; better on 19, worse on 9, equal on 48; at 2 or lower, 12 to 2 | Live |
| Guard plus a prompt note asking for one polite formal speech level and joined particles | Formal sentence ends 177 to 183 of 262; particles standing apart unchanged; one row lost to the 12 s timeout | not graded | Not adopted |
| Particles joined in the service, from a closed list in the profile | 63 spaces removed in 49 rows; every word joined was a particle | not graded: a spelling rule | Live |
| Prompt note naming Taiwan's words for six mainland ones | Rows with a listed mainland word 23 to 16; 157 rows changed | 157 rows: mean 4.03 and 4.03; better on 27, worse on 28 | Not adopted |
| Prompt note asking for Taiwan's vocabulary with no examples | 23 to 22 | not graded | Not adopted |
| OpenCC's Taiwan phrase conversion on the stored translations | Changed 20 rows, several wrongly: it rewrote ordinary words as computing terms | not graded | Not adopted |

The guard's cost: on one worker, alternating guarded and plain requests over three sentences, 26.5 and 26.6 ms per generated token. Building the mask takes about 0.3 s once, on the first guarded request; decoding the vocabulary adds about 1.2 s to the worker's start.

With joined particles in the context it reads, the model itself joined a particle 22 times and left 47 apart, where it had joined almost none; the service joins the rest.

On twelve sentences about software written for this session, the model already used Taiwan's words for most computing terms without any note, and wrote four mainland words in one sentence and a mainland greeting. The note fixed those. On the earnings calls the gain was small and the grade unchanged.

## English to Korean, read again

The six English talks as stored on 2026-11-22 against the same rows translated with term sets, the guard and joined particles: every row graded by one agent, the two versions as blind pairs. Recognition-error flags are those of 2026-11-22, since the recognized text is the same.

| | Stored, 2026-11-22 | With term sets, guard and particles |
| --- | --- | --- |
| Mean grade, 232 clean rows | 3.52 | 3.98 |
| Clean rows at 2 or lower | 42 (18.1%) | 12 (5.2%) |
| Rows at grade 1, all rows | 33 | 1 |
| Invention, all 262 rows | 3 (1.1%) | 7 (2.7%) |

- The judge of 2026-11-22 gave the stored rows 3.46 and the same 42 low rows, so the two sessions grade alike.
- The new version was better on 67 rows, worse on 22 and equal on 173. On the 195 clean rows that were already wholly Korean the means are 3.95 and 3.96: the gain is the rows that had been in Japanese or Chinese, and nothing else moved.
- English to Korean now grades level with Korean to English, 3.98, and still under part 4's mean of 4.3.
- What the grader noted across rows, in both versions: a call's central term rendered four to six ways, speech level dropping from formal into plain forms in some rows, domain words taken literally, and names spelled several ways. A term set for the talk is the tool for the first and last.
- The comparison covers the 262 rows that had a translation on 2026-11-22. One of them has none in the new version: a two-word fragment the model answers with empty text, where before it handed the fragment back in English.

These rows were translated outside real time. A replay in real time, `review_export.py --gate ko`, was not repeated: it would overwrite the graded export of 2026-11-22.

## Part 6 in `en-ko`

`pnpm gate:delay --gates ko`, on the tree with term sets, the guard and joined particles. Load average was 2.7 before and 1.8 after, on mains power. The Mac had run about an hour of translation requests with gaps, not the two hours of replays that preceded the run of 2026-11-22, so this run is under lighter load than that one.

| Talk | Rows | Median | p90 | Result | p90 on 2026-11-22 |
| --- | --- | --- | --- | --- | --- |
| held-en-4320211 | 50 | 2.3 s | 3.5 s | pass | 4.7 s, fail |
| held-en-4346818 | 51 | 2.7 s | 3.9 s | pass | 4.2 s |
| held-ko-lvIVLOef9AM | 54 | 2.1 s | 3.6 s | pass | 4.2 s |
| held-ko-ZBNO2Drz36c | 56 | 2.1 s | 3.4 s | pass | 4.4 s |
| held-ko-jUe7EdiQP1c | 79 | 1.6 s | 2.5 s | pass | 3.3 s |
| held-ko-zRvDWVfib2c | 48 | 2.1 s | 3.4 s | pass | 3.8 s |

Every talk passes. The English talk that missed on 2026-11-22 passes by 1 s at p90. A talk's p90 moves by up to about 1 s between replays, and the load differed, so the run shows the guard does not slow the pair; it does not show a gain. Run: `benchmarks/results/delay-20261125T231643`.

## Changed

- `scripts/local/translate_worker.py`: a request may carry `avoid`, Unicode character-name prefixes; `scripts/local/script_mask.py` lists the tokens that hold such a character, and the worker rules them out before each token is chosen.
- `packages/providers/local-translator.ts`: with the direction known, sends the target profile's `foreign` as `avoid`; `scriptGuard: false` turns it off.
- `packages/providers/script.ts`, `attached`: joins a profile's `particles` to the number or Latin word before them; the controller applies it to translations, streamed and final, and the replay and eval scripts do the same.
- `profiles/languages.json`: Korean gains `foreign` and `particles`. No other profile sets either, so no other pair changes.
- Unit tests for the mask, the adapter's request, the joining rule and the controller.

## Run

| Check | Result |
| --- | --- |
| `pnpm check` | Passes |
| `pnpm test:local-unit` | 71 tests pass |
| Offline browser smoke, `--offline --rolling --pair <pair>` | Passes in `en-ko` and `en-ja` |

## Observed, not changed

- The same spacing habit shows in the other languages without word spaces. In the stored exports the model leaves a space between a Latin word or number and the text beside it in 129 of 283 Japanese rows and 90 of 266 Chinese rows. Chinese typography accepts it. Japanese captions usually close it. Nothing was changed for either.
- Counters after a number in Korean, `2 월`, are left apart.
- Into English, the low rows of both Korean and Chinese are mostly endings invented for unfinished sentences and subjects Korean leaves out. Neither was worked on.

## Not done

- No microphone session in either pair.
- Korean to English, and both Chinese directions, were not read again; nothing that reaches them changed.
- The particle list and the guard's effect have not been seen by a native reader.

## Commands

```text
pnpm check
pnpm test:local-unit
pnpm exec tsx scripts/local-browser-smoke.ts --offline --rolling --pair en-ko
pnpm gate:delay --gates ko
```
