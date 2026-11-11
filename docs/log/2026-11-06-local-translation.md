# Local translation in the live service, and automatic gain on by default

2026-11-06. Following the [rehearsal latency](2026-11-06-rehearsal-latency.md) review, the maintainer chose two changes: Automatic mic gain on by default, and offline translation as the next step. Both are in. The listen profile and its defaults are unchanged.

## What changed

- The Automatic mic gain checkbox starts checked. The browser smoke test expects it.
- `pnpm dev:offline` and `start:offline` run local recognition with local translation. They read no `.env` and clear both keys. `pnpm preflight:offline` checks the translation model files too. `TRANSLATION_BACKEND=local` does the same from `.env`, and only with local recognition.
- `packages/providers/local-translator.ts` drives `scripts/local/translate_worker.py`, a stdio child like the recognition worker. It loads a pinned model with mlx-lm 0.32.2, renders the chat template with thinking off, decodes greedily up to 512 tokens and stops a request on cancel. The service loads and warms the model before it prints its URL.
- The model is mlx-community's 4-bit MLX build of Qwen3.5-4B, about 3 GB, pinned by revision with LFS SHA-256 and Git blob hashes in `scripts/local/translators.json`. `pnpm local:setup-translator` fetches it. The first download attempt failed two thirds of the way through and discarded its partial file, so the downloader now keeps the partial file and resumes it with range requests, up to eight times.
- `mlx-lm==0.32.2` joined `requirements.in`. The lock was recompiled with every existing pin held, adding mlx-lm, transformers 5.22.1 and their dependencies.
- The snapshot's `processing` gains `local-audio-local-text`. The console says audio and text stay on the Mac, and labels the translation toggle "on this Mac" instead of "paid cloud requests".
- `pnpm eval:translation` takes `mlx:qwen3.5-4b-q4`, which runs the live local translator with its model loaded before the warm-up.
- `pnpm test:offline-browser` is the rolling listen smoke test with the real local model in place of the fake translator.

## The direction fix

The first real run failed every Japanese row in Auto: the model returned `target: ja` with a Japanese paraphrase of the source, which validation rejects. With the direction stated it translated each test line correctly. In Auto, the local translator now sends the direction implied by the recognizer's language when that language is in the pair. It keeps Auto when the recognizer reports none, so the model can still return `unknown`. The cloud translators are unchanged.

## Measured

Development numbers, on this Mac, with public fixtures and authored lines only. No paid call was made.

- Load and warm-up: 1.8 to 4.3 s at service startup.
- Eval on the 36 public cases, 2 repeats, local model alone: 72 of 72 valid, no wrong direction, request time p50 1.22 s, p90 1.42 s, max 1.71 s, 38 of 67 glossary terms. The 2026-10-26 run on the same cases found Terra at p50 1.61 s and 44 of 67 terms, and Haiku 5.5 at 1.51 s and 43 of 67. Quality was not judged, since the judge is a paid model.
- Contention with recognition: an 8 s window repeatedly decoded by Turbo Q4 took p50 0.74 s alone and 1.74 s while the eval ran translations back to back. Translation slowed to p50 1.59 s and p90 2.03 s. This is a worst case: live, a row is translated once, for about 1 s, every few seconds. Still, a rolling decode that overlaps a translation runs over its 1 s interval.
- `pnpm test:offline-browser`: pass, with both public fixture rows translated in the right direction, at 1.12 and 1.11 s.

Against the rehearsal's cloud requests, p50 2.2 to 2.5 s with a tail to 7 s, a local request saves about 1 s for each row, and the tail goes with the network. Row length is still the largest part of the delay.

## Checks

`pnpm check`: 144 tests, including 5 for the local translator against a fake worker: parsing past an empty thinking block, abort without blocking the next request, restart after a worker exit, token-limit and garbage replies as failures, and the Auto direction. `pnpm test:browser`, `pnpm test:local-unit` and `pnpm test:offline-browser`: pass. `pnpm local:stream` stops after its first two English fixtures with its generic failure message. That happens with no translation running, and it is not investigated here.

## Open

- A live rehearsal with `pnpm dev:offline`, rolling and diagnostics on, to see whether contention delays locks. Compare decode time and lock lag in Health and `pnpm diag:latency` with the listen rehearsal. If it does, the options are a smaller model such as Qwen3.5-2B, or holding translation while a recognition decode runs.
- Translation quality is unjudged. The glossary-term count is below the cloud models'. A judged eval needs the paid judge and the maintainer's authorization. The other local candidates, Gemma 4 and HY-MT 1.5, and every planned language, follow.
- Memory: the two models together add about 3.5 GB of weights. Not checked on an 8 GB Mac.
- The listen profile stays the cloud default. Whether offline becomes the recommended profile waits on the rehearsal and the judged eval.
