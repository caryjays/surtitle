# Documentation practices

Verified: 2026-10-26 · Sources: scripts/docs-check.ts

Two kinds of documents, one rule each.

`docs/wiki/` describes the project as it is. Present tense, no dates in the body, no "latest", "earlier", "now" or "update" sections. When the code changes, the page is rewritten to match; nothing is appended.

`docs/log/` records what happened. Dated, append-only entries named `YYYY-MM-DD-slug.md`. Never edited afterwards except to fix a link. Pre-wiki documents are kept there unchanged as the historical record.

## Freshness

Every wiki page's first line after the title is:

```text
Verified: YYYY-MM-DD · Sources: path/one.ts, path/two.py
```

Sources are the files or directories the page describes, or `none` for pages about process. `pnpm docs:check`, which runs inside `pnpm check`, fails when:

- a source changed after the Verified date, by commit date or by file modification date for uncommitted changes;
- a source path does not exist;
- a relative link in any Markdown file under `docs/`, the root `README.md`, `AGENTS.md`, `benchmarks/README.md` or `profiles/README.md` does not resolve;
- a wiki page is missing from the wiki index;
- a commit-eligible file contains an email address, a home directory path, an API key shape, a private key block, a bearer token, a non-loopback IP address, a link into `private/`, or a term from `private/denylist.txt`;
- any file under `private/` is tracked.

It warns when `status.md` is older than 14 days. To clear a failure, re-read the sources, fix the page, and set the date to today. Bumping the date without reading makes the check worthless.

## Privacy

Tracked files are written to be public. Personal context, field diaries, hardware and network details, event and travel details and the real glossary live in the ignored `private/` directory, and `private/AGENTS.md` carries the context agents need. Public pages never link into `private/`. Field results appear as aggregate numbers. Add any new private term to `private/denylist.txt` so the check catches it everywhere.

## One fact, one place

| Fact | Lives in |
| --- | --- |
| Limits, thresholds, timeouts | the bounds table in [architecture](architecture.md) |
| Commands | [operations](operations.md) and [testing](testing.md) |
| What is verified, open, next | [status](status.md) |
| Why something is the way it is | [decisions](decisions.md) |
| Measurements and counts | a dated log entry; a wiki page may quote one headline figure with a link |

Other pages link instead of restating. Disclaimers are stated once in status.md.

## Handoff

At the end of a session that changed code or learned something:

1. Rewrite the affected wiki pages and bump their dates.
2. Rewrite [status](status.md): where things stand, open problems, next steps.
3. Add a log entry: what was done, what was observed, which commands ran, which backend was used, what was left undone. Personal observations go to `private/`, never to the log.
4. If a decision was made or reversed, append to [decisions](decisions.md).
5. Run `pnpm docs:check`.

## Writing

Short pages, about 700 words of prose; tables do not count. Split when longer. One idea per sentence. Plain words over hedges. Tables for numbers and enumerations. Code identifiers only where the reader must go to that file. State what is and is not verified once, plainly, and move on.
