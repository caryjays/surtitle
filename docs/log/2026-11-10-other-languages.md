# The held-out talk with stray rows: lost speech, and rows outside the pair

2026-11-10. Under the new [held-out targets](2026-11-10-held-out-targets.md), Japanese fails mostly on one talk, 0KTVqevvEjo: live deletions 19.0% against 5.5% for the one-pass decode, and six rows in Hangul or Latin script with no pair language. The maintainer chose to keep the talk and fix what it shows rather than drop it after seeing its results. All measurements here are offline and content-free; scratch scripts printed counts and rates only.

## Where the speech goes

Checked in order on that talk, against the four other Japanese talks:

- Recording level. Its median 50 ms RMS is the lowest of the five, 0.0038 against 0.0071 to 0.0346, with loud peaks. Replaying the energy detector's rules, as the gate calibrates them on silence, against Silero's speech frames: 6 s of 214 s of detected speech fall outside any stretch, 2.6%; under 0.1% on every other held-out talk. A small part of the loss.
- Stray rows. They hold about 11 s of audio and 33 characters. A small part.
- Decoding each energy stretch once in Japanese, with the worker's filters, gives 1,245 characters against 1,601 unfiltered. The repetition filter dropped 334 characters in two places. One dropped segment is 113 characters over 8 s of audio, 14 characters a second with 3 distinct characters, compressing 21 to 1: a Whisper loop. Scored against the reference, error is 29.20% unfiltered and 29.33% filtered, so the filter turns wrong characters into missing ones and the speech under the loop is lost either way. The other Japanese talk checked had no filter drops.
- The rolling simulator, run over the same stretches with the live rules, produced 1,324 characters against 1,294 in the live gate run, so the simulator reproduces the loss.

The loss is Whisper looping at temperature 0 on short stretches of this talk, which the one-pass decode over the whole excerpt does not do.

Temperature fallback, decoding again at 0.2, 0.4 and 0.6 when a segment's compression ratio exceeds 2.4, was compared per stretch on all eleven held-out talks. It fired on 13 segments of this talk, error −1.4 points and deletions −2.6, and on one segment elsewhere, error +1.1 points. The comparison truncated stretches over 29 s in both arms, which voids its absolute rates on talks with long stretches but not the paired difference. Too small and too mixed to adopt; not built.

## Rows outside the pair

In Auto, a rolling row with no language yet is decoded with detection on, and the worker accepted text in any language; the adapter took a row's language only from a pair language, but locked the text regardless, so a third-language row displayed as `unknown`. The 2026-11-02 decision to reject such rows was not enforced.

`language_sim.py` gains `--pair-only`, a decode detected outside the pair locks nothing and is handled as wholly filtered, and `--pair-retry T`, such a window is decoded again in the pair language detection prefers when the pair holds at least T of its probability, kept only if written in that language's script. Live rules: `auto-lock --keep-agreed --noise-confirm -0.5`. The gate streams were rebuilt at full length first: a smoke run had left three-clip streams, which invalidated a first attempt.

| Stream | Live rules | `--pair-only` | `--pair-only --pair-retry 0.2` |
| --- | --- | --- | --- |
| Public Japanese, error | 6.55% | 6.55% | 6.55% |
| Public English, error | 4.31% | 4.31% | 4.31% |
| Music, noise, applause rows | 0 | 0 | 0 |
| Third-language rows, 40 clips | 49 | 0 | 0 |

The held-out talks, simulated over the energy detector's stretches and scored with the gate's `edits` on the whole reference, without the gate's first-and-last-subtitle exclusion, so the rates compare arms only:

| Talk | Live rules: rows outside pair, error, deletions | `--pair-only` | `--pair-retry 0.5` | `--pair-retry 0.2` |
| --- | --- | --- | --- | --- |
| 0KTVqevvEjo | 6, 33.90%, 17.87% | 0, 34.31%, 20.40% | 0, 34.38%, 20.53% | 0, 33.08%, 19.58% |
| -6K2nN9aWsg | 1, 25.70%, 8.64% | 0, 25.28%, 9.00% | 0, 26.17%, 9.41% | 0, 25.93%, 9.18% |
| Six English and three other Japanese | none | unchanged | not run | not run |

## What changed

- `scripts/local/engine.py`: `transcribe` takes `pair`. With no language, a decode with accepted text detected outside the pair runs Whisper's language detection; when the pair holds at least 0.2 of it, the audio is decoded again in the preferred pair language, and that result is used if it passes the filters and is in the language's script. `quality.py` holds the two pure decisions, `pair_retry_language` and `script_matches`.
- `scripts/local/worker.py` accepts an optional `pair` of two profiled codes.
- `packages/providers/local.ts`: rolling requests carry the pair while a row has no language; a decode outside the pair for such a row locks nothing, and a closing decode outside the pair closes the row rejected.
- Tests: two fake-worker rolling tests, both failing without the adapter change; Python tests for the two decisions and the RPC field.

On the real engine, of 28 windows of 0KTVqevvEjo whose detection fell outside the pair with accepted text, 10 were decoded again into the pair, 9 Japanese and 1 English; none of the first 3 s of the 40 third-language clips was.

## Open

- Real-time gate run with the held-out set, rolling and turns, on the Air: the change has only been simulated.
- Looping on short stretches remains this talk's main loss.
- Turns mode still shows a third-language final as `unknown`.
- One window of the talk went into English on retry; whether it was an English loanword phrase or a translation was not checked.
