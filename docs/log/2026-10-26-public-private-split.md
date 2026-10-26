# 2026-10-26: public-by-default repository and private overlay

Backend: none for the audit; fake providers and the real local Turbo Q4 worker for checks. No `.env` read, no paid call, no microphone.

## Why

The maintainer wants one codebase that serves personal use and a public profile. A scrubbed fork would drift from the code actually run, so the repository itself becomes publishable and personal context moves to an ignored overlay.

## Done

- Audited every commit-eligible file and the existing history for secrets, personal details, locations, third-party information and local paths. Found no credentials, no attendee content and no personal email; found personal planning context in documentation and a personal glossary.
- Created the ignored `private/` overlay: a personal `AGENTS.md`, the real glossary, a denylist, and the pre-wiki documents that carried personal narrative. Three technical pre-wiki records stay public in `docs/log/`.
- Glossary resolution: `GLOSSARY_PATH`, then `private/glossary.json`, then the new tracked `profiles/glossary.example.json`. Startup and preflight report which loaded. A missing or invalid glossary stops startup with a message that names the fix.
- `AGENTS.md`: privacy rules, the private overlay, neutral wording; `README.md`: license section and neutral wording; wiki pages updated to match.
- `pnpm docs:check` extended with a leak scan over every commit-eligible file and a check that `private/` stays untracked.
- `LICENSE` (Apache 2.0, verified against the published checksum), `NOTICE`, and `license` in `package.json`.

## Observed

| Command | Result |
| --- | --- |
| `pnpm docs:check` | 14 wiki pages, 102 files scanned, 0 errors; injected email, home path and denylisted term were each caught, then removed |
| `pnpm check` | typecheck, 93 Node tests, docs check, build pass |
| `pnpm test:listen-browser` | pass: real speech gate and Turbo Q4, previews, fake translation, private glossary loaded |
| `pnpm preflight:listen` | credential configured, model files, detector and Python present, glossary valid (private). The local `.env` still named the retired glossary path, so a fallback with a startup notice was added rather than breaking existing launches |
| Apache 2.0 text | SHA-256 matches the published file |

## Not done

No commit made. The existing single commit still contains the pre-split documents; a fresh initial commit is the next step before publishing.
