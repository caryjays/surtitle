# A confident first lock after a noise trim: non-speech rows removed

2026-11-04. The three non-speech rows left by [settle at lock](2026-11-04-settle-at-lock.md) came from a lottery: a stretch held open by music or noise ran hundreds of decodes, and two hallucinated decodes eventually agreed. In `0ef69bb` the first lock after a noise trim needs a confident decode. The real-time rolling gate now passes every part it measures on public and non-speech material.

## Cause

The three rows, "Period." and "Peace." on music and "Oh my god." on noise, locked after 212, 243 and 32 decodes of their rows, 50, 66 and 32 s after the row began; public speech rows took at most 16 decodes. Re-decoding windows around each lock showed Whisper returning a stream of short phrases on music ("Thank you.", "Bye.", "you", "好", "Period.") with segment log probabilities of −0.6 to −1.6 and no-speech probability 0.00 throughout, so the no-speech rule cannot catch them. Whichever pass the −1.0 floor are agreement candidates, and over enough decodes two consecutive ones match.

## Rule

After a noise trim, the row's next lock, including the closing decode's, needs a decode whose lowest segment log probability is at least −0.5 (`ROLLING.noiseConfirmLogprob`). A less confident decode locks nothing; mid-stretch that only delays text, since the window keeps growing, while a closing decode leaves the row's remaining text out. A lock clears the condition.

## Offline check

`pnpm gate:language-sim --rules auto-lock --keep-agreed --noise-confirm=-0.5`. New stress streams put the 8 tuning and 8 noisy-set clips, none of them gate material, behind 8 s of the gate's music or noise at full level, or with it at −12 dB before and under the speech.

- Every real-speech lock that followed a trim, 32 on the stress streams and 3 on public Japanese, was at −0.43 or better, mostly −0.1 to −0.3. The worst was English under music.
- The only blocked locks were "Oh my god." on noise, at −0.68 to −0.75.
- Public, stress and third-language scores were unchanged; music and noise rows went to none. At −0.7 the noise row survived.

The margin to real speech, 0.07 on English under music, is narrow, and faint far-field speech was not in this material.

## Gate

`pnpm gate:run --segmentation rolling` at `0ef69bb`, clean tree. Load average median 1.9, maximum 2.3.

| Measure | `4ed733a` | `0ef69bb` | Target |
| --- | --- | --- | --- |
| Public Japanese error | 5.69% | 5.73% | ≤ 6.0% |
| Japanese live minus full-clip | 0.58 pts | 0.61 pts | ≤ 1.5 |
| Japanese errors, deletions | 158, 37 | 159, 37 | |
| Public English error | 4.63% | 4.47% | ≤ 8.0% |
| English live minus full-clip | 0.32 pts | 0.16 pts | ≤ 1.5 |
| English errors, deletions | 58, 12 | 56, 12 | |
| Wrong-language share | 0.00% | 0.00% | ≤ 2% |
| Non-speech rows | 3 | 0 | 0 |
| Stock or repetitive rows | 0 | 0 | 0 |
| Third-language rows | 44 | 44 | not gated |

The scorer reports INCOMPLETE: every measured recognition target passes, and the held-out targets, including lock lag and time to first text, are not measured because the held-out set does not exist yet.

## Open

- The held-out set, at least 20 minutes per language of new speech with hand-corrected references, needs the maintainer.
- The turns segmentation was not rerun. The gate applies to whichever mode becomes the default, so making rolling the default is now a decision to take with the held-out results.
- Third-language rows still display.
- Faint and far-field speech after noise, against the −0.5 confirm threshold, needs a room recording.
