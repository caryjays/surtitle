# Language gates

Verified: 2026-11-22 · Sources: scripts/local/gate.py, scripts/translation-delay.ts, scripts/local/review_export.py, scripts/local/prepare_gate_fixtures.py, scripts/local/scoring.py, scripts/replay-cases.ts, scripts/translation-eval.ts, profiles/languages.json, benchmarks/gate-ja.json, benchmarks/gate-es.json, benchmarks/gate-fr.json, benchmarks/gate-it.json, benchmarks/gate-pt.json, benchmarks/gate-zh.json, benchmarks/gate-ko.json, scripts/local/prepare_held_out.py, scripts/local/stock_sweep.py, scripts/local/quality.py, benchmarks/gate-fleurs.json, benchmarks/gate-nonspeech.json, benchmarks/gate-other.json, benchmarks/gate-other-es.json, benchmarks/translation-terms-es.json, benchmarks/translation-terms-zh.json, benchmarks/translation-terms-ko.json, scripts/local/prepare_held_out.py, benchmarks/gate-held-out.json, benchmarks/gate-held-out-es.json, benchmarks/gate-held-out-fr.json, benchmarks/gate-held-out-it.json, benchmarks/gate-held-out-pt.json, benchmarks/gate-fleurs-fr.json, benchmarks/gate-fleurs-it.json, benchmarks/gate-fleurs-pt.json

A language ships when it passes a gate written before any gate measurement is taken. The [roadmap](roadmap.md) sets the parts; this page sets the numbers. Japanese is the first gate; Spanish is the pilot of the further gates, and French, Italian and Portuguese have gates in its shape. Mandarin and Korean have gates in the Japanese gate's shape. The tooling takes any gate: a gate is a file `benchmarks/gate-<language>.json` naming its languages, the pair replayed, its public manifest and its targets. Targets change only by a dated entry in [decisions](decisions.md) made before the run they would apply to, never after seeing its results. Results go in a dated log entry.

## Rules for every gate run

- Measured through the real code path: real-time replay with `scripts/replay-cases.ts`, listen-mode calibration on 1.5 s of silence before each stream, the Turbo Q4 worker, and the default segmentation, rolling.
- Run on a machine without other heavy work, on mains power and kept awake, because real-time replay output depends on decode speed; a Mac that sleeps during a replay ends it with an inference backlog. Each run records the machine's load average.
- Scored with the units of `scripts/local/scoring.py`: NFKC, case folding and punctuation removed; each language by the unit in its profile, English by word error rate and Japanese by character error rate. Deletions are reported separately because they are the live path's main failure.
- Material that informed a design or tuning choice is not gate material. The tuning and noisy FLEURS clips, and the seven recordings behind the rolling design, are excluded.
- Every target applies to each language on its own; English passing does not carry Japanese.
- A failed gate is reported as failed with its numbers. Fixing the cause and rerunning is allowed; rerunning unchanged code to get a better draw is not. A run made while the machine did other heavy work, or that slept, broke the rule above: it is void, the log says why, and running again is not a better draw.

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

The public set is read speech with numbers and names that the scorer counts strictly, so its absolute targets are looser; the difference from the full-clip decode isolates what live segmentation loses. Held-out targets are differences only: on unscripted public speech the model's own one-pass decode sets the floor, so the gate measures what the live path adds to it. The absolute held-out error and deletion rates are reported, not gated. Mixed-language rows, such as Japanese with English loanword phrases, are reported but not gated, because no reference convention for them exists yet.

Recognition timing is reported, not gated, by the maintainer's decision of 2026-11-16: lock lag p90, row start to first locked text p90 and row start to first shown text p90, in rolling, on held-out rows. The audience waits on the translation, and a row is translated only once it closes, so these times don't decide when it appears. Part 6 gates that delay. They still matter with translation off, where the original is all a viewer reads. Until 2026-11-16 the first two were targets of 3.0 s and 8.0 s.

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

Measured, not scored by `gate:score`: `pnpm gate:delay` replays held-out talks of both languages in real time on an otherwise idle Mac on mains power, one pair at a time, through `pnpm replay:contention --translate local`, and scores each talk from `pnpm diag:latency`. Since 2026-11-17 the part is measured under sustained load, as in a presentation: the pairs run back to back with no cooling pause, and a talk replayed alone on a fresh Mac is not a result for it. It keeps the Mac awake and records the load average before and after each pair. The talks were chosen on 2026-11-17, before any part 6 run outside Japanese: the first two English excerpts of the held-out manifest in every pair, every excerpt of the pair language, and for Japanese the two talks of its earlier rounds, so its repeat compares with them. `--gates` picks pairs, `ja,es,fr,it,pt` by default, `zh` and `ko` on request, Mandarin in `en-zh-Hant`, the script of its held-out lectures; `--score <run folder>` scores a run again, and `--talks <n>` makes a smoke run, which is never a gate result.

