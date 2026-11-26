# Word boundaries outside ASCII, and the offline smoke's check

2026-11-23. Uncommitted tree on `main` at `2221bd5`, on top of [the pair review](2026-11-23-language-pair-review.md) and [term sets](2026-11-23-glossary-term-sets.md). No paid calls and no microphone. Local recognition `turbo-q4` in rolling, local translator `qwen3.5-4b-q4`, on the Air on mains power. Nothing here is a gate result. Done at the maintainer's request, closing findings 2, 4 and 5 of the review.

## Changed

- `stablePrefix` in `packages/providers/rolling.ts`: agreed text no longer ends inside a word of any script written with spaces. A word character is a letter, mark or digit outside kana and Chinese characters, where it was an ASCII letter or digit. "Dice que están" after "Dice que está bien" now agrees on "Dice que ", where it gave "Dice que está"; a Korean word is no longer cut at a syllable. Japanese and Chinese agree to the character as before.
- `joinText`, same file: the space Whisper sometimes omits at the start of a segment is restored after and before the same word characters, and before `¿`, `¡` and `«`. "Fue al café" and "y luego" join with a space; Korean sentences and words do. Japanese and Chinese join with none, as before.
- For text in ASCII, kana and Chinese characters both functions return what they did, so `en-ja` and both Chinese pairs change only where English holds an accented letter. Locks were never affected: they are whole segments.
- `scripts/local-browser-smoke.ts`: the check of the translation out of English asks for Hangul with no kana in Korean, Chinese characters with no kana in Chinese, and in the Latin-script pairs Latin words that are not the row's own English. The fake translator of the listen smoke answers in Japanese only in `en-ja`.

## Run

| Check | Result |
| --- | --- |
| `pnpm check` | Passes |
| Offline browser smoke, `--offline --rolling --pair <pair>` | Passes in all 8 pairs. `en-ko`, which the review left failing, passes with term sets: the translation is in Hangul |
| Listen smoke with the fake translator | Passes in `en-ja` and `en-ko` |

## Not done

- No gate run, part 6 run or read-through was repeated. The change alters the agreed text a display shows early in Spanish, French, Italian, Portuguese and Korean, which part 6 and the display simulation read; how often the old rule cut a word on talks was never measured, so there is no before and after.
- Scripts without spaces other than kana and Chinese characters, such as Thai, are treated as spaced; none is profiled.

## Commands

```text
pnpm check
pnpm exec tsx scripts/local-browser-smoke.ts --offline --rolling --pair en-ko
```
