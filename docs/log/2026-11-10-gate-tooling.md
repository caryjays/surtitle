# Gate tooling and profile shape generalized for more languages

2026-11-10. Code change with unit tests, a rescore of an existing run and a smoke replay; no paid calls, no microphone, no new fixtures.

## Decision

The maintainer agreed to generalize the evaluation tooling and the profile shape now, before the Japanese gate passes, and to pilot stage 2 with Spanish alone before French and Italian. No language is added by this change. Whether the Spanish pilot runs beside the remaining Japanese gate work or after it is not decided.

## What changed

- A gate is a file. `benchmarks/gate-ja.json` gained `pair` and `public`; `gate.py run --gate <language>` loads `benchmarks/gate-<language>.json`, replays that pair, and records the gate in `run.json`. `gate.py score` reads the gate from the run, and treats a run without one as Japanese. Run folders are named `gate-<language>-…`.
- The runner's loops over English and Japanese, its held-out language check, the third-language stream and the closing message follow the gate file. The third-language stream leaves out clips in the gate's own languages.
- `scoring.py` labels a score WER or CER from the profile.
- `scripts/replay-cases.ts` takes `--pair` and passes it to the recognizer. A pair with one kana or kanji language still tells a draft case's language by script, as before; a pair in one script takes the recognizer's language. Hangul is not handled.
- `pnpm eval:translation` takes `--pair`: the translators' pair, the forced directions, the direction check and the languages named to the judge. The judge's instructions for `en-ja` are the same text as before, kept by a test. Cases outside the pair are refused.
- Profiles carry `spaced`. The controller joins translated pieces by it and the pacer releases whole words by it; both used `scoring` before. English is spaced, Japanese is not, so nothing changes on screen.

## Checks

| Command | Result |
| --- | --- |
| `pnpm check` | passed: 158 tests, docs check clean |
| `pnpm test:local-unit` | passed: 53 tests, one new for the gate file |
| `gate.py score` on a copy of the 2026-11-06 rolling run, without held-out material | every public, non-speech and stock-phrase target has the value and status stored in that run's `score.json` |
| `pnpm gate:run --segmentation rolling --smoke`, then `gate:score` on it | ran every stream through `--gate` and `--pair` and scored; three clips per stream, a pipeline check and not a gate result |

The rescore ran on a copy, so the stored run is untouched. The held-out parts were not rescored.

## Not done

- `prepare_gate_fixtures.py` and `prepare_held_out.py` still select English and Japanese only. A new language needs its own public manifest, since a written manifest is never changed, and a held-out source with human references.
- `translation_cases.py`, `benchmarks/translation-terms.json`, `language_sim.py`, `prepare_corpus.py` and `corpus_eval.py` are English and Japanese only.
- The pacer still picks a partial row's rates by script, which cannot tell two Latin-script languages apart; their rates would have to differ for it to matter.
- No script setting for Chinese, no Chinese or Korean fonts in the stylesheet, no Hangul count in diagnostics.
- No pair other than `en-ja` can run, because only two profiles exist.

## Next

The Spanish pilot's steps are listed in [status](../wiki/status.md).
