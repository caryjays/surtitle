# A Japanese gate run with first shown text

2026-11-15. One full run of the Japanese gate in rolling on commit `861d812`, a clean tree, the first full run to record first shown text ([how it is measured](2026-11-15-shown-text-timing.md)). Run `gate-ja-rolling-20261115T150159`, 15:01 to 17:19, with the Mac in ordinary desktop use, load average 2.5 at the start and 1.8 at the end. No paid calls.

| Measure | Japanese | English |
| --- | --- | --- |
| Held-out error over one-pass, points | 2.03, fail | 0.69, pass |
| Held-out deletions over one-pass, points | 3.16, fail | 0.26, pass |
| Held-out error | 14.42% | 12.07% |
| Public error | 5.65% | 4.71% |
| Public error over full clip, points | 0.54 | 0.40 |
| Wrong-language rows | 0.55% | 0 |
| Lock lag p90 | 2.85 s, pass | 3.83 s, fail |
| First text p90, locked | 7.07 s, pass | 9.68 s, fail |
| First shown p90, not gated | 5.16 s | 5.53 s |
| Stock or repetitive rows | 0 | 0 |

Non-speech rows and third-language rows: 0. The share of held-out rows rated major is not measured. Recognition parts: fail, as in every run since the talk with frequent pauses became a known limit.

- The gated figures lie within the spread of [the runs of 2026-11-13](2026-11-13-closing-decode-and-faint-sweep.md). Nothing in recognition changed between them.
- With early text shown, the default, English shows a row's first text 4.2 s sooner at p90 than it locks, and Japanese 1.9 s sooner. Both are under the 8 s first-text target, English by about 2.5 s.
- English lock lag still misses, and this change doesn't address it.

Whether the first-text target should measure shown text is the maintainer's decision, recorded in [decisions](../wiki/decisions.md) if taken, before the run it applies to.

```sh
pnpm gate:run --gate ja --segmentation rolling --held-out .local/fixtures/held-out/held-out.json
pnpm gate:score benchmarks/results/gate-ja-rolling-<stamp> --held-out .local/fixtures/held-out/held-out.json --held-out-results .local/fixtures/held-out/results-rolling-<stamp>
```
