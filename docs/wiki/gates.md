# Language gates

Verified: 2026-11-12 · Sources: scripts/local/gate.py, scripts/local/prepare_gate_fixtures.py, scripts/local/scoring.py, scripts/replay-cases.ts, scripts/translation-eval.ts, profiles/languages.json, benchmarks/gate-ja.json, benchmarks/gate-es.json, benchmarks/gate-fleurs.json, benchmarks/gate-nonspeech.json, benchmarks/gate-other.json, benchmarks/gate-other-es.json, benchmarks/translation-terms-es.json, scripts/local/prepare_held_out.py, benchmarks/gate-held-out.json, benchmarks/gate-held-out-es.json

A language ships when it passes a gate written before any gate measurement is taken. The [roadmap](roadmap.md) sets the five parts; this page sets the numbers. Japanese is the first gate; a Spanish pilot gate has its file, public set and targets. The tooling takes any gate: a gate is a file `benchmarks/gate-<language>.json` naming its languages, the pair replayed, its public manifest and its targets. Targets change only by a dated entry in [decisions](decisions.md) made before the run they would apply to, never after seeing its results. Results go in a dated log entry.

## Rules for every gate run

- Measured through the real code path: real-time replay with `scripts/replay-cases.ts`, listen-mode calibration on 1.5 s of silence before each stream, the Turbo Q4 worker, and the segmentation that is the default when the run happens. If rolling is still behind `LOCAL_SEGMENTATION`, both modes are measured and the gate applies to the one that becomes the default.
- Run on a machine without other heavy work, because real-time replay output depends on decode speed. Each run records the machine's load average.
- Scored with the units of `scripts/local/scoring.py`: NFKC, case folding and punctuation removed; each language by the unit in its profile, English by word error rate and Japanese by character error rate. Deletions are reported separately because they are the live path's main failure.
- Material that informed a design or tuning choice is not gate material. The tuning and noisy FLEURS clips, and the seven recordings behind the rolling design, are excluded.
- Every target applies to each language on its own; English passing does not carry Japanese.
- A failed gate is reported as failed with its numbers. Fixing the cause and rerunning is allowed; rerunning unchanged code to get a better draw is not.

## Japanese gate

### 1. Material

| Set | Content | References |
| --- | --- | --- |
| Public | 60 English and 60 Japanese FLEURS test clips at the pinned revision, sentence IDs distinct from the tuning and noisy sets, chosen in archive order before recognition | The public transcripts, uncorrected |
| Held-out | At least 30 minutes per language of unscripted public speech new to the project, chosen by fixed rules before recognition by `pnpm gate:held-out-fixtures`: English excerpts of whole speaker turns from the second half of Rev's Earnings-21 Eval-10 earnings calls, mostly analyst Q&A; Japanese excerpts of TEDxJP-10K's Japanese TEDx talks. The maintainer's own recordings may be added under `private/` | English: Rev's professional transcripts, fillers removed. Japanese: the talks' human subtitles, whose sentences the TEDxJP-10K authors checked by hand; the first and last subtitle of each excerpt are excluded from scoring |
| Non-speech | `pnpm local:silence`, plus at least 30 minutes of public licensed background noise, instrumental music and applause | none; any displayed text is an error |

### 2. Accuracy

| Measure | Japanese | English |
| --- | --- | --- |
| Held-out live error minus one-pass decode of the same excerpts | ≤ 1.5 points | ≤ 1.5 points |
| Held-out live deletions minus one-pass decode of the same excerpts | ≤ 1.0 point | ≤ 1.0 point |
| Public error rate, live path | ≤ 6.0% CER | ≤ 8.0% WER |
| Public live error minus full-clip decode of the same clips | ≤ 1.5 points | ≤ 1.5 points |
| Held-out rows rated major or hallucinated, by a read-through against references | ≤ 5% of rows | ≤ 5% of rows |
| Rows given the wrong language in Auto, on single-language material | ≤ 2% of rows | ≤ 2% of rows |
| Lock lag p90, segment end to locked text, rolling only | ≤ 3.0 s | ≤ 3.0 s |
| Row start to first locked text p90, rolling only | ≤ 8.0 s | ≤ 8.0 s |

