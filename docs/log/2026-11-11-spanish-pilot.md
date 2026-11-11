# Spanish pilot: first run, and the non-speech row traced and fixed

2026-11-11. The maintainer chose to start the Spanish pilot beside the open parts of the Japanese gate; see [decisions](../wiki/decisions.md). This entry covers the pilot's setup, its first real-time run, and the non-speech row that run shared with both Japanese gate runs of the same day. No paid calls. Public material only.

## Setup

- `profiles/languages.json` has a Spanish profile: word-scored, written with spaces, Latin sentence and clause punctuation, the English reading rates. Its stock-phrase list is a first guess at common Whisper sign-offs, not the result of a sweep.
- `pnpm gate:fixtures --language es` writes `benchmarks/gate-fleurs-es.json` without touching `gate-fleurs.json`: 60 Spanish FLEURS test clips, locale `es_419`, by the first gate's selection rule and excluding the third-language set's clips, plus the first gate's 60 English clips unchanged.
- `benchmarks/gate-es.json`, pair `en-es`, carries the Japanese gate's English targets for both languages. It was written before any Spanish measurement.

## First run

`pnpm gate:run --gate es --segmentation rolling`, real time, at the live settings including settle 0.5 s. Load average 2.2 at both ends. Public, non-speech and third-language material only; there is no held-out Spanish set yet, so the held-out targets, lock lag and first text are not measured.

| Measure | Target | Spanish | English |
| --- | --- | --- | --- |
| Public error | ≤ 8% | 2.63% | 4.47% |
| Public error over full clip | ≤ 1.5 points | −0.07 | 0.16 |
| Wrong-language share | ≤ 2% | 0.00% | 0.00% |
| Stock or repetitive rows | 0 | 0 | 0 |
| Non-speech rows | 0 | 1, fail, both languages together | |
| Third-language rows, reported only | | 0 | |

Full-clip error: Spanish 2.70%, English 4.31%. Rows kept and rejected or empty: Spanish 74 and 5, English 64 and 20.

- Turbo Q4 in rolling is well inside the range on read Spanish, and the live path loses nothing against a full-clip decode.
- No row took the wrong language. English and Spanish share a script, so the script check on a retried decode cannot tell them apart; on read single-language clips that did not matter. Mixed and accented speech is untested.
- The English numbers equal the Japanese gate run of the same day at settle 1.0, 4.47% and 0.16: the first real-time public figures at settle 0.5, and no change.

Run: `benchmarks/results/gate-es-rolling-20261111T193505`.

## The non-speech row

The one non-speech row is the same row in this run and in both Japanese gate runs of [the same day](2026-11-11-outlier-talk-and-settle-pair.md): the word "You", from the background-noise stream about 813 s in, with first text 4.0 s after its row began. Rolling showed it in three runs up to 2026-11-04; the runs of 2026-11-04 and 2026-11-06 after [settle at lock](2026-11-04-settle-at-lock.md) and [noise confirm](2026-11-04-noise-confirm.md) did not. It came back with the pair rules of [other languages](2026-11-10-other-languages.md).

Decoding that stretch's growing windows, 1 to 8 s, with the live engine:

| Window | Auto, no pair | With a pair, Japanese or Spanish |
| --- | --- | --- |
| 1 s | rejected | rejected |
| 2 s | English "You", −0.83 | the same |
| 3 s | a Russian phrase, −0.31 | retried in English: "You", −0.98 |
| 4 s | English "You", −0.96 | the same |
| 5 s | the Russian phrase, −0.40 | the same, retry not kept |
| 6 to 8 s | rejected | rejected |

Without a pair no two consecutive decodes agree, so nothing locks. Two pair rules each undo that:

1. The retry. Detection gave the pair 0.21 to 0.29 of its probability at 3 s, over the 0.2 share, so the window was decoded again in English and returned the stock word at −0.98, which passes the −1.0 floor and the script check. Three decodes in a row then agree.
2. The skip. Without the retry, the Russian decode is outside the pair and handled as a decode with no segments; after a decode that returned text, such a decode is skipped so the decodes on either side can agree. That rule was written for a repetition loop inside real speech. Here it lets "You" at 2 s agree with "You" at 4 s.

The noise-confirm rule does not apply: no trim had happened, since the windows were under 3 s or returned text.

## Fix

Both are needed; either rule alone still locks the row.

