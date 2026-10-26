# Surtitle

Local English ↔ Japanese live captions for one Mac. Surtitles are the translated text projected above a stage during a live performance; this does the same for a talk, a lecture or a conversation. Chrome captures the microphone, a loopback Node service runs MLX Whisper in an isolated Python worker and can send finalized text to cloud translation, and OBS can compose a transparent overlay. Nothing is recorded or persisted.

## Quick start

```sh
pnpm install
pnpm local:setup   # Python venv, pinned models and public fixtures; no key needed
pnpm dev:local     # local recognition, translation off, never reads .env
```

Open `http://127.0.0.1:4317/control` in Chrome, pick the input, click Start, wait for ACTIVE, speak. OBS Browser Source: `http://127.0.0.1:4317/overlay` at 1920 × 1080 with Local file unchecked.

For Japanese lecture reading or EN↔JA conversation with paid cloud translation:

```sh
pnpm preflight:listen   # presence checks only, no API call
pnpm dev:listen         # local recognition + cloud text translation
```

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
packages/providers/  Local worker adapter, turn detector, cloud adapters
scripts/local/       Python worker, setup, scoring, benchmarks, experiments
benchmarks/          Public fixture manifests and attribution; no audio in Git
profiles/            Example translation glossary; a private one can override it
docs/wiki, docs/log  Current state and history
```

Standalone: no accounts, hosted infrastructure or external backend.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Public speech fixtures are Google FLEURS, CC BY 4.0, attributed in [benchmarks/README.md](benchmarks/README.md).
