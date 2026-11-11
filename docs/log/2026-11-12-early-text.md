# Early text: showing what two decodes agree on before it locks

2026-11-12. Lock lag and first text miss their targets on continuous speech in both gates. The maintainer lifted the tuning pause for this and, after the simulation below, chose to build the one lever found as an overlay setting, off by default. No paid calls. Aggregates only.

## Why first text is late

A rolling row shows only locked text, and text locks a whole Whisper segment at a time: the segment must lie inside what two consecutive decodes agree on and end 0.5 s before the newest audio. On continuous speech Whisper returns one long, growing segment, which in practice ends only when the next begins. The words at its start wait for all of it.

## Simulation

A scratch script replayed the cached decodes of the Japanese gate's held-out talks, six English and five Japanese, under the live rolling rules in virtual time, as `scripts/local/held_out_sim.py` does, and tracked a second view beside locked text: locked text plus the start of the unlocked tail on which the newest two decodes agree. Times per character run from when it was spoken, interpolated inside its segment, to when it was visible and stayed.

| Measure | English, locked | English, agreed | Japanese, locked | Japanese, agreed |
| --- | --- | --- | --- | --- |
| First text of a row, median | 5.7 s | 2.9 s | 4.2 s | 3.3 s |
| First text of a row, p90 | 9.1 s | 4.5 s | 7.3 s | 4.7 s |
| Spoken to visible, per character, median | 4.8 s | 2.9 s | 3.7 s | 2.8 s |
| Spoken to visible, per character, p90 | 8.7 s | 5.5 s | 6.2 s | 4.4 s |

The locked columns reproduce the gate's first-text miss for English, 9.0 s p90 in the latest run.

Agreed text is not final. Rules tried, by how often shown text changed in more than case, spacing or punctuation:

| Rule | English: changes per minute, share of shown characters | Japanese |
| --- | --- | --- |
| The newest agreement as it is | 4.2, 18% | 1.6, 5.4% |
| The same, last word held back | 3.8, 18% | 1.4, 5.3% |
| Kept while a later agreement covers less speech | 1.2, 5.7% | 0.5, 1.7% |
| Kept, last word held back | 1.1, 5.3% | 0.4, 1.0% |

Most changes of the plain rule come just after a lock: the trimmed window is decoded afresh and its first decode agrees with nothing. Keeping what is shown until a longer agreement replaces it removes two thirds of them. Holding back the last word buys little and costs 0.1 to 0.3 s. A change is about 25 characters at the median in English and 6 in Japanese. Changes of case and punctuation alone add about two a minute in English.

A row's sentence end becomes agreed in the same decode that locks it, in every row measured, so this does nothing for translation delay.

## What was built

- `packages/providers/local.ts` and `rolling.ts`: a rolling partial carries `agreed`, the length of locked text plus the agreed tail, kept as shown while a later agreement covers less speech. Before a row has locked text, agreed text needs a decode at log probability −0.5 or better, in the pair, and no noise trim waiting. A row begins at its first locked or agreed text.
- `Segment.agreed` in the protocol; the pacer releases up to it only for a display that asks.
- The overlay and the Audience view ask with Show text early in the Overlay for OBS panel, `early=on` in the Browser Source URL. Off by default; the operator transcript is unchanged.
- Recognition, locks, rows, translation and the measurements named first text and lock lag are untouched: they still describe locked text.

Tests: the helpers, a fake worker with one growing segment, the confidence guard, the controller's clamp, the pacer, and in `pnpm test:browser` the URL and an overlay with and without the setting.

## Real time

The first five minutes of four held-out talks through the rolling provider with the real worker, in real time, one run each, by a scratch script that reads the provider's events. Sooner: a row's first agreed text against its first locked text. A word change: shown text that changed in more than case, spacing or punctuation, a row's close included.

| Talk | Rows | Rows with text before a lock | Sooner, median and p90 | Word changes per minute | Share of final characters changed |
| --- | --- | --- | --- | --- | --- |
| English, held-en-4320211 | 45 | 37 | 2.8 s, 7.1 s | 2.0 | 11.3% |
| English, held-en-4366522 | 42 | 36 | 3.0 s, 6.1 s | 1.6 | 7.1% |
| Japanese, held-ja-0jJLyvNn_to | 36 | 33 | 2.0 s, 4.1 s | 0.8 | 1.8% |
| Spanish, the first held-out excerpt | 58 | 36 | 1.7 s, 5.1 s | 0.2 | 0.8% |

- Text shows 1.7 to 3.0 s sooner at the median and 4 to 7 s sooner at p90, about what the simulation gave.
- English changes more often here than the simulation's average over six talks; the first talk was also its worst there. Spanish and Japanese change rarely.
- No row that began with agreed text closed rejected on these talks. Noise, music and third-language material were not replayed with the setting.

## Not done

- A session: whether the changes on screen are acceptable is the maintainer's to judge, with the setting on and off.
- The gate's lock lag and first text targets still measure locked text and still fail. Measuring shown text instead is a change to the gate for the maintainer to make; `pnpm diag:latency` and the display events of a diagnostics download already time what a surface showed.
- The non-speech and third-language gate streams with the setting, for text that shows and is then withdrawn.
- Agreed text in piece translation, and the operator transcript marking it.

## A quieter rule, after a session

The maintainer tried the setting in a short Japanese session: it works, text is erased and rewritten, and with translation timing unchanged the rewrites are most of what one notices. Two changes followed, by the maintainer's choice among keeping, quieting and removing it.

Agreed text now needs three consecutive decodes of the same window, one more than a lock. Simulated on the same talks, with the rule that keeps shown text:

| Measure | English: two agree, three agree | Japanese: two agree, three agree |
| --- | --- | --- |
| Word changes per minute | 1.2, 0.25 | 0.5, 0.07 |
| Changes of any kind per minute | 3.4, 0.7 | 0.8, 0.07 |
| First text of a row, p90 | 4.5 s, 5.1 s | 4.7 s, 5.7 s |
| Spoken to visible, median | 2.9 s, 3.7 s | 2.8 s, 3.5 s |

And a display that shows text early swaps a changed original in place: its released length stays, where before the text from the change on was erased and released again at reading pace.

Real time, as above, with three decodes:

| Talk | Rows with text before a lock | Sooner, median and p90 | Word changes per minute | Share of final characters changed |
| --- | --- | --- | --- | --- |
| English, held-en-4320211 | 28 of 45 | 1.8 s, 5.1 s | 0.8 | 7.1% |
| Japanese, held-ja-0jJLyvNn_to | 23 of 36 | 1.0 s, 3.0 s | 0.2 | 0.3% |

Changes fall to less than half on the English talk and a quarter on the Japanese one, and text shows about a second later than with two decodes. In Japanese the median gain over locked text is now about a second; the larger gain is in the slow rows. Not seen in a session yet.

