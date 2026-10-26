# Overview

Verified: 2026-10-26 · Sources: apps/service/main.ts, apps/service/glossary.ts, package.json, .env.example

Surtitle is a local English ↔ Japanese live caption companion for one Mac. The name is the theatre term for translated text projected above a stage during a live performance. An operator browser tab captures a microphone, a loopback Node service turns speech into bilingual text, and a transparent overlay page can be composed in OBS. It was built by a presenter who gives English talks to Japanese audiences and reads Japanese lectures in English, and it has been used live at a conference.

## Product contract

- Live text captions. No synthesized speech. Original text appears smaller, its translation larger.
- Automatic EN↔JA direction per turn, with explicit EN→JA and JA→EN overrides.
- Original text survives translation failure. Local recognition is a hard requirement and cloud recognition must not replace it.
- Capture lives in the operator page. Overlay reloads and OBS scene changes never affect capture.
- Nothing is recorded or persisted: no audio, no transcripts, no accounts, no hosted service.

## Launch profiles

| Command | Recognition | Translation | Reads `.env` | Paid calls |
| --- | --- | --- | --- | --- |
| `pnpm dev:local` / `pnpm start:local` | local MLX Whisper | off | no | none |
| `pnpm dev:listen` / `pnpm start:listen` | local MLX Whisper | OpenAI Responses | yes | after Start, per finalized turn |
| `pnpm dev` / `pnpm start` | per `.env`, default local | per `.env`, default off | yes | only if a cloud backend is set |
| `pnpm preflight:listen` | presence checks only | | yes | none |

`dev:*` commands build then run from source; `start:*` run `dist/`. There is no hot reload: restart the service and reload the browser after a change. Operator page: `http://127.0.0.1:4317/control`. Overlay: `http://127.0.0.1:4317/overlay`. `localhost` is rejected on purpose.

## Configuration

`.env` is ignored and never read by agents. It holds `OPENAI_API_KEY`, `TRANSCRIPTION_BACKEND`, `TRANSLATION_BACKEND`, `LOCAL_MODEL` with `turbo-q4` default or `small-q4`, `LOCAL_MAX_TURN_MS` from 1000 to 12000, `LOCAL_PREVIEWS` which is `on` in listen mode by default, `PORT`, `TRANSCRIPTION_MODEL`, `TRANSLATION_MODEL`, `TRANSLATION_REASONING_EFFORT` and `GLOSSARY_PATH`. The `--local-only` flag overrides all of these to local recognition with translation off; `--listen` forces local recognition plus cloud translation.

The glossary resolves in this order: `GLOSSARY_PATH` when set, `private/glossary.json` when present, otherwise the tracked `profiles/glossary.example.json`. Startup and preflight report which one loaded. A `GLOSSARY_PATH` still naming the retired default `profiles/glossary.json` falls through to the normal order with a notice.

## Private overlay

The ignored `private/` directory holds the maintainer's personal context: notes, the real glossary, hardware and event details, and a personal `AGENTS.md` that agents read after the tracked one. Nothing in it is linked from or copied into tracked files. See [security and privacy](security-privacy.md).

## Platform

Apple Silicon Mac. Developed and benchmarked on an M5 MacBook Air with 24 GB. Any microphone Chrome can open works; a directional microphone through an audio interface was used in the field, with the built-in microphone as backup.

## Out of scope for now

Speech synthesis, speaker identification, mixing several audio sources, remote call capture, native overlays, multi-user hosting, automatic backend failover, full offline translation. See [roadmap](roadmap.md).
