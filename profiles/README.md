# Profiles

## Translation glossary

The service loads one glossary at startup and sends it with every cloud translation request as bidirectional terminology hints. It is not injected into the local recognizer by default; see [translation](../docs/wiki/translation.md).

Resolution order: `GLOSSARY_PATH` when set, else `private/glossary.json` when present, else `profiles/glossary.example.json`. A `GLOSSARY_PATH` that still names the retired default `profiles/glossary.json` falls through to that order with a notice. Keep personal names and project terms in the private file, which Git ignores. The tracked example holds generic AI vocabulary. The startup log and `pnpm preflight:listen` report which one loaded.

Format: a JSON array of at most 32 objects `{ "term": "…", "translation": "…" }`. `term` is 1 to 80 characters, `translation` 1 to 120, no other keys. Invalid JSON or schema stops startup without printing the file. In cloud recognition mode, terms without `<`, `>`, CR or LF also become recognition keywords.

Mappings are hints. A glossary cannot repair recognition errors, and glossary text is never an instruction to the application or the model. Talk profiles, profile selection and topical context are deferred; there is one file format and no profile framework.

## Language profiles

`languages.json` holds one profile per language, keyed by its ISO 639 code as Whisper reports it. The service and the Python worker both read it. `LANGUAGE_PAIR`, default `en-ja`, must name two profiled languages; only English and Japanese exist today, and the [roadmap](../docs/wiki/roadmap.md) sets the gate before another is added.

| Field | Use |
| --- | --- |
| `name` | English name in translation instructions, cloud recognition hints and control labels |
| `scoring` | `word` or `character`: the error-rate unit in benchmark scoring |
| `sentenceEnd` | characters that end a sentence; rolling segmentation closes a row at one after 3 s of locked audio |
| `clauseEnd` | characters that end a clause; rolling segmentation closes a row at one only when given a clause length, which the live service does not set |
| `stockPhrases` | sign-offs Whisper hallucinates; a long turn or row that is only these is dropped. Every profile's phrases apply in every session |

A script variant, such as Simplified or Traditional Chinese, is meant to be a profile setting, not a separate code. No such setting exists yet.
