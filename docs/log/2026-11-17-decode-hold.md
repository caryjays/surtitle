# Holding rolling decodes for the translator

2026-11-17. A replay-only experiment from [the breakdown](2026-11-17-translation-delay-breakdown.md): rolling decodes due on the 1 s interval wait while a translation waits for its first text, for at most 1.5 s. The decode at the pause mark and closing decodes never wait, and no audio is dropped. No paid calls.

`pnpm replay:contention --hold <ms>` sets it; `pnpm gate:delay --hold <ms>` passes it on. Live is unchanged.

## Run

The French pair, four talks: two English, two French. Each talk was replayed four times back to back, off, hold, hold, off, with no pause between replays, for 1 hour 32 minutes of sustained load. The run used commit 20282e7 plus the uncommitted change. Load average at the start of each replay was 1.6 to 4.7, except 8.7 before the first replay of `held-fr-0u7tTptBo9I`: other work on the Mac, not controlled. The holds added up to 15 to 25 s per replay, over 41 to 70 translations.

Medians in seconds, off replays then hold replays:

| Talk | Last word to first translated text | Translator's first text | Speech end to final text |
| --- | --- | --- | --- |
| held-en-4320211 | 2.7, 4.2 · 3.0, 3.0 | 1.0, 1.8 · 1.0, 1.0 | 1.7, 2.3 · 2.0, 1.9 |
| held-en-4346818 | 3.5, 4.9 · 3.7, 4.0 | 1.1, 2.1 · 1.1, 1.2 | 2.0, 3.0 · 2.4, 2.7 |
| held-fr-0u7tTptBo9I | 5.1 (load 8.7), 3.6 · 3.1, 2.8 | 2.1, 1.6 · 1.0, 0.9 | 3.0, 2.0 · 2.0, 1.8 |
| held-fr-16MWHwqz0mQ | 3.2, 3.5 · 3.9, 3.9 | 1.2, 1.4 · 1.2, 1.1 | 1.9, 2.0 · 2.7, 2.8 |

Rows translated per replay were within the spread of the off replays, and none were lost.

- The translator's first text came faster with the hold, by about 0.3 s on average, and its p90 dropped in most replays.
- Rows took longer to close in two of the four talks. A held decode locks nothing, so the closing decode has more audio left to transcribe: its inference rose from 1.1 s to 1.3 or 1.4 s in `held-fr-16MWHwqz0mQ`.
- Net, the median of last word to first translated text fell by 0.2 s on average leaving out the replay at load 8.7, or 0.4 s counting it. That is smaller than the 1 s spread between two replays of one talk. One talk was slower with the hold.

## Verdict

No clear gain. The hold moves part of the time from the translator to the row's close, as expected of two stages sharing one GPU. Not adopted; the flag stays replay-only.

## Next

A lever that takes no time from recognition: the translator spends its first generated tokens on the reply's opening, `{"source":…,"target":…,"text":"`, before any translated text. When the recognizer has set the direction, that opening is known, and it could be given to the model as the start of its reply instead of being generated. Measure it the same way, off and on in alternation under sustained load.