The public set is read speech with numbers and names that the scorer counts strictly, so its absolute targets are looser; the difference from the full-clip decode isolates what live segmentation loses. Held-out targets are differences only: on unscripted public speech the model's own one-pass decode sets the floor, so the gate measures what the live path adds to it. The absolute held-out error and deletion rates are reported, not gated. Mixed-language rows, such as Japanese with English loanword phrases, are reported but not gated, because no reference convention for them exists yet.

### 3. Stock phrases and repetition

- No displayed row on any non-speech input.
- No displayed row on the public or held-out sets whose whole text is a stock phrase from `profiles/languages.json` or fails the repetition check.
- Every stock-phrase rejection on speech material is listed by count, and each new Japanese phrase seen in the sweep is added to the profile before the gate passes.

### 4. Translation

Run with `pnpm eval:translation` in both directions on cases frozen from the gate's public and held-out material, for the translator the listen profile will default to. It needs explicit authorization for paid calls.

| Measure | Target, each direction |
| --- | --- |
| Mean judged fidelity on cases recognized without a meaning-changing error | ≥ 4.3 of 5 |
| Cases on those inputs judged 2 or lower | 0 |
| Translations flagged for invention, all cases | ≤ 2% |
| Required terms present, on correctly recognized inputs | ≥ 95% |
| Failed calls, wrong-direction or unresolved outputs | 0 |
| Latency p90 on the network recorded in the log | ≤ 2.5 s |

The score targets must hold under two judges from different model families. Cases with recognition errors are reported but not gated, since a translator is told not to invent repairs.

### 5. Field session

- The calibration warning is shipped: a calibration that leaves the gate above the speech that follows is visible to the operator.
- One real session of at least 30 minutes with Japanese and English speech, diagnostics on, and the gate's chosen settings.
- No capture failure and no manual restart other than an intentional stop. Automatic recognizer restarts are counted and reported.
- The diagnostics download is summarized in a dated log entry with aggregate counts only.

### 6. Translation delay, offline profile

Measured, not scored by `gate:score`: `pnpm replay:contention --translate local` on held-out talks of both languages on an otherwise idle Mac, read with `pnpm diag:latency`.

| Measure | Target, each talk |
| --- | --- |
| A row's last word to its first translated text, median | ≤ 3.0 s |
| The same, p90 | ≤ 4.5 s |

The delay from the middle of a row is reported, not targeted: about half a row of it is waiting for the sentence to end, which translating whole rows cannot remove. Set on 2026-11-11; see [translation latency](../log/2026-11-11-translation-latency.md).

## Spanish gate, pilot

`benchmarks/gate-es.json`, pair `en-es`, written on 2026-11-11 before any Spanish measurement. Its rules and parts are the Japanese gate's. Its targets are the Japanese gate's English column, since Spanish is word-scored and written with spaces as English is:

| Measure | Spanish and English, each |
| --- | --- |
| Held-out live error minus one-pass decode of the same excerpts | ≤ 1.5 points |
| Held-out live deletions minus one-pass decode of the same excerpts | ≤ 1.0 point |
| Public error rate, live path | ≤ 8.0% WER |
| Public live error minus full-clip decode of the same clips | ≤ 1.5 points |
| Held-out rows rated major or hallucinated | ≤ 5% of rows |
| Rows given the wrong language in Auto, on single-language material | ≤ 2% of rows |
| Lock lag p90, rolling only | ≤ 3.0 s |
| Row start to first locked text p90, rolling only | ≤ 8.0 s |
| Non-speech rows; stock or repetitive rows | 0 |

Material so far: the public set, `benchmarks/gate-fleurs-es.json` from `pnpm gate:fixtures --language es`, 60 Spanish FLEURS test clips in archive order that are not in the third-language set, with the first gate's 60 English clips unchanged; the shared non-speech set; and the third-language set without its Spanish clips, followed by the gate's own `benchmarks/gate-other-es.json`, named by the gate file's `other`: ten clips each of French, Italian and Portuguese, Spanish's close neighbours. The held-out set, `benchmarks/gate-held-out-es.json` from `pnpm gate:held-out-fixtures --language es`: excerpts of six talks from the Spanish test split of Multilingual TEDx, chosen by fixed rules before any recognition, with the first gate's English excerpts unchanged; audio and references stay in the ignored cache, and each excerpt is its transcribed segments placed at their own times over digital silence, so untranscribed sound is absent. Its references have not been hand-checked. For translation, `benchmarks/translation-terms-es.json` holds required terms for 50 of the public clips, written from the references before any translation, and `pnpm eval:translation-cases --gate es` freezes the cases; no judged run exists. The Spanish stock phrases come from a sweep with `scripts/local/stock_sweep.py`. Not yet done: a judged translation run for the pair. Parts 5 and 6 apply to Japanese only for now.

