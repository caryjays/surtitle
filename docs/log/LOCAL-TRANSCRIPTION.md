# Local transcription: setup, benchmark and current recommendation

## Controlled noisy-Japanese experiment — latest local results

The owner authorized a reproducible local-only comparison after breakout-session losses. Added eight new pinned CC-BY-4.0 FLEURS JA read-speech sources (IDs excluded from original tuning) and 30 deterministic clean/1.25×/noise/babble/faint/non-speech cases. Actual Turbo Q4/Silero runs made no cloud calls, loaded no `.env`, recorded no microphone and changed no live defaults. See [methodology, measurements, limits and commands](NOISY-EXPERIMENT.md).

- Full-clip screen: baseline, lower VAD threshold, lower confidence floor and forced JA each produced 11.87% target CER, no fully missing speech cases and zero text on six non-speech controls. The baseline already passed these speech cases, so no false-rejection benefit was demonstrated.
- Real-time adapter replay: 1.5 s previews emitted source text ~3.3–3.4 s earlier on two tested sentences with unchanged final CER, but cost 30 vs 16 jobs on the second sentence. An 8 s cap worsened first-sentence aggregate CER from 4.35% to 9.24%.
- A clean first-final check found faster previews did not accelerate the translation-ready point: 13.747 s vs 13.077 s baseline. An 8 s cap reached first final at 12.469 s but introduced 19.57% CER vs 0% on that sentence. These are PCM-start/worker timings, not browser or human speech-end latency.

**No live profile was promoted.** These controlled read-speech transformations do not recreate real far-field natural conversation, room reverberation or Chrome noise processing, and do not resolve the owner's observed group-speech rejection. Benchmark commands are explicit real-model integration, not ordinary tests:

```sh
pnpm local:noisy-fixtures
pnpm local:noisy-prepare
pnpm local:noisy-screen
pnpm local:noisy-replay
```

## Current personal companion extension

The explicitly selected `pnpm dev:listen` profile combines local recognition with cloud MT and agreeing-prefix source previews. An owner test exposed severe silence hallucinations. Current local inference adds a pinned CPU Silero speech check before Whisper, segment confidence filtering and repetition rejection; listen mode also calibrates ambient noise for 1.5 seconds. Browser automatic gain and default Whisper vocabulary prompting are now off. The glossary remains in MT. See [PERSONAL-COMPANION.md](../wiki/operations.md).

Real-model synthetic silence/steady noise/electrical hum now return no text. Real-browser replay of a non-speech prelude then public EN/JA produces no prelude MT and still produces both real originals (MT is fake in the test). Two separate one-repeat full-clip regressions on the same eight tuning clips retained **6.82% EN WER / 4.44% JA CER**, with warm medians 0.93–1.03 s and ~928–932 MiB peak process RSS. These are repeat timing runs, not additional independent samples. Those are isolated file measurements, not new live-caption/thermal guarantees. New benchmark reports identify the VAD model and filtering pipeline; older reports/tables below predate these safeguards. Ordinary local-only/benchmark paths retain fixed RMS segmentation and no previews/prompts, but now share the CPU/model-output rejection stage.

### Content-free causal diagnostics

Version-2 diagnostics add final-turn boundary/audio duration, local queue and worker inference/commit timing, a short decoder language code, character-clipping flag and quality-filter counters (including partially dropped decoder pieces). The actual stdio reply now carries a strict metadata object; restart service/worker and reload `/control` to activate it. These are status measurements, not a new inference option: model/precision, prompts, thresholds, segmentation and accepted text are unchanged. Worker inference duration includes resampling/speech verification/filtering. No raw speech or model errors are exported; no internal Whisper decode-limit/coverage probability is inferred. See [diagnostic fields/limits](../wiki/diagnostics.md). This upgrade was tested with fake workers/engine and no actual model inference.

### Speech detector provenance

