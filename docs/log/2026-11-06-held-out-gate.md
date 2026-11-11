# First held-out gate run: the model misses the absolute targets on public unscripted speech

2026-11-06. The first rolling gate run with the public held-out set fails. Held-out error is 14.67% CER in Japanese and 11.66% WER in English, against targets of 5.0% and 4.0%. A one-pass decode of the same excerpts scores 12.40% and 11.38%, so most of the miss comes from the model against these references, not from rolling. Public and non-speech results are unchanged from `0ef69bb`.

## Run

`pnpm gate:run --segmentation rolling --held-out .local/fixtures/held-out/held-out.json` at `325ca9c`, clean tree, on the laptop. It started once the 5-minute load average fell below 2.5: 2.0 at the start and 2.3 an hour in. Every replay finished. The run then crashed printing the held-out results path, which was relative because the manifest path was, and that lost the per-stream load samples. The silence check, the full-clip decodes and `run.json` were finished separately for the same run directory; none of them is paced in real time. The manifest folder is now resolved to an absolute path.

`gate:run` now also decodes each held-out excerpt in one pass in its language with the live model: plain Whisper long-form decoding at temperature 0, without the speech gate, decoder filters or segmentation, and `gate:score` reports that as `heldoutOfflineRate`, not gated. For this run, those decodes were made after the replays with the same function.

## Results

| Measure | Japanese | English | Target |
| --- | --- | --- | --- |
| Held-out error, live | 14.67% | 11.66% | ≤ 5.0% / ≤ 4.0% |
| Held-out error, one-pass offline | 12.40% | 11.38% | not gated |
| Held-out deletions, live | 6.00% | 4.22% | ≤ 2.0% / ≤ 1.0% |
| Wrong-language share, public and held-out rows | 2.44% | 0.00% | ≤ 2% |
| Lock lag p90 | 2.69 s | 3.70 s | ≤ 3.0 s |
| First text p90 | 7.03 s | 9.03 s | ≤ 8.0 s |
| Public error | 5.73% | 4.47% | ≤ 6.0% / ≤ 8.0% |
| Public live minus full-clip | 0.61 pts | 0.16 pts | ≤ 1.5 |
| Non-speech rows | 0 | | 0 |
| Stock or repetitive rows | 0 | 0 | 0 |
| Excluded reference share | 2.04% | 0.00% | |
| Third-language rows | 44 | | not gated |

Held-out rows rated major or hallucinated: not measured. Rating means reading row text, and held-out results sit under `.local/`, which agents do not read.

Per excerpt, live and offline error:

| Excerpt | Live | Live deletions | Offline | Offline deletions |
| --- | --- | --- | --- | --- |
| held-en-4320211 | 10.5% | 6.2% | 10.9% | 6.8% |
| held-en-4346818 | 17.3% | 8.1% | 16.1% | 7.4% |
| held-en-4366522 | 9.3% | 2.8% | 6.9% | 2.5% |
| held-en-4366893 | 9.8% | 2.1% | 10.6% | 2.0% |
| held-en-4367535 | 11.9% | 1.2% | 11.9% | 1.8% |
| held-en-4383161 | 12.0% | 4.7% | 12.2% | 5.2% |
| held-ja--6K2nN9aWsg | 24.1% | 7.0% | 18.9% | 5.0% |
| held-ja-0KTVqevvEjo | 30.4% | 19.0% | 25.3% | 5.5% |
| held-ja-0L8zz6v-3lw | 7.0% | 1.9% | 6.4% | 1.9% |
| held-ja-0SI8rms050Q | 9.7% | 2.9% | 7.4% | 1.9% |
| held-ja-0jJLyvNn_to | 5.7% | 1.5% | 6.5% | 2.0% |

## Reading

- English: live is 0.28 points over offline. Rolling loses almost nothing here. The 11% is the model on fast multi-speaker phone audio against verbatim transcripts. Deletions are high offline too, which points at the reference or the audio, for example crosstalk and words Whisper drops, not at locking.
- Japanese: live is 2.27 points over offline, more than the 1.5 points allowed on public material. Most of the gap is one talk, 0KTVqevvEjo, whose live deletions are 19.0% against 5.5% offline. The same talk produced 6 short rows in Hangul or Latin script with no pair language, and another produced 2 such rows plus one English row. Those 9 rows are the wrong-language failure. The three cleanest talks are 5.7 to 9.7% live, and two talks above 18% offline dominate the total.
- Timing: the targets fail on English only. Continuous earnings-call speech produces long rows: 59 of 274 English rows took more than 8 s to show first text, against 15 of 304 in Japanese. One growing Whisper segment locks only when a later segment starts.
- Targets: the 10-28 targets were set just above rolling on the maintainer's own recordings with silver references, where rolling scored 2.3% WER and 4.2% CER. On this material the model's one-pass decode is about three times the absolute targets. No change to rolling can meet them here. The targets can only change through a dated decision made before the next run.

## Open

- A decision on the held-out targets for public material: keep the absolute limits, or gate live minus one-pass offline as the public set does, with or without an absolute cap. Not taken.
- The 0KTVqevvEjo loss and its off-pair rows: find what in the talk causes them, such as music, laughter or audience noise, without reading its text into agent context.
- The row rating needs the maintainer, or the held-out results kept somewhere agents may read.
- The first-text delay on continuous English speech.
- The turns segmentation was not rerun.
