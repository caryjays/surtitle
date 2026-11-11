# Offline rehearsal with the text-last prompt

2026-11-10. The maintainer's rehearsal of `pnpm dev:offline` with rolling recognition, Auto direction and the local `qwen3.5-4b-q4`. It ran after the [prompt order](2026-11-10-prompt-order.md) change. Input was a recorded Japanese video: one fast speaker using many technical and coding terms.

## Observed by the maintainer

- System CPU load stayed well under what was expected.
- One row failed to translate.
- Speed and quality were good overall, including on fast technical Japanese.

## Diagnostics

The downloaded file covers about 4 minutes, from when diagnostics were switched on mid-session, so it holds no Start command. Counts are from `pnpm diag:latency`, metadata only:
- 27 rows: 23 translated Japanese to English, 1 failed, 3 rejected by the speech gate.
- 19 of the 23 translated rows closed by length, a median 9.3 s of audio, so the speech was continuous.
- The failed row's reply came back after 1.8 s and was invalid. It was neither a timeout nor overload. The translation queue stayed empty throughout.

Medians in seconds, with p90 in parentheses:

| Stage | Rehearsal | Replay, Japanese 2 (long rows) |
| --- | --- | --- |
| Lock lag | 2.1 (2.6) | 2.0 to 2.2 |
| Speech end to final | 2.0 (2.5) | — |
| Translation request | 2.1 (2.9) | — |
| Request to first translated text | 1.2 (1.6) | 1.0 to 1.1 |
| Last word to first translated text | 3.2 (4.1) | 2.9 to 3.1 |
| Middle of a row to first translated text | 7.8 (9.8) | 7.4 to 7.5 |
| First word of a row to first translated text | 12.5 (15.8) | 11.9 to 12.2 |

The replay column is the long-row held-out talk in today's and the 2026-11-09 row runs. The rehearsal matches it within half a second at every stage. As there, a long row's length is most of the wait from its middle and its first word.

## Second session

The maintainer started again on the same video, with diagnostics on from the first Start. The file covers 156 s and 16 rows: all 16 translated Japanese to English, none failed. 13 rows closed at a pause and 3 by length. The speaker paused more in this stretch, so rows were shorter, a median 4.6 s of audio against 9.3 s before. The translation queue again stayed empty.

Medians in seconds, with p90 in parentheses:
- lock lag 1.9 (4.2);
- speech end to final 1.7 (2.4);
- translation request 1.5 (2.2), and 1.0 (1.3) to its first text;
- speech to first translated text: 2.7 (3.4) from a row's last word, 5.0 (8.8) from its middle, 7.2 (13.6) from its first word.

From the middle and the first word that is 2.8 and 5.3 s faster than the first session, because the rows were shorter; from the last word, 0.5 s faster.

The console text the maintainer shared shows the speaker's text. Only general observations are kept here:
- **Product and coined names were recognized inconsistently.** One product name appeared in three spellings across rows, one of which translated literally as an unrelated phrase. A coined acronym appeared in four.
- **One misheard word gave a nonsense phrase** in the translation.
- **The translations followed the recognized text faithfully.** The errors came from recognition, not translation.

The local recognizer gets no glossary: prompting was removed after the silence failure, per [recognition](../wiki/recognition.md). Names then depend on the recognizer alone. The translation glossary can't fix them, because it matches the recognized spelling.

## Change

`pnpm diag:latency` read only sessions that began with a Start command, so it printed nothing for this file. A file with no Start is now read as one session from its first event, with a notice that rows open when collection began are only partly measured.

## Open

- The live defaults stay as they are: whole-row translation, the row rules and the cadence.
- Next, per status: lock lag, then the pacing rates and the rolling default.
- An English rehearsal and one with the maintainer's own glossary terms have not been run.
- Names misrecognized in several spellings are a recognition problem; recognition tuning stays paused by the maintainer's decision of 2026-11-06.
