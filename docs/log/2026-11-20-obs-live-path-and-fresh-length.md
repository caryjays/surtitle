# OBS on the live path; closing long rows on one decode

2026-11-20, after [the probe run](2026-11-19-translation-delay-host-probe-run.md). No paid calls. Timings, counts and shares only.

## The live path without a microphone

`pnpm replay:live` plays recordings as Chrome's microphone into a running service. The audio goes through the control page's capture, the WebSocket and the service with its host probe, as in a rehearsal, which `replay:contention` skips. It turns on diagnostics, starts once, and saves the diagnostics file. The page keeps only its latest 5,000 events, so the script saves a part every 5 min and merges the parts. Chrome's capture processing brings the level in about four times higher than in the replays (row RMS median 0.068 against 0.015), so recognition input differs from `replay:contention`.

Each run is the French gate's 8 talks back to back, 42 min in one Start, against `LANGUAGE_PAIR=en-fr pnpm dev:offline`, on the Air on mains power. The same audio plays in every run, so a minute of one run compares with the same minute of another. Request time rises to about 2 s around minutes 5 to 9 in every run, which comes from the talk content. The Mac read thermal fair in all runs after its first minutes.

| Run | OBS | Display | Last word to first translated text, median / p90 | Per-minute median request |
| --- | --- | --- | --- | --- |
| A | not running | on for most of it | 2.4 / 3.6 s | 0.7 to 2.1 s |
| B | launched 1 min before Start | on for the first 6.5 min, with input on the Mac, then asleep | 2.3 / 3.7 s | 3.4, 4.8, 1.8, 4.9, 2.9, 3.1 s in minutes 2 to 7; then as A |
| C | open in the background | asleep throughout | 2.3 / 3.3 s | as A, a few tenths higher in minutes 2 to 7 |
| D | brought to the front each minute | asleep until minute 35, then on | 2.3 / 3.6 s | as C |
| E | open, brought to the front each minute | kept on with `caffeinate -u -d`, nobody at the Mac | 2.6 / 3.6 s | 0.7 to 2.2 s, as A |

GPU busy share by group:

- With the display asleep, OBS used about 16% and the display server 0%.
- In run E, lit and untouched, OBS used 16 to 20% and the display server 5 to 6%.
- In run B's slow minutes, OBS used 26 to 29% and the display server 6 to 9%.

What this shows:

- OBS showing its preview on a lit screen, left alone, does not slow translation.
- The one step came while OBS had just been launched and someone was probably using the Mac. That matches the rehearsal, where the step began when the maintainer opened the OBS window.
- Two causes remain, and these runs cannot tell them apart: OBS starting up, which loads its scene and the overlay's browser source, and working in the OBS window.
- Thermal state does not explain it: fair before, during and after the step.

## Closing a long row on one decode's text

At present a row that reaches its length limit (`maxMs`, live 8 s) closes only after its text locks. Locking needs two decodes in a row to agree, so the row closes one decode later than it could. The new option `freshLengthClose`, flag `--fresh-length` on `replay:contention` and `gate:delay`, is off by default. When the settled segments of a single decode would take the row to its limit, it locks them and closes the row on them. Fake-worker tests cover the close with and without the option.

`pnpm gate:delay --gates it`, live and then with the option, back to back:

| Talk | Live, median / p90 | `--fresh-length`, median / p90 |
| --- | --- | --- |
| held-en-4320211 | 2.1 / 4.0 s | 2.0 / 2.9 s |
| held-en-4346818 | 2.7 / 4.2 s | 1.9 / 3.1 s |
| held-it-7TqiEZn5uBE | 3.4 / 4.3 s, fails | 2.6 / 4.8 s, fails |
| held-it-AILi62xo7j8 | 2.6 / 4.2 s | 2.3 / 3.0 s |
| held-it-RjY6MZUGiHQ | 2.3 / 3.4 s | 2.1 / 2.8 s |
| held-it-TpJ2LjF16s8 | 2.0 / 3.1 s | 2.0 / 3.0 s |
| held-it-bInuBKb-mN0 | 2.1 / 3.5 s | 2.3 / 3.1 s |
| held-it-pRLMJnMo3zI | 2.0 / 3.2 s | 1.8 / 3.2 s |

- With the option, p90 is lower on 6 of 8 talks, by up to 1.2 s.
- The talk that fails part 6 fails in both runs: on its median live, on its p90 with the option.

This does not yet show a gain. A talk's p90 moves by about 1 s between replays of the same code, and the option always ran second. Its risk is text at row ends: a row can close on words no second decode confirmed, and those words reach the translation and later rows' context. Not done: a repeat in the other order, and a scored read of row ends with `--review`. Live stays as it was.

## Next

1. Launch OBS mid-run with nobody at the Mac, to tell OBS starting up from working in its window. Meanwhile, in a rehearsal, open and arrange OBS before Start and leave it alone during the talk.
2. Repeat the `--fresh-length` comparison with the option first, and score row ends.
