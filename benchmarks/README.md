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

## Translation eval cases

`pnpm eval:translation-cases` runs the 16 FLEURS clips above and, when present, the noisy variants of the four targets through the live recognizer with automatic language, and freezes reference plus recognized text to ignored `results/translation-cases.json`. Recognized text keeps the recognizer's real mistakes, which is the point: translators are scored on what they were actually given. `translation-terms.json` lists spellings a correct translation must contain, chosen from the public references. `model-prices.json` holds retrieved list prices for cost estimates. See [testing](../docs/wiki/testing.md#translation-eval).

Use these clips to compare models/settings and detect regressions. EN word error rate and JA character error rate are transcription metrics, not translation grades or a percentage of understood meaning. Do not compare their percentages directly. A held-out, larger sample and representative spontaneous/mixed-language speech are needed before choosing event settings.

## Language gate fixtures

`pnpm gate:fixtures` prepares the public material for the [language gates](../docs/wiki/gates.md). The first run selected clips by fixed rules before any recognition and wrote the manifests; later runs only verify the ignored cache in `.local/fixtures/gate/` against them and refuse a manifest that would change.

- `gate-fleurs.json`: 60 English and 60 Japanese clips from **Google FLEURS** at the same pinned revision, CC BY 4.0, attribution above. Selection: the first distinct sentence IDs in test-archive order, 4 to 16 seconds, excluding every ID in `fleurs.json` and `noisy-ja.json`. References are the raw public transcripts, uncorrected.
- `gate-nonspeech.json`: about 37 minutes from **MUSAN** (Snyder, Chen and Povey, *MUSAN: A Music, Speech, and Noise Corpus*, 2015, https://arxiv.org/abs/1510.08484; https://www.openslr.org/17/). Licenses are per file, from the corpus's own LICENSE files:
  - Background noise: every file in `noise/free-sound` that the corpus annotates as a background noise and that the pinned Hugging Face mirror `FluidInference/musan` holds; marked public domain on Freesound. Checksums are the mirror's, pinned by revision; that the mirror matches the original archive file for file is not verified.
  - Applause: `noise-sound-bible-0003`, "Audience Applause" by Matthiew11 on SoundBible, CC BY 3.0.
  - Instrumental music: `music-fma-0001` to `0003`, from the album *Memory Bank* by Airglow on the Free Music Archive, CC BY, read from a bounded prefix of the original OpenSLR archive.

Nothing from these sets is redistributed: audio stays in the ignored cache, and replay outputs go to ignored `results/`.

## Development corpus

`pnpm corpus:fetch` builds a longer development set from **YODAS2** (Li et al., *YODAS: Youtube-Oriented Dataset for Audio and Speech*, 2023, https://arxiv.org/abs/2406.00899; https://huggingface.co/datasets/espnet/yodas2), pinned to revision `631fc446cb1a41ee93a1d390a167c6e08c2597a3`. The dataset holds only YouTube videos published under CC BY 3.0. The script reads the `en000` and `ja000` subsets, whose subtitles were uploaded with the video, and never the `100` subsets, which hold YouTube's automatic captions; Whisper scored against automatic captions would understate its errors.

Selection reads only the duration and subtitle files and keeps recordings in shard order that are 8 to 40 minutes long, with subtitles covering at least 60% of the time, in the expected script, without music marks or roll-up repeats, and at a plausible speaking rate. A reviewer reads an excerpt of each pick and lists exclusions, such as synthetic narration or subtitles that read as machine output, in `review.json` next to the manifest; selection then skips them and continues. Audio is streamed only for the final picks, from shards checked against their pinned SHA-256.

Uploaded subtitles are not verbatim, so the corpus is development material with silver references and never gate material. The recordings, subtitles, manifest and review list are third-party material and stay under `private/`; nothing is redistributed. Each recording's YouTube ID, kept in the private manifest, is its attribution source.

