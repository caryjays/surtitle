# Security and privacy

Verified: 2026-10-26 · Sources: apps/service/server.ts, apps/service/main.ts, packages/providers/local.ts, packages/providers/openai.ts, apps/web/diagnostics.ts, apps/web/reading.ts, .gitignore, AGENTS.md, scripts/docs-check.ts

## Boundary

| Rule | Where |
| --- | --- |
| Bind `127.0.0.1` only; exact `Host` and `Origin`; reject cross-site fetch metadata and WebSockets without a matching `Origin` | `server.ts` |
| Static route allowlist, `GET` only, `Cache-Control: no-store`, CSP `default-src 'none'` with self-only scripts, styles and sockets | `server.ts` |
| `/control` may use the microphone; `/overlay` has `microphone=()` and imports no capture code | `server.ts`, `overlay.ts` |
| One control socket; overlay sockets are closed on any write; 16 clients; 4 KiB payloads; audio and command rate limits | `server.ts` |
| Secrets live only in the service process; endpoints are not configurable; nothing secret enters a snapshot, URL or browser | `main.ts`, `openai.ts` |
| The worker child gets an allowlisted environment with no key and offline Hugging Face flags; its stderr is dropped | `local.ts` |
| Spoken text, glossary and context are JSON data to the translator under fixed higher-priority instructions and no tools | `openai.ts` |

This boundary protects against arbitrary web origins. A hostile local process or browser extension is out of scope.

## Retention

The application writes nothing to disk: no audio, no transcripts, no server logs with content. Browser storage holds only validated display preferences. Diagnostics are opt-in, content-free, in tab memory, and leave the machine only by explicit download. Benchmarks write metrics to ignored `benchmarks/results/`; `--review` adds public-fixture text only. Downloaded models and fixtures live under ignored `.local/`.

In the listen profile, finalized text, up to four preceding rows and the glossary go to OpenAI with `store: false`. That is not zero retention; see [translation](translation.md). Transcribing other people requires their permission. Recording is not implemented and would need separate consent.

## Credential rules for agents

The mandatory rules are in [AGENTS.md](../../AGENTS.md): never read `.env`, `.env.*` other than `.env.example`, or `.local/` into a session by any means; report only configured or missing; verify exclusion with `git check-ignore -v .env` and `git ls-files --error-unmatch .env`; never overwrite `.env`; ordinary tests never load `.env` or call providers. `dev:local` and `start:local` do not read `.env` at all.

## Public repository and the private overlay

Everything tracked by Git may become public, including history. The maintainer's personal context lives only in the ignored `private/` directory: notes, hardware and network inventory, event details, field diaries, the real glossary and a personal `AGENTS.md`. Tracked files carry no third-party names, venues, personal dates, device inventories, network names, home paths or email addresses, and report field results as aggregate numbers.

`pnpm docs:check` enforces this on every commit-eligible file: it fails on email addresses, home directory paths, API key shapes, private key blocks, bearer tokens, non-loopback IP addresses, Markdown links into `private/`, any tracked file under `private/`, and any term listed in `private/denylist.txt`. The denylist is itself private, so the check can name what must stay out without the list becoming public.
