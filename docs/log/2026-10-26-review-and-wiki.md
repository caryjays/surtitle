# 2026-10-26: code review and documentation restructure

Backend: none for the review; fake providers and the real local Turbo Q4 worker for checks. No `.env` read, no paid call, no microphone, no running service touched.

## Done

- Full read of the documentation and source. Findings are the ranked open problems in [status](../wiki/status.md).
- Documentation restructured: present-tense wiki in `docs/wiki/`, pre-wiki documents moved unchanged into `docs/log/`, root `README.md` and `AGENTS.md` rewritten to point at the wiki, `scripts/docs-check.ts` added and wired into `pnpm check` as `pnpm docs:check`.

## Observed

| Command | Result |
| --- | --- |
| `pnpm check` | typecheck, 93 Node tests, build pass |
| `pnpm test:local-unit` | 24 tests pass |
| `pnpm test:browser` | pass, fake providers |
| `pnpm test:local-browser` | pass, real Turbo Q4, public fixtures, headless Chrome; replay WAV removed afterwards |
| `pnpm docs:check` | pass after link fixes |
| `git check-ignore -v .env`, `git ls-files --error-unmatch .env` | ignored and untracked |

## Review findings

1. Chrome `echoCancellation` and `noiseSuppression` are hardcoded on in `apps/web/control.ts` and have never been tested against the far-field rejection problem.
2. No level normalization before the Silero gate. The field gate threshold sat at the 0.004 floor; the faint fixture is about 0.015 RMS, far louder.
3. Capture hard-fails on a third queued final or a 12 s inference timeout and needs a manual Start.
4. Recalibration clears reading history.
5. Four bodies of uncommitted work on top of the single commit.
6. Documentation: about 24,700 words across twelve files with repeated counts and disclaimers and stacked dated sections.

## Not done

No code behavior changed. No commit made. OBS, physical microphone and cloud rehearsal are unchanged.
