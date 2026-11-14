# Content-free diagnostics

Verified: 2026-11-14 · Sources: apps/web/diagnostics.ts, packages/protocol/diagnostics.ts, apps/service/controller.ts, packages/providers/local.ts

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
| `health` | capture and processing mode, language pair, direction, error category, queue and running counts, rejected count, gate state, level and threshold, and `masked` while the gate reports speech-like sound staying under it |
| `segment` | sequence, final flag, state, caption source and target, character counts, script letter counts, translation request ms, time since first seen; `baseline` marks rows already present at opt-in |
| `segment-removed` | sequence plus the retained turn outcome, or `unknown` |
| `turn` | the service `TurnTrace`, re-emitted whenever it changes |
| `capture` | at Start, or when collection starts during capture: what the browser applied to the microphone track, `echoCancellation`, `noiseSuppression`, `autoGainControl`, `sampleRate`, `channelCount`, each null when not reported |
| `display` | when the console's audience preview, paced as an overlay is, released a row: `sequence`, `stage` in `original-first`, `original-all`, `translation-first`, `translation-all`, and whether pacing was on. Rows on screen when collection starts are not reported |
| `command`, `connection`, `started`, `stopped`, `mark` | operator actions and collection boundaries |

## Turn trace fields

| Group | Fields |
| --- | --- |
| identity | `sequence`; `mode` at turn start; `outcome` in `capturing`, `committed`, `rejected`, `empty`, `original`, `translating`, `ready`, `unresolved`, `failed`, `skipped`, `capture-failed` |
| boundary | `boundary` in `silence`, `max-duration`, `length`, `flush`, `mode-change`, `pause`; the schema also accepts `recalibration`, which the local adapter no longer reports because a recalibrated turn is dropped; `audioMs` including pre-roll and trailing quiet; `trailingQuietMs`; `inputRms` and `inputPeak`, the level of the turn's captured audio as a share of full scale, before any worker processing; in rolling mode, of the audio heard while the row was the open one |
| rolling | `decodes` that fed the row; `forcedLocks` made without agreement; `firstTextMs` from row start to its first locked text; `lockLagMs`, the median from a locked segment's end to its lock; `speechEndToFinalMs`, from the end of the row's last speech to its final: the trailing quiet plus what is left of the closing decode, which may have been sent during the quiet, or the lag of the lock that closed it by length. In rolling mode, `audioMs` is the row's locked audio and quality counters sum over its decodes |
| piece translation | `pieces`, one entry per piece request, at most 32: `endMs`, the row's locked audio at the cut (the row's `audioMs` for the last piece); `lagMs`, from that audio's end to the request being ready (the last piece's `speechEndToFinalMs`); `queueMs`; `firstTranslationMs`, from sending to the first translated text shown; `translationMs`; and `outcome` |
| recognition | `recognitionQueueMs`; `recognitionInferenceMs` covering resample, gate, decode and filter; `commitToFinalMs`; `recognitionLanguage`, the decoder code; `recognitionSource`, a language of the pair or unknown; `recognitionClipped`; `adapterRepetitionRejected`; `controllerRepetitionRejected`; `recognitionFailure` |
| quality | `speechGateRejected`, `decodedSegments`, `droppedSegments`, `noSpeechDrops`, `lowConfidenceDrops`, `repetitionDrops`, `stockPhraseDrops`, `invalidScoreDrops`, `noSpeechMax`, `logprobMin`; in rolling Auto, `pairRetries`, decodes outside the pair that the worker's retry placed in the pair, and `otherLanguageDrops`, decodes outside the pair that locked nothing |
| translation | `contextSequences`, `contextMissingTranslations`, `contextClippedRows`, `translationQueueMs`, `translationMs`, `translationResponse`, `outputTokenLimitReached`, `translationFailure`, `originalEndsInEllipsis`, `translationEndsInEllipsis` |

A missing field means unavailable, never zero.

## Reading a log

- `speechGateRejected` separates pre-Whisper rejection from decoded-but-dropped output in `lowConfidenceDrops` and `noSpeechDrops`. High gate rejection with a threshold stuck at the 0.004 floor points at input level or capture processing rather than the decoder.
- Short `audioMs` with `silence` boundaries means the energy gate is closing often; many `max-duration` boundaries mean continuous speech and long waits. In rolling mode, `length` boundaries are the normal way continuous speech closes rows, and any `forcedLocks` mean decodes stopped agreeing.
- Turn timings are process or worker clocks; browser `atMs` is observation time. `display` events time the console's preview, not an OBS overlay, which paces by the same rules on its own clock. `pnpm diag:latency` joins them into speech to displayed translation; see [testing](testing.md).
- `inputRms` far below the gate threshold in `health`, or a `capture` event showing processing the operator did not expect, points at input level or browser processing before the recognizer.
- Caption `source` and `target` can be revised by translation; `recognitionLanguage` is what the decoder saw.
- The log cannot say what was spoken, whether a rejection was correct, or how accurate a caption was.

## Excluded

Transcript text, audio, credentials, headers, device labels and IDs, URLs, model and backend strings, raw errors, provider or segment IDs and session UUIDs. Every field passes a strict Zod schema on both sides.
