# Profiles

## Translation glossary

A glossary is a term set: the names and terms of one product, stack or subject. The service sends the set in use with every translation request as bidirectional terminology hints, as the session's pair needs it. It is not injected into the local recognizer; see [translation](../docs/wiki/translation.md#glossary).

The starting set resolves in this order: `GLOSSARY_PATH` when set, else `private/glossary.json` when present, else `profiles/glossary.example.json`. A `GLOSSARY_PATH` that still names the retired default `profiles/glossary.json` falls through to that order with a notice. Every valid file in `private/glossaries/` is offered beside it on the operator page, one file per product or talk. Keep personal names and project terms in the private files, which Git ignores. The tracked example holds generic AI vocabulary in every profiled language. The startup log and `pnpm preflight:listen` report which one loaded, and `pnpm glossary:check` prints what each set sends in each pair.

Format: `{ "name": "…", "terms": [ … ] }` with at most 32 entries of two kinds.

```json
{ "name": "Product demo", "terms": [
  { "name": "Claude Code", "heard": ["cloud code", "클로드 코드"] },
  { "en": "inference", "ja": "推論", "es": "inferencia" }
] }
```

- A name is a proper noun, written as given in every pair and both directions. `heard` lists other spellings of it, as the recognizer hears it or as the translator writes it in another script; each is replaced by the name. A name may also carry a form for one language, `"ja": "…"`, where it is written otherwise.
- A term is a preferred translation: one form per language, keyed by language code, or by `zh-Hant` or `zh-Hans` for a form of that script. It is sent only in a pair that has both of its languages; the operator page lists the ones a pair leaves out.

The list that came before, a JSON array of `{ "term": "…", "translation": "…" }`, still loads and is read as English and Japanese. Invalid JSON or schema in the starting set stops startup without printing the file; an invalid file in `private/glossaries/` is left out with a count. In cloud recognition mode, terms without `<`, `>`, CR or LF also become recognition keywords.

Mappings are hints: the translator can still write a name its own way, which a `heard` spelling then corrects. Glossary text is never an instruction to the application or the model. Topical context is deferred.

## Language profiles

`languages.json` holds one profile per language, keyed by its ISO 639 code as Whisper reports it. The service and the Python worker both read it. `LANGUAGE_PAIR`, default `en-ja`, must name two profiled languages, with a script subtag such as `en-zh-Hant` when one of them has scripts. English, Japanese, Spanish, French, Italian, Portuguese, Chinese and Korean have profiles; a profile makes a pair selectable, and the [gates](../docs/wiki/gates.md) say which languages have passed theirs.

| Field | Use |
| --- | --- |
| `name` | English name in translation instructions, cloud recognition hints and control labels |
| `scoring` | `word` or `character`: the error-rate unit in benchmark scoring |
| `spaced` | whether the language writes spaces between words: paced text is released in whole words, and translated pieces join with a space |
| `sentenceEnd` | characters that end a sentence; rolling segmentation closes a row at one after 3 s of locked audio |
| `clauseEnd` | characters that end a clause; rolling segmentation closes a row at one only when given a clause length, which the live service does not set |
| `stockPhrases` | sign-offs Whisper hallucinates; a long turn or row that is only these is dropped. Every profile's phrases apply in every session |
| `stockPatterns` | optional: sign-offs that vary, matched against the whole compacted text as regular expressions valid in both JavaScript and Python. Chinese and Korean use one each for subtitle credits, which carry people's names that no tracked file may hold |
| `latinWords` | optional, character scoring only: a run of Latin letters or digits counts as one unit, for speech that switches into English. Chinese and Korean set it |
| `letters` | optional, character scoring only: the language's letters as Unicode character-name prefixes. When a decode outside the pair is decoded again in a pair language, the worker keeps the second decode only if at least half its letters are the language's. Without it, kanji and kana count; Korean sets `HANGUL` |
| `foreign` | optional: writing a translation into the language never holds, as Unicode character-name prefixes. With the direction known, the local translator cannot generate a token that holds such a character. Korean lists Chinese characters and kana |
| `particles` | optional: particles written onto the word before them. In a translation into the language, the space the local translator leaves between a number or Latin word and one of them is removed, `AI 는` to `AI는`. A closed list of whole words. Korean sets it |
| `adjoining` | optional: the language's writing, as Unicode script names among `Han`, `Hiragana` and `Katakana`, that stands directly beside a Latin word or number. In a translation into the language, a space between a Latin letter, digit or percent sign and a character of that writing, its punctuation included, is removed on either side, `AI は 10 月` to `AIは10月`. A space between two Latin words or numbers stays. Japanese sets all three; Chinese does not set it, since Chinese typography accepts the space |
| `uncaptioned` | short label for a marker row, speech heard but not captioned; the displays show both pair languages' labels and never name the speech's language |
| `scripts` | optional, for a language written in more than one script: each script's `name`, `uncaptioned` label and OpenCC target `convert` (`cn` or `tw`), keyed by BCP 47 subtag, the first being the default. The session's script names the language and labels its markers, and the service converts text recognized in the language, and translations into it, to that script. Only Chinese has scripts: `Hans`, Simplified, and `Hant`, Traditional in Taiwan's character forms |
