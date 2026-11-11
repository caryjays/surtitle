# Rolling language choice: the cause of lost openings, a fix, and an offline simulator

2026-11-02. Rolling recognition's lost Japanese openings trace to how a row picks its language, not to its noise rule. A narrow fix is in. A new offline simulator compares broader rules on cached decodes, and none is ready to ship.

## Cause

Per-segment logging in a replay of the public Japanese stream logged every segment's confidence. Of 23 segments below the −1.0 log-probability floor, nearly all at clip openings were English, and one Chinese, decoded from Japanese speech. Example: "Cancel policy is a different way to do." for a clip that opens キャンセルポリシーは. Whisper's detection on a 1 to 3 s opening often picks English. The adapter fixed a row's language from its first decode even when that decode's text was all filtered. Every later decode of the row was then forced to English, translated at low confidence and filtered. Only the 3 s noise trim, which resets the language, let the row recover, after discarding the opening. This is also why holding such windows longer (see [rolling opening loss](2026-11-01-rolling-opening-loss.md)) lost whole sentences.

On the non-speech streams, rolling's stray rows ("Thank you.", "You") score above the floor, so lowering the floor would admit more of them while recovering little.

## Fix in the adapter

A row now takes its language only from a decode with accepted text (`packages/providers/local.ts`), with a fake-worker test that fails without it. On a replay of public Japanese clips 40 and 41, clip 40 went from 116 lost characters, in the 8 s hold variant, to none.

A full rolling gate run with the fix ran under heavy load from other work, load average median 8.5 and maximum 18.9, so it is not comparable. Its public Japanese error was 8.82% against 9.11% and the gap over full-clip 3.71 points against 4.00. English, non-speech rows and wrong-language share were unchanged. Clips 5, 24, 41 and 55 still lose openings of 9 to 17 characters.

On excerpts of those clips, under load average below 2, adding the 8 s hold on top of the fix lost more than the fix alone: 33 to 46 characters per clip against 3 to 17. In clip 24 it also produced a row repeating "I am a member of the team.", so the hold was dropped.

## Offline simulator

`pnpm gate:language-sim` (`scripts/local/language_sim.py`) replays the gate streams in virtual time with the live rolling locking, row closing and noise trim. Each clip is one stretch. Rules for a row with no language yet:

- `auto`: the live rule with the fix above.
- `pair-detect`: Whisper's detection restricted to the pair.
- `retry`: decode in the pair language detection prefers and, only if that is wholly filtered or in the wrong script, again in the other; the row's language settles when its first text locks.
- `candidates`: decode in both pair languages and keep the more confident passing text. A window whose detection puts more than half its probability outside the pair is rejected as a third language.

Decodes and detections are cached per window and language. The simulator does not model the speech detector's pauses, so its rates are not gate rates; the comparison between rules on the same windows is what it measures. Laptop, load average about 2.

| Stream | auto | pair-detect | retry | candidates |
| --- | --- | --- | --- | --- |
| Public Japanese error | 7.63% | 8.07% | 6.88% | 7.89% |
| Public Japanese deletions | 71 | 75 | 63 | 75 |
| Public English error | 4.31% | 4.31% | 6.63% | 10.14% |
| Public English deletions | 13 | 11 | 39 | 76 |
| Wrong-language rows, both public sets | 0 | 1 | 0 | 3 |
| Music rows | 2 | 1 | 1 | 0 |
| Background-noise rows | 1 | 1 | not run | 2 |
| Applause rows | 0 | 0 | not run | 0 |

What the runs show:

- On a 2 s opening of Japanese clip 5, detection gave English 0.47 and Japanese 0.03. Restricting detection to the pair therefore cannot fix openings; only decoding the other language can.
- `candidates` loses English openings. Early detection spreads probability across many languages, so the third-language rule rejects real English. Picking by confidence also let an opening decode as Japanese fix a row's language: "Northern Mariana's Emergency Management Officeご視聴ありがとうございました". On noise it produced the Japanese sign-off ご視聴ありがとうございました as a row.
- `retry` is best on Japanese, but loses English. Most of that loss is one clip, where only "accurately" survived from a sentence of about 20 words. The rest is spread over many clips and has not been examined.
- Third-language detection on short windows is not reliable enough to reject on. Rejection probably belongs at the row level, over more audio.

## Open

- Find why `retry` loses English, starting with gate-en-1678, then run it on background noise and applause.
- Try `retry` with the second decode only when detection's preferred pair language was below a margin, which bounds both the extra decodes and the English risk.
- Third-language rejection per row, and fixtures for it: FLEURS clips in a few other languages, with the expected outcome "rejected".
- Model the speech detector's pauses in the simulator, or replay the corpus through it, before trusting its rates.
- A clean real-time gate run of the adapter fix on a quiet laptop.
