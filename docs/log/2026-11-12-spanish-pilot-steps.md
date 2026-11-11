# Spanish pilot: stock phrases, neighbour languages, local translation, and a session in the pair

2026-11-12. The four steps left open by [the Spanish pilot](2026-11-11-spanish-pilot.md), in order. No paid calls. Public material, plus held-out talks read by scripts only, reported as counts and times.

## 1. Stock-phrase sweep

`scripts/local/stock_sweep.py --language es` decodes non-overlapping 10 s and 25 s windows of the gate's three non-speech streams, forced into Spanish, at the stream's level and 20 dB below, without the speech gate, and counts each window's whole text after the segment filters.

Of 630 windows, all returned text and 489 passed the filters. The profile's first-guess list covered 470 of those: "Gracias por ver el video." alone was 420, "Gracias." 50. The largest uncovered text was "¡Suscríbete al canal!", 13, with "¡Suscríbete!" once. Both are now in the Spanish `stockPhrases`, which covers 484 of the 489. The five left are single windows: an English phrase twice, its Spanish version, a repeated conjunction, and a church's name. None was added.

The sweep is forced Spanish on non-speech. It says what Whisper invents in Spanish, not how often a live session would show it: live, the speech gate, Auto detection and the pair rules stand in front. The gate's own measure, stock or repetitive rows on speech material, was 0 in the full run.

## 2. Neighbour languages

`pnpm gate:fixtures --language es` now also writes `benchmarks/gate-other-es.json`: the first ten FLEURS test clips each of French, Italian and Portuguese, by the third-language set's rule. The Spanish gate file names it as `other`, and `gate:run` replays it after the shared third-language set. `gate-other.json` and the Japanese gate are unchanged. Third-language rows are reported, not gated, and the addition was made before any run on it.

A real-time rolling replay of the Spanish gate's whole third-language stream, 60 clips, 11 minutes, ten each of Mandarin, Korean, German, French, Italian and Portuguese, in the `en-es` pair: no row displayed, 121 stretches rejected or empty. The neighbours did not leak into Spanish rows. The clips are read sentences; accented or mixed speech is untested.

## 3. Local translation in the pair

`pnpm eval:translation-cases --gate es` freezes the gate's 120 public clips, decoded one by one in Auto with the pair, as cases; none was rejected. `benchmarks/translation-terms-es.json` holds required terms for 50 of them, 25 per direction, 98 term groups, written from the public references before any translation.

`pnpm eval:translation --pair en-es --candidate mlx:qwen3.5-4b-q4 --no-judge --repeats 1` on the Air:

| Measure | Result |
| --- | --- |
| Valid replies | 120 of 120, none in the wrong direction |
| Request time, median, p90, maximum | 1.3 s, 1.8 s, 2.4 s |
| Required term groups present | 89 of 98 |

The nine misses, read against the recognized text: seven are recognition errors on proper names that the translator carried over faithfully; one is a ratio written out in words where the term file wanted digits, a correct translation; one is a real translation error, a vegetable rendered as a different one. Reading a further sample of 14 translations by the agent, not a judge: fluent and complete in both directions, with two lexical slips, tree species rendered as other species and one English word left untranslated in Spanish. That is a reading, not a score; no judged run exists for the pair, and a judged run is paid.

## 4. A session in the pair

- `LANGUAGE_PAIR=en-es` passes the offline preflight.
- The operator page relabelled its presets and mode menu for the pair already; its heading and tab title stayed in the Japanese pair's wording and now follow the pair too.
- `pnpm exec tsx scripts/local-browser-smoke.ts --offline --rolling --pair en-es`: headless Chrome, a synthetic microphone playing a public English clip and a public Spanish clip, the real speech gate, Turbo Q4 in rolling and the real local translator. Both originals and both translations reached the overlay, with the heading "English ↔ Spanish" and the preset "Lecture · Spanish → English". The default pair's run still passes.
- That check does not assert an unlocked tail outside the Japanese pair. English and Spanish clips of a sentence or two lock a whole sentence at a time, which closes the row, so no open row carried a tail; the Japanese clip locks in shorter segments. The same behaviour shows in the Spanish gate's time to first text.

