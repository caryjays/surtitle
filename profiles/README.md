# Profiles

## Translation glossary

The service loads one glossary at startup and sends it with every cloud translation request as bidirectional terminology hints. It is not injected into the local recognizer by default; see [translation](../docs/wiki/translation.md).

Resolution order: `GLOSSARY_PATH` when set, else `private/glossary.json` when present, else `profiles/glossary.example.json`. A `GLOSSARY_PATH` that still names the retired default `profiles/glossary.json` falls through to that order with a notice. Keep personal names and project terms in the private file, which Git ignores. The tracked example holds generic AI vocabulary. The startup log and `pnpm preflight:listen` report which one loaded.

Format: a JSON array of at most 32 objects `{ "term": "…", "translation": "…" }`. `term` is 1 to 80 characters, `translation` 1 to 120, no other keys. Invalid JSON or schema stops startup without printing the file. In cloud recognition mode, terms without `<`, `>`, CR or LF also become recognition keywords.

Mappings are hints. A glossary cannot repair recognition errors, and glossary text is never an instruction to the application or the model. Talk profiles, profile selection and topical context are deferred; there is one file format and no profile framework.

## Language profiles

`languages.json` holds one profile per language, keyed by its ISO 639 code as Whisper reports it. The service and the Python worker both read it. `LANGUAGE_PAIR`, default `en-ja`, must name two profiled languages, with a script subtag such as `en-zh-Hant` when one of them has scripts. English, Japanese, Spanish, French, Italian, Portuguese and Chinese have profiles; a profile makes a pair selectable, and the [gates](../docs/wiki/gates.md) say which languages have passed theirs.

| Field | Use |
| --- | --- |
| `name` | English name in translation instructions, cloud recognition hints and control labels |
| `scoring` | `word` or `character`: the error-rate unit in benchmark scoring |
| `spaced` | whether the language writes spaces between words: paced text is released in whole words, and translated pieces join with a space |
| `sentenceEnd` | characters that end a sentence; rolling segmentation closes a row at one after 3 s of locked audio |
| `clauseEnd` | characters that end a clause; rolling segmentation closes a row at one only when given a clause length, which the live service does not set |
| `stockPhrases` | sign-offs Whisper hallucinates; a long turn or row that is only these is dropped. Every profile's phrases apply in every session |
| `stockPatterns` | optional: sign-offs that vary, matched against the whole compacted text as regular expressions valid in both JavaScript and Python. Chinese uses one for subtitle-volunteer credits, which carry people's names that no tracked file may hold |
| `latinWords` | optional, character scoring only: a run of Latin letters or digits counts as one unit, for speech that switches into English. Chinese sets it |
| `uncaptioned` | short label for a marker row, speech heard but not captioned; the displays show both pair languages' labels and never name the speech's language |
| `scripts` | optional, for a language written in more than one script: each script's `name`, `uncaptioned` label and OpenCC target `convert` (`cn` or `tw`), keyed by BCP 47 subtag, the first being the default. The session's script names the language and labels its markers, and the service converts text recognized in the language, and translations into it, to that script. Only Chinese has scripts: `Hans`, Simplified, and `Hant`, Traditional in Taiwan's character forms |
