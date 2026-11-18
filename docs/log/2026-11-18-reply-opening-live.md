# The reply's opening, checked for quality and made live

2026-11-18. Follows [the reply opening](2026-11-17-reply-opening.md), which cut about 1 s from last word to first translated text under sustained load in French but left its translations unchecked. No paid calls.

## Method

`scripts/local/review_export.py --opening` replays a gate's public held-out talks in real time as before, then re-translates the replay's rows in order outside real time twice, as live then was and with the opening, through `scripts/review-retranslate.ts`. Both read the same recognized text, with context built as the controller builds it, each variant from its own translations. The export also records each row's recognized language, which an unresolved reply otherwise overwrites. It writes under `review/<gate>/opening/`, so the graded exports of 2026-11-14 and 2026-11-15 stay as they were. The agent read the rows, which the review-folder rule allows; this entry quotes counts only.

The re-translation without the opening reproduced 608 of 615 live translations in French; the rest differ where live context still lacked a translation that was streaming. The Japanese export ran after the opening was made live, so there its replay used the opening.

## Counts

| | French gate, 12 talks | Japanese gate, 11 talks |
| --- | --- | --- |
| Rows re-translated | 655 | 586 |
| Unresolved without the opening | 39 | 3 |
| Unresolved with it | 0 | 0 |
| Changed, among rows translated both ways | 177 | 227 |
| Of those, nearly identical, similarity above 0.9 | 108 | 84 |

## Rows the model left unresolved

Of the 39 French rows, nearly all are complete, clear French sentences, not fragments; some open a talk. With the opening, 37 read as good translations, one inverts its meaning and one drops a word. The model's `unknown` was mostly a mistake on clear speech, and the opening removes it. The 3 Japanese rows are too few to read anything into.

## Rows that change

Decoding is greedy, and the opening's tokens are exactly the ones the model generates on its own: the tokenizer splits the opening and the join with the chat template the same way in both cases. So the opening does not change what the model is asked. It changes only how the cache is computed: those tokens are processed together with the prompt instead of one at a time. Where two next tokens are nearly tied, that flips the choice and the rest of the reply follows.

A baseline confirms it. Switching the prompt cache on and off, also no change to meaning, changes 181 of the 586 Japanese rows. Each changed row also changes the context of the next four.

The larger changes were read blind, the two versions in random order, judged before the order was revealed:

| | French, all 69 | Japanese, 70 of 143 sampled |
| --- | --- | --- |
| Opening better | 18 | 12 |
| Without it better | 14 | 23 |
| No difference | 37 | 35 |

Over both pairs, 30 against 37, within chance. Japanese alone leans against the opening, 12 against 23, about p = 0.09 by a sign test, with a few bad replies on each side: a stray Chinese character, a reply romanized instead of translated, a reply that repeats the row before. One judge, of the same model family as the read-throughs.

## Decision

The opening is live: `LocalTranslator` gives it whenever the direction is known, unless `replyOpening: false`. `pnpm replay:contention --no-opening` restores the old behaviour for comparison. Reasons: about 1 s off part 6 under sustained load, no cost to recognition, rows the model wrongly left unresolved now translated, and changes to the rest within the noise of a change that leaves meaning alone. See [decisions](../wiki/decisions.md).

## Next

1. The full sustained `pnpm gate:delay` with the opening live, on a committed tree.
2. The Japanese lean is worth one more look the next time a Japanese read-through is graded: grade the `review/ja/opening/` talks whole, as the rubric does, rather than the changed rows alone.
