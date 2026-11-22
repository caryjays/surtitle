# Chinese in both scripts: profile and conversion

2026-11-21, the start of roadmap stage 3. No paid calls, no recognition or translation runs. Fake providers and a fake worker only.

## What was built

- A `zh` profile: character scoring, no spaces, `。！？` and `，、；：`, the Japanese reading rates as a starting point, and a first list of stock phrases, each written in both scripts so the TypeScript and Python matchers need no converter. The list comes from known Whisper sign-offs in Chinese and has not been swept.
- Two scripts in the profile, `Hans` and `Hant`, each with a name, a marker label and an OpenCC target: Simplified Chinese (`cn`), and Traditional Chinese (Taiwan) (`tw`). Taiwan was the maintainer's choice among Taiwan, Hong Kong, both, and OpenCC's own standard.
- The session's script is a subtag on the pair, `LANGUAGE_PAIR=en-zh-Hant`, and travels with it: snapshot, `set-pair`, controller, recognizer factory, translators, and the replay and eval scripts' `--pair`. The language code stays `zh`, as Whisper reports it. A pair without a subtag takes the first script, Simplified.
- Conversion with `opencc-js` 1.4.2, MIT and Apache-2.0, pinned exactly, in the service only, so the pages do not bundle its dictionaries. Text folds to Simplified and then converts to the target, so Hong Kong and OpenCC forms (`裏`, `着`) reach the Taiwan forms (`裡`, `著`). In a probe of a few sentences, folding first gave the same Taiwan text as converting directly.
- Two conversion points: each recognizer reply recognized as Chinese, before rolling compares decodes, and each translation into Chinese, streamed and final, in the controller. Nothing else is converted: a probe showed OpenCC turning `視聴` in Japanese into `视聴`.
- Page labels, the marker row and the translation instructions name the language as the script does. Rows carry `lang="zh-Hant"` or `zh-Hans`, so the browser picks the script's glyphs rather than Japanese ones.
- A Chinese preview conversation on the history page, written in Simplified and kept in Traditional as the service converts it.

## Observed

- 206 Node tests and 64 Python tests pass. New tests cover pair tags, profile names per script, conversion and idempotence, a fake worker whose decodes change script every time and still lock in rolling, the controller passing the script to the recognizer and translating the shown text, translations into Chinese converted while streaming and when final, and switching between scripts as a new session.
- OpenCC's Taiwan conversion changes characters only. It writes `臺灣` for `台灣`, keeps mainland vocabulary such as `軟件`, and leaves punctuation alone, so `“”` stays where Taiwan usage prefers `「」`.

## Open

- A gate: FLEURS Mandarin (`cmn_hans_cn`) for the public set, held-out Mandarin talks, a stock-phrase sweep, and scoring that folds both scripts before character error rate, which needs OpenCC on the Python side or references converted ahead.
- Whether Taiwan Mandarin speech, rather than mainland, needs its own material; FLEURS has only the mainland set.
- Cantonese is reported by Whisper as `yue` and falls outside the pair. Untested.
- The local translator's quality into and out of Chinese, and whether it holds the Taiwan form unprompted; the controller converts its output either way.
- No real-model run, browser smoke or microphone session in `en-zh` yet.
