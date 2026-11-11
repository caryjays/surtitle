# 2026-10-26: held-out recordings, transcription plausibility

Backend: local Turbo Q4 only. No cloud calls: translation and the model judge were deliberately not run, so this entry measures transcription alone. Recording content stays in `private/`; this entry reports aggregates and error categories only.

## Material

Seven third-party public videos supplied by the maintainer as a held-out set, about 29 minutes: two English, five Japanese, all technical (3D tools, AI coding tools, animation principles, video production). No human reference transcripts exist. Each was decoded whole with `scripts/local/full_clip.py` and replayed in real time with `scripts/replay-cases.ts --calibrate` at the live 12 s cap, giving 144 live turns.

References are silver, not gold: the full-file decode with corrections the agent judged confident from context (product names, homophones, mis-heard loanwords), and uncertain names left as decoded. Scores against them understate the full decode's own error and are only for comparing live segmentation changes.

## Findings

| | Reference units | Live error | Of which deleted | Substituted | Inserted |
| --- | --- | --- | --- | --- | --- |
| English, WER | 1815 words | 4.8% | 2.9% | 1.1% | 0.8% |
| Japanese, CER | 7216 chars | 10.6% | 7.4% | 2.4% | 0.8% |

Against the same references the full-file decode scored 0.6% WER and 2.0% CER; those residuals are only the agent's corrections, so they are a floor, not a measurement.

Agent read-through of each live turn against the full decode and context:

| Rating | Turns |
| --- | --- |
| Plausible, no meaning-changing error | 77 |
| Minor: a term or homophone slip, or a few words lost, meaning intact | 52 |
| Major: a clause lost or its meaning changed | 12 |
| Hallucination: text not grounded in the audio | 3 |

- 129 of 144 turns ended at the 12 s cap. Deletion dominates live error, and 6 of the 12 major turns are words lost or invented at a cap boundary, once inverting a negation.
- All 3 hallucinations are a stock sign-off phrase ("thank you for watching", "good work") emitted for a 12 s window of ordinary Japanese speech; the real speech is in the full decode. The quality filter has no rule for this because the output is short, confident and not repetitive.
- One turn rejected by the quality filter and one over background music lost about 9 to 12 s each.
- 4 major turns are recognition errors that the full decode shares: one recurring Japanese term heard as three different homophones, and one verb. A vocabulary prompt would address only the product-name share of the minor slips.
- One recording produced no turns and no rejections when calibrated on its own quietest window: that window's level set the threshold above the speech level, and idle noise-floor following kept it there. It recovered fully when calibrated on silence. This failure is silent in the operator UI.
- Coverage of the full-decode text by live replay was 89 to 99% per recording when calibration worked.

## Next

1. Reject a short stock phrase that comes from a long turn, as a quality-filter rule with tests; a sign-off said at the real end of a talk is short audio and stays.
2. Controlled replay of pause-based cuts against the fixed cap on these seven recordings, scored with the silver references.
3. Surface a calibration that leaves the gate above the following speech, rather than failing silently.

## Stock-phrase rule

`scripts/local/quality.py` now rejects a turn of at least 6 s whose whole text is a stock sign-off, counted in the new `stockPhraseDrops` quality field. A real-time replay of the two affected recordings with the rule rejected all 3 hallucinated turns; every other turn's text was identical to the earlier replay. The lost speech is still lost: the rule turns a wrong caption into a visible rejection, it does not recover the window. `pnpm check` and `pnpm test:local-unit` pass.
