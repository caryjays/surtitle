# Log

Dated history. Entries are append-only and never rewritten. For how things are now, read [the wiki](../wiki/README.md). The maintainer's planning notes and field diaries from the same period are kept outside the repository.

## Entries

| File | Covers |
| --- | --- |
| [2026-10-26-review-and-wiki.md](2026-10-26-review-and-wiki.md) | Code review, check results, documentation restructure |
| [2026-10-26-public-private-split.md](2026-10-26-public-private-split.md) | Public-by-default repository, private overlay, leak scan, license |
| [2026-10-26-rename-surtitle.md](2026-10-26-rename-surtitle.md) | Project renamed to Surtitle |
| [2026-10-26-anthropic-translator.md](2026-10-26-anthropic-translator.md) | Anthropic translator adapter and shared prompt |
| [2026-10-26-translation-eval.md](2026-10-26-translation-eval.md) | Offline translation eval harness |
| [2026-10-26-first-translation-eval.md](2026-10-26-first-translation-eval.md) | First paid translation eval |
| [2026-10-26-prompt-variants.md](2026-10-26-prompt-variants.md) | Translation prompt variants and segmentation losses |
| [2026-10-26-held-out-transcription.md](2026-10-26-held-out-transcription.md) | Held-out transcription plausibility, stock-phrase rule |
| [2026-10-26-rolling-window-simulation.md](2026-10-26-rolling-window-simulation.md) | Rolling-window simulation, soak, word-level locking |
| [2026-10-26-rolling-recognition-design.md](2026-10-26-rolling-recognition-design.md) | Rolling recognition design proposal |
| [2026-10-27-worker-segments.md](2026-10-27-worker-segments.md) | Worker segment ends, rolling step 1 |
| [2026-10-27-rolling-mode.md](2026-10-27-rolling-mode.md) | Rolling mode in the local adapter, rolling step 2 |
| [2026-10-27-rolling-replay.md](2026-10-27-rolling-replay.md) | Rolling mode replayed on the held-out set, rolling step 3 |
| [2026-10-27-product-direction.md](2026-10-27-product-direction.md) | Product identity, stack and language sequence |
| [2026-10-27-capture-lanes.md](2026-10-27-capture-lanes.md) | Five usage lanes and the capture plan |
| [2026-10-27-language-pair.md](2026-10-27-language-pair.md) | Language pair generalized, roadmap stage 0 |
| [2026-10-28-japanese-gate.md](2026-10-28-japanese-gate.md) | Japanese gate targets, tooling and first public run |
| [2026-10-28-development-corpus.md](2026-10-28-development-corpus.md) | Second machine for long runs and the YODAS2 development corpus |
| [2026-11-01-rolling-opening-loss.md](2026-11-01-rolling-opening-loss.md) | Rolling opening loss confirmed, a longer noise hold measured and reverted |
| [2026-11-02-language-arbitration.md](2026-11-02-language-arbitration.md) | Rolling row language traced as the cause of lost openings, adapter fix, offline language-rule simulator |
| [2026-11-04-language-rules.md](2026-11-04-language-rules.md) | Retry's English loss traced to the noise trim, settling at lock, third-language fixtures, clean gate of the 11-02 fix |
| [2026-11-04-settle-at-lock.md](2026-11-04-settle-at-lock.md) | Settling a rolling row's language at lock, shipped and gated: Japanese passes both public accuracy targets |
| [2026-11-04-noise-confirm.md](2026-11-04-noise-confirm.md) | A confident first lock after a noise trim; rolling passes every measured gate target |
| [2026-11-06-held-out-gate.md](2026-11-06-held-out-gate.md) | First held-out gate run: rolling fails, the model's one-pass decode is near the live error on public unscripted speech |
| [2026-11-06-pacing.md](2026-11-06-pacing.md) | Rolling step 4: locked-text marker, reading-pace release, roll-up overlay with Browser Source settings |
| [2026-11-06-console.md](2026-11-06-console.md) | Display simulations, the operator console, runtime segmentation and translation settings |
| [2026-11-06-rehearsal-latency.md](2026-11-06-rehearsal-latency.md) | First console rehearsal in rolling listen mode, and the stages of translation delay |
| [2026-11-06-local-translation.md](2026-11-06-local-translation.md) | Offline profile with a local Qwen3.5-4B translator, its latency and GPU contention; automatic gain on by default |
| [2026-11-08-gpu-contention.md](2026-11-08-gpu-contention.md) | Real-time held-out replay with and without the local translator: what each costs the other on one GPU |
| [2026-11-08-row-length.md](2026-11-08-row-length.md) | Speech to translation measured per row, and two shorter row rules against the live one |
| [2026-11-09-cadence-streaming.md](2026-11-09-cadence-streaming.md) | Faster decode cadences against the live one, and streamed local translation |
| [2026-11-09-piece-translation-design.md](2026-11-09-piece-translation-design.md) | Design proposal: translating locked pieces before a row closes |
| [2026-11-09-piece-translation.md](2026-11-09-piece-translation.md) | Piece translation built behind a replay flag and compared with row translation |
| [2026-11-10-piece-quality.md](2026-11-10-piece-quality.md) | Piece translation quality read against rows: worse on every talk, live stays row |
| [2026-11-10-prompt-order.md](2026-11-10-prompt-order.md) | Padded replies traced to the local prompt's order; text now last; glossary filter tried and reverted |
| [2026-11-10-offline-rehearsal.md](2026-11-10-offline-rehearsal.md) | Maintainer's two offline rehearsal sessions on fast technical Japanese, matching replay timings, names misrecognized; `diag:latency` reads files without a Start |
| [2026-11-10-held-out-targets.md](2026-11-10-held-out-targets.md) | Held-out gate targets become differences from the model's own one-pass decode; scorer changed and checked |
| [2026-11-10-other-languages.md](2026-11-10-other-languages.md) | The held-out talk with stray rows: Whisper loops on short stretches; rolling rows outside the pair lock nothing after a retry in the pair; two rehearsals; marker rows for uncaptioned speech |
| [2026-11-10-gate-tooling.md](2026-11-10-gate-tooling.md) | Gate runner, replay and translation eval take a gate or pair; profiles gain `spaced`; Spanish chosen as the stage 2 pilot |
| [2026-11-10-state-review.md](2026-11-10-state-review.md) | Working-tree review, verification results, rolling recalibration and direction-change defects, recommendations |
| [2026-11-10-rolling-lifecycle-fixes.md](2026-11-10-rolling-lifecycle-fixes.md) | Fixes for those two defects: rolling rows keep their mode, recalibration drops pending recognition; adapter and controller regression tests |
| [2026-11-10-reliability-and-measurement.md](2026-11-10-reliability-and-measurement.md) | Recalibration keeps finished rows; per-turn input level, applied capture settings and display pacing in diagnostics; speech to displayed translation in `diag:latency`; gate runs record their gate file and implementation digest |
| [2026-11-11-settle-time.md](2026-11-11-settle-time.md) | Settle time 0.5 s against the live 1.0 s: simulator sweep and real-time replays; English lock lag 0.3 to 0.6 s lower, not yet adopted |
| [2026-11-12-spanish-pilot-steps.md](2026-11-12-spanish-pilot-steps.md) | Spanish stock-phrase sweep, neighbour languages as third languages, local translation in the pair, and a session in `en-es` |
| [2026-11-12-en-es-microphone-session.md](2026-11-12-en-es-microphone-session.md) | An `en-es` microphone session: a long translation pushed out of the overlay window by short rows, and no rows after a change to English inside a row; both fixed |
| [2026-11-12-early-text.md](2026-11-12-early-text.md) | Why first text is late on continuous speech, a simulation of showing agreed text before it locks, and the overlay setting built from it |
| [2026-11-12-early-text-default.md](2026-11-12-early-text-default.md) | Show text early as the default, the field session accepted for gate part 5, and the third-language and non-speech streams replayed for text shown early |
| [2026-11-13-closing-decode-and-faint-sweep.md](2026-11-13-closing-decode-and-faint-sweep.md) | A decode sent in the quiet as the closing decode, the Japanese held-out talks at settle 0.5, a faint-level sweep, and the applause stream with early text |
| [2026-11-11-spanish-pilot.md](2026-11-11-spanish-pilot.md) | Spanish pilot: profile, public set, gate file and first real-time run; the non-speech row traced to two pair rules and fixed |

## Pre-wiki technical records, frozen 2026-10-26

These documents predate the wiki and stack dated sections; later sections are later state. Where they disagree with the wiki, the wiki is current. "Owner" in them means the maintainer.

| File | Span | Holds |
| --- | --- | --- |
| [PROVIDERS.md](PROVIDERS.md) | 2026-10-18 and 2026-10-21 | Cloud provider documentation as retrieved: contracts, pricing, retention |
| [LOCAL-TRANSCRIPTION.md](LOCAL-TRANSCRIPTION.md) | 2026-10-21 to 2026-10-26 | Local model setup, methodology, benchmark tables, speech gate and silence fix notes |
| [NOISY-EXPERIMENT.md](NOISY-EXPERIMENT.md) | 2026-10-26 | Controlled noisy-Japanese experiment report |
