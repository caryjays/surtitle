# Testing and benchmarks

Verified: 2026-11-02 · Sources: package.json, tests, scripts/browser-smoke.ts, scripts/local-browser-smoke.ts, scripts/local/benchmark.py, scripts/local-stream-benchmark.ts, scripts/local/silence_check.py, scripts/noisy-stream-experiment.ts, scripts/local/translation_cases.py, scripts/translation-eval.ts, scripts/translation-eval-lib.ts, scripts/replay-cases.ts, scripts/local/full_clip.py, benchmarks/translation-terms.json, benchmarks/model-prices.json, benchmarks/prompt-variants.json, benchmarks/README.md, scripts/local/gate.py, scripts/local/prepare_gate_fixtures.py, scripts/local/prepare_corpus.py, scripts/local/corpus_eval.py, scripts/local/language_sim.py

Ordinary tests never read `.env`, never call a provider and never touch a physical microphone. Real-model checks are explicit commands.

| Command | Covers | Real model | Network |
| --- | --- | --- | --- |
| `pnpm check` | TypeScript; Node tests with fake providers and a fake worker covering segmentation, direction, out-of-order results, failures, clear and session invalidation, queue bounds, server origin rules, telemetry schemas and diagnostics export; docs check; build | no | no |
| `pnpm test:local-unit` | Python in the project environment from `pnpm local:setup`: scoring, gate alignment and the gate targets against the wiki table, development-corpus screening rules and its fast alignment against the plain scorer, decoder filters, worker RPC with a fake engine, experiment DSP and guards | no | no |
| `pnpm test:browser` | Headless Chrome with a synthetic microphone and fake providers: continuous EN/JA, preset switch, history, preview, diagnostics download, overlay, clear, pause, denied microphone | no | no |
| `pnpm test:local-browser` | Public EN then JA fixtures through Chrome, the worklet and the real Turbo Q4 worker to the original-only overlay | yes | no |
| `pnpm test:listen-browser` | Noise prelude plus fixtures through the real gate and model with previews into a fake translator | yes | no |
| `pnpm local:silence` | Synthetic silence, noise and hum through the real engine must yield no text | yes | no |
| `pnpm local:bench`, `pnpm local:stream` | Full-clip and real-time replay accuracy and timing on the tuning fixtures; metrics to ignored `benchmarks/results/` | yes | no |
| `pnpm local:noisy-fixtures`, `local:noisy-prepare`, `local:noisy-screen`, `local:noisy-replay` | Controlled noisy Japanese experiment; fixture setup downloads bounded public data once | yes | fixtures only |
| `pnpm gate:fixtures`, `gate:run`, `gate:score` | Language gate: public FLEURS and MUSAN non-speech streams, and private held-out recordings, replayed in real time and scored against the targets in [gates](gates.md); fixture setup downloads bounded public data once | yes | fixtures only |
| `pnpm corpus:fetch` | Development corpus of CC BY 3.0 YODAS2 recordings with uploaded subtitles, a few hours per language, into `private/`; `--list` prints picks for review. Silver references, never gate material; see [benchmarks/README.md](../../benchmarks/README.md#development-corpus) | no | metadata, then the picked audio |
| `pnpm corpus:run`, `corpus:score` | Development corpus replayed in real time in one segmentation mode, plus a cached whole-file decode of each recording in its language with the live model and filters. The score reports live and whole-file error against the subtitles, live minus whole-file, and the share of whole-file text never shown live, which does not depend on subtitle wording; also wrong language, stock or repetitive rows, forced locks and rolling timing with the machine's load. Development numbers, never a gate result; outputs stay under `private/`. `--smoke` replays the shortest recording per language | yes | no |
| `pnpm gate:language-sim` | Offline comparison of rules that settle a rolling row's language (`auto`, `pair-detect`, `retry`, `candidates`) on the gate streams in virtual time, each clip one stretch; `--rules` and `--streams` narrow it. Every decode and detection is cached per window and language under ignored `benchmarks/results/language-sim/`, so rules sharing windows decode them once. Development numbers: it does not model the live speech detector's pauses, so its rates differ from `gate:run` | yes | no |
| `pnpm eval:translation-cases` | Public fixtures and noisy variants through the live recognizer, frozen as translation cases in ignored `benchmarks/results/translation-cases.json` | yes | no |
| `pnpm eval:translation` | Translation comparison; see below | local candidates only | paid only with `--paid` |
| `pnpm docs:check` | Wiki freshness against sources, dead links, index coverage, leak scan of every commit-eligible file | no | no |

Run real-model commands one at a time; they share the GPU and skew each other's timings. Browser checks use the installed Chrome; set `CHROME_PATH` to override.

## Translation eval

`pnpm eval:translation` replays frozen cases through any set of translators and writes a results file to ignored `benchmarks/results/`. It is the only command that loads `.env`, and it makes no cloud call without `--paid`; without it, it prints the planned call counts and exits.

```text
pnpm eval:translation --paid \
  --candidate openai:gpt-5.6-terra \
  --candidate anthropic:claude-haiku-5-5 \
  --candidate local:<model>@http://127.0.0.1:8080/v1
```

| Part | Behavior |
| --- | --- |
| Candidates | `openai:<model>` and `anthropic:<model>` use the production translators; append `#low` and so on to set effort. `local:<model>@<url>` uses the chat-completions adapter against any loopback server. Append `~<variant>` to any candidate to use a prompt variant from `benchmarks/prompt-variants.json`, written as edits to the live instructions; an edit that no longer matches fails the run |
| Cases | Each pairs recognizer output with the public reference. Add more files with repeated `--cases`; hand-written private cases belong in `private/` and may carry `terms`, `glossary` and `context` |
| Timing | One untimed warm-up per candidate, then sequential calls with the order rotated per case; `--repeats`, default 2; `--timeout-ms`, default 12000 as live |
| Terms | Required spellings per fixture in `benchmarks/translation-terms.json`; several test recovery from known recognition errors |
| Judge | `--judge`, default `anthropic:claude-opus-5-5` with server-side fallback, grades the first output per case 1 to 5 against the reference and records whether a recognition error was repaired. `--no-judge` skips it |
| Blinding | The judge sees only reference, recognized text, whitespace-collapsed translation and target language. Outputs identical for a case are graded once and the score shared. Jobs are shuffled across cases and candidates with a seed, `--seed` or random, recorded with the opaque job keys in the results file. Blinding removes labels and order, not style: a judge may still recognize its own family's phrasing, so repeat with an OpenAI judge before trusting a close Anthropic-versus-OpenAI result |
| Cost | Token usage read from each reply, priced from `benchmarks/model-prices.json` |
| Invention | The judge also flags a translation that introduces a term, name, command, number or claim supported by neither the reference nor the recognized text, so a prompt that repairs more cannot hide that it also invents more |
| Own recordings | `scripts/replay-cases.ts --audio <file> --out private/<name>.json --calibrate` replays a recording in real time through the live recognizer, with `--max-turn-ms` for shorter caps or `--segmentation rolling` for rolling rows, and writes one draft case per turn or row with context and cut flags; rolling rows also carry decodes, forced locks, time to first text and lock lag. `scripts/local/rolling_sim.py` simulates rolling against fixed cuts offline from a file, with real decode times and virtual audio time. `scripts/local/full_clip.py` transcribes the whole file in Whisper's own windows as a reference draft. References are corrected by hand. Personal and third-party recordings and their outputs stay in `private/` |

Latency is request time from this machine, so run it on the network you care about and record which one in the log.

## Fixtures

Google FLEURS, CC BY 4.0, pinned revision and SHA-256 per clip in `benchmarks/fleurs.json` for the 4 EN and 4 JA tuning clips and `benchmarks/noisy-ja.json` for the 8 JA sources of the noisy experiment with distinct sentence IDs. Audio stays in ignored `.local/fixtures/`; reference text is data and never a prompt. EN is scored by word error rate, JA by character error rate after NFKC normalization. Attribution is in [benchmarks/README.md](../../benchmarks/README.md).

## Recording results

Counts and measurements go in a dated entry under `docs/log/`, never in wiki prose. `pnpm check` prints the test count. A wiki page may quote one headline figure with a link to the entry it came from.
