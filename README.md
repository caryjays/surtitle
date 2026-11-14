# Surtitle

Live captions on one Mac, pairing English with one other language per session. Surtitles are the translated text projected above a stage during a live performance; this does the same for a talk, a lecture or a conversation. Chrome captures the microphone, a loopback Node service runs MLX Whisper in an isolated Python worker, and OBS can compose a transparent overlay. Translation is off by default and can run on the same Mac with a local model, or in the cloud. Nothing is recorded or persisted.

Japanese is the first language pair. Spanish runs as a pilot beside it. Each pair ships after it passes a written quality gate; see the [roadmap](docs/wiki/roadmap.md) and [gates](docs/wiki/gates.md).

Requirements: Apple Silicon Mac, Node 22.9 or later, pnpm, uv, ffmpeg, Google Chrome.

## Quick start

```sh
pnpm install
pnpm local:setup   # Python venv, pinned models and public fixtures; no key needed
pnpm dev:local     # local recognition, translation off, never reads .env
```

Open `http://127.0.0.1:4317/control` in Chrome, pick the input, click Start, stay quiet through the short calibration, then speak. The page is the operator console: session controls, an audience view of what the overlay shows, health and settings.

## Translation

Three profiles, all with local recognition:

| Command | Translation | Needs |
| --- | --- | --- |
| `pnpm dev:local` | off | nothing |
| `pnpm dev:offline` | a pinned local model, streamed as it is written | `pnpm local:setup-translator` once, about 3 GB |
| `pnpm dev:listen` | paid cloud text translation | a key in `.env`; `pnpm preflight:listen` checks presence without an API call |

`dev:local` and `dev:offline` make no network calls and never read `.env`.

## Recognition modes

- Rolling, the default: the worker decodes about once a second and shows text that consecutive decodes agree on, so captions follow continuous speech.
- Turns: text appears when a speech turn ends. Start with `LOCAL_SEGMENTATION=turns`, or switch in the console's Session panel while capture is off.

## Language pair

`LANGUAGE_PAIR=en-ja` is the default; `en-es` selects the Spanish pilot. The console can switch the pair while capture is off. Speech outside the pair is not captioned and leaves a marker row.

## Overlay for OBS

Add a Browser Source at `http://127.0.0.1:4317/overlay`, 1920 × 1080, Local file unchecked. Originals show smaller and translations larger, rolled up and paced at reading speed. The console's Overlay for OBS panel builds the URL with its settings: `lines=3` for the window height, `pace=off` to show text at once, and `early=off` to hold rolling text until it locks instead of showing agreed text sooner. See [operations](docs/wiki/operations.md).

## Documentation

- [Wiki](docs/wiki/README.md): current state. Start with [overview](docs/wiki/overview.md), [status](docs/wiki/status.md) and [architecture](docs/wiki/architecture.md).
- [Log](docs/log/README.md): dated history and the pre-wiki documents.
- [AGENTS.md](AGENTS.md): mandatory rules for agents, including credential safety and documentation practices.

## Checks

```sh
pnpm check              # typecheck, fake-provider tests, docs check, build
pnpm test:local-unit    # Python unit tests, no models
pnpm test:browser       # headless Chrome, fake providers
pnpm test:local-browser # headless Chrome, real local model, public fixtures
```

The full list is in [testing](docs/wiki/testing.md).

## Credential safety

`.env` is ignored and untracked. Agents must never read, print or overwrite it; local-only commands never load it; ordinary tests never call a provider. See [security and privacy](docs/wiki/security-privacy.md).

## Layout

```text
apps/web/            Operator page, overlay, AudioWorklet
apps/service/        Loopback HTTP/WebSocket service and caption controller
packages/protocol/   Runtime-validated shared schemas
packages/providers/  Local worker and translator adapters, turn and rolling segmentation, cloud adapters
scripts/local/       Python worker, setup, scoring, benchmarks, experiments
benchmarks/          Gate targets, public fixture manifests and attribution; no audio in Git
profiles/            Language profiles and an example translation glossary; a private one can override it
docs/wiki, docs/log  Current state and history
```

Standalone: no accounts, hosted infrastructure or external backend.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). No audio is in Git; the public fixtures and their licenses are listed in [benchmarks/README.md](benchmarks/README.md).
