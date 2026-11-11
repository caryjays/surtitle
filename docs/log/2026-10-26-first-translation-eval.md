# 2026-10-26: first paid translation eval

Backend: cloud translation candidates and judge, called from the maintainer's laptop on a home connection. Run with explicit authorization. The agent did not read `.env`.

## Commands

```text
pnpm eval:translation --paid --candidate openai:gpt-5.6-terra --candidate anthropic:claude-haiku-5-5 --candidate anthropic:claude-sonnet-5-5
pnpm eval:translation --paid --candidate anthropic:claude-sonnet-5-5
```

36 frozen public cases, 2 repeats, mode auto, effort `none`, 12 s timeout, blind judge `anthropic:claude-opus-5-5`.

## Adapter defect found and fixed

All 72 Sonnet 5.5 calls in the first run failed as `http-error`. The Anthropic adapter sent `thinking: {type: "disabled"}` for effort `none`; per Anthropic's model documentation Sonnet 5.5 rejects that and takes `between_tools`, and Opus 5.5 cannot disable thinking. `thinkingFor` in `packages/providers/anthropic.ts` now picks per model. The raw error body was not inspected, by design; the diagnosis rests on the documented rule and on the rerun succeeding. Sonnet was rerun alone about four minutes later, so its latency is from a different window than Terra's and Haiku's.

## Results

| Candidate | OK | p50 ms | p90 ms | Max ms | Terms | Fidelity | Fidelity, changed cases | Recovered | $ / 1000 turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Terra | 72/72 | 1610 | 2041 | 4423 | 44/67 | 3.56 | 3.45 | 10/25 | 1.28 |
| Haiku 5.5 | 72/72 | 1505 | 2086 | 2991 | 43/67 | 3.56 | 3.42 | 10/26 | 0.11 |
| Sonnet 5.5 | 72/72 | 1707 | 4458 | 5672 | 44/67 | 3.86 | 3.71 | 12/26 | 2.20 |

No wrong-direction or unresolved outputs. One translation was shared by identical outputs in the first run's judging.

## Observed

- All three repaired well-known names garbled by recognition: バルセアナ and カタルーネ語 became Barcelona and Catalan in every variant, パティマ became Fátima.
- None repaired errors that need domain inference: ロスB数 and 時期判定 (Rossby number, magnetic reversal), 3列車 (参列者, attendees, translated as trains), "say" for the German "Sie", 郊外 for 口蓋. These cases score 1 to 3 for every model. Sonnet recovered the palate sentence's meaning in two of five variants.
- Haiku matched Terra on judged quality and terms, at a similar median, a lower maximum and about a twelfth of the cost.
- Sonnet scored highest but had a long tail: p90 4.5 s.

## Limits

- One run per model, 36 cases built from 20 distinct sentences; 20 cases are noise variants of 4 sentences and are not independent. Differences of 0.1 to 0.3 in mean fidelity are within what a second run could reverse.
- The judge is from the same family as two candidates. A cross-check with an OpenAI judge has not been run.
- Read speech without preceding context; field speech has context, which should help the domain-inference failures.
- Latency is from a home connection, not venue Wi-Fi; field median for Terra was near 2.1 s.
- Judge token usage is not metered; the judge accounted for most of this run's cost.

## Next

1. Test the prompt: the instructions forbid inventing speech, which pushes literal translation of obvious mishearings. A variant allowing correction of clearly misheard words when context supports it should be compared on the same cases.
2. Cross-check with `--judge openai:gpt-5.6-terra`.
3. Add context-bearing private cases from real talks.
