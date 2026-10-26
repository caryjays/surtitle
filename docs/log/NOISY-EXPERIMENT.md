# Controlled noisy-Japanese experiment — first results

## Decision

**Keep the live defaults unchanged.** This experiment did not identify a safe improvement to the final-text → English-translation path, and did not reproduce the room's major false-rejection failure.

- Relaxing the neural speech threshold or decoder-confidence floor did not improve the full-clip screen.
- More frequent previews made **provisional Japanese originals** appear earlier, with the same final character error on the tested inputs, but used substantially more inference jobs. Previews do not trigger translation. A follow-up actually measured a later first final with faster previews.
- Shorter chunks hurt recognition on one clean sentence; their small first-final benefit did not justify that error increase.
- These are small, controlled synthetic stress tests, not proof of noisy-room capability, natural conversation accuracy, source separation, or an old-versus-current whole-application performance regression test.

## Sources and reproducibility

`benchmarks/noisy-ja.json` pins eight **new** Japanese Google FLEURS read-speech clips at revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`, CC BY 4.0. Their sentence IDs exclude the original four Japanese tuning IDs. Selection was archive order, first eight distinct eligible sentences of 4–16 seconds, before recognition results. The first four are targets (51.66 seconds); the next four are distractor sources. The current mixtures use the first three distractors; the fourth is reserved. Total downloaded source duration is 100.26 seconds. Attribution/license/source hashes are in [benchmarks](../../benchmarks/README.md) and the manifest.

The fixture preparer downloads at most an 8 MiB archive prefix plus bounded TSV metadata, verifies the reference column against the existing pinned manifest, and extracts no archive paths. Cached fixtures are verified offline on subsequent runs. Float WAVs are converted by ffmpeg, not assumed to be PCM16.

Each target has six deterministic conditions:

1. Clean, fixture-level p90 RMS normalization to 0.06 (peak bound 0.9; **not live AGC**).
2. Pitch-preserving 1.25× speed via ffmpeg `atempo`.
3. Seeded Gaussian noise, whole-clip target/interference SNR +6 dB.
4. Three overlapping other Japanese read-speech clips, +6 dB target/interference SNR.
5. The same competing speech at 0 dB.
6. Target scaled down 12 dB after the same fixture normalization.

Mixtures prevent clipping by jointly scaling target and interference; seed, normalization/anti-clip gains and exact PCM hashes are recorded. Six additional six-second controls contain silence, low/high Gaussian noise, 50/220 Hz hum or modulated noise—not speech. There are **30 cases / 335.65 seconds** total. Babble references score the designated target only; words from other legitimate voices count as interference, not necessarily hallucinations. Distractor speech is not used as a non-speech false-positive control.

No real audience audio or transcripts, microphone access, `.env`, paid providers, external model requests or new model downloads were used. Existing pinned Turbo Q4 + CPU Silero ran locally. Reports contain metrics only; `--review` explicitly retains public-fixture text for the full-clip screen, never audience content. Raw fixtures/transformed PCM live only in ignored `.local/`; reports in ignored `benchmarks/results/`. Public references in the manifest are data, never prompts/instructions.

## Profiles: one variable at a time

| Profile | Difference from baseline |
| --- | --- |
| `baseline-auto` | Auto, Silero ≥0.5 for 3 consecutive frames, confidence floor −1.0, 3-second previews, 12-second cap |
| `gate-035` | Only neural speech threshold becomes 0.35 |
| `confidence-125` | Only confidence floor becomes −1.25; no-speech/repetition guards remain |
| `forced-ja` | Only language hint becomes Japanese |
| `preview-1500` | Only preview interval becomes 1.5 seconds; still requires two agreeing hypotheses |
| `chunks-8000` | Only maximum turn becomes 8 seconds |

These profiles are imported only by experiment scripts. Production service config/UI/RPC cannot select the experimental thresholds. Engine/filter helpers accept bounded optional arguments with the original defaults, and the separate experiment worker explicitly supplies them. The production worker rejects threshold fields in incoming RPC. No accounts/services/providers or live behavior changed.

## Stage 1: full-clip quality/rejection screen

Four speech profiles × 30 identical cases = **120 local pipeline invocations** (non-speech may bypass Whisper), one pass; order rotates per case. Prewarming is excluded from measurements. No segmentation/previews/browser/translation in this stage.

| Profile | Aggregate target CER ↓ | Speech cases with no text | Non-speech cases producing text |
| --- | ---: | ---: | ---: |
| Baseline Auto | 11.87% | 0 / 24 | 0 / 6 |
| Speech threshold 0.35 | 11.87% | 0 / 24 | 0 / 6 |
| Confidence floor −1.25 | 11.87% | 0 / 24 | 0 / 6 |
| Forced Japanese | 11.87% | 0 / 24 | 0 / 6 |

Baseline CER by condition: clean 11.22%; 1.25× 12.68%; noise +6 dB 11.71%; babble +6 dB 10.73%; babble 0 dB 13.66%; faint 11.22%. All profile aggregates were identical. Fewer errors in one synthetic mixture than clean is not evidence that noise improves recognition—small-sample decoding variation/context effects are possible.

**Interpretation:** no positive evidence to relax filters. Since none of the baseline full speech clips was rejected, this corpus did not reproduce the room's admission problem; it cannot establish that sensitivity changes would or would not help there. The six non-speech controls are a limited regression check, not silence safety certification. Full clips offer more acoustic context than short live turns.

## Stage 2: real-time local-adapter replay

Actual `LocalTranscriber` receives identical 24 kHz PCM at real-time 50 ms intervals, 1.5-second quiet calibration and one-second trailing silence. Final jobs retain production priority/queue/deadline bounds; previews use the normal agreement rule. Translation is absent. This measures **source emission**, not browser paint or human-labelled speech-end latency.

First target (`ja_lab-1834`), four conditions (clean/fast/babble 0 dB/faint), plus a high-noise control:

| Profile | Target CER ↓ | Median first emitted source, from PCM start ↓ | Rejected speech candidates |
| --- | ---: | ---: | ---: |
| Baseline Auto | 4.35% | 9.762 s | 0 / 5 |
| 1.5-second previews | 4.35% | 6.433 s | 0 / 5 |
| 8-second cap | 9.24% | 9.564 s | 0 / 6 |

All emitted no text on the one high-noise control. The 8-second variant's extra errors were on the clean sentence: **0% → 19.57% CER**. There was no material first-source advantage in this pass.

Second target (`ja_lab-1813`), same four conditions/control, reversed profile order:

| Profile | Target CER ↓ | Median first emitted source ↓ | Speech worker jobs | Rejected candidates |
| --- | ---: | ---: | ---: | ---: |
| Baseline Auto | 10.21% | 8.781 s | 16 | 1 / 5 |
| 1.5-second previews | 10.21% | 5.354 s | 30 | 1 / 5 |

Again neither profile emitted text on the noise control. Worker jobs count all recognition requests (including previews and potentially speech-gate-only checks), **not GPU time**. Faster preview's maximum final queue wait was 656 ms versus 434 ms baseline. Each target/condition pair is the same waveform across profiles; two target sentences with variants are not eight independent speakers or a statistical benchmark.

## Stage 3: first finalized text, not just previews

A further clean replay of `ja_lab-1834` measures the actual first nonempty final—the earliest point at which MT could begin. Times are from the fixed PCM start, including any fixture leading silence:

| Profile | First provisional-or-final source ↓ | First finalized source ↓ | Final CER ↓ | Worker jobs |
| --- | ---: | ---: | ---: | ---: |
| Baseline Auto | 10.059 s | 13.077 s | 0% | 3 |
| 1.5-second previews | 7.430 s | 13.747 s | 0% | 6 |
| 8-second cap | 10.400 s | 12.469 s | 19.57% | 4 |

**Important:** earlier Japanese previews did not mean earlier English translation. In this single follow-up, faster previews delayed the first final by ~0.67 s while doubling jobs. Shorter chunks finalized ~0.61 s earlier but introduced substantial character errors. These are one-pass observations subject to runtime/thermal variation, not general latency guarantees. No translation request was made.

`lastFinalFromPcmEndMs` in raw reports may be negative because source files contain trailing silence; it is not a human-labelled speech-end metric. Frame-scheduling lateness was recorded separately (maximum ~17 ms across these runs), so the intended replay clock can be audited. First-emission metrics are nullable when no text appears; timing medians across rejected/non-speech jobs are not described as decoder speed improvements.

## Reproduce (sequentially, not alongside live recognition)

Requires existing local setup, ffmpeg, pnpm and the pinned models. No new Python dependency:

```sh
pnpm local:noisy-fixtures  # bounded public download if missing; otherwise checksum-only cache verification
pnpm local:noisy-prepare   # deterministic ignored PCM + metadata-only input index; no model calls
pnpm local:noisy-screen    # explicit real local inference; four profiles, 30 cases
pnpm local:noisy-replay    # explicit real-time inference; first target, three timing profiles, five cases
pnpm local:noisy-replay --profiles preview-1500,baseline-auto --target ja_lab-1813
pnpm local:noisy-replay --profiles baseline-auto,preview-1500,chunks-8000 --target ja_lab-1834 --conditions clean
```

Replays take several minutes at real time. The screen supports `--profiles baseline-auto,gate-035`, `--repeats 2` and explicit public-fixture `--review`; candidates remain bounded. Replay supports only allowlisted profile/condition names and checks PCM hashes/paths. Results include source-code hashes for the uncommitted worktree used, input hashes and selected settings—not environment/config dumps or keys. This freezes the comparison inputs but does not isolate other system workloads/thermal drift. Full-clip screen order rotates; replay order reverses across the two sentences, not repeated within every condition.

Actual local reports from this run:

- `benchmarks/results/noisy-screen-1792954783089350000.json`
- `benchmarks/results/noisy-replay-1792955300704792000.json`
- `benchmarks/results/noisy-replay-1792955611722778000.json`
- `benchmarks/results/noisy-replay-1792955903295882000.json`

Source-code hashes correspond to code at each run; later validation/counting-only changes are not retroactively rewritten into reports. The first replay predates worker-job counting and first-final timing; missing measurements are unavailable, not zero.

## Remaining gap / next decision

Synthetic sped-up read speech is not natural disfluent conversation. This test lacks far-field microphone directivity, reverberation, real crowd noise, Chrome echo/noise processing and the venue's short/overlapping speech dynamics. No learned speaker separation/diarization or acoustic overlap-window deduplication was added. The earlier room's false-negative problem remains unresolved.

Do not promote weaker filters, an 8-second default or faster previews as an English-reading fix from these results. Next useful evidence would be separately licensed natural/noisy/short Japanese speech and controlled far-field/capture-processing cases that actually reproduce rejection; then compare speech-aware boundaries or overlapping acoustic context while preserving no-speech safety and final accuracy. Any audience recording or speaker enrollment still needs separate permission.
