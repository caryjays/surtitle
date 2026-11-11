# Padded replies traced to the order of the local prompt

2026-11-10. The [piece quality](2026-11-10-piece-quality.md) reading found two problems in both translation units. Short rows came back padded with earlier rows' translations, and one reply was a list of glossary terms. This entry tries a fix for each on the local `qwen3.5-4b-q4`. Only one survives: the local prompt now puts the text to translate last.

## Method

- **Replays:** the four held-out talks in row mode, with the live row rules and cadence, compared with the row runs of [piece translation](2026-11-09-piece-translation.md).
- **Offline:** every row request of one of those row runs, rebuilt with the same context, is translated again with nothing else on the GPU, so a prompt change is compared on identical input.
- **Padding:** a Japanese row is counted as padded when its translation is over four times its length plus 40 characters, the streaming display's limit. For English rows, the count is of translations longer than the original, since Japanese usually runs about half the original's length.
- Scratch scripts printed counts only. No transcript or translation text is reproduced here.

## Before

Across the six earlier review files, 2,213 translated rows, 27 were padded, all Japanese:
- 17 of 59 rows of five characters or fewer;
- none of 6 to 20 characters;
- 10 longer ones.

In each row run, 2 of the 5 short Japanese rows were padded. One reply in one piece run was a list of glossary terms, the only case in about 1,190 rows across those runs, and no original in the four talks contains a term of the example glossary.

## What was tried

| Change | Offline (198 rows) | Replay |
| --- | --- | --- |
| Send only the glossary entries whose term occurs in the text | Padded 18 against 2; median reply doubled in length | Japanese 2 p90 translation length 527 against 163 and 163 characters, max 831; English 1 p90 106 against 73 and 75. 12 of 90 longer Japanese rows padded, against 0 and 1 |
| The above, with the text moved after the context and glossary | Padded 1. English rows over twice the original: 2, against 0 | 0 of 5 short and 1 of 89 longer Japanese rows padded. English rows longer than the original: 7, against 2 and 0 |
| Whole glossary, text after the context and glossary | Padded 1, short rows 0 of 5. English rows over twice the original: 0 | 0 of 5 short and 0 of 89 longer Japanese rows padded. English rows longer than the original: 2 |
| No context for a row under 6 characters | No change once the text was last | Not replayed |

The user message is the request's JSON, which had the text first, then the glossary, then the context. With the text first, the model sometimes translated the context as well. With an empty glossary the context came straight after the text, and the model did it much more often. Putting the text last fixed both orders of the problem. Even with the text last, removing the glossary still lengthened some English to Japanese replies, so the glossary filter was reverted. A short-row rule had nothing left to fix and was not kept.

The confirming replay, whole glossary and text last, against the two row runs:
- translation length p90 was 75, 82, 127 and 152 characters, against 73 and 75, 74 and 72, 128 and 135, 163 and 163;
- the maximum on the Japanese talks fell to 183 and 174 characters, from 269 and 398, 224 and 179;
- failures and unresolved rows: 2, against 3 and 3;
- speech to first translated text from the middle of a row: 6.7, 5.7, 5.9 and 7.5 s at the median, against 7.3 and 8.1, 7.3 and 7.1, 6.3 and 6.4, 7.5 and 7.5 s. This was the coolest run, and English lock lag was 0.3 to 0.6 s lower too, so the speed difference is not attributed to the prompt.

A glossary term turned up once in a row whose original lacked it, a single ordinary word, not a list.

## Change

- `chatMessages` in `packages/providers/chat.ts` builds the user message with `text` last. It serves the local translator and the chat-completions eval adapter. The OpenAI and Anthropic translators build their own messages and are unchanged; whether the order matters to them has not been measured.
- The whole glossary still goes with every request. A reply that is a glossary list stays possible, but it was seen once in about 1,390 rows.

## Open

- Replies over four times the original plus 40 characters are shown in full once valid. Treating them as failed would catch any padding that remains; it changes failure behaviour, so it is left to the maintainer.
- The four talks have no glossary terms. Whether terms are still used where they occur needs the maintainer's own lecture audio and glossary.