## Accepted limits

The Japanese held-out differences are accepted as failing on one talk, 0KTVqevvEjo, by the maintainer's decision of 2026-11-11: its speaker pauses often at low level, the detector cuts it into short stretches, and no rule tested recovers what the short windows lose. The targets and the talk stay as they are; a run reports the failure, and it does not block the gate while that talk accounts for it. See [decisions](decisions.md).

## Running a gate

| Step | Command |
| --- | --- |
| Public material, once | `pnpm gate:fixtures`; see [benchmarks/README.md](../../benchmarks/README.md#language-gate-fixtures) |
| Held-out material, once | `pnpm gate:held-out-fixtures`, which needs `yt-dlp`; it writes the gate's held-out manifest to `.local/fixtures/held-out/held-out.json` |
| Replay | `pnpm gate:run --segmentation rolling`, and again with `turns` while rolling is not the default. `--gate <language>` picks the gate file, `ja` by default; the run records its name, its whole content and a digest of the implementation that ran, and `gate:score` reads the name from there. Add `--held-out .local/fixtures/held-out/held-out.json` for the held-out set, or a manifest under `private/` for own recordings. Real time: about an hour without held-out material, about two with it. `--smoke` checks the pipeline on three clips per stream and is never a gate result |
| Rate held-out rows | Add `"rating"` to each case in the held-out results: `plausible`, `minor`, `major` or `hallucination` |
| Score | `pnpm gate:score benchmarks/results/gate-<run>`, plus `--held-out <manifest> --held-out-results <results folder next to it>` |

`gate:run` scales every clip so its 90th-percentile 50 ms RMS is 0.1 without clipping, as an operator sets input gain, then joins each language's public clips, each non-speech category, and the third-language clips into one stream each with a second of silence between clips, replays it, runs `local:silence`, and decodes every public clip whole in Auto as the full-clip comparison. With held-out material it also decodes each excerpt in one pass in its own language, written as `offline.json` beside the held-out results and reported by `gate:score` as `heldoutOfflineRate`. The held-out targets are the live path's error and deletions over these decodes, on the excerpts both decoded; without `offline.json` they are not measured. The third-language stream, the FLEURS clips of `benchmarks/gate-other.json` in languages outside the gate, 40 in Chinese, Korean, Spanish and German for Japanese, is reported as `thirdLanguageRows` and not gated: rejecting a third language is decided but not built, and a target for it needs its own entry in [decisions](decisions.md). Public, non-speech and third-language outputs go to ignored `benchmarks/results/`; held-out outputs go next to their manifest under `private/`.

A held-out manifest lists recordings as `{ "id", "audio", "language", "reference" }`, with `language` one of the gate's languages or `mixed`, and paths relative to the manifest. A reference is the hand-corrected transcript; text inside `{{ }}` marks a span the reviewer could not resolve, which costs nothing when aligned and is reported as an excluded share. Mixed recordings count toward the stock-phrase check only. Held-out recordings are replayed at their recorded level.

`gate:score` reads the targets from the current gate file named by the run, for Japanese `benchmarks/gate-ja.json`, which a unit test keeps equal to the tables above, since targets may change by a dated decision; `--targets run` scores with the gate file as the run recorded it. It says when the gate file or the implementation changed since the run, or while it was replaying, and writes what it scored with to `score.json`. The implementation digest covers every commit-eligible file under `apps`, `packages`, `scripts`, `profiles` and `benchmarks` plus the package files, as on disk, so it identifies an uncommitted tree. Runs from before this hold neither and score with the current file only. It prints aggregates only: each target as pass, fail or not measured, and a verdict for the recognition parts. Timing targets are scored on held-out rows. The stock-phrase review, translation and the field session are checked by hand.

