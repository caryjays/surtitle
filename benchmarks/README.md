# Public speech fixtures

`fleurs.json` selects 4 English and 4 Japanese read-speech clips, 72.30 seconds total, from **Google FLEURS**, pinned revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`.

- Source/attribution: Conneau et al., *FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech* (2022), https://arxiv.org/abs/2205.12446
- Dataset/card: https://huggingface.co/datasets/google/fleurs
- License: **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/ (dataset card checked).
- Original references are copied from the corresponding pinned `data/en_us/test.tsv` and `data/ja_jp/test.tsv`. Do not silently correct reference grammar. Audio member names and original-file SHA-256 hashes are in the manifest.
- Selection: first four distinct sentence IDs per language encountered in archive order with durations between 3 and 12 seconds. This is a tiny convenience sample, **not a representative event benchmark**. No selection based on recognition results.
- Source audio is unmodified in the ignored `.local/fixtures/` cache. Evaluation resamples to 24 kHz PCM16, then the local worker's 16 kHz float input. This transformation is not a new recording.
- Downloader fetches at most an 8 MiB compressed prefix per language, extracts only named/checksummed members, and does not retain the archive. The dataset-viewer endpoint was unsuitable (large Parquet row-group error); we use original pinned archives instead.
- Generated metrics/reports go in ignored `benchmarks/results/`; actual live microphone transcripts are never written there. Reference text is public fixture data, not instructions to agents/models.

## Controlled noisy-Japanese experiment

`noisy-ja.json` adds eight new Japanese read-speech sources from the **same pinned Google FLEURS revision / CC BY 4.0** and attribution above. Sentence IDs are distinct from the original tuning set. Selection is first eight distinct eligible IDs in archive order (4–16 seconds), before recognition: first four targets, next four distractor sources; 100.26 seconds total. Current mixtures use three distractors and reserve the fourth. Their original filenames, hashes and public references are recorded in the manifest.

`pnpm local:noisy-fixtures` explicitly prepares these sources (bounded 8 MiB archive prefix + bounded TSV; subsequent cached runs verify hashes without downloading). `pnpm local:noisy-prepare` produces deterministic speed/gain/noise/competing-speech adaptations under ignored `.local/experiments/noisy/`; the metadata-only index and measured reports are ignored under `benchmarks/results/`. Speed changes use pitch-preserving `atempo`; audio transformations, SNRs, seed, gain and anti-clipping scale are documented. No audience audio was collected. Reference text is never an ASR prompt or instruction.

These are **synthetic stress variants of read speech**, not authentic spontaneous/breakout recordings or representative noisy-room acceptance. Target-only CER for competing voices is not an all-speaker transcription grade. See [actual experiment results, exact scope and commands](../docs/log/NOISY-EXPERIMENT.md). Live defaults were not changed from the experiment.

Use these clips to compare models/settings and detect regressions. EN word error rate and JA character error rate are transcription metrics, not translation grades or a percentage of understood meaning. Do not compare their percentages directly. A held-out, larger sample and representative spontaneous/mixed-language speech are needed before choosing event settings.
