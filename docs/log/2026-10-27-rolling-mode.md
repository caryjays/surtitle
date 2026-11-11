# 2026-10-27: rolling mode in the local adapter, rolling step 2

Step 2 of the [rolling recognition design](2026-10-26-rolling-recognition-design.md). Behind `LOCAL_SEGMENTATION=rolling`; the default stays `turns`, so live behavior is unchanged.

## Changes

- `packages/providers/rolling.ts`: pure rules: agreed prefix, which segments lock, row text joining, sentence ends, and the stock sign-off list mirrored from the Python filter. Constants match the simulation: 1 s cadence and settle, forced lock at 25 s, 29 s request cap, 3 s noise trim, rows closing at 3 s with sentence punctuation or 8 s.
- `packages/providers/local.ts`: in rolling mode the detector runs without a maximum duration. Each open stretch keeps only unlocked audio and is decoded after each further second, one decode in flight. Locks append to the current row and trim the audio. A decode still in flight when the stretch closes is ignored, and a closing decode locks everything left.
- The overlay sees locked text only: partial events carry the row's locked text and a row's begin waits for its first lock. The provisional tail and the `stable` protocol field are step 4.
- `packages/protocol/diagnostics.ts`: boundary `length`, and `decodes`, `forcedLocks`, `firstTextMs`, `lockLagMs` per row.
- `apps/service/main.ts` and `.env.example`: `LOCAL_SEGMENTATION`. Previews are off in rolling mode.

## Not built yet

- Merging a short row closed by a pause into the next. It needs a held row that finalizes after a quiet timeout; deferred until replay shows how often tiny rows occur.
- Recalibration and flush share the direction-change close path but have no rolling-specific test.

## Verified

- `tests/rolling.test.ts`, 11 tests against a fake worker whose words are keyed to absolute audio position:
  - agreement and lock
  - locked text never retracts
  - a `length` row at 8 s and a final lock at stretch end
  - forced lock at 25 s with no request over 26 s
  - noise trimming with no request over 4 s
  - a reply in flight at stretch close ignored
  - direction change keeps the old language
  - close drops in-flight work
  - one decode in flight, asserted on every request
  - through the controller, open rows showing only locked text and one translation per row at final, with no `truncated` flag
- `pnpm check`: 119 tests, docs check clean. `pnpm test:local-unit`: 30 tests.
- Not run against the real model through this code path yet.

## Next

Step 3: `scripts/replay-cases.ts --segmentation rolling` on the held-out recordings, which must match the simulation: Japanese CER at or below 5%, display lag p90 at or below 2 s, no forced locks.
