# Language pair generalized, roadmap stage 0

2026-10-27. Code change with fake-provider and public-fixture checks; no paid calls, no microphone.

## What changed

English and Japanese were hardcoded in `Mode`, four protocol schemas, the controller's direction check, the local adapter, the worker, the translation prompt and schema, cloud recognition hints and the control page. They now come from a configured pair.

- `profiles/languages.json` holds one profile per language: name, scoring unit, sentence-end characters, stock phrases. Only `en` and `ja` exist. `packages/protocol/languages.ts` and `scripts/local/languages.py` read it.
- `LANGUAGE_PAIR`, default `en-ja`, is checked at startup and printed by preflight. The controller takes the pair and the snapshot carries it.
- Modes stay `auto` plus `source-target` strings. Schemas accept any two- or three-letter code. The controller enforces the pair:
  - It refuses a mode outside the pair, and the server closes the control socket that sent it.
  - It treats a recognized language outside the pair as `unknown`.
  - In `auto`, it fails a translation whose source or target is outside the pair, keeping the original text.
- Translation instructions and the output schema are generated from the pair. For `en-ja` the instructions are the same text as before, checked by string comparison, so prompt variants in the translation eval still apply. The chat-completions adapter states the pair's codes in its JSON shape hint.
- The cloud recognizer's language list and prompt follow the pair.
- Rolling segmentation closes rows at the sentence-end characters of the pair's profiles. The stock-phrase rule in Node and Python uses every profile's phrases, as before.
- The worker accepts and reports any profiled language. Benchmark scoring takes word or character units from the profile.
- The control page relabels its presets and direction menu from the snapshot's pair. It ships labelled for `en-ja`, so nothing changes on screen today.
- The diagnostics `health` record includes the pair.

Not done: recognition hints and a script variant setting are not profile fields yet, because nothing uses them. The fictional layout preview stays English and Japanese. The offline benchmark and noisy-experiment scripts keep their EN and JA fixture lists.

## Checks

| Command | Result |
| --- | --- |
| `pnpm check` | passed: 123 tests, 4 of them new in `tests/languages.test.ts`; docs check clean |
| `pnpm test:local-unit` | passed |
| `pnpm test:browser` | passed |
| `pnpm test:local-browser` | passed, real MLX worker on public fixtures |
| `pnpm test:listen-browser` | passed, real MLX worker, fake bidirectional translation |

No other pair can be exercised end to end, because only two profiles exist. The new tests cover refusal of modes outside the pair, mapping of other recognized languages, translation results outside the pair, and the generated prompt and schema for the swapped order.

## Next

Japanese gate targets, then step 4 of rolling recognition, whose pacer rates go into the profiles.

## Docs check dates

Committing this change just after midnight local time showed that `docs:check` mixed time zones: it took today and file modification days in UTC but commit days in local time, so a fresh commit looked like a source changed in the future of a page verified today. It now uses local calendar days throughout.
