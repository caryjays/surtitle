# 2026-10-27: worker segment ends, rolling step 1

Step 1 of the [rolling recognition design](2026-10-26-rolling-recognition-design.md). No live behavior changes: nothing reads the new field yet, and segmentation is still energy turns with the 12 s cap.

## Changes

- The worker's `final` reply carries `segments: [{ endMs, text }]` for the segments that passed the decoder filters. `scripts/local/quality.py` has `accepted_segments`, which `accepted_result` now wraps unchanged, and `segment_ends`, which clamps ends to the audio length and stops the list at a missing, non-finite, negative or decreasing end, at 64 entries or past 4,000 characters.
- The request line limit rises from 900,000 to 2,000,000 bytes. A 30 s request, the engine's audio limit, is about 1.92 MB.
- `packages/providers/local.ts` accepts the optional field in its strict reply schema. A malformed list fails capture closed, like any other protocol error.

## Verified

- `pnpm test:local-unit`: 30 tests, including segment bounds and a 30 s frame accepted with a 2 MB frame refused.
- `pnpm check`: 108 tests, docs check clean. The fake worker now returns segments on its normal path and a bad list on a new failure case.
- Real worker, Turbo Q4, public FLEURS fixtures joined into 25 s requests of 1.6 MB: English returned 3 segments, Japanese 4. Ends were ordered, the last clamped to 25,000 ms, and the joined segment text matched `text` in both. Decode took 0.75 s and 1.16 s with language detection.

## Next

Step 2: `LocalTranscriber` rolling mode behind `LOCAL_SEGMENTATION=rolling`, with fake-worker tests.
