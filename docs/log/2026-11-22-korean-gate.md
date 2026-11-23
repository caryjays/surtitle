# Korean: profile, sets, sweep and first gate run

2026-11-22, the start of roadmap stage 4. Uncommitted tree on `main` at `36c717a`. No paid calls. Local recognition only, `turbo-q4`, rolling segmentation, on the Air.

## What was built

- A `ko` profile: scored by character with spaces removed, Latin runs as one unit (`latinWords`), written with spaces (`spaced`, so paced text is released in whole words and translated pieces join with a space), Latin sentence and clause marks, reading rates of 5 to 15 characters per second, and the marker label 자막 없음. The rates are a guess between English and Japanese, not measured.
- A profile field `letters`, Unicode character-name prefixes for a character-scored language's letters. The worker's check that a retried decode is written in the pair language read only kanji and kana, so a Korean decode always failed it, and Korean misheard as another language could never be recovered by the retry. Korean sets `HANGUL`; without the field the old set applies, so Japanese and Chinese are unchanged.
- A Korean layout-preview conversation in `apps/web/preview.ts`.
- `benchmarks/gate-ko.json`, with the Japanese gate's targets, written before any Korean measurement.
- Public set `benchmarks/gate-fleurs-ko.json`: 60 FLEURS `ko_kr` test clips, 11.6 min, beside the first gate's 60 English clips. 9 of the 60 references gloss a name or term in Latin letters in brackets; about 12 Latin units over about 2,600 syllables.
- Held-out set `benchmarks/gate-held-out-ko.json`: four whole talks of Pansori-TEDxKR 1.0, 30.0 min, 117 to 159 fragments each. The archive is pinned by checksum and read from an OpenSLR mirror; the corpus's Google Cloud link returned 403. The corpus keeps no fragment times, so each recording is its fragments joined with 0.5 s of digital silence. The corpus's folder names are its speakers' names in base64, so the manifest names talks by video ID only.
- Third languages for this gate, `benchmarks/gate-other-ko.json`: the 10 Japanese FLEURS clips the Mandarin gate also hears.
- Tests: Korean scoring, the script check for Korean, Japanese and Chinese, the pair, pacing and the preview.

## Stock-phrase sweep

`scripts/local/stock_sweep.py --language ko`, 630 windows of the non-speech streams forced into Korean. Every window had text; 604 passed the filters. A first-guess list covered 5. Most were one closing line for a video, 583 windows; added with a weekly sign-off, a news sign-off and a pattern for Korean subtitle credits, which carry a person's name. Covered after: 594. The 10 left are a religious exclamation, a food word and three repetition loops; none was added, since they are also real speech.

## Run

`pnpm gate:run --gate ko --segmentation rolling --held-out .local/fixtures/held-out/held-out-ko.json`, kept awake with `caffeinate`, on mains power. A three-clip smoke run came first. The implementation did not change during the run. Load average median 2.6, maximum 11.1: other work ran on the Mac for part of the run.

## Results

| Part | ko | en | Target |
| --- | --- | --- | --- |
| Held-out error over one-pass | 0.38 points | 0.49 points | 1.5 |
| Held-out deletions over one-pass | 0.15 points | 0.18 points | 1.0 |
| Public error rate | 4.35 % | 4.71 % | 6 % / 8 % |
| Public over full clip | 0.82 points | 0.40 points | 1.5 |
| Wrong-language rows | 0 % | 0 % | 2 % |
| Stock or repetitive rows | 0 | 0 | 0 |
| Rated share of major rows | not measured | not measured | 5 % |

Non-speech rows: 0, and the silence check passed. Third-language rows: 0.

Reported, not gated: public full-clip rate ko 3.53 %, en 4.31 %; held-out error ko 2.94 %, en 11.87 %; held-out one-pass ko 2.55 %, en 11.38 %; held-out deletions ko 0.85 %, en 4.55 %; lock lag p90 ko 2.56 s, en 4.11 s; first text p90 ko 7.00 s, en 9.34 s; first shown p90 ko 4.50 s, en 5.79 s.

Runs: `benchmarks/results/gate-ko-rolling-20261122T140109`, held-out results beside the manifest in `results-rolling-20261122T140109`.

## Reading

Korean passes every measured recognition part on its first run. The held-out margin is wide, but the material flatters rolling: every fragment ends in a 0.5 s pause, so rows close on silence at subtitle boundaries, where a real talk's pauses vary and are sometimes missing. It is the opposite case to the Mandarin lectures, joined with no pause. The talks are 2010 to 2014 TEDx recordings, mostly clean stage audio. Neither set has been listened to.

## Open

- The rated share of major rows, and the maintainer's review of the new stock phrases.
- Translation in the pair: the local translator's replies on the public clips, an offline browser smoke in `en-ko`, a read-through in both directions, and part 6.
- Whether held-out Korean with natural pauses is needed before the gate counts as passed.
- No microphone session in the pair.

```sh
pnpm gate:fixtures --language ko
python3 scripts/local/prepare_held_out.py --language ko
.local/venv/bin/python scripts/local/stock_sweep.py --language ko
pnpm gate:run --gate ko --segmentation rolling --held-out .local/fixtures/held-out/held-out-ko.json
pnpm gate:score benchmarks/results/gate-ko-rolling-20261122T140109 --held-out .local/fixtures/held-out/held-out-ko.json --held-out-results .local/fixtures/held-out/results-rolling-20261122T140109
```
