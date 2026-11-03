# Settling a rolling row's language at lock: gated in real time

2026-11-04. The two adapter changes proposed in [language rules](2026-11-04-language-rules.md) shipped together in `4ed733a`: in Auto a rolling row settles its language when its first text locks, and a wholly filtered decode under 25 s, after a decode that returned text, is skipped instead of trimming. The real-time rolling gate confirms them. Japanese now passes both public accuracy targets; the gate still fails on non-speech rows.

## Change

`packages/providers/local.ts`. The closing decode still settles the language from accepted text, since it locks everything it returns. The 25 s bound exists because the live window is the first 29 s of unlocked audio: skipping without a bound would re-decode the same audio while new audio accumulated. The simulator got the same bound; its speech results were unchanged and music went from one row to none. Two fake-worker scenarios, `rolling-misheard-pass` and `rolling-loop`, fail on the previous adapter and pass with the change.

## Gate

`pnpm gate:run --segmentation rolling` at `4ed733a`, clean tree, started once the 5-minute load average fell below 2.5. Load average median 2.0, maximum 8.9 at one stream start, from another project's CI runner on the same laptop; the earlier run had median 2.1 and maximum 7.6.

| Measure | 11-04 before, `63bd0e6` | 11-04 after, `4ed733a` | Target |
| --- | --- | --- | --- |
| Public Japanese error | 8.21% | 5.69% | ≤ 6.0% |
| Japanese live minus full-clip | 3.10 pts | 0.58 pts | ≤ 1.5 |
| Japanese errors, deletions | 228, 109 | 158, 37 | |
| Public English error | 4.87% | 4.63% | ≤ 8.0% |
| English live minus full-clip | 0.56 pts | 0.32 pts | ≤ 1.5 |
| English errors, deletions | 61, 18 | 58, 12 | |
| Wrong-language share | 0.00% | 0.00% | ≤ 2% |
| Non-speech rows | 3 | 3 | 0 |
| Third-language rows | 44 | 44 | not gated |

The non-speech rows changed text but not count: "Period." and "Peace." on music and "Oh my god." on noise, against "Thank you." twice and "You" before. Third-language rows are unchanged, as expected; nothing rejects them yet.

The improvement is larger than the simulator's, 7.63% to 6.55% offline for the same rule. The simulator does not model speech-detector pauses, so its absolute rates differ; the direction agreed.

## Open

- Non-speech rows: short English words on music and noise. A whole-row check on short rolling rows, measured against the public sets, is the next candidate.
- Third-language rejection live, given that rolling text displays before the row closes.
- The turns segmentation was not rerun; the change affects rolling only.
- The held-out set, timing targets and translation parts of the gate are unmeasured.
