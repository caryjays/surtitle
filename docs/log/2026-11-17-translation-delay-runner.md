# A runner for gate part 6, and the layout preview in every pair

2026-11-17. Two changes: one command for the translation-delay runs every gate now needs, and a layout preview in the session's pair. No paid calls.

## `pnpm gate:delay`

Part 6, last word of a row to its first translated text, applies to every gate since [the decision of 2026-11-16](2026-11-16-translation-delay-gated.md). The command is `scripts/translation-delay.ts`. For each pair it chooses, it replays the pair's held-out talks in real time through `replay:contention --translate local` and writes one diagnostics file per pair. It then scores each talk from `diag:latency` against the part's targets: a median of 3.0 s or less and a p90 of 4.5 s or less. The run also does the following:

- It keeps the Mac from idle sleep with `caffeinate` while it runs.
- It records whether the Mac is on mains power and warns if not.
- It records the load average before and after each pair, plus the commit and whether the tree had uncommitted changes, in `run.json`.

It writes to the ignored `benchmarks/results/delay-<stamp>/`, timings and counts only, and resolves recordings from the tracked held-out manifests without reading the cache's.

The talks were chosen before any part 6 run outside Japanese, and are recorded in [gates](../wiki/gates.md#6-translation-delay-offline-profile):

- The first two English excerpts in every pair.
- Every excerpt of the pair language.
- For Japanese, the two talks of the rounds of [2026-11-11](2026-11-11-translation-latency.md), so the owed repeat compares with them.

That makes 4 talks for Japanese and 8 for each other pair, about 3 hours and 10 minutes in real time for all five.

A smoke run, `pnpm gate:delay --gates es --talks 1`, on an uncommitted tree, on mains power, with load average 1.9 before and 1.7 after: both talks pass, with 53 and 57 rows translated. English to Spanish has a median of 2.1 s and a p90 of 3.9 s; Spanish to English has a median of 1.9 s and a p90 of 3.0 s. A smoke run is never a gate result. `--score` on the run folder reproduces the same figures, and they match `diag:latency`'s own output.

## Layout preview

The control page's fictional preview of a long conversation was English and Japanese in every pair. Its conversation is now in the session's pair: the same eight turns, written in Spanish, French, Italian and Portuguese, with the English side naming the language and a search word in it. A pair without its own falls back to English and Japanese, and the notice names the pair shown. Tests cover each profiled pair. The browser smoke, `pnpm test:browser`, passes.

## Next

The full run, on an idle Mac on mains power, overnight:

```sh
pnpm gate:delay
```
