# Local translation and recognition on one GPU

2026-11-08. The [local translation](2026-11-06-local-translation.md) entry left open whether the translator, sharing the GPU with recognition, delays locked text in a live session. `pnpm replay:contention` answers it without a microphone: it replays recordings in real time through the live controller with rolling recognition, with the local translator or without it, and writes a diagnostics file in the console's format. `pnpm diag:latency` now also reports first lock, lock lag and closing decode time over every kept row, so a run without translation has numbers to compare.

## Run

Four public held-out talks, two English and two Japanese, about 23 minutes of continuous speech, replayed once with translation off and then once with `qwen3.5-4b-q4`, back to back on one Mac. The order was not alternated, so thermal drift is not separated from contention.

| Talk | Rows off / local | First locked text p50, off → local (s) | Lock lag p50, off → local (s) | Closing decode p90, off → local (s) | Translation request p50 / p90 (s) |
| --- | --- | --- | --- | --- | --- |
| English 1 | 52 / 49 | 5.1 → 5.8 | 2.2 → 2.5 | 0.7 → 0.9 | 2.2 / 2.9 |
| English 2 | 49 / 49 | 5.0 → 4.8 | 2.4 → 2.4 | 0.7 → 1.2 | 2.1 / 3.0 |
| Japanese 1 | 58 / 56 | 4.4 → 5.4 | 2.0 → 2.4 | 0.7 → 1.1 | 1.9 / 3.1 |
| Japanese 2 | 42 / 41 | 3.3 → 4.2 | 1.9 → 2.2 | 0.7 → 1.4 | 2.2 / 2.8 |

No row was forced to lock in either run. Row start to translation, p50 per talk, was 9.4, 7.8, 9.4 and 11.4 s.

## Findings

- Recognition pays a little: lock lag rises 0.2 to 0.4 s at the median on three talks, first locked text up to 1 s, and the closing decode's p90 roughly doubles. Rows shift slightly because locks land at different times.
- Translation pays more. A request that takes 1.2 s alone takes 1.9 to 2.2 s at the median during rolling recognition, which decodes every second. That is about the cloud's 2.2 to 2.5 s median from the listen rehearsal, with a shorter tail: p90 3.1 s at most here against 5.3 s there.
- Four of 56 rows in the first Japanese talk came back invalid, against none in the 72-request eval. The text was not inspected.
- Row length is still most of the delay: rows of 4.7 to 9.0 s audio at the median, with first lock and translation on top.

## Open

- Whether a smaller translator, such as Qwen3.5-2B, keeps quality and returns the time; whether holding translation generation while a recognition decode runs helps either side.
- The invalid Japanese replies: their cause, and whether a retry or a lower-temperature prompt change removes them.
- Shorter rows, the larger lever, change the live default and need a controlled comparison first.
- The maintainer's live rehearsal with `pnpm dev:offline` remains the check on real speech and a real microphone.
