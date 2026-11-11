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
- `gate-fleurs-es.json`, from `pnpm gate:fixtures --language es`: 60 Spanish clips, FLEURS locale `es_419`, selected by the same rule and also excluding every ID in `gate-other.json`, with the 60 English clips of `gate-fleurs.json` unchanged. Same revision, licence and attribution.
- `gate-other-es.json`, also from `pnpm gate:fixtures --language es`: the Spanish gate's further third-language clips, the first 10 FLEURS test clips each of French `fr_fr`, Italian `it_it` and Portuguese `pt_br` by the same rule. Same revision, licence and attribution.
- `translation-terms-es.json`: required terms for 50 clips of `gate-fleurs-es.json`, 25 per direction, for `pnpm eval:translation --pair en-es`.
- `gate-nonspeech.json`: about 37 minutes from **MUSAN** (Snyder, Chen and Povey, *MUSAN: A Music, Speech, and Noise Corpus*, 2015, https://arxiv.org/abs/1510.08484; https://www.openslr.org/17/). Licenses are per file, from the corpus's own LICENSE files:
  - Background noise: every file in `noise/free-sound` that the corpus annotates as a background noise and that the pinned Hugging Face mirror `FluidInference/musan` holds; marked public domain on Freesound. Checksums are the mirror's, pinned by revision; that the mirror matches the original archive file for file is not verified.
  - Applause: `noise-sound-bible-0003`, "Audience Applause" by Matthiew11 on SoundBible, CC BY 3.0.
  - Instrumental music: `music-fma-0001` to `0003`, from the album *Memory Bank* by Airglow on the Free Music Archive, CC BY, read from a bounded prefix of the original OpenSLR archive.

- `gate-other.json`: 10 clips each of Mandarin Chinese, Korean, Spanish and German from **Google FLEURS** at the same pinned revision, CC BY 4.0, about 7 minutes. Selection: the first distinct sentence IDs in each language's test-archive order, 4 to 16 seconds. Speech outside the session pair, on which any displayed row is an error. These IDs are excluded from a future gate in their own language.

## Held-out gate material

`pnpm gate:held-out-fixtures` selects the held-out set by fixed rules before recognition and records the selection and checksums in `gate-held-out.json`; audio and references stay in the ignored `.local/fixtures/held-out/`. It needs `yt-dlp`.

- English: excerpts of six calls from **Earnings-21** (Del Rio et al., *Earnings-21: A Practical Benchmark for ASR in the Wild*, 2021, https://arxiv.org/abs/2104.11348; https://github.com/revdotcom/speech-datasets), CC BY-SA 4.0, pinned by commit. From each Eval-10 call in metadata order, whole speaker turns from the first turn starting at or after half the call, at least 5 minutes, mostly analyst Q&A. References are Rev's transcripts without fillers, cut-off words or tags; they keep spoken repetitions.
- Japanese: excerpts of five talks from **TEDxJP-10K** (Ando and Fujihara, *Construction of a Large-scale Japanese ASR Corpus on TV Recordings*, 2021, https://arxiv.org/abs/2103.14736; https://github.com/laboroai/TEDxJP-10K), whose URL list and corrections are Apache 2.0, pinned by commit; the talks are TEDx videos under TED's CC BY-NC-ND 4.0 usage policy, downloaded from YouTube. From each talk of at least 8 minutes with manual Japanese subtitles, in list order, whole subtitle cues from 60 s, at least 6 minutes. References are the subtitles cleaned as the TEDxJP-10K authors clean them; the first and last cue are excluded from scoring. The authors checked every sentence of their 10,000-segment sample by hand and changed about a quarter, mostly to add fillers such as えー and まあ or to write numbers in kanji; the subtitles, without fillers, are closer to caption style.
- Spanish, for the Spanish gate, in `gate-held-out-es.json` from `pnpm gate:held-out-fixtures --language es`: excerpts of six talks from the test split of **Multilingual TEDx** (Salesky et al., *The Multilingual TEDx Corpus for Speech Recognition and Translation*, 2021, https://arxiv.org/abs/2102.01757; https://www.openslr.org/100), CC BY-NC-ND 4.0. Read from one file of the Hugging Face mirror `deepdml/mtedx`, pinned by revision and checksum; that the mirror matches the original archive is not verified. Talks in talk-ID order whose segments span at least 8 minutes; from each, whole segments from the first starting at or after 60 s, at least 5 minutes. The split holds one clip per segment, so an excerpt is its clips placed at their own times over digital silence. References are the corpus transcripts without bracketed sound annotations. Audio and references stay in the ignored cache. The path needs `pyarrow` in the Python that runs it. The English excerpts are the first gate's.

YouTube audio can change after selection; a cache that no longer matches the manifest is refused rather than refetched.

Nothing from these sets is redistributed: audio stays in the ignored cache, and replay outputs go to ignored `results/`.

## Development corpus

`pnpm corpus:fetch` builds a longer development set from **YODAS2** (Li et al., *YODAS: Youtube-Oriented Dataset for Audio and Speech*, 2023, https://arxiv.org/abs/2406.00899; https://huggingface.co/datasets/espnet/yodas2), pinned to revision `631fc446cb1a41ee93a1d390a167c6e08c2597a3`. The dataset holds only YouTube videos published under CC BY 3.0. The script reads the `en000` and `ja000` subsets, whose subtitles were uploaded with the video, and never the `100` subsets, which hold YouTube's automatic captions; Whisper scored against automatic captions would understate its errors.

Selection reads only the duration and subtitle files and keeps recordings in shard order that are 8 to 40 minutes long, with subtitles covering at least 60% of the time, in the expected script, without music marks or roll-up repeats, and at a plausible speaking rate. A reviewer reads an excerpt of each pick and lists exclusions, such as synthetic narration or subtitles that read as machine output, in `review.json` next to the manifest; selection then skips them and continues. Audio is streamed only for the final picks, from shards checked against their pinned SHA-256.

Uploaded subtitles are not verbatim, so the corpus is development material with silver references and never gate material. The recordings, subtitles, manifest and review list are third-party material and stay under `private/`; nothing is redistributed. Each recording's YouTube ID, kept in the private manifest, is its attribution source.

