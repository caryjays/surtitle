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

## First rehearsal with the change

The maintainer ran `pnpm dev:offline` with rolling and Auto for 440 s on two videos, one in fast technical Japanese, one in English, while another project's test suites loaded the Mac: load average 9 to 12. Content-free diagnostics:

- 45 rows: 34 translated, 1 left untranslated by an invalid local translator reply after 1.9 s, and 10 rejected. Nine rejections were the speech gate on non-speech, at the start and between the videos; one closing decode, 3.5 s at the end, was detected as Russian and rejected under the new rule.
- No shown row outside the pair: every kept row was recognized as English or Japanese, each video in its own language.
- Latency is not comparable with earlier rehearsals. Translation request to first translated text was 2.3 s at the median against 1.0 s in the previous session, a stage the retry does not touch, and 32 of 34 rows closed by length on continuous speech, 9.0 s of audio at the median against 4.6 s.

The session predates the counters below, so it cannot show retries or drops.

## Counters

Row quality gains two optional counts, `pairRetries` from the worker and `otherLanguageDrops` from the adapter, and `pnpm diag:latency` prints their totals per Start when a file carries them. On the real engine, 3 of 12 windows of 0KTVqevvEjo detected outside the pair came back with `pairRetries: 1`.

## Open

- A rehearsal with the counters, on an otherwise idle Mac, with speech that has been mislabeled before.
- Real-time gate run with the held-out set, rolling and turns, on the Air.
- Looping on short stretches remains this talk's main loss.
- Turns mode still shows a third-language final as `unknown`.
- One window of the talk went into English on retry; whether it was an English loanword phrase or a translation was not checked.

## Second rehearsal: OBS, recording, and Spanish

The maintainer ran `pnpm dev:offline` with rolling and Auto for 459 s with OBS composing the overlay, screen and browser sharing, audio into OBS, video recording for part of the session, and another agent session running development tasks. Japanese and English video, and a stretch of Spanish speech. Content-free diagnostics, with the counters:

- 52 rows: 49 translated, 3 rejected. No shown row outside the pair, and the retry never fired: `pairRetries` 0.
- The Spanish stretch was one row of 20 decodes, all detected as Spanish, all dropped, none placed in the pair by the retry. English resumed in the right language on the next row.
- The other two rejections: 8.3 s of near-silent audio, RMS 0.0018, that Whisper looped on and the repetition filter rejected; and 2.7 s of English dropped for low confidence, log probability −1.14, possibly a real short phrase.
- From about 1:55 to 4:00 into the session, lock lag rose from about 2 s to 4 to 8 s, translation requests from 2 to 3 s to 4 to 6.6 s, and one closing decode waited 4.4 s in the queue. Both recovered after about 4:00. The maintainer observed lag with recording on and smooth captions, slower than on an idle Mac, with recording off. Which stretch the recording covered is the maintainer's recollection, not in the file.

## Marker rows

The Spanish stretch left the overlay empty for about 30 s. The maintainer asked for a display in that time, worded so it serves other drop reasons and languages detection cannot name reliably.

- `TranscriptEvent` finals and `Segment` gain `uncaptioned`: `language` or `filtered`. The controller keeps such a rejected row as a final marker with an empty original, never translated and never context, and still counts it as rejected.
- The rolling adapter closes an empty row as a `language` marker after three consecutive decodes outside the pair, so the marker shows about 3 s into the speech; the stretch continues in a row that shows no second marker. A shorter stretch leaves the marker when it closes. A closing decode rejected by the repetition, low-confidence or stock-phrase filters, with the speech gate passed and no noise trim waiting, closes its empty row as a `filtered` marker. Speech-gate rejections and unconfirmed rows after a noise trim leave nothing.
- Profiles gain `uncaptioned`, `not captioned` and `字幕なし`. Displays render `[ not captioned · 字幕なし ]` in muted italics: the overlay and audience view for `language`, the operator page for both, with the reason in its row details.
- Tests: three adapter tests over the fake worker, a controller test, and the display rules. `pnpm check`, the Python tests and `pnpm test:browser` pass. Not yet seen on a real display.

Applied to the second rehearsal, the rule would have shown one overlay marker about 3 s into the Spanish and two operator-only markers, for the near-silent loop and the dropped English.

## Third rehearsal: markers in OBS

The maintainer's report, no diagnostics file: the markers worked as intended in OBS. An English speaker explaining several Latin phrases was transcribed and translated throughout, since a row's settled language keeps later decodes in English; a long stretch of Spanish that followed showed the marker and then resumed correctly.

## Open, after the rehearsals

- The near-silent loop would show an operator marker; whether filtered markers should require a minimum input level is open.
- Recording's GPU cost under OBS: a run with recording toggled at noted times would separate it from the other load.
