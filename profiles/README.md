# Translation glossary

The service loads one glossary at startup and sends it with every cloud translation request as bidirectional terminology hints. It is not injected into the local recognizer by default; see [translation](../docs/wiki/translation.md).

Resolution order: `GLOSSARY_PATH` when set, else `private/glossary.json` when present, else `profiles/glossary.example.json`. A `GLOSSARY_PATH` that still names the retired default `profiles/glossary.json` falls through to that order with a notice. Keep personal names and project terms in the private file, which Git ignores. The tracked example holds generic AI vocabulary. The startup log and `pnpm preflight:listen` report which one loaded.

Format: a JSON array of at most 32 objects `{ "term": "…", "translation": "…" }`. `term` is 1 to 80 characters, `translation` 1 to 120, no other keys. Invalid JSON or schema stops startup without printing the file. In cloud recognition mode, terms without `<`, `>`, CR or LF also become recognition keywords.

Mappings are hints. A glossary cannot repair recognition errors, and glossary text is never an instruction to the application or the model. Talk profiles, profile selection and topical context are deferred; there is one file format and no profile framework.
