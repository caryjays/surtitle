# Timing of first shown text in gate runs

2026-11-15. The gate's first-text and lock-lag targets measure locked text, but by default the overlay shows text that three decodes agree on before it locks. Gate runs now record when each row first had text to show and report its p90. The figure is reported, not gated. No paid calls.

## What is recorded

Each rolling row's measurement gains `firstShownMs`: the time from the row's creation to its first agreed or locked text. Agreed text that a row later withdraws still counts, because the display showed it. A row that never had agreed text before it locked gets its first-text time. `gate:score` reports `firstShownP90Ms` per language over held-out rows as an info line, next to the gated `firstTextP90Ms`. Runs from before this change don't have the field, and the line is left out for them. `pnpm diag:latency` reads the same field from session diagnostics.

Lock lag has no shown-text counterpart. A segment's last words have usually locked by the time three decodes agree on them, so agreed text adds little or nothing at the end of a segment. It helps only at the start of a row.

## Check

Tests cover three cases: no row's first shown text is later than its first text, a long rolling row shows text before it locks, and on a low-confidence opening the two times are equal. `pnpm check` passes.

A smoke run of the Japanese gate in rolling (`--smoke`, uncommitted code, load average about 2.5) replays three public clips per stream and every held-out talk in full. Scored on held-out rows:

| Language | First text p90, locked | First shown p90 |
| --- | --- | --- |
| Japanese | 8.70 s | 7.20 s |
| English | 11.89 s | 7.47 s |

A smoke run is not a gate result. The run shows the pipeline records and scores the field. Both shown figures fall under the 8 s target, but this has to be confirmed by a full run on a committed tree.

## Open

Whether the first-text target should measure shown text is the maintainer's decision. It would be dated, made before the run it applies to and recorded in [decisions](../wiki/decisions.md). See [status](../wiki/status.md).
