# First console rehearsal and where translation delay comes from

2026-11-06. The maintainer rehearsed the console in listen mode: local Turbo Q4 recognition with cloud text translation, on a microphone, first with conversational speech and then with harder natural voice samples, both in rolling segmentation switched on in the Session panel. Diagnostics were on, and the downloaded file is the source of every number here. A new command, `pnpm diag:latency <file>`, reads such a file and breaks each translated row's delay into stages.

## Observed

- The layout and the transcription quality felt good. Rolling felt better than turns on the same material.
- Audio stopped dropping out once Automatic mic gain was on. Before that, speech was being lost. It stays off by default; whether to change that is open.
- The delay from speech to its translation still felt long.

## Measured

Two Starts, 288 s and 317 s, both in Auto direction. The first was mostly short Japanese turns; the second was the natural samples, with longer rows. Medians, then p90, in seconds unless noted.

| Stage | First Start | Second Start |
| --- | --- | --- |
| Rows translated | 50 | 36 |
| Rows closed by silence / by length | 48 / 2 | 24 / 12 |
| Row audio | 2.6, 6.2 | 7.0, 11.0 |
| Original characters | 10, 46 | 33, 136 |
| Row start to first locked text | 3.0, 6.0 | 5.1, 8.3 |
| First shown text to final | 0.0, 0.6 | 0.0, 6.7 |
| Closing quiet | 0.7 | 0.7 |
| Closing decode, queue plus inference | 0.8, 1.2 | 0.7, 1.2 |
| Translation queue | 0.0 | 0.0 |
| Translation request | 2.2, 3.9 | 2.5, 5.3 |
| First shown text to translation | 2.5, 4.3 | 4.3, 9.7 |
| Row start to translation | 5.3, 9.7 | 9.9, 15.7 |

Display pacing comes after the last row and is not in the file. The translation of a row starts releasing as soon as it arrives and drains in about 4 s, so it adds little to a row's first words and up to about 4 s to its last.

## Where the time goes

A translation is requested only when its row closes. So a row's first words wait for the whole row to be spoken, then for the close, then for the request. In the second Start that is about 7 s of speech, 1.4 s to close and 2.5 s of request for the median row. The causes, largest first:

1. **Row length.** Translation waits for the row, and rows on natural speech run 7 to 11 s. The length closes happen at the 8 s locked-audio limit (`ROLLING.maxRowMs`), or at sentence punctuation after 3 s (`sentenceRowMs`), and Japanese output from Whisper often lacks the punctuation. Rows can pass 8 s because a late lock can add several seconds of audio at once.
2. **Early locks are rare.** For more than half the rows the first locked text arrived together with the final, so rolling showed nothing early for them, and the operator saw them no sooner than in turns. A segment locks only once it ends 1 s before the newest audio and two decodes agree, and on unpunctuated Japanese one segment often spans the whole stretch until the speaker pauses. When locks did happen, they lagged their audio by 1.9 s.
3. **The translation request.** 2.2 to 2.5 s median, with a tail to 5 to 7 s. The request is not streamed: the service waits for the complete JSON response. The queue never held anything, so concurrency is not the limit.
4. **The close.** 0.7 s of quiet ends a row at a pause, then the closing decode takes about 0.7 s, plus up to 0.6 s when it waits behind a rolling decode already in flight.
5. **Display pacing,** last and smallest for a row's first words.

## Options, not yet tried

- Translate earlier: close rows at clause punctuation (、 and commas) or at a shorter length limit, or request translations of a row's locked text as it grows and replace them as the row extends. This is the largest lever and costs more requests and less context for each one. It is a recognition and translation design change and needs a controlled comparison before the defaults change.
- Stream the translation response so its text arrives as it is generated. The schema puts `text` after `source` and `target`, so the text would stream. The saving depends on how much of the 2.3 s is time to the first token, which is not measured; finding out needs paid calls and authorization.
- Compare a faster translator on latency. The earlier eval found Haiku 5.5 level with Terra on speed; its tail on live rows is not measured.
- Shorten the closing quiet from 0.7 s, at the risk of more mid-sentence splits.

## Gaps in the telemetry

Rows closed by length report no closing decode timings and no recognition language, so the second Start has 12 rows without them. The file has no time of last speech, so speech-to-display latency is still inferred from row start and row audio, not measured.
