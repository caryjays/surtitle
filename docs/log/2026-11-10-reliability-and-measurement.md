# Reliability and measurement work from the state review

2026-11-10. The parts of the [state review](2026-11-10-state-review.md)'s recommendations that needed no decision from the maintainer, after the [rolling lifecycle fixes](2026-11-10-rolling-lifecycle-fixes.md). No recognition setting, row rule, cadence, pacing rate or translation default changed.

## Recalibration keeps reading history

`Controller.calibrate()` no longer clears the screen. Finalized rows stay. Open rows are removed with their traces. Queued and running translations are cancelled; their rows keep the original with state `skipped` and any streamed partial translation is withdrawn. Rows finalized before the recalibration are no longer translation context, in row and in piece translation. The translation epoch changes; the display generation does not, so clients keep what they have released.

The operator text, the `skipped` label and the wiki say so. Tests: the controller and server recalibration tests were rewritten for the new behaviour, and the browser smoke checks that finalized rows survive the button.

## Capture diagnostics

- Each turn trace carries `inputRms` and `inputPeak`: the level of the turn's captured PCM as a share of full scale, measured in the adapter before the worker. In rolling mode a row's level covers the audio heard while it was the open row, so audio decoded into the next row after a length close is counted with the earlier one.
- A `capture` diagnostics event records what the browser applied to the microphone track: echo cancellation, noise suppression, automatic gain, sample rate and channel count, from an allowlist that excludes the device label and IDs. The console's input line shows the same after Start.

These are the evidence the two group-speech hypotheses in [status](../wiki/status.md) were waiting for. Nothing about the gate or capture request changed.

## Display pacing in the latency report

The delay a reader experiences ends when the pacer releases the translation, which no trace covered. The console's audience preview paces as an overlay does, so the diagnostics log now records a `display` event when that preview first releases a row's original or translation and when it finishes releasing each. `pnpm diag:latency` adds, when a file holds them:

- final text to original fully released, first translated text to its first release, and translation ready to fully released;
- speech to displayed translation: a row's last word to the translation fully released, its middle to the midpoint of the release, and its first word to the first released text.

That puts row length, lock lag, translation and pacing in one figure per row. It was checked on a synthetic file and the events on the browser smoke's download. It has not been read from a real session; the next rehearsal with diagnostics on gives the first numbers. An OBS overlay runs its own pacer on its own clock, so the preview's times stand in for it.

## Gate runs record what they ran against

`gate:run` writes into `run.json` the whole gate file, its digest, and a digest of every commit-eligible file under `apps`, `packages`, `scripts`, `profiles` and `benchmarks` plus the package files, as on disk at the start, and whether that changed by the end. `gate:score` still scores with the current gate file, since targets change by dated decision, and takes `--targets run` to score against the recorded one. It reports when the gate file or the implementation differs from the run's and writes what it scored with to `score.json`. Checked on a copy of an earlier run: it scores as before, refuses `--targets run` for a run with no record, and with a planted record reports both differences and applies the recorded target.

## Documentation reconciled

Status no longer says the directory and remote carry the old name or that the history is a single commit, and no longer says every third-language clip displays a row. Architecture's automatic gain default was corrected in the previous entry.

## Verification

| Check | Result |
| --- | --- |
| `pnpm check` | passed: typecheck, 166 TypeScript tests, documentation check, build |
| `pnpm test:local-unit` | 55 Python tests passed |
| `pnpm test:browser` | passed, with new assertions for the applied settings, the `capture` and `display` events and rows surviving recalibration |
| `pnpm test:rolling-browser` | passed with the real Turbo Q4 recognizer and a fake translator |

One timing assertion in `tests/pieces.test.ts` required a wall-clock queue time of exactly 0 ms and failed intermittently while the machine was busy with unrelated work; it now checks only that the time is recorded. No paid call, microphone, OBS or gate run was used. A real-time gate run was not started because the machine was under heavy load, which the gate rules exclude.

## Left for the maintainer

- Automatic worker restart and dropping the oldest queued final: both change the failure policy that capture never restarts on its own.
- The Japanese evidence: the real-time gate in both segmentation modes with the held-out set, the held-out row ratings, an English rehearsal, one with glossary terms, and OBS.
- Lock lag and pacing rates: the measurement is ready; any change waits for a controlled comparison.