| Measure | Target, each talk |
| --- | --- |
| A row's last word to its first translated text, median | ≤ 3.0 s |
| The same, p90 | ≤ 4.5 s |

The delay from the middle of a row is reported, not targeted: about half a row of it is waiting for the sentence to end, which translating whole rows cannot remove. Set on 2026-11-11; see [translation latency](../log/2026-11-11-translation-latency.md). Since 2026-11-16 it applies to every gate, each on its own held-out talks with `--pair`, and it is the only target on how soon captions appear; part 4's latency target bounds the cloud translator's round trip alone.

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
| Non-speech rows; stock or repetitive rows | 0 |

Material so far: the public set, `benchmarks/gate-fleurs-es.json` from `pnpm gate:fixtures --language es`, 60 Spanish FLEURS test clips in archive order that are not in the third-language set, with the first gate's 60 English clips unchanged; the shared non-speech set; and the third-language set without its Spanish clips, followed by the gate's own `benchmarks/gate-other-es.json`, named by the gate file's `other`: ten clips each of French, Italian and Portuguese, Spanish's close neighbours. The held-out set, `benchmarks/gate-held-out-es.json` from `pnpm gate:held-out-fixtures --language es`: excerpts of six talks from the Spanish test split of Multilingual TEDx, chosen by fixed rules before any recognition, with the first gate's English excerpts unchanged; audio and references stay in the ignored cache, and each excerpt is its transcribed segments placed at their own times over digital silence, so untranscribed sound is absent. Its references have not been hand-checked. For translation, `benchmarks/translation-terms-es.json` holds required terms for 50 of the public clips, written from the references before any translation, and `pnpm eval:translation-cases --gate es` freezes the cases; no judged run exists. The Spanish stock phrases come from a sweep with `scripts/local/stock_sweep.py`. Not yet done: a judged translation run for the pair. Part 5 applies to Japanese only for now; part 6 applies to every gate, on its own held-out talks with `--pair`.

## French, Italian and Portuguese gates

`benchmarks/gate-fr.json`, `gate-it.json` and `gate-pt.json`, pairs `en-fr`, `en-it` and `en-pt`, written on 2026-11-14 before any measurement in those languages. Rules, parts and targets are the Spanish gate's table above, read with the gate's language in place of Spanish: all three are word-scored and written with spaces.

Material, each chosen by the Spanish gate's rules before any recognition:

- Public: `benchmarks/gate-fleurs-<language>.json` from `pnpm gate:fixtures --language <language>`, 60 FLEURS test clips of the language that are in no third-language set, with the first gate's 60 English clips unchanged. FLEURS holds Brazilian Portuguese only.
- Third languages: the shared set, then `benchmarks/gate-other-es.json` without the gate's own language, so each of the three hears the other two and Spanish.
- Held-out: `benchmarks/gate-held-out-<language>.json` from `pnpm gate:held-out-fixtures --language <language>`, excerpts of six talks from the language's test split of Multilingual TEDx, with the first gate's English excerpts unchanged. Its references have not been hand-checked, and its excerpts carry digital silence between segments.
- Stock phrases: each profile's list comes from a sweep with `scripts/local/stock_sweep.py`.

`pnpm eval:translation-cases --gate <language>` freezes each gate's cases. Not built for these three: required terms for a translation eval, and no judged run exists. Each of the three has had one [read-through](#translation-read-through) of the offline profile. Part 5 applies to Japanese only; part 6 applies to each.

## Mandarin gate

`benchmarks/gate-zh.json` gates the `en-zh` pair with the Japanese gate's targets, written before any Mandarin measurement: the nearest precedent, a language scored by character. One gate covers both of the profile's scripts, since the service converts recognized text after decoding; the conversion is covered by tests.