- `scripts/local/engine.py`: the retried decode replaces the first only when its lowest segment log probability is at least −0.5, `PAIR_RETRY_LOGPROB` in `quality.py`, the same level as the noise confirm.
- `packages/providers/local.ts`: a decode with accepted text outside the pair, after a decode that returned text, clears that text instead of being skipped. Text in another language is evidence against the decode before it. A rejected decode is still skipped.

`pnpm gate:language-sim` gains `--retry-confirm T` and `--other-resets` for the two rules. With `--rules auto-lock --keep-agreed --pair-only --pair-retry 0.2 --noise-confirm=-0.5`, error and deletions:

| Stream | Live rules | Both new rules |
| --- | --- | --- |
| Public Japanese | 6.77%, 34 | 6.77%, 34 |
| Public English | 4.31%, 11 | 4.31%, 11 |
| Stress English, noise before | 7.95%, 2 | 7.95%, 2 |
| Stress Japanese, noise before | 6.81%, 4 | 6.81%, 4 |
| Stress English, noise under | 5.68%, 2 | 5.68%, 2 |
| Stress Japanese, noise under | 6.09%, 7 | 6.45%, 7 |
| Third-language, music, noise | no rows | no rows |

`--other-resets` alone changes nothing on any stream. Retries that pass the script check are rare on this material, 7 in all, and 5 of them fall under −0.5: the floor removes most retries, and the only cost seen is one more error on the eight clips of Japanese under noise. The retry's measured benefit in [other languages](2026-11-10-other-languages.md) was on wrong-language rows, which stay at none here. The simulator treats each clip as one stretch and does not reproduce the row, so it shows cost only; the row itself is checked by the engine probe above, where the 3 s window now stays Russian, and by the real-time run below.

A rolling test covers the second rule with a fake worker that alternates a stock word in the pair with text outside it; it fails without the change.

## Confirming run

`pnpm gate:run --gate ja --segmentation rolling` with both changes in the working tree, uncommitted and covered by the run's implementation digest, at settle 0.5 s. Public, non-speech and third-language material; the held-out set was not replayed. Load average median 2.5, maximum 6.2.

| Measure | Target | This run | Same day, before, settle 1.0 |
| --- | --- | --- | --- |
| Public error, Japanese | ≤ 6% | 5.62% | 5.83% |
| Public error, English | ≤ 8% | 4.47% | 4.79% |
| Public error over full clip, Japanese | ≤ 1.5 points | 0.50 | 0.72 |
| Public error over full clip, English | ≤ 1.5 points | 0.16 | 0.48 |
| Wrong-language share, Japanese and English | ≤ 2% | 0.00%; 0.00% | 1.09%; 0.00% |
| Non-speech rows | 0 | 0 | 1 |
| Stock or repetitive rows | 0 | 0 | 0 |
| Third-language rows, reported only | | 0 | 0 |

Every target measured on this material passes; the scorer reports INCOMPLETE because the held-out targets were not run. The non-speech row is gone, and the background-noise stream keeps no row. This is also the first Japanese gate material at settle 0.5: public error is no worse than at 1.0. One run each, and the earlier run began under a load average of about 4.5, so the differences in error are not evidence that 0.5 is better. The held-out differences, lock lag and first text at settle 0.5 with these rules are still unmeasured.

Run: `benchmarks/results/gate-ja-rolling-20261111T205145`.

## Not done for Spanish

- A held-out source with human references, its licence checked first. Without it the gate's main recognition targets and both timing targets are unmeasured.
  Two candidates, licences read from their public pages on 2026-11-11, neither downloaded: the Spanish part of Multilingual TEDx, https://www.openslr.org/100, CC BY-NC-ND 4.0, whole talks with transcripts in a 35 GB archive, the closest match to the Japanese held-out set and under the same terms as its talks, so audio and references would stay in the ignored cache; and VoxPopuli Spanish, https://huggingface.co/datasets/facebook/voxpopuli, CC0 annotations over European Parliament recordings, prepared speeches cut into short utterances, which suits lock lag and first text less. The choice is the maintainer's.
- A stock-phrase sweep for the Spanish list.
- French and Italian clips in the third-language set; Portuguese is the close neighbour to watch.
- Translation cases and required terms for `en-es`; the local translator has not been asked for Spanish.
- The app itself: `LANGUAGE_PAIR=en-es` now has both profiles, but the service has not been started or rehearsed with it, and the pages' wording for the pair is unchecked.
- Display pacing picks partial-row rates by script, which cannot separate English from Spanish.
