# Giving the local model its reply's opening

2026-11-17. The next lever from [the decode hold](2026-11-17-decode-hold.md). The local translator's reply always starts `{"source":"en","target":"fr","text":"`, about 13 tokens generated before any translated text. When the recognizer has set the direction, that opening is known. With `replyOpening`, the adapter sends it with the request, and the worker ends the prompt with it instead of generating it. The reply and its partials include it, so parsing is unchanged. Replay-only: `pnpm replay:contention --opening`. Live is unchanged. No paid calls.

## Alone on the GPU

The breakdown's scratch script, six sentences per direction, French, Italian and Japanese pairs. First translated text fell from 0.47 to 0.65 s at the median to 0.14 to 0.17 s. A whole request fell from 0.74 to 1.10 s to 0.51 to 0.63 s, with 17 to 22 tokens generated instead of 28 to 45. The sample replies read the same with and without it.

## Under sustained load

Set up as for the hold: French pair, the same four talks, each replayed off, on, on, off back to back with no pause, 1 hour 32 minutes. Commit 20282e7 plus the uncommitted changes. Load average 1.4 to 2.8 at the start of each replay.

Medians, off replays then on replays; p90 in brackets for the target measure:

| Talk | Last word to first translated text | Translator's first text | Speech end to final text |
| --- | --- | --- | --- |
| held-en-4320211 | 2.2 (3.6), 3.5 (4.8) · 2.2 (3.9), 1.9 (3.2) | 1.0, 1.3 · 0.5, 0.4 | 1.1, 1.7 · 1.7, 1.4 |
| held-en-4346818 | 2.9 (4.9), 3.3 (4.3) · 1.8 (3.3), 2.0 (3.1) | 1.1, 1.0 · 0.3, 0.3 | 1.6, 1.8 · 1.5, 1.5 |
| held-fr-0u7tTptBo9I | 2.8 (4.1), 3.0 (4.6) · 1.8 (2.4), 1.8 (2.5) | 1.1, 1.3 · 0.3, 0.3 | 1.7, 1.7 · 1.4, 1.5 |
| held-fr-16MWHwqz0mQ | 3.2 (4.9), 3.2 (4.8) · 2.2 (3.1), 2.1 (4.0) | 1.1, 1.2 · 0.4, 0.4 | 1.9, 1.8 · 1.8, 1.6 |

- Last word to first translated text fell by about 1.0 s at the median on average, 3.0 s to 2.0 s, more than the spread between two replays of one talk. The p90 fell in seven of eight comparisons.
- Under part 6's targets, all eight on replays pass. Seven of the eight off replays miss.
- Rows close no slower: speech end to final text is the same or lower with the opening. The translator holds the GPU for less time, so recognition gains a little too.
- The whole translation request fell from about 2 s to about 1.1 s at the median.

## Rows the model used to leave unresolved

Without the opening, the model can answer `source: unknown`, and the row then shows its original only. In the off replays, 1 to 9 rows per French talk ended unresolved, 9 of about 70 in `held-fr-0u7tTptBo9I`. With the opening, the reply's source and target are already written, so the model cannot answer unknown: every one of those rows was translated, and none ended unresolved. Whether those translations are right, or the model forced into translating fragments it rightly declined, is not checked. The rows' text was not read.

## Verdict

A clear gain on speed with no cost to recognition. Before it can go live, its translations need checking, in particular the rows that used to end unresolved.

## Next

1. A translation read-through with and without the opening, through `scripts/local/review_export.py`, which would need the option. Look first at the rows that end unresolved without it.
2. If it holds up, make it live and repeat the full sustained `pnpm gate:delay`.