The [Silero VAD README](https://github.com/snakers4/silero-vad), pinned [16 kHz/512-sample JIT API](https://github.com/snakers4/silero-vad/blob/066409f3d9db45a30d21dfcbf9147826ffdd7052/src/silero_vad/utils_vad.py) and [MIT license](https://github.com/snakers4/silero-vad/blob/066409f3d9db45a30d21dfcbf9147826ffdd7052/LICENSE) were checked. Revision, byte count and SHA-256 are in `scripts/local/vad-model.json`. The CPU model resets recurrent state for each turn/preview and is prewarmed; no torch.hub or runtime networking. Torch 2.14.1 was already locked/installed and is now an explicit direct dependency. No new Python package installation was needed on this machine. Existing setups can use `pnpm local:setup-vad`; setup does not modify `.env`.

## Decision / observed hardware — 2026-10-21

The owner requested local transcription before further cloud translation work. Verified on this machine: **Apple M5, arm64, 24 GiB unified memory, macOS 26.5**. No API calls were made and `.env` was neither read into agent context nor modified.

Implemented **MLX Whisper** as a local stdio worker behind the existing transcription adapter. The current default is **`turbo-q4` with translation OFF**. This produces original English/Japanese captions, not bilingual translations. No local translation model or cloud translation evaluation was added.

Why MLX: Apple Silicon support, a small Python API, multilingual models, and quick reproducible benchmarking without a separate network daemon. Upstream sources checked:

- [Apple MLX Whisper README/API](https://github.com/ml-explore/mlx-examples/tree/main/whisper), including model caching, quantized loading, 16 kHz input, language detection and `verbose=None`.
- [Whisper models and language caveats](https://github.com/openai/whisper). The multilingual models transcribe EN/JA; turbo is not a general bidirectional translation model.
- [Small Q4 weights](https://huggingface.co/mlx-community/whisper-small-mlx-q4) and [Turbo Q4 weights](https://huggingface.co/mlx-community/whisper-large-v3-turbo-q4). Exact revisions, byte counts and SHA-256 hashes are in `scripts/local/models.json`. Quantization is 4-bit, group size 64. Full-precision models have **not** been benchmarked here. Original Whisper code/weights are MIT; these community conversions are pinned and downloaded locally, not vendored or redistributed by this repository.

## Install / run

Already installed and exercised on this box. Reproducible setup from repository root requires **uv**, **ffmpeg**, Node/pnpm and an Apple Silicon Mac:

```sh
pnpm install
pnpm local:setup
pnpm dev:local
```

`local:setup` creates/preserves `.local/venv` with Python 3.12, syncs `scripts/local/requirements.lock`, verifies/downloads two Whisper model files (~197 MB + ~464 MB) plus a 2.27 MB Silero VAD model, and downloads the public test clips. First setup also installs Python dependencies; allow additional disk space/network time. It makes no paid requests and loads no `.env` or Hugging Face token. Setup is repeatable and rechecks audio/model hashes.

`dev:local` builds and starts `/control` and `/overlay` on the usual loopback origin. It **does not load `.env`**, and `--local-only` forces local transcription + translation off even if parent environment variables request cloud processing. A built launch is `pnpm build && pnpm start:local`.

Open **http://127.0.0.1:4317/control**, select input, click Start and **wait for ACTIVE** before speaking. The worker loads/warms the model while status is CONNECTING. Audio remains in memory; no local microphone recording or transcript log is written. The UI explicitly states that translation is OFF. Pause releases the mic; Clear closes/recreates the worker to invalidate old audio/results, so it also briefly reconnects.

To compare another installed model without editing a credential file:

```sh
LOCAL_MODEL=small-q4 pnpm dev:local
```

`LOCAL_MAX_TURN_MS` accepts 1000–12000; default **12000**. Maximum turn duration is not a sentence boundary. We deliberately did **not** reduce the default after the short-chunk tests below. Automatic live microphone gain control is not implemented. Listen mode now calibrates a noise threshold, not gain; ordinary local-only launches retain the fixed RMS gate. Appropriate microphone placement/input gain remains necessary.

The regular `pnpm dev` / `pnpm start` commands still load `.env` internally. Their new defaults are local/off, but explicit `TRANSCRIPTION_BACKEND=cloud` and/or `TRANSLATION_BACKEND=cloud` opt into paid processing. Keep cloud translation off until it is deliberately selected. The existing `.env` was left untouched; do not overwrite it with the example.

## Reproduce the measurements (offline after setup)

```sh
pnpm local:bench --model small-q4 --mode auto --repeats 2
pnpm local:bench --model turbo-q4 --mode auto --repeats 2
pnpm local:bench --model turbo-q4 --mode forced --repeats 2

pnpm local:stream --model turbo-q4 --mode auto --max-turn-ms 12000 --normalize
pnpm local:stream --model turbo-q4 --mode auto --max-turn-ms 6000 --normalize
pnpm local:stream --model turbo-q4 --mode auto --max-turn-ms 8000 --normalize
pnpm local:stream --model turbo-q4 --mode forced --max-turn-ms 12000 --normalize

pnpm check
pnpm test:local-unit
pnpm test:local-browser
```

Only these explicit local integration commands load real models. Ordinary `pnpm test` uses fake workers/providers and does not require Python models or make network calls. `test:local-unit` uses stdlib Python for scoring tests. `test:local-browser` replays two public recordings through a fresh headless Chrome fake microphone, the AudioWorklet, local MLX adapter and original-only overlay. It does not request the physical mic. It defaults to installed macOS Chrome; set `CHROME_PATH` for another executable.

Both benchmark commands save **metrics only** under ignored `benchmarks/results/`. Add **`--review`** to explicitly retain references/hypotheses for these public fixtures in the report; never use that path as an implicit audience transcript log. Terminal output contains timings/error rates, not speech content. Delete the result directory to remove generated reports; delete `.local/fixtures` to remove the downloaded clips. Model files are under `.local/models`.

## Fixture provenance and scoring

Eight licensed FLEURS recordings, four per language, **72.30 s total**, selected in archive order before inference. References and original WAV checksums are in [the fixture manifest](../../benchmarks/fleurs.json); attribution, CC BY 4.0 license and selection method are in [benchmarks/README.md](../../benchmarks/README.md).

- English **WER**: edit distance over words after Unicode NFKC, lowercasing and punctuation/whitespace normalization.
- Japanese **CER**: edit distance over Unicode characters after NFKC and removing punctuation/spacing. No kana/kanji equivalence rewriting.
- Numbers are not semantically normalized. For example `25–30 years` versus reference `25 to 30 year` contributes errors despite largely preserving meaning. German `Sie` inside English and Japanese homophones exposed genuine recognition errors too.
- Aggregate rates are total edit errors / total reference units, not averages of clip percentages. There are only **88 English reference words and 135 Japanese reference characters**. Repeats are timing trials, not additional independent examples.
- Reference transcripts are never prompts, decoder context or training data. These are inference/segmentation experiments, **not model fine-tuning** and not a translation evaluation.

## Observed full-clip results

Source levels were **not normalized** for these direct-inference tests. Each clip was converted through the same 24 kHz PCM16 → 16 kHz float resampler used by the worker. Temperature 0, task transcribe, no previous-text conditioning, no glossary/prompt, no word timestamps. First inference is marked separately; warm statistics exclude it.

| Model / language selection | EN WER ↓ | JA CER ↓ | Warm median decode / clip | Warm real-time factor ↓ |
| --- | ---: | ---: | ---: | ---: |
| Small Q4 / Auto | 11.36% | 14.81% | 0.56 s | 0.064 |
| Small Q4 / forced correct language | 11.36% | 14.81% | 0.19 s | 0.023 |
| Turbo Q4 / Auto | 6.82% | 4.44% | 0.80 s | 0.098 |
| Turbo Q4 / forced correct language | 6.82% | 4.44% | 0.61 s | 0.067 |

RTF = total decoding seconds / audio seconds, **not microphone-to-caption delay**. RTF 0.098 means about 10× faster than real time in that particular full-clip run. All full-clip Auto detections were EN/JA correctly on this sample. First-ever Small inference took **8.02 s**, versus subsequent sub-second results; local capture now prewarms on synthetic silence before declaring ACTIVE. Cold-start latency is not a warm latency guarantee. Measured process peak RSS was ~569–572 MiB (Small) / ~760–766 MiB (Turbo); **this is not a complete unified-memory/GPU allocation measurement**.

A separate review run overlapped another GPU benchmark and had a 2.27 s warm median. It is excluded from this isolated table and labelled as contention in its report. Do not run the model benchmarks concurrently when comparing timings. Ambient workload, GPU clocks and thermal state were not controlled; no OBS load was included.

## Observed real-time adapter/VAD replay

A real file decoder can look good while the live path fails. That happened initially: the fixed RMS **0.012** energy gate missed four very quiet recordings (some maximum 50 ms RMS values were only 0.0019–0.003). The as-is replay failed before completing the suite. This is a **capture-level/VAD limitation**, not evidence that the ASR cannot recognize those files.

For the completed replay runs, **`--normalize` explicitly adjusts each public fixture's gain** so its 90th-percentile frame RMS approaches 0.06, capped by peak 0.9 and gain 100. Gain is recorded per clip. This uses the whole fixture to set its level; it is **not an implemented live automatic gain controller**. Real microphones must be level-checked. Files play at original speed in 50 ms frames; the production adapter/VAD supplies turns. One second of trailing silence is appended to allow the 700 ms pause rule to fire. Auto uses one worker across EN then JA; forced mode restarts once when the language changes.

| Turbo Q4 configuration | EN WER ↓ | JA CER ↓ | Median commit→final | Median estimated end→final | Maximum estimated end→final |
| --- | ---: | ---: | ---: | ---: | ---: |
| Auto, 12 s maximum | 6.82% | 2.96% | 2.16 s | 2.86 s | 3.38 s |
| Auto, 8 s maximum | 9.09% | 8.15% | 2.19 s | 2.77 s | 3.10 s |
| Auto, 6 s maximum | 5.68% | 11.85% | 1.96 s | 2.33 s | 2.98 s |
| Forced language, 12 s maximum | 6.82% | 2.96% | 0.51 s | 1.21 s | 1.41 s |

“End” here is the last input frame exceeding the same RMS threshold, **not a human-labelled end of speech**. Timing includes the silence wait, IPC/queue/inference until the final callback, but excludes browser rendering/OBS. It measures the final tail of a clip, not time until the first caption during a long utterance. These paths differ from full-clip tests (VAD trimming, gain, worker environment and pacing); do not extrapolate the 0.80 s file median into a live-caption promise.

**Recommendation:** retain Turbo Q4, 12-second maximum and 700 ms pause finalization. For a known English talk, use EN→JA while translation remains off; it acts as an EN recognition hint and was substantially faster in this test. Use Auto for unscripted language switching, or switch to JA→EN for a Japanese question. Shorter forced chunks damaged Japanese recognition enough that the modest tail-latency gain was not worth adopting. No overlap/partial-stabilization scheme was added; continuous long speech can still wait up to the max-turn interval before first text.

## Actual integration checks / remaining gaps

Passed: TypeScript/build; **39 Node tests** with fake providers/workers; **4 Python scoring tests**; original fake-provider browser smoke; **real local-model browser smoke** with public English then Japanese audio. The real smoke verified original-only captions, language labels, privacy notice, overlay snapshot reload and Pause. Chrome used a temporary synthetic capture WAV, deleted afterward, with no physical mic access or cloud translation.

Still untested: physical mic/venue feed, OBS itself and Chrome→Ghostty switching, long thermal/load soak alongside demos, noisy/quiet rooms, spontaneous conversation, glossary/code-switching, larger held-out accuracy set. Quantization and smaller models need broader comparisons before event use. The current hard-split energy VAD is deliberately simple; no claim of production-ready streaming recognition.

The same eight clips were used to choose the chunk default: this is **tuning-set performance**, not a held-out accuracy claim. Next work should add more diverse held-out audio and improve gain/VAD/partial captions before treating the app as a reliable event interpreter. Cloud translation can be chosen independently later.
