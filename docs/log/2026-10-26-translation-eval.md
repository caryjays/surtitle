# 2026-10-26: translation eval

Backend: local Turbo Q4 for case generation only. No `.env` read by the agent, no paid call, no microphone.

## Why

The goal is the fastest translator that keeps quality, with a cloud default and later a local backup for unreliable venue networks. A reusable comparison is needed before any default changes.

Field diagnostics already bound what a faster translator can win. Across the logged field sessions the translation request median stayed near 2.0 to 2.2 s before and after the silence and diagnostics changes, and local recognition inference stayed near 0.7 s with no backlog. The perceived later-session slowdown coincides instead with accepted turns reaching the 12 s maximum, fewer provisional previews, and rejected turns leaving gaps. Turn segmentation therefore remains the larger latency lever; the controlled local replay planned in status is still the way to test it.

## Done

- `scripts/local/translation_cases.py` (`pnpm eval:translation-cases`) runs the 16 public FLEURS clips and 20 noisy variants of the four noisy-experiment targets through the live recognizer, automatic language, no prompt, and writes 36 cases to ignored `benchmarks/results/translation-cases.json`. None was rejected.
- `scripts/translation-eval.ts` (`pnpm eval:translation`) with pure logic in `scripts/translation-eval-lib.ts`: candidate specs, warm sequential timing with rotated order, required-term checks, direction checks, token usage and cost, an optional model judge, a summary table and a JSON results file. Paid candidates or judge require `--paid`; without it the command prints planned call counts and exits 2.
- `packages/providers/chat.ts`: an OpenAI-compatible chat-completions translator for local servers, eval-only.
- `benchmarks/translation-terms.json` and `benchmarks/model-prices.json`.
- Blind judging: the judge receives only reference, recognized text, whitespace-collapsed translation and target language; identical outputs for a case are graded once and shared; jobs are shuffled with a recorded seed and carry opaque keys. The judge call takes only the prepared input string, so identity cannot reach it by construction.
- Seven tests, including a blindness test that no provider or model name reaches any judge input, and an end-to-end run of the CLI against a fake loopback chat server and a check that a paid candidate without `--paid` makes no request.

## Observed

The frozen cases contain the error class seen in the field. Examples from public references: バルセロナ recognized as バルセアナ and カタルーニャ語 as カタルーネ語 in all five noisy variants; ファティマ as パティマ under noise; ロスビー数 as ロスB数; 磁気反転 as 時期判定; 口蓋 as 郊外; サンピエトロ as サンピエトル; the German word "Sie" as "say". 31 of 36 cases differ from the reference by more than punctuation and spacing; some differences are harmless, such as "25 to 30 year" recognized as "25-30 years", so the judge's recovered field, not this count, identifies meaning-changing errors.

The dry run for Terra, Haiku 5.5 and Sonnet 5.5 plans 73 calls per candidate and up to 108 judge calls.

`pnpm check` passes.

## Not done

- No paid comparison. Suggested first run: `pnpm eval:translation --paid --candidate openai:gpt-5.6-terra --candidate anthropic:claude-haiku-5-5 --candidate anthropic:claude-sonnet-5-5`, then repeat the judge with `--judge openai:gpt-5.6-terra` if Anthropic and OpenAI candidates land close.
- No local model chosen or installed. Any server exposing `/v1/chat/completions` on loopback can be passed as `local:<model>@http://127.0.0.1:<port>/v1`. Run it alone, not alongside recognition, until contention with Whisper is measured.
- Cases are read speech with no preceding context. Field-like cases with context and the real glossary should be hand-written into `private/` and passed with a second `--cases`.
- The judge is a single model; its scores are not validated against human ratings.