- Public: `benchmarks/gate-fleurs-zh.json` from `pnpm gate:fixtures --language zh`, 60 FLEURS Mandarin test clips, mainland speech with Simplified transcripts, that are in no third-language set, with the first gate's 60 English clips unchanged.
- Held-out: `benchmarks/gate-held-out-zh.json` from `pnpm gate:held-out-fixtures --language zh`, two whole lectures, about 35 minutes, of one lecturer in Taiwan Mandarin with frequent English terms, with Traditional, unpunctuated references, chosen by the maintainer on 2026-11-21 over mainland and conversational sources. Each recording is the lecture's clips joined, so it holds no pause of a second or more: more continuous than a talk, which the held-out targets, measured against a one-pass decode of the same audio, do not reward. It is one speaker, so it says little about other voices.
- Third languages: the shared set without its Mandarin clips, and `benchmarks/gate-other-zh.json`, 10 clips each of Japanese and Cantonese. Whisper reports Cantonese as `zh`, so Cantonese speech is shown as Chinese in the session's script; the third-language report counts it.
- Standing: one rolling run, which fails held-out error over one-pass narrowly and passes every other measured part; the rated share of major rows is not measured. See [the run](../log/2026-11-21-mandarin-gate.md).
- Scoring: `scripts/local/scoring.py` folds Chinese to Simplified before comparing, so neither the live path, which shows the session's script, nor a one-pass decode in Whisper's own script is charged for the script, and counts a run of Latin letters or digits as one unit, the profile's `latinWords`, so an English term weighs as one word.
- Stock phrases: from a sweep with `scripts/local/stock_sweep.py --language zh`. Subtitle-volunteer credits carry people's names, so they are caught by a pattern, the profile's `stockPatterns`, rather than listed.
- Translation: `benchmarks/translation-terms-zh.json` holds required terms for 50 public clips, 25 per direction, written before any translation; a group accepts either script. The local translator has run on the public clips in both scripts, and the held-out talks have had one read-through in `en-zh-Hant` and one part 6 run, which passes on every talk; see [the entry](../log/2026-11-22-chinese-korean-local-translation.md).

## Korean gate

`benchmarks/gate-ko.json` gates the `en-ko` pair with the Japanese gate's targets, written before any Korean measurement, as for Mandarin.

- Public: `benchmarks/gate-fleurs-ko.json` from `pnpm gate:fixtures --language ko`, 60 FLEURS Korean test clips that are in no third-language set, with the first gate's 60 English clips unchanged. Some references gloss a name or term in Latin letters in brackets, such as a name followed by its English spelling, which a decode is charged for when it does not write it.
- Held-out: `benchmarks/gate-held-out-ko.json` from `pnpm gate:held-out-fixtures --language ko`, four whole TEDx Korea talks of Pansori-TEDxKR, about 30 minutes, with unpunctuated references. The corpus cuts each talk into fragments at subtitle boundaries and keeps no times, so each recording is its fragments joined with 0.5 s of digital silence: every pause is the same length, and speech in fragments the corpus's authors dropped is absent from both audio and reference.
- Third languages: the shared set without its Korean clips, and `benchmarks/gate-other-ko.json`, the 10 Japanese clips that the Mandarin gate also hears.
- Scoring: by character with spaces removed, so spacing differences cost nothing, and a run of Latin letters or digits counts as one unit, the profile's `latinWords`.
- Stock phrases: from a sweep with `scripts/local/stock_sweep.py --language ko`. Subtitle credits carry people's names, so they are caught by a pattern.
- Standing: one rolling run, which passes every measured part; the rated share of major rows is not measured. The held-out recordings pause 0.5 s at every subtitle boundary, which suits rolling better than a real talk would. See [the run](../log/2026-11-22-korean-gate.md).
- Translation: `benchmarks/translation-terms-ko.json` holds required terms for 50 public clips, 25 per direction, written before any translation. The local translator has run on the public clips, and the held-out talks have had one read-through and one part 6 run, which misses on one English talk; see [the entry](../log/2026-11-22-chinese-korean-local-translation.md).

## Translation read-through

Reported, not gated, and no substitute for part 4, which needs two judges from different model families. The maintainer does not read the gate languages, so by their decision of 2026-11-14 an agent session grades the offline profile's translations by reading whole talks. The rubric below was written before any transcript was read.

`.local/venv/bin/python scripts/local/review_export.py --gate <language>` replays the gate's public held-out talks in real time with the local translator and writes one transcript per talk under the ignored `review/` folder: each row's original and translation in order, and the talk's reference. With `--opening`, each row also carries a re-translation as live and one with the reply's opening, made in order outside real time over the same recognized text, to compare the two; that export goes under `review/<gate>/opening/`. With `--cloud`, which is paid, the replay uses Claude Haiku 5.5 as the live translator and each row also carries a re-translation by the local model as live and one by Haiku, under `review/<gate>/cloud/`, to compare the profiles. The agent reads each talk whole and grades every row that has a translation:

| Grade | Meaning |
| --- | --- |
| 5 | Complete and accurate; reads naturally |
| 4 | Accurate, with a small loss or awkward wording |
| 3 | The gist is right, with a noticeable omission or distortion |
| 2 | The gist is wrong or misleading |
| 1 | Unrelated, empty, untranslated or in the wrong language |

Each row is also flagged for invention, content the original does not hold, and for a recognition error that changes the original's meaning against the reference. Rows with such a recognition error are graded against what was recognized and reported apart, as part 4 does. Per talk the agent notes what a row-by-row judge misses: a name or term rendered several ways, a thread lost between rows, register that drifts.

Reported per direction: rows graded, mean grade and share at 2 or lower on rows recognized without a meaning-changing error, the invention share on all rows, and rows left without a translation. The judge is one model family, and a session's grades are not reproducible by a command; the graded files are kept in `review/` so a later run can be compared row by row.

