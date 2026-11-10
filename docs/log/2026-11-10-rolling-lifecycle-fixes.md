# Rolling lifecycle fixes: recalibration and direction change

2026-11-10. Fixes for the two defects the [state review](2026-11-10-state-review.md) reproduced. No live default changed.

## What was wrong

Rolling rows send their begin event late, at their first locked text or when they close. Two operator actions could land between a row's audio and that event.

- Recalibrate cleared the controller's rows, but the adapter still closed the open stretch with one last decode. Its reply began a row from audio heard before the recalibration, and the controller translated it.
- A direction change closed the stretch in its old language, but the late begin read the adapter's current mode. The old row was sent for translation in the new direction and failed direction validation.

## What changed

- `packages/providers/local.ts`: a rolling row records its mode when it is created, and its begin event and its Auto language reset use that mode.
- `packages/providers/local.ts`: `calibrate()` drops the open turn or stretch, the queued decodes and the replaceable preview, and marks a decode in flight so its reply is read and ignored. The detector ends the turn without a commit. The worker and its model stay, and the inference deadline still covers the ignored decode. This applies in turns segmentation too, where the controller already ignored the late final; the decode is now skipped.
- `packages/providers/types.ts` states the contract for any transcriber with `calibrate`: no event for earlier audio may follow it.
- The `recalibration` boundary stays in the schema but the local adapter no longer reports it.

## Tests

Four tests in `tests/rolling.test.ts` run the real adapter, and for three of them the real controller, over the fake rolling worker:

- recalibrating before the first lock leaves no row, no trace, no rejection count and no translation request, and later speech is recognized from its own audio only;
- recalibrating a row that already shows locked text removes it and nothing brings it back;
- a direction change before the first lock sends the old speech with its own mode and source language, and the next row with the new one;
- at the adapter, the begin event carries the row's own mode and no event follows a recalibration.

With the two fixes temporarily removed, three of the four failed; the open-row case already held and is kept as a guard.

## Verification

| Check | Result |
| --- | --- |
| `pnpm check` | passed: typecheck, 164 TypeScript tests, documentation check, build |
| `pnpm test:local-unit` | 53 Python tests passed |
| `pnpm test:browser` | build and synthetic browser smoke passed, including recalibration |

All recognition and translation were fakes. Not run: the real-model browser smokes, real models, a physical microphone, OBS. The architecture page also said automatic gain is off by default; it is on, and the page now says so.

## Left undone

Recalibration still clears reading history; keeping finalized rows is open problem 3 in [status](../wiki/status.md). The other recommendations of the state review are unchanged.
