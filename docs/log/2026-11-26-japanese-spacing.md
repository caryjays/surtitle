# Japanese translations: spaces beside Latin words and numbers closed

2026-11-26. Uncommitted tree on `main` at `2221bd5`, on top of [the Korean script guard](2026-11-25-korean-script-guard.md). No paid calls, no microphone and no model run except the offline smoke. The maintainer's decision, on the count that entry reported.

## What the model writes

The local translator `qwen3.5-4b-q4` leaves a space between a Latin word, a number or a percent sign and the Japanese beside it, `AI は` and `10 月`. Japanese captions do not carry that space. In the stored read-through of the Japanese gate's English talks, 283 translated rows:

| | Stored | With the rule |
| --- | --- | --- |
| Rows holding a space | 131 | 14 |
| Rows changed | n/a | 129 |
| Space characters removed | n/a | 327 |
| Rows changed in anything but spaces | n/a | 0 |
| Spaces left, by what they stand between | n/a | 16 two Latin words, 6 a Latin word and a number |

Every space the stored rows hold stands beside a Latin letter, a digit or a percent sign. None stands between two Japanese words or after Japanese punctuation.

## The rule

A profile may list `adjoining`: its writing, as Unicode script names, that stands directly beside a Latin word or number. In a translation into the language, a run of spaces between a Latin letter, digit or percent sign and a character of that writing is removed, on either side. A character counts by its Unicode script extensions, so Japanese punctuation and the long-vowel mark count as Japanese. Japanese lists `Han`, `Hiragana` and `Katakana`.

- A space between two Latin words or numbers stays, as in a name of several words or a model number.
- A space between two Japanese words stays, and so does one after a Latin comma.
- It applies where the Korean particle rule does: in the controller to translations, streamed and final, from any translator, and in the replay and evaluation scripts. Recognized text is never changed.
- A streamed reply needs no special case: a space is closed only once the characters on both sides are written.
- Chinese does not set the field. Chinese typography accepts the space, and 90 of 266 stored Chinese rows hold one.

Nothing was graded: it is a spelling rule and changes no word. The model's context now holds its earlier translations without those spaces; whether it then writes fewer was not measured.

## Changed

- `packages/protocol/languages.ts`: optional profile field `adjoining`.
- `profiles/languages.json`: Japanese sets it.
- `packages/providers/script.ts`, `attached`: closes those spaces before joining particles.
- Tests: the rule and the controller's streamed and final text, in `tests/script.test.ts`.

## Run

| Check | Result |
| --- | --- |
| `pnpm check` | Passes, 222 tests |
| Offline browser smoke, `--offline --rolling --pair en-ja` | Passes |

## Not done

- No microphone session and no Japanese reader's look at the result.
- The Japanese read-through and part 6 were not repeated: no word changes, and the rule costs one regular expression per shown text.

## Commands

```text
pnpm check
pnpm exec tsx scripts/local-browser-smoke.ts --offline --rolling --pair en-ja
```