## Accepted limits

The Japanese held-out differences are accepted as failing on one talk, 0KTVqevvEjo, by the maintainer's decision of 2026-11-11: its speaker pauses often at low level, the detector cuts it into short stretches, and no rule tested recovers what the short windows lose. The targets and the talk stay as they are; a run reports the failure, and it does not block the gate while that talk accounts for it. See [decisions](decisions.md).

Part 5, the field session, is accepted as met by the maintainer's decision of 2026-11-12 on a microphone session of 24.5 minutes in rolling with offline translation and diagnostics on: no capture failure, no recognizer restart, and its download summarized in [the entry](../log/2026-11-12-en-es-microphone-session.md). It is shorter than the 30 minutes the part asks for, and its speech was English and Spanish, not Japanese. The part's wording stays as it is for a later language.

## Running a gate

| Step | Command |
| --- | --- |
| Public material, once | `pnpm gate:fixtures`; see [benchmarks/README.md](../../benchmarks/README.md#language-gate-fixtures) |
| Held-out material, once | `pnpm gate:held-out-fixtures`, which needs `yt-dlp`; it writes the gate's held-out manifest to `.local/fixtures/held-out/held-out.json`. With `--language es`, `fr`, `it` or `pt` it writes `held-out-<language>.json` there and needs `pyarrow`; see [benchmarks/README.md](../../benchmarks/README.md#held-out-gate-material) |
| Replay | `pnpm gate:run --segmentation rolling`; `turns` is measured only for comparison. `--gate <language>` picks the gate file, `ja` by default; the run records its name, its whole content and a digest of the implementation that ran, and `gate:score` reads the name from there. Add `--held-out .local/fixtures/held-out/held-out.json` for the held-out set, or a manifest under `private/` for own recordings. Real time: about an hour without held-out material, about two with it. `--smoke` checks the pipeline on three clips per stream and is never a gate result |
| Rate held-out rows | Add `"rating"` to each case in the held-out results: `plausible`, `minor`, `major` or `hallucination` |
| Score | `pnpm gate:score benchmarks/results/gate-<run>`, plus `--held-out <manifest> --held-out-results <results folder next to it>` |

`gate:run` scales every clip so its 90th-percentile 50 ms RMS is 0.1 without clipping, as an operator sets input gain, then joins each language's public clips, each non-speech category, and the third-language clips into one stream each with a second of silence between clips, replays it, runs `local:silence`, and decodes every public clip whole in Auto as the full-clip comparison. With held-out material it also decodes each excerpt in one pass in its own language, written as `offline.json` beside the held-out results and reported by `gate:score` as `heldoutOfflineRate`. The held-out targets are the live path's error and deletions over these decodes, on the excerpts both decoded; without `offline.json` they are not measured. The third-language stream, the FLEURS clips of `benchmarks/gate-other.json` in languages outside the gate, 40 in Chinese, Korean, Spanish and German for Japanese, is reported as `thirdLanguageRows` and not gated: rejecting a third language is decided but not built, and a target for it needs its own entry in [decisions](decisions.md). Public, non-speech and third-language outputs go to ignored `benchmarks/results/`; held-out outputs go next to their manifest, under `.local/` or `private/`.

A held-out manifest lists recordings as `{ "id", "audio", "language", "reference" }`, with `language` one of the gate's languages or `mixed`, and paths relative to the manifest. A reference is the hand-corrected transcript; text inside `{{ }}` marks a span the reviewer could not resolve, which costs nothing when aligned and is reported as an excluded share. Mixed recordings count toward the stock-phrase check only. Held-out recordings are replayed at their recorded level.

`gate:score` reads the targets from the current gate file named by the run, for Japanese `benchmarks/gate-ja.json`, which a unit test keeps equal to the tables above, since targets may change by a dated decision; `--targets run` scores with the gate file as the run recorded it. It says when the gate file or the implementation changed since the run, or while it was replaying, and writes what it scored with to `score.json`. The implementation digest covers every commit-eligible file under `apps`, `packages`, `scripts`, `profiles` and `benchmarks` plus the package files, as on disk, so it identifies an uncommitted tree. Runs from before this hold neither and score with the current file only. It prints aggregates only: each target as pass, fail or not measured, and a verdict for the recognition parts. On held-out rows in rolling it reports, not gates, `lockLagP90Ms`, `firstTextP90Ms` and `firstShownP90Ms`. The last is row start to the first text a display that shows text early has to show, the overlay's default; runs from before 2026-11-15 do not record it. Lock lag has no shown-text counterpart, because a segment's last words have usually locked by the time three decodes agree on them: by the third decode that holds a segment's end, the two before it agreed on it and it had settled, unless Whisper divided the speech into segments differently between them. The stock-phrase review, translation and the field session are checked by hand.