`pnpm replay:contention --pair en-es --translate local --units row` on two Spanish and two English held-out talks, real time through the live controller, load average about 2.8 at the start. Medians in seconds, p90 in brackets:

| Talk | Rows translated | Lock lag | Speech end to final text | Translation request to first text | Last word to first translated text | Middle of row to first translated text |
| --- | --- | --- | --- | --- | --- | --- |
| held-es-051ObIQbmVs | 57 of 57 | 2.5 (4.1) | 2.1 (3.1) | 1.1 (1.8) | 3.2 (4.7) | 5.7 (7.0) |
| held-es-9hUjhIfs-bw | 37 of 37 | 1.9 (3.5) | 1.8 (2.5) | 1.0 (1.6) | 2.9 (3.8) | 6.7 (8.5) |
| held-en-4320211 | 49 of 50 | 2.8 (4.4) | 2.2 (4.4) | 1.3 (2.1) | 3.6 (6.1) | 7.4 (10.8) |
| held-en-4346818 | 51 of 51 | 2.2 (3.3) | 2.2 (3.1) | 1.0 (1.5) | 3.3 (4.4) | 5.6 (7.4) |

Against gate part 6, which is set for the Japanese pair only, 3.0 s at the median and 4.5 s at p90: one Spanish talk meets it, the other misses by 0.2 s, and English misses as it does in the Japanese pair. Three decodes in the Spanish talks were detected outside the pair and dropped, in three rows; none was retried into the pair. The translations of the held-out talks were written to an ignored review file and not read.

## The maintainer's first session, and two translator guards

`LANGUAGE_PAIR=en-es pnpm dev:offline`, turns segmentation, played speech switching from English to Spanish, diagnostics on. Every turn was transcribed. Of 14 turns, the first two Spanish turns after the switch showed "Language uncertain" with no translation, and two more Spanish rows showed their own text as the translation.

The diagnostics file shows recognition was right: every one of those turns has recognition language `es`. The translator was wrong. The local translator already asks the model for the direction the recognizer's language gives; the model answered `unknown` twice and handed the source back twice.

Offline, with the public cases of step 3: 30 rows of one language, each sent with three rows of the other language and their translations as context, as the controller does right after a switch.

| | Returned `unknown` | Source handed back | Answered in the source language | With no context |
| --- | --- | --- | --- | --- |
| Spanish after English rows | 4 | 5 | 2 | 0 of 30 failed |
| English after Spanish rows | 4 | 0 | 0 | 0 of 30 failed |

Separately, a five-word Spanish fragment sent with two Spanish rows as context came back unchanged three times of three, and translated three of three without context.

Two changes in `local-translator.ts`:

- In a pair whose languages share a script, a request directed by the recognizer's language carries only the context rows in that language. With it, the probe above fails on none of 60.
- In any pair, a reply whose text is the source text unchanged, on a request that carried context, is asked for once more without context. The fragment now translates three of three. The cost is one more request for that row.

The first is limited to pairs of one script because the Japanese pair's defaults are frozen and the failure was not looked for there. A second session by the maintainer with both changes, in rolling, switching between English and Spanish and once to French: 23 rows, all translated, none unresolved or failed, across three switches inside the pair by the diagnostics file; the French speech was rejected as outside the pair and showed no caption. The maintainer saw no lost row. The audio was played speech, not a talker at the microphone. The probe's check for "answered in the source language" is a count of common words, good enough to count failures, not a language detector.

The operator page's diagnostics help named the Japanese lecture preset in every pair; it now says the Lecture preset. Also seen in that session: there is no pair selector in the operator page; the pair is set at startup by `LANGUAGE_PAIR`. And the session ran in turns, where a 12 s limit cuts continuous speech mid-sentence; the Spanish gate results are for rolling.

## Verification

`pnpm check`, the Python unit tests and both real-model browser runs pass.

## Open for Spanish

- The maintainer's rating of held-out rows for the major-error share, and a spot check of the unchecked references.
- A judged translation run, which is paid.
- A real microphone session in the pair. Everything above is replayed audio.
- Lock lag and first text on continuous speech, which miss narrowly in the full gate run.
- Display pacing picks partial-row rates by script, which cannot separate English from Spanish.
