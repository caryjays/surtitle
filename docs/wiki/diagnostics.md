# Content-free diagnostics

Verified: 2026-10-26 · Sources: apps/web/diagnostics.ts, packages/protocol/diagnostics.ts, apps/service/controller.ts, packages/providers/local.ts

Diagnostics answer what the pipeline did with each turn without storing what anyone said. The service keeps up to 60 recent turn traces in memory; the browser records them only after the operator opts in.

## Collect

1. In `/control` expand Diagnostic log and click Start diagnostics. The status must say "turn details available"; if it says unavailable, the running service predates the browser bundle and needs a restart.
2. Under Text & spacing enable Show caption diagnostics to see sequence numbers, boundary labels and audio duration on each row.
3. Click Mark problem now when something goes wrong. The mark records the time and the sequence numbers visible on screen.
4. Download diagnostics JSON saves a file in the browser's download folder; nothing is uploaded or written otherwise. Stop keeps the buffer, Discard empties it. Reload or close loses an undownloaded buffer.

The buffer holds 5,000 events and reports how many older ones were dropped. Stable health values are sampled at most every 2 s; row metadata is deduplicated. Clear and New session reset service traces and leave the browser timeline alone.

## Events

| Event | Content |
| --- | --- |
| `health` | capture and processing mode, direction, error category, queue and running counts, rejected count, gate state, level and threshold |
| `segment` | sequence, final flag, state, caption source and target, character counts, script letter counts, translation request ms, time since first seen; `baseline` marks rows already present at opt-in |
| `segment-removed` | sequence plus the retained turn outcome, or `unknown` |
| `turn` | the service `TurnTrace`, re-emitted whenever it changes |
| `command`, `connection`, `started`, `stopped`, `mark` | operator actions and collection boundaries |

## Turn trace fields

| Group | Fields |
| --- | --- |
| identity | `sequence`; `mode` at turn start; `outcome` in `capturing`, `committed`, `rejected`, `empty`, `original`, `translating`, `ready`, `unresolved`, `failed`, `skipped`, `capture-failed` |
| boundary | `boundary` in `silence`, `max-duration`, `flush`, `mode-change`, `pause`, `recalibration`; `audioMs` including pre-roll and trailing quiet; `trailingQuietMs` |
| recognition | `recognitionQueueMs`; `recognitionInferenceMs` covering resample, gate, decode and filter; `commitToFinalMs`; `recognitionLanguage`, the decoder code; `recognitionSource` in EN, JA or unknown; `recognitionClipped`; `adapterRepetitionRejected`; `controllerRepetitionRejected`; `recognitionFailure` |
| quality | `speechGateRejected`, `decodedSegments`, `droppedSegments`, `noSpeechDrops`, `lowConfidenceDrops`, `repetitionDrops`, `invalidScoreDrops`, `noSpeechMax`, `logprobMin` |
| translation | `contextSequences`, `contextMissingTranslations`, `contextClippedRows`, `translationQueueMs`, `translationMs`, `translationResponse`, `outputTokenLimitReached`, `translationFailure`, `originalEndsInEllipsis`, `translationEndsInEllipsis` |

A missing field means unavailable, never zero.

## Reading a log

- `speechGateRejected` separates pre-Whisper rejection from decoded-but-dropped output in `lowConfidenceDrops` and `noSpeechDrops`. High gate rejection with a threshold stuck at the 0.004 floor points at input level or capture processing rather than the decoder.
- Short `audioMs` with `silence` boundaries means the energy gate is closing often; many `max-duration` boundaries mean continuous speech and long waits.
- All timings are process or worker clocks. None is human speech end to display. Browser `atMs` is observation time.
- Caption `source` and `target` can be revised by translation; `recognitionLanguage` is what the decoder saw.
- The log cannot say what was spoken, whether a rejection was correct, or how accurate a caption was.

## Excluded

Transcript text, audio, credentials, headers, device labels, URLs, model and backend strings, raw errors, provider or segment IDs and session UUIDs. Every field passes a strict Zod schema on both sides.
