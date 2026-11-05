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

## Pre-wiki technical records, frozen 2026-10-26

These documents predate the wiki and stack dated sections; later sections are later state. Where they disagree with the wiki, the wiki is current. "Owner" in them means the maintainer.

| File | Span | Holds |
| --- | --- | --- |
| [PROVIDERS.md](PROVIDERS.md) | 2026-10-18 and 2026-10-21 | Cloud provider documentation as retrieved: contracts, pricing, retention |
| [LOCAL-TRANSCRIPTION.md](LOCAL-TRANSCRIPTION.md) | 2026-10-21 to 2026-10-26 | Local model setup, methodology, benchmark tables, speech gate and silence fix notes |
| [NOISY-EXPERIMENT.md](NOISY-EXPERIMENT.md) | 2026-10-26 | Controlled noisy-Japanese experiment report |
