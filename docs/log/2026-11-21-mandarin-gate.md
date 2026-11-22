# Mandarin gate: sets, sweep and first run

2026-11-21, on the branch `worktree-chinese`, uncommitted tree. No paid calls. Local recognition only, `turbo-q4`, rolling segmentation, on the Air.

## What was built

- `benchmarks/gate-zh.json`, with the Japanese gate's targets, written before any Mandarin measurement.
- Public set `benchmarks/gate-fleurs-zh.json`: 60 FLEURS `cmn_hans_cn` test clips, 9.6 min, beside the first gate's 60 English clips.
- Held-out set `benchmarks/gate-held-out-zh.json`: two whole lectures of the long-form NTU ML2021 test set, 34.6 min, one lecturer in Taiwan Mandarin with English terms, Traditional references. Each lecture is its test clips joined, with no pause of a second or more.
- Third languages for this gate, `benchmarks/gate-other-zh.json`: 10 FLEURS clips each of Japanese and Cantonese.
- Scoring folds Chinese to Simplified with the Python `opencc` 1.4.2, and the profile's `latinWords` counts each Latin or digit run as one unit.
- Stock phrases from `stock_sweep.py --language zh`: 630 windows, all with text; 319 passed the filters, and 300 of those are covered by the list and the subtitle-volunteer pattern. The 19 not covered are 17 short repetition loops of one or two characters, one interjection with English, and one channel sign-off, not yet listed; the sweep runs without the speech gate.

## Run

`pnpm gate:run --segmentation rolling --gate zh --held-out .local/fixtures/held-out/held-out-zh.json`.

The first attempt stopped after the public streams: `gate.py` resolved the held-out path through the worktree's link to the main checkout's cache and rejected it as outside `.local/`. The check now accepts a path inside `private/` or `.local/` as written or as resolved, and runs before the public replays. The second attempt finished every replay and the offline decodes and then stopped on printing the held-out results path, which was outside the worktree; that print is fixed. The full-clip decodes and `run.json` were written afterwards by a one-off script with the same calls. That record marks itself as completed separately; load averages and gains were not kept.

## Results

| Part | zh | en | Target |
| --- | --- | --- | --- |
| Held-out error over one-pass | 1.77 % | 0.59 % | 1.5 % · **zh fails** |
| Held-out deletions over one-pass | 0.67 % | 0.18 % | 1 % |
| Public error rate | 5.99 % | 5.03 % | 6 % / 8 % |
| Public over full clip | 0.75 % | 0.72 % | 1.5 % |
| Wrong-language rows | 0 % | 0 % | 2 % |
| Stock or repetitive rows | 0 | 0 | 0 |
| Rated share of major rows | not measured | not measured | 5 % |

Non-speech rows: 0, and the silence check passed.

Reported, not gated: public full-clip rate zh 5.24 %, en 4.31 %; held-out error zh 9.51 %, en 11.97 %; held-out one-pass zh 7.74 %, en 11.38 %; held-out deletions zh 3.24 %, en 4.55 %; lock lag p90 zh 3.36 s, en 3.82 s; first text p90 zh 6.63 s, en 9.93 s; first shown p90 zh 4.50 s, en 5.76 s.

Third languages: 11 rows, all labelled `zh`, all starting after the Cantonese clips begin. Cantonese is recognized as Chinese and shown in the session's script; Japanese, Korean, Spanish and German showed none. Earlier docs assumed Whisper reports Cantonese as `yue`; in this run it did not.

## Reading

Mandarin passes every measured part but one. Public error sits just under its target. The held-out failure is narrow, on lectures that hold no pause of a second or more, so rolling never closes on silence. That this is the cause is untested. The English held-out talks pass as in the earlier gates.

## Open

- The maintainer's decision on the held-out failure: accept it as a limit of the joined lectures, or find held-out Mandarin with natural pauses.
- Whether Cantonese shown as Chinese is acceptable, or needs detection.
- Offline browser smoke in `en-zh-Hant`, the local translator's replies on the public clips, and a read-through in both directions.
