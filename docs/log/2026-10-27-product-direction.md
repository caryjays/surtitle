# Product direction and language sequence

2026-10-27. A planning session. No code changed and nothing was run except `pnpm docs:check`.

## What was done

Surveyed existing open-source projects with a similar pipeline, read three of them in a scratch clone without building or running any, and set the product identity, stack and language sequence. The outcome is in [roadmap](../wiki/roadmap.md) and five entries in [decisions](../wiki/decisions.md).

## What the survey found

Projects reviewed, described by kind:

| Kind | Relevant to Surtitle |
| --- | --- |
| Self-hosted text translation API on small offline models | A possible eval-only translator; no speech, no context, no glossary |
| macOS overlay for system audio: MLX Whisper, Silero, a local LLM through Ollama | Same stack. Overlap only on forced cuts plus deduplication by word timestamps; a punctuation check before reusing text as the Whisper prompt. Its word and sentence regexes miss Japanese entirely, its prompt asks the model to repair recognition errors, and it saves every transcript by default |
| Android offline speech-to-speech translator: Whisper Small and small translation models on ONNX | Decodes each utterance forced to both languages and picks by text language ID, then confidence. A small translation-only model, HY-MT 1.5 1.8B, is a local candidate. Utterances are translated without context |

Built-in captions in meeting platforms and slide software, and cloud interpretation services sold to event organizers, cover the common case. None found combines a room microphone, long continuous speech, context-aware translation and OBS composition over arbitrary sources.

## Decisions

- Identity: open source, used by the maintainer, presenter-controlled and local-first. Closed productization is a separate venture and out of scope.
- One pair per session, English with one other language. Order: Japanese, then Spanish, French and Italian, Chinese Simplified and Traditional, Korean, German.
- Generalize the pair before adding a language, as its own change after the rolling replay. English and Japanese are hardcoded today in four protocol schemas and in `Mode`.
- A written gate per language.
- TypeScript service and Python worker stay. The rolling-window log measured decodes at about 0.4 s, GPU-bound, so the orchestration language is not the latency source.

## Not done

- No code for stage 0.
- Japanese gate targets are not yet written.
- None of the reviewed projects' ideas were tested. The two worth testing offline on the held-out set are overlap with timestamp deduplication at forced cuts, and the forced dual-language decode for language drift.
