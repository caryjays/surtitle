# Recognition timing reported; translation delay gated in every gate

2026-11-15. A decision about the gates, made before any run it applies to. No measurements and no paid calls.

## The decision

The maintainer: the first transcribed text matters little; the first translated text is what matters. The audience reads the translation, which the overlay shows larger.

- Lock lag p90 and row start to first locked text p90 stop being targets in all five gates. `gate:score` still reports them, with first shown text, as info lines on held-out rows in rolling. They stay reported because with translation off, the default profile, the original is all a viewer reads.
- Part 6, the delay from a row's last word to its first translated text with the offline profile, now applies to every gate: Japanese, Spanish, French, Italian and Portuguese, each on its own held-out talks. Its targets are unchanged, a median of 3.0 s or less and a p90 of 4.5 s or less per talk, and it is the only target on how soon captions appear. Part 4's latency target bounds only the cloud translator's round trip.

The reason it's this measure: a row is translated only once it closes. A lock or early text doesn't bring the translation forward. What the audience waits on is the row's close plus the translator. Translating locked pieces before a row closes was tried and read worse on every talk ([piece quality](2026-11-10-piece-quality.md)).

## Effect on standing results

The decision applies to runs made after it. Runs made before it, including [the Japanese run of today](2026-11-15-japanese-gate-shown-text.md), keep their results under the targets they were run against, which `--targets run` scores with: in that run English fails lock lag and first text. Rescored with the current files, a run prints those two as info lines instead. The decision was not drawn from that run. The maintainer gave the reason, and it would hold whatever the run had measured. Even so, the gates' rule is that targets change before a run, so the run's verdict stands as it was.

Part 6 has been met once, for Japanese, on an idle machine; one clean repeat is owed. It has not been measured for Spanish, French, Italian or Portuguese.

## Changes

- `benchmarks/gate-*.json`: the `lockLagP90Ms` and `firstTextP90Ms` targets removed.
- `scripts/local/gate.py`: the two are printed as info lines, beside `firstShownP90Ms`, and saved under `info` in `score.json`. The closing note names translation delay as not scored here.
- [Gates](../wiki/gates.md), [roadmap](../wiki/roadmap.md), [status](../wiki/status.md) and [decisions](../wiki/decisions.md) updated.

```sh
pnpm replay:contention --pair <pair> --translate local --out <file> <held-out audio>...
pnpm diag:latency <file>
```
