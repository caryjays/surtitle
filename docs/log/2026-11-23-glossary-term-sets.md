# Glossary term sets: names, preferred translations, and pair switches

2026-11-23. Uncommitted tree on `main` at `2221bd5`, on top of [the pair review](2026-11-23-language-pair-review.md). No paid calls and no microphone. Local translator `qwen3.5-4b-q4` on the Air on mains power, with other applications open. Nothing here is a gate result.

## Why

The glossary was one list of `{ term, translation }`, loaded once, naming no languages. Its English-to-Japanese entries went out in every pair, which sent English to Korean into Japanese. It had no way to say that a product name stays as written while a technical term has a preferred translation, and no way to keep one set per product.

## What changed

- A glossary is a term set, `{ name, terms }`, of at most 32 entries. A name, `{ "name": "Claude Code" }`, is kept as written in every pair. A term has one form per language and is sent only in a pair that has both. The format is in [translation](../wiki/translation.md#glossary).
- The controller builds the list a session sends from the set in use, at start and on every pair or set switch. Chinese forms are converted to the session's script, and a form keyed `zh-Hant` wins there.
- The old list format still loads, read as English and Japanese. For `en-ja` the list sent is identical, entry for entry, for the tracked example and for a list in the old format; checked by comparing the two.
- Sets: the starting one as before, every valid file in `private/glossaries/`, the example, and an empty set. The operator page has a Glossary selector beside the pair, usable while the microphone is off, with the counts the pair sends and the terms it leaves out. A switch starts a new session, as a pair switch does.
- `heard` on a name lists other spellings of it. Each is replaced by the name in recognized text, in the local recognizer adapter before decodes are compared, and in translations, in the controller.
- Each translated row's trace counts the names and terms its original holds and those the translation lacks.
- `pnpm glossary:check` prints what each offered set sends in each pair, as counts; `--gaps` names the sets and the terms left out.
- The tracked example now has a form in every profiled language. The forms outside Japanese were written in this session and have not been checked by a native reader.
- The replay scripts, `contention-replay.ts` and `review-retranslate.ts`, send the example as the pair receives it, as live. A read-through or part 6 run outside `en-ja` therefore no longer matches the earlier ones in what the translator was sent.

## Measured

A probe of five English sentences written for this session, each naming "Claude Code" and using terms of the example set, sent in order through `LocalTranslator` with the rows before as context. The set was the example plus the name. "Names" counts two entries per row, "Claude Code" and "Claude".

| Pair | Names kept, set | Names kept, no glossary | Terms kept, set | Terms kept, no glossary | Rows with kana, set |
| --- | --- | --- | --- | --- | --- |
| `en-ja` | 10 of 10 | 0 of 10 | 5 of 6 | 5 of 6 | not counted |
| `en-es` | 10 of 10 | 10 of 10 | 5 of 6 | 6 of 6 | 0 |
| `en-fr` | 10 of 10 | 10 of 10 | 5 of 6 | 2 of 6 | 0 |
| `en-it` | 10 of 10 | 10 of 10 | 6 of 6 | 4 of 6 | 0 |
| `en-pt` | 10 of 10 | 10 of 10 | 5 of 6 | 5 of 6 | 0 |
| `en-zh-Hans` | 10 of 10 | 10 of 10 | 5 of 6 | 4 of 6 | 0 |
| `en-zh-Hant` | 10 of 10 | 10 of 10 | 5 of 6 | 4 of 6 | 0 |
| `en-ko` | 0 of 10 | 0 of 10 | 6 of 6 | 4 of 6 | 0 |

- English to Korean stayed Korean on all five rows with the set: no kana. In the pair review the same kind of probe with the old list was Japanese on five of five.
- Into Korean the model wrote the name in Hangul on every row, with the name mapped to itself in the glossary. An added instruction that an entry mapped to itself is a name, to be written in the same letters, changed nothing: 0 of 10 again.
- With the name's Hangul spellings under `heard`, replaced in the translation, names kept in `en-ko` were 10 of 10; from the second row on the model wrote the name in Latin letters itself, following its context. `en-ja` with kana spellings listed stayed 10 of 10.
- Without a glossary, Japanese writes the name in kana on every row and the other six pairs keep it.
- The term counts are approximate, as the count is: an inflected form does not match. Five sentences say nothing about quality on talks.

## Not verified

- The browser smokes. The Mac's screen locked during the session, and headless Chrome's capture then never starts: Start stays disabled with no error, in the fake-provider smoke on the unchanged tree as well. So the operator page's Glossary selector has not been seen in a browser, and the offline smoke in `en-ko`, which the pair review left failing, has not been repeated. The controller and server paths are covered by unit tests with fake providers.
- `heard` on recognized speech with the real recognizer. The replacement is unit-tested; no audio was decoded with a set that lists spellings.
- The cloud translators and cloud recognition, parked. Cloud recognition takes its keywords once, from the starting set in the starting pair.

## Limits

- A name is kept only where the model follows the mapping or a `heard` spelling covers what it writes. The trace counts show which.
- A `heard` spelling is replaced wherever it is recognized, so a common word listed as a spelling is rewritten every time it is said.
- In rolling segmentation a spelling split across two recognized segments is not replaced.
- A set holds 32 entries, the most a request carries. Larger sets would need the choice of entries per request that made the local model worse on 2026-11-10.

## Commands

```text
pnpm check
pnpm glossary:check
pnpm exec tsx scripts/local-browser-smoke.ts --offline --rolling --pair en-ko
```
