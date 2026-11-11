# Settle time: 0.5 s against the live 1.0 s

2026-11-11. Lock lag is the largest remaining part of the wait from speech to translation ([piece translation](2026-11-09-piece-translation.md)). A rolling segment locks when two consecutive decodes agree and it ended at least `ROLLING.settleMs` before the newest audio, 1000 ms live. This entry compares shorter settle times, in the simulator and then in real time. Nothing live changed. All numbers are content-free aggregates.

## Simulator

`language_sim.py` gains `--settle S` and reports lock lag in virtual time for every run: from a locked segment's end to the reply that locked it, finals excluded. Live rules throughout: `auto-lock --keep-agreed --pair-only --pair-retry 0.2 --noise-confirm -0.5`.

Public gate streams:

| Stream | Settle | Lock lag p50, p90 | Error | Deletions |
| --- | --- | --- | --- | --- |
| Public Japanese | 1.0 | 2.29, 3.78 | 6.55% | 34 |
| Public Japanese | 0.5 | 2.02, 3.78 | 6.77% | 34 |
| Public Japanese | 0.25 and 0.0 | 1.99, 3.68 | 6.77% | 33 |
| Public English | 1.0 | 2.31, 2.97 | 4.31% | 11 |
| Public English | 0.5 | 2.07, 2.80 | 4.31% | 11 |
| Public English | 0.0 | 1.98, 2.80 | 4.31% | 11 |

The held-out talks, simulated over the energy detector's stretches by a scratch script and scored with the gate's `edits` on the whole reference, so rates compare arms only:

| Talk | Settle 1.0: lag p50, p90; error; deletions | Settle 0.5 | Settle 0.0 |
| --- | --- | --- | --- |
| held-en-4320211 | 3.11, 4.38; 11.02%; 6.50% | 2.67, 4.27; 11.30%; 6.69% | same as 0.5 |
| held-en-4346818 | 2.89, 4.75; 17.49%; 7.51% | 2.08, 4.39; 17.49%; 7.24% | 1.82, 4.39; 17.62%; 6.83% |
| held-en-4366522 | 2.44, 4.67; 7.98%; 2.53% | 2.17, 3.44; 8.11%; 2.66% | 2.02, 2.53; 7.98%; 2.79% |
| held-en-4366893 | 2.56, 5.18; 10.72%; 2.24% | 2.27, 3.99; 10.72%; 2.12% | 2.27, 3.99; 10.60%; 2.00% |
| held-en-4367535 | 2.77, 5.76; 12.71%; 2.18% | 2.11, 4.36; 12.71%; 2.82% | 2.13, 3.85; 12.71%; 2.82% |
| held-en-4383161 | 2.95, 5.35; 11.64%; 4.40% | 2.51, 4.33; 11.00%; 4.27% | 2.38, 4.33; 10.87%; 4.14% |
| held-ja--6K2nN9aWsg | 2.42, 3.81; 25.93%; 9.18% | 2.29, 3.81; 26.05%; 9.30% | 2.28, 3.45; 25.87%; 9.30% |
| held-ja-0KTVqevvEjo | 2.24, 2.91; 33.08%; 19.58% | 1.81, 3.20; 32.88%; 19.85% | 1.79, 2.83; 33.42%; 20.40% |
| held-ja-0L8zz6v-3lw | 2.41, 3.20; 6.97%; 2.08% | 2.07, 3.23; 6.97%; 2.02% | 2.03, 3.63; 6.97%; 2.02% |
| held-ja-0SI8rms050Q | 2.73, 4.09; 8.99%; 2.37% | 2.42, 3.68; 8.93%; 2.43% | 2.42, 3.51; 8.99%; 2.49% |
| held-ja-0jJLyvNn_to | 2.22, 3.07; 6.85%; 2.09% | 2.07, 2.94; 6.71%; 2.00% | same as 0.5 |

Settle 0.5 lowers the held-out median lock lag by 0.13 to 0.81 s on every talk and the English p90 by up to 1.4 s. Error moves between −0.64 and +0.28 points, deletions between −0.27 and +0.64, with no consistent direction. Below 0.5 gains little more. Public Japanese error rises 0.22 points at 0.5, with the same deletions; public English does not move.

## Real time

`pnpm replay:contention --translate local --units row` on four held-out talks, two English and two Japanese, with `--cadence 1000,500` and then `--cadence 1000,1000`, one run each, settle 0.5 first. Load average 4 to 6 during both runs. Medians in seconds from `pnpm diag:latency`, lock lag p90 in brackets:

| Talk | Lock lag, 0.5 vs 1.0 | Speech end to final text | Last word to first translated text | Middle of row to first translated text | Translation request |
| --- | --- | --- | --- | --- | --- |
| held-en-4320211 | 2.3 (5.1) vs 2.6 (4.1) | 2.0 vs 2.5 | 3.5 vs 4.7 | 6.8 vs 7.9 | 2.3 vs 3.2 |
| held-en-4346818 | 2.3 (3.2) vs 2.9 (4.6) | 2.1 vs 2.6 | 3.6 vs 4.3 | 6.5 vs 7.1 | 2.1 vs 2.6 |
| held-ja--6K2nN9aWsg | 2.4 (3.9) vs 2.7 (3.9) | 1.9 vs 1.8 | 3.4 vs 3.5 | 6.6 vs 6.6 | 2.1 vs 2.2 |
| held-ja-0jJLyvNn_to | 2.1 (3.1) vs 2.1 (2.9) | 1.7 vs 1.9 | 3.3 vs 3.3 | 7.8 vs 7.5 | 3.1 vs 2.7 |

- English gains about as the simulator predicted: lock lag 0.3 to 0.6 s, speech end to final text 0.5 s on both talks. The larger translation gains are partly noise, since the translation request, which settle does not touch, varied by up to 0.9 s between runs.
- Japanese barely changes, matching the simulator's small gains on these two talks; most of the second talk's rows close at the length limit, where settle matters least.
- Rejected and failed rows match between the runs.
- English 4320211's lock lag p90 is worse at 0.5, 5.1 s against 4.1 s. One run per setting cannot separate that from noise.

## Not settled

- Accuracy in real time: the replays ran without `--review`, so recognition error cannot be scored. Only the simulator says accuracy holds.
- Order: settle 0.5 ran first, on the cooler Mac. Earlier entries found that running first can flatter a setting.
- The public Japanese rise of 0.22 points in the simulator.

## Next

One more pair overnight on the Air, in the opposite order, live 1.0 first and then 0.5, both with `--review <file>`, kept under ignored `.local/`, so error can be scored. If English keeps about 0.5 s and error holds, change `ROLLING.settleMs` to 500 in `packages/providers/rolling.ts`, add a decisions row, and rerun the held-out gate in both modes.

```sh
T=".local/fixtures/held-out/held-en-4320211.wav .local/fixtures/held-out/held-en-4346818.wav .local/fixtures/held-out/held-ja--6K2nN9aWsg.wav .local/fixtures/held-out/held-ja-0jJLyvNn_to.wav"
pnpm replay:contention --translate local --units row --review .local/review/settle1000.json --cadence 1000,1000 --out <dir>/settle1000.json ${=T}
pnpm replay:contention --translate local --units row --review .local/review/settle500.json --cadence 1000,500 --out <dir>/settle500.json ${=T}
pnpm diag:latency <dir>/settle1000.json
```

Under zsh, `${=T}` splits the list; a plain `$T` passes it as one path.
