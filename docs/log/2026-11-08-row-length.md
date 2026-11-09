# Speech to translation, and shorter rows

2026-11-08. The [GPU contention](2026-11-08-gpu-contention.md) entry found row length to be most of the delay. This entry measures the delay from the words themselves and compares two shorter row rules against the live one.

## What changed

- Every closed rolling row carries `speechEndToFinalMs`: from the end of the row's speech to its final text. For a silence close it is the trailing quiet plus the closing decode; for a length close it is the lag of the last lock.
- `pnpm diag:latency` reports recognition over every kept row, and a new section, speech to translation, for the last word, the middle and the first word of each row. That is speech end to final text, plus final text to translation, plus the share of the row's audio that came before.
- The local adapter takes a `rows` option: the sentence length, the maximum length, and an optional clause length at which a row may also close on a clause mark. The profile field `clauseEnd` holds the marks: `,;:` for English, `、，` for Japanese. Only `pnpm replay:contention --rows sentence,max,clause|off` sets it. The live rules are unchanged: 3000, 8000, off.
- `replay:contention --review <file>` writes each row's original and translation for a person to read. The runs below wrote theirs under `.local/experiments/`, which is ignored and was not read by the agent.

## Run

The same four held-out talks, two English then two Japanese, about 23 minutes, replayed in real time through the controller with rolling recognition and `qwen3.5-4b-q4`, once under each rule, back to back on one Mac in the order live, short, clause. The order was not alternated, so later runs may be slower from heat.

- live: a row closes at a sentence end after 3 s of locked audio, or at 8 s
- short: sentence end after 2 s, or at 5 s
- clause: as short, and also at a clause mark after 2 s

Speech to translation, p50 / p90 in seconds:

| Talk | Rows live / short / clause | Last word | Middle of row | First word |
| --- | --- | --- | --- | --- |
| English 1 | 50 / 58 / 62 | 3.9 / 5.2 → 4.3 / 6.0 → 5.0 / 7.0 | 7.5 / 11.3 → 7.3 / 10.3 → 7.7 / 10.2 | 10.6 / 17.3 → 10.5 / 15.2 → 10.6 / 14.6 |
| English 2 | 50 / 56 / 58 | 3.6 / 4.7 → 4.3 / 5.5 → 4.5 / 6.0 | 5.9 / 9.7 → 6.6 / 9.3 → 6.8 / 9.1 | 8.1 / 15.3 → 8.8 / 13.0 → 9.1 / 12.1 |
| Japanese 1 | 59 / 66 / 66 | 3.1 / 5.8 → 3.6 / 5.0 → 3.6 / 4.7 | 6.5 / 8.9 → 6.4 / 8.1 → 6.5 / 7.7 | 9.5 / 13.3 → 9.4 / 12.1 → 9.4 / 11.1 |
| Japanese 2 | 42 / 53 / 55 | 3.7 / 5.2 → 3.8 / 4.7 → 3.8 / 4.6 | 8.3 / 10.0 → 7.1 / 8.9 → 7.0 / 8.6 | 13.0 / 15.7 → 10.5 / 13.3 → 10.2 / 12.5 |

Supporting numbers, p50 in seconds, live / short / clause:

| Talk | Row audio | Lock lag | Speech end to final text | Translation request | Failed or unresolved |
| --- | --- | --- | --- | --- | --- |
| English 1 | 6.5 / 5.9 / 5.5 | 2.3 / 2.5 / 2.6 | 2.0 / 2.2 / 2.5 | 2.1 / 2.1 / 2.4 | 0 / 0 / 0 |
| English 2 | 4.7 / 4.7 / 4.8 | 2.1 / 2.6 / 2.7 | 1.8 / 2.2 / 2.4 | 1.8 / 2.0 / 2.0 | 0 / 0 / 0 |
| Japanese 1 | 6.8 / 5.3 / 5.3 | 2.1 / 2.4 / 2.4 | 1.6 / 1.9 / 1.8 | 1.7 / 1.8 / 1.8 | 5 / 7 / 5 |
| Japanese 2 | 8.9 / 6.6 / 6.3 | 2.0 / 2.0 / 2.0 | 1.8 / 1.9 / 2.0 | 2.1 / 1.9 / 1.9 | 0 / 0 / 0 |

## Findings

- Shorter rows cut the tail more than the median. The first word's p90 fell 2.1 to 3.2 s with the clause rule on every talk, and the middle's p90 0.6 to 1.4 s. At the median only the second Japanese talk, the one with the longest rows, gained much: 2.8 s at the first word, 1.3 s at the middle.
- The last word got slower, by up to 1.1 s at the median on English. More rows close by length, and a length close waits for a lock, about 2.4 s, where a silence close takes about 1.6 s. Lock lag also rose on English as rows shortened, partly from more translations on the GPU; heat from the unalternated order may add to it.
- Row audio stayed at 5 to 6 s at the median. Many rows still close at a pause, and a sentence or clause close needs locked text, so the 2 s floor is rarely the binding rule.
- Failures did not change: the first Japanese talk keeps its 3 to 5 failed rows under every rule, and the other talks have none.
- The middle of a row still waits 6.5 to 7.5 s. Speech end to final text and the translation request add about 4 s, and half a row adds about 3 s. Rules that close rows at clauses do not reach the 3 to 4 s goal.
- Quality was not judged. Shorter rows give the translator less of each sentence. The review files are for the maintainer to read.

## Open

- Whether to adopt the clause rule, 2000, 5000, 2000, as the live default. It shortens the slowest rows at a cost of up to 1 s on the last word; the maintainer's reading of the review files decides on quality.
- A length close could use the fresh decode's text instead of waiting for its lock, which would recover the last-word loss.
- The remaining delay is speech end to final text and the translation itself, each about 2 s, plus the wait for the row to end. Streaming translation tokens to the display and translating locked text before the row closes are the next levers.
