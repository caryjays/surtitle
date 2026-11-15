# Translation read-through of the offline profile, four directions

2026-11-14. The first reading of whole translated talks, by an agent session, since the maintainer does not read the gate languages. Local recognition and the local translator only; no paid calls. Aggregates only. The rubric is in the gates page and was written before any transcript was read.

## What ran

`scripts/local/review_export.py` replayed the public held-out talks in real time through the live controller with rolling recognition, the closing decode and the local Qwen3.5-4B translator, with the example glossary: six English excerpts and five Japanese talks in `en-ja`, the same six English excerpts and six Spanish talks in `en-es`. One session of the model that wrote this entry graded each direction, reading every talk whole against its reference: a grade of 1 to 5 for each translated row, a flag for invention, and a flag for a recognition error that changes the original's meaning. A fifth session read one Japanese talk and part of an English one against their grades and found them strict and not inflated. One judge, one model family; the translator is from another family.

The first export left out English to Spanish, because the Spanish held-out manifest lists only its Spanish talks; the script now takes the shared English excerpts from the first gate's manifest.

## Results

Clean rows are those recognized without a meaning-changing error.

| Direction | Talks | Rows graded | Rows with a recognition error | Mean grade, clean rows | Clean rows at 2 or lower | Invention, all rows | Rows without a translation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| English to Spanish | 6 | 287 | 33 (11%) | 4.31 | 4 (1.6%) | 2 (0.7%) | 3 |
| Spanish to English | 6 | 314 | 25 (8%) | 4.19 | 19 (6.6%) | 2 (0.6%) | 5 |
| Japanese to English | 5 | 294 | 61 (21%) | 4.12 | 10 (4.3%) | 9 (3.1%) | 24 |
| English to Japanese | 6 | 283 | 30 (11%) | 3.79 | 14 (5.5%) | 7 (2.5%) | 1 |

Gate part 4 asks for a mean of at least 4.3, no clean row at 2 or lower, and invention on at most 2% of rows, under two judges. This is one judge and does not stand in for that part; by its numbers only English to Spanish reaches the mean, and no direction is free of low rows.

Rows without a translation: most had an empty original; 15 of the Japanese 24 are in the talk with frequent pauses.

## What goes wrong

The same three things in every direction:

- Short rows translated alone. A fragment of one to five words, or a row cut before the end of its sentence, is translated as a complete statement. The subject is guessed, which in Spanish and Japanese, both of which drop subjects, turns one person into another; a negation or contrast held by the neighbouring row is lost, and some rows state the opposite. One Spanish first-person account holds 14 of that direction's low rows this way. Most low grades on clean rows are of this kind.
- Terms and names. Domain vocabulary seldom gets the established term and changes within a talk: one sales measure is rendered three ways in Japanese, a key object four ways in English. Into Spanish the translator coins words that look Spanish when it has none. Names are unstable, and in Japanese to English five rows replace a correctly recognized name with another.
- Recognition errors pass through. A misrecognized word is translated faithfully into fluent text that says something else. In Japanese a talk's central noun comes out as several homophones, each translated literally, so the subject of the talk changes from row to row. Repair from context happens, on well-known facts, and is rare.

Invention is nearly all one mechanism: a row's translation takes content from earlier rows, or completes a cut clause with a detail the speaker did not give. None of the flagged rows is free fabrication.

Long, complete sentences are translated accurately and naturally in all four directions, and numbers, dates and percentages are carried correctly almost everywhere.

## Reading

- The graders put most low rows down to short and cut rows translated alone. The check below does not bear that out: the losses are mostly the translator's own.
- English to Japanese is weakest. Its talks are earnings calls, dense with finance and industry vocabulary the example glossary does not hold, so its term losses overstate what a talk on the maintainer's own subjects with a glossary would show. The cut-row losses would remain.
- Japanese to English loses more to recognition than to translation.

## A check of the row-context reading

The translator already receives the four rows before a row, each with its translation. Two things were checked the next day against the stored transcripts.

By punctuation, rows that follow an unfinished row score the same as rows that do not, and rows of five words or fewer score higher than the rest, in the three directions where rows carry punctuation. Whisper ends most fragments with a full stop, so punctuation is a weak sign of a cut sentence, but it gives no support to cut rows being the main loss.

A scratch harness re-translated a talk's rows in order with the live prompt and context, outside real time. It reproduces the live translations exactly, 73 of 73 and 44 of 44 rows on the two talks tried, so the translator is deterministic and stored transcripts are a test bed. On the Spanish talk with 14 low rows and the English talk with 7, three variants:

| Variant | Spanish talk, low rows fixed of 14 | English talk, low rows fixed of 7 |
| --- | --- | --- |
| Instruction rewritten to say the context is the speech just before, and to keep subject, gender, tense, negation and terms consistent with it | 3 | 1 |
| No context at all | 3, others changed for the worse | not run |
| Eight rows of context | not run: the protocol allows four | not run |

The rewritten instruction changed 20 of 73 and 32 of 44 translations, and some rows not graded low read worse with it. Read by the agent, not graded blind.

What the low rows are: in the Spanish talk, complete sentences in which Spanish leaves the subject out and the 4B model picks the wrong person with the context in front of it. In the English talk, disfluent speech and jargon, and an industry abbreviation recognized as a word. Neither is a row cut in the wrong place. The limit is the translator model's ability and, into Japanese, vocabulary and recognition; the way context is worded is a small lever.

The maintainer left it there for now: the reworded instruction is not adopted, and no larger model was tried. The harness was a scratch script and is not in the repository; it calls `LocalTranslator` once per row with the four rows before it, as the controller does.

## Not done

A second judge from another model family. A reading of the cloud translators. A comparison of settings: the graded files are kept in the ignored `review/` folder so a later run can be compared row by row, which is the way to test longer rows, more context for a row, or a term list built during the talk.

```sh
.local/venv/bin/python scripts/local/review_export.py --gate ja
.local/venv/bin/python scripts/local/review_export.py --gate es
```
