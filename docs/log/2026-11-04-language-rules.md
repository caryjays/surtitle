# Rolling language rules: retry's English loss, settling at lock, third-language fixtures, and a clean gate of the 11-02 fix

2026-11-04. Retry's English loss is not a language problem: a filtered decode lets the noise trim discard text that earlier decodes agreed on, and it hits every rule. Settling a row's language only when its text locks, plus skipping such filtered decodes, beats the live rule on both languages in the simulator. Third-language fixtures exist and show that forcing a pair language turns foreign speech into invented captions. A clean real-time gate of the 11-02 adapter fix improved Japanese and still fails. Nothing live changed.

## Why retry lost English

All of retry's extra English loss in the 11-02 table is one clip, gate-en-1678: 28 of its 39 deletions, with 2 fewer elsewhere. The 11-02 entry said the rest was spread over many clips; it was not.

A cached trace of that clip under retry: the row's single growing segment never settled, so nothing locked for 11 s while six decodes agreed on the sentence. The 11 s decode in English looped ("sincerity, accuracy, accuracy, …"), and the repetition filter rejected it whole. The retry decode in Japanese returned the sentence in English, which the script check refused. The window came back empty, over 3 s and not final, so the noise trim kept only the last second, discarding 10 s of agreed speech. Only "accurately" survived.

Retry's extra detection and second decodes shift its window timing; under `auto` the same clip happened not to produce a looping window. Counting trims that discard text the previous decode returned, on the public sets: `auto` 4, `pair-detect` 7, `retry` 3, `candidates` 9. Japanese gate-ja-1707 lost 「ここは南アフリカの主な観光地の一つで」 under retry the same way. This answers the 11-01 open question of whether a filtered decode should reset agreement: it is the loss mechanism.

## Retry rescues

Over every cached window where retry ran its second decode, the second decode passed the filters 37 times. On public Japanese it rescued real speech twice, both with detection's preferred pair language below 0.08, and once returned an English loanword. Every other rescue, 6 on public English, 26 on music and 2 on noise, was a Japanese sign-off such as ご視聴ありがとうございました or おやすみなさい, accepted because the stock-phrase rule applies only to 6 s or more of audio. Those had detection confidence of 0.25 or more. So retry's Japanese gain came mostly from settling the language at lock, not from the second decode.

## New simulator options

- `auto-lock`: the live rule, with the row's language settled only when its first text locks.
- `retry-uncertain`: retry, with the second decode only when detection's preferred pair language is below 0.2. The margin was chosen from the rescues above, on the same streams, so it is fitted, not validated.
- `--keep-agreed`: a wholly filtered decode no longer trims a window whose previous decode returned text; it is skipped.
- `--third-row`: a closing row is dropped when detection over its whole audio, up to 29 s, puts more than half its probability outside the pair.

## Results

Laptop, load average about 2. Same virtual-time caveats as 11-02: no speech-detector pauses, so rates are not gate rates.

| Stream | auto | auto-lock | retry | retry-uncertain | auto +keep | auto-lock +keep | retry +keep | retry-uncertain +keep |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public Japanese error | 7.63% | 6.55% | 6.88% | 6.88% | 13.94% | 6.55% | 5.87% | 5.87% |
| Public Japanese deletions | 71 | 35 | 63 | 63 | 246 | 35 | 34 | 34 |
| Public English error | 4.31% | 4.31% | 6.63% | 6.55% | 4.31% | 4.31% | 4.39% | 4.31% |
| Public English deletions | 13 | 13 | 39 | 39 | 11 | 11 | 11 | 11 |
| Wrong-language rows, both public sets | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| Music rows | 2 | 1 | 1 | 1 | 0 | 1 | 1 | 0 |
| Background-noise rows | 1 | 1 | 2 | 1 | 1 | 1 | 3 | 1 |
| Applause rows | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Third-language rows | not run | not run | not run | not run | 49 | 49 | 28 | 28 |

With `--third-row` added, `auto-lock +keep` and `retry-uncertain +keep` kept every public and non-speech number above, and third-language rows fell to 1 and 0.

What the runs show:

- `--keep-agreed` alone is harmful under `auto`. Its four worst Japanese clips are the ones where a short English mishearing ("It", "What is", "Video", "Forkland") had already fixed the row's language; the trim was the only recovery, and keeping the window lost the whole clip. Under any rule that settles at lock it is neutral or helps.
- `auto-lock +keep` improves both languages over the live rule without an extra decode or detection pass.
- `retry-uncertain +keep` is best on Japanese and on non-speech, at about 10% more decodes than `auto-lock` on Japanese, plus a detection pass per unsettled window.
- Third-language speech: `auto` and `auto-lock` show it in its own script with no pair language. Retry rules force a pair language, and Whisper then translates: a Chinese clip became "This is a chapter of the end, also the beginning of the chapter.", Spanish and German mostly became English, and Chinese and Korean mostly Japanese. That is worse than foreign text, since it reads as a real caption.
- Row-level detection rejected third-language rows without touching pair-language rows here. Live rolling displays text as it locks, so rejecting at row close would mean retracting text or holding a row's first text until enough audio is in. Not designed yet.

## Third-language fixtures

`benchmarks/gate-other.json`: 10 FLEURS test clips each of Mandarin Chinese, Korean, Spanish and German at the pinned revision, the first distinct sentence IDs of 4 to 16 s in each language's archive order, 7.3 minutes. `gate:run` now replays them as a `third-language` stream, and `gate:score` reports `thirdLanguageRows` without gating it. Those IDs are excluded from a future gate in their own language.

## Clean gate of the 11-02 fix

`pnpm gate:run --segmentation rolling`, commit `63bd0e6`. The uncommitted changes were the offline simulator, fixture preparation and the third-language stream in `gate.py`; the live path was as committed. Load average median 2.1, maximum 7.6 at one stream start, against median 1.6 and maximum 2.7 for the 11-01 baseline.

| Measure | 11-01 baseline, before the fix | 11-04, with the fix |
| --- | --- | --- |
| Public Japanese error | 9.11% | 8.21% |
| Japanese live minus full-clip | 4.00 pts | 3.10 pts |
| Japanese deletions | 134 | 109 |
| Public English error | 4.87% | 4.87% |
| English live minus full-clip | | 0.56 pts |
| Non-speech rows | 3 | 3 |
| Wrong-language share | 0.00% | 0.00% |
| Third-language rows | not run | 44 of 44, 43 with no pair language, 1 English |

The gate still fails: Japanese public error and its gap over full-clip, and the three non-speech rows ("Thank you. Thank you.", "Thank you." on music, "You" on noise).

## Open

- Port settling at lock and keep-agreed to `packages/providers/local.ts`, together, with fake-worker tests for both clips' shapes, then rerun the gate. `auto-lock +keep` is the cheaper first candidate; `retry-uncertain +keep` only if Japanese still misses.
- Choose how third-language rows are rejected live, given that rolling text displays before the row closes.
- The Japanese sign-offs that pass on short windows argue for a whole-row stock-phrase check on short rows in rolling mode; measure against the public sets first.
- The stray English rows on music and noise are unchanged.
