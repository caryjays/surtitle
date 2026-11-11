# Project state review

2026-11-10. Review of the working tree, including existing uncommitted language-gate and rolling changes. Application code and live defaults were left unchanged. This entry and the status handoff record the findings; recommendations are not adopted decisions.

## Verification

| Check | Observed result |
| --- | --- |
| `pnpm check` | Typecheck and all 160 TypeScript tests passed; documentation check failed because `security-privacy.md` is verified before the working-tree change to `packages/providers/local.ts`; its build stage was not reached |
| `pnpm test:local-unit` | All 53 Python tests passed |
| `pnpm test:browser` | Build and synthetic browser smoke passed, including overlay reload, console settings, clear, pause and denied microphone |
| Credential exclusion, metadata only | `.env` is ignored and not tracked |
| Synthetic adapter/controller probes | Both lifecycle defects below reproduced |

The initial TypeScript commands could not create the test runner's IPC socket inside the sandbox; they were rerun with the required execution permission. All recognition and translation in these checks used fakes. No paid providers, physical microphone, OBS rehearsal, real-model gate or audience recording was used. Credential files and the local cache were not read into the review.

## Reproduced lifecycle defects

### Recalibration can admit old rolling speech

Start a controller with rolling segmentation, calibrated gating and the existing fake rolling worker. Feed the quiet calibration, then one second of synthetic voiced frames, and recalibrate before any text locks. The controller clears its rows immediately, but the closing worker reply subsequently creates one row and schedules one translation from the old audio.

`Controller.calibrate()` invalidates the controller epoch without invalidating the recognizer's pending rows. `TurnDetector.calibrate()` finishes the old stretch. Unlike turns mode, rolling delays its begin event until text locks or the row closes, so `LocalTranscriber.closeRow()` can introduce the old row after invalidation. The existing fake-controller calibration test does not exercise that late begin.

Recommendation: invalidate pending recognition work across recalibration while retaining the loaded model, and cover recalibration before and after the first rolling begin with adapter/controller tests. Preserving finalized reading history is a separate existing usability request.

### Direction changes can relabel an old rolling row

Start rolling in `ja-en`, feed one second of synthetic voiced frames, then switch to `en-ja` before the first lock. The old row's recognition source remains Japanese, but the translation request carries `en-ja`. A fake Japanese-to-English response consequently fails direction validation.

The row stores its recognition language, but its delayed begin event uses mutable `this.options.mode`. `setMode()` queues the closing decode and changes that mode before the reply arrives. Recommendation: freeze the row's mode when the row is created and use it for every begin event. Test a switch before the first lock through the controller, including the translation input; the current rolling direction test checks final languages after text has already locked.

## Assessment and recommendations

- The architecture has useful boundaries: capture independent of the overlay, loopback origin enforcement, bounded work, validated worker messages, and original text retained when translation fails. Coverage is substantial but needs the adapter/controller transition cases above.
- Keep local recognition and the current live defaults. Whole-row translation remains the supported choice: the piece-quality comparison found worse joins and meaning changes, while the text-last prompt improved padding without changing the translation unit.
- Treat speech-to-readable-translation latency as the outcome. The offline rehearsal shows row duration materially changes the wait even when the translation queue is empty. Compare lock lag and pacing with fixed input and controlled machine load, respecting the existing pause on recognition tuning.
- Close the Japanese release evidence before expanding the supported language list: both segmentation modes on the declared gate, held-out human ratings, translation quality including numbers, negation and names, and the field/OBS rehearsal. Relative-to-offline accuracy isolates live-path loss but does not alone establish caption usefulness.
- Add capture settings and level diagnostics before changing faint-speech gates. Recoverable inference failures and history loss on recalibration remain practical reliability work.
- Reconcile the handoff documentation. The architecture still describes automatic gain as off by default even though the console and browser test default it on. Status retains obsolete verification and housekeeping claims, and descriptions of off-pair rejection lag the working tree. Freshness dates cannot detect semantic contradictions by themselves.
- Snapshot gate inputs and targets with each run. The scorer currently loads the gate definition from the current tree; a commit identifier plus a dirty flag does not uniquely identify an uncommitted implementation or changed acceptance targets.

## Handoff

No functional fixes were made. Add regression coverage and fix the two lifecycle defects, reconcile the affected wiki pages, then run `pnpm check`, `pnpm test:local-unit` and `pnpm test:browser`. Real-model and OBS results remain separate from these synthetic checks. The documentation freshness failure above is left visible rather than advancing a date as part of a code review.
