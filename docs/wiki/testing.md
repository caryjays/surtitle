# Testing and benchmarks

Verified: 2026-10-26 · Sources: package.json, tests, scripts/browser-smoke.ts, scripts/local-browser-smoke.ts, scripts/local/benchmark.py, scripts/local-stream-benchmark.ts, scripts/local/silence_check.py, scripts/noisy-stream-experiment.ts, benchmarks/README.md

Ordinary tests never read `.env`, never call a provider and never touch a physical microphone. Real-model checks are explicit commands.

| Command | Covers | Real model | Network |
| --- | --- | --- | --- |
| `pnpm check` | TypeScript; Node tests with fake providers and a fake worker covering segmentation, direction, out-of-order results, failures, clear and session invalidation, queue bounds, server origin rules, telemetry schemas and diagnostics export; docs check; build | no | no |
| `pnpm test:local-unit` | Python: scoring, decoder filters, worker RPC with a fake engine, experiment DSP and guards | no | no |
| `pnpm test:browser` | Headless Chrome with a synthetic microphone and fake providers: continuous EN/JA, preset switch, history, preview, diagnostics download, overlay, clear, pause, denied microphone | no | no |
| `pnpm test:local-browser` | Public EN then JA fixtures through Chrome, the worklet and the real Turbo Q4 worker to the original-only overlay | yes | no |
| `pnpm test:listen-browser` | Noise prelude plus fixtures through the real gate and model with previews into a fake translator | yes | no |
| `pnpm local:silence` | Synthetic silence, noise and hum through the real engine must yield no text | yes | no |
| `pnpm local:bench`, `pnpm local:stream` | Full-clip and real-time replay accuracy and timing on the tuning fixtures; metrics to ignored `benchmarks/results/` | yes | no |
| `pnpm local:noisy-fixtures`, `local:noisy-prepare`, `local:noisy-screen`, `local:noisy-replay` | Controlled noisy Japanese experiment; fixture setup downloads bounded public data once | yes | fixtures only |
| `pnpm docs:check` | Wiki freshness against sources, dead links, index coverage, leak scan of every commit-eligible file | no | no |

Run real-model commands one at a time; they share the GPU and skew each other's timings. Browser checks use the installed Chrome; set `CHROME_PATH` to override.

## Fixtures

Google FLEURS, CC BY 4.0, pinned revision and SHA-256 per clip in `benchmarks/fleurs.json` for the 4 EN and 4 JA tuning clips and `benchmarks/noisy-ja.json` for the 8 JA sources of the noisy experiment with distinct sentence IDs. Audio stays in ignored `.local/fixtures/`; reference text is data and never a prompt. EN is scored by word error rate, JA by character error rate after NFKC normalization. Attribution is in [benchmarks/README.md](../../benchmarks/README.md).

## Recording results

Counts and measurements go in a dated entry under `docs/log/`, never in wiki prose. `pnpm check` prints the test count. A wiki page may quote one headline figure with a link to the entry it came from.
