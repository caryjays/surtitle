# French, Italian and Portuguese: profiles, material, sweeps and one gate run each

2026-11-15. The maintainer asked for the three languages; Portuguese is new to the sequence, see [decisions](../wiki/decisions.md). Everything follows [the Spanish pilot](2026-11-11-spanish-pilot.md) and [its further steps](2026-11-12-spanish-pilot-steps.md). Local recognition only, no translation, no paid calls. Public material; held-out talks were read by scripts only and are reported as counts.

## Setup

- `profiles/languages.json` has French, Italian and Portuguese profiles in the Spanish shape: word-scored, spaced, Latin punctuation, the English reading rates. A profile makes its pair selectable in the operator page.
- `pnpm gate:fixtures --language fr`, `it` and `pt` wrote `benchmarks/gate-fleurs-<language>.json`: 60 FLEURS test clips each, locales `fr_fr`, `it_it` and `pt_br`, with the first gate's English clips. The selection now excludes a language's clips in every `gate-other*.json`; before, it read only the shared set, and the ten clips each language has in the Spanish gate's neighbour set would have entered its own gate.
- `scripts/local/prepare_held_out.py --language` takes `fr`, `it` and `pt` beside `es`, each reading its own test-split file of the Multilingual TEDx mirror at the revision already pinned, with its own checksum. Six talks per language by the Spanish rules, 30.4 to 30.5 minutes. Run with `uv run --no-project --with pyarrow`. References are unchecked.
- `benchmarks/gate-fr.json`, `gate-it.json` and `gate-pt.json` carry the Spanish gate's targets and name `gate-other-es.json` as their further third languages, so each hears the other two and Spanish. Written before any measurement in the three languages.
- `scripts/local/review_export.py` takes the three gates.

## Stock-phrase sweeps

`scripts/local/stock_sweep.py --language <language>`, 630 windows each of the non-speech streams, forced into the language.

| Language | Passing the filters | Covered by the first-guess list | Added | Covered after |
| --- | --- | --- | --- | --- |
| French | 504, of which 291 are an ellipsis with no letters | 292 | "sous-titrage st' 501", 209 windows | 501 |
| Italian | 620 | 614, nearly all "grazie a tutti" | nothing | 614 |
| Portuguese | 286 | 0 | "e aí", 279 windows and 2 more as repeats | 281 |

What is left uncovered are single windows: an English exclamation in all three, a one-word reply, an advertisement, a call to subscribe. None was added. "E aí" is also real speech; the stock rule drops only a long row that holds nothing else.

## Gate runs

`pnpm gate:run --gate <language> --segmentation rolling --held-out <manifest>`, real time, one after another on mains power with the machine kept awake, scored with `pnpm gate:score`. A three-clip smoke run of each gate came first. The tree was uncommitted; no implementation file changed during a run.

| Measure | Target | French | Italian | Portuguese |
| --- | --- | --- | --- | --- |
| Held-out error over one-pass | ≤ 1.5 points | 2.70, fail | 0.48 | 1.47 |
| Held-out deletions over one-pass | ≤ 1.0 point | 0.54 | 0.39 | 1.17, fail |
| Public error | ≤ 8% | 7.10% | 3.30% | 5.13% |
| Public error over full clip | ≤ 1.5 points | 0.20 | −0.08 | 0.32 |
| Wrong-language share | ≤ 2% | 0.46% | 0.32% | 0.87% |
| Lock lag p90 | ≤ 3 s | 3.56 s, fail | 3.53 s, fail | 3.74 s, fail |
| First text p90 | ≤ 8 s | 6.94 s | 9.90 s, fail | 7.54 s |
| Stock or repetitive rows | 0 | 0 | 0 | 0 |
| Non-speech rows, per run | 0 | 0 | 0 | 0 |
| Third-language rows, 60 clips, reported only | | 0 | 0 | 0 |
| Load average, median and maximum | | 2.0, 3.0 | 1.8, 3.1 | 1.6, 2.2 |

Held-out error, live against one-pass: French 9.41% and 6.71%, Italian 6.75% and 6.27%, Portuguese 10.97% and 9.50%. The major-error share was not measured; it needs a rating.

English, the same clips and excerpts in each run, passed every accuracy target three times and missed timing three times: held-out error over one-pass 0.18, 0.32 and 0.44 points, lock lag p90 3.77, 3.83 and 3.60 s, first text p90 9.07, 8.77 and 8.96 s. That spread is a first view of run-to-run noise on unchanged code.

Runs: `benchmarks/results/gate-fr-rolling-20261114T114005`, `gate-it-rolling-20261114T140013`, `gate-pt-rolling-20261114T162211`; the folder names carry the machine's clock.

## Reading

- Italian passes every accuracy target on its first run, as Spanish did.
- French fails held-out error. Per talk, by counts: four talks sit within 2.0 points of their one-pass decode, and two lose 4.8 and 7.3 points. Those two are the talks cut into the most rows, 77 and 79 against 45 to 70. Deletions rise little, so the loss is mostly wrong words, not missing ones. Its public error, 7.10%, is the closest of the four pilot languages to the 8% target; the full-clip decode of the same clips is at 6.91%, so that is the model on these clips and not segmentation.
- Portuguese fails held-out deletions by 0.17 points, and one talk carries it: 7.0% deleted live against 0.8% in one pass, with the other five within 1.2 points. Held-out error passes by 0.03 points.
- Lock lag misses in all three as it does for English and Spanish. First text misses for Italian only.
- No neighbour leaked: French, Italian, Portuguese and Spanish clips showed no row in any of the three pairs. Read sentences; accented or mixed speech is untested.
- The French and Portuguese failures stand as failures. The causes in the three talks were not traced; recognition tuning is paused, and the references are unchecked.

## Verification

`pnpm check` and the Python unit tests pass.

## Not done

- Tracing the two French talks and the one Portuguese talk.
- Required terms and frozen cases for a translation eval, and any translation in the three pairs: the local translator has not been asked for French, Italian or Portuguese.
- The app in the three pairs: no service start, browser smoke or microphone session.
- A rating of held-out rows and a spot check of the references.

```sh
pnpm gate:fixtures --language fr
uv run --no-project --with pyarrow python scripts/local/prepare_held_out.py --language fr
.local/venv/bin/python scripts/local/stock_sweep.py --language fr
pnpm gate:run --gate fr --segmentation rolling --held-out .local/fixtures/held-out/held-out-fr.json
```
