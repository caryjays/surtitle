# Held-out gate targets measured against the model's own decode

2026-11-10. The maintainer's decision on the question the [held-out gate](2026-11-06-held-out-gate.md) left open.

## Decision

The held-out targets of 2026-10-28 were absolute: live error at most 5.0% CER in Japanese and 4.0% WER in English, with deletions at most 2.0% and 1.0%. On the public held-out set, a one-pass decode of each excerpt with the live model scores 12.40% and 11.38%, about three times those limits, so no change to the live path could pass them.

The held-out targets are now differences from that one-pass decode, on the excerpts both decoded, in each language:
- live error at most 1.5 points over the one-pass decode, the same margin the public set allows over its full-clip decode
- live deletions at most 1.0 point over it

The deletion margin is a new number, tighter than the error margin, because speech lost at row and window boundaries is the failure the live path adds. The absolute held-out rates are still printed by `gate:score`, as information.

## What changed

- `scripts/local/gate.py` scores `heldoutOverOffline` and `heldoutDeletionsOverOffline`; without the run's `offline.json` both are not measured. `heldoutErrorRate` and `heldoutDeletionRate` move to the information lines.
- `benchmarks/gate-ja.json` and the accuracy table in [gates](../wiki/gates.md) carry the new targets; the unit test that keeps them equal passes.

## Scorer check

The 2026-11-06 rolling run was rescored to check the new code, not as a gate result: the targets apply from the next run. Its `score.json` was restored afterwards. Live over one-pass error: Japanese 2.28 points, English 0.28, matching that entry's 2.27 and 0.28 within rounding. Live over one-pass deletions: Japanese 2.82 points, English −0.14. Under the new targets that run would pass English accuracy and fail Japanese on both differences, which the 2026-11-06 entry traced mostly to one talk.

## Next

- Rerun the gate with the held-out set in both segmentation modes, rolling and turns, on the Air. The turns run also supplies the controlled comparison for the rolling default.
- The held-out row rating still needs the maintainer.
