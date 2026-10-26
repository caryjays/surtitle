# 2026-10-26: renamed to Surtitle

Backend: none. No `.env` read, no paid call, no microphone.

## Done

- Renamed the project to Surtitle in `package.json`, `README.md`, `NOTICE` and the wiki. The name is the theatre term for translated text projected above a stage during a live performance.
- Chosen over Japanese-word candidates to stay language-neutral for future language pairs, and over other English words after checking GitHub repository names, npm, PyPI and GitHub account availability. Closest existing projects in the space are LocalVocal, KazKozDev/live-translation and WhisperLiveKit; none shares the name.

## Observed

`pnpm check` passes after the rename: typecheck, Node tests, docs and leak check, build.

## Not done

The working directory, the Git remote and the first public commit still carry the old name or do not exist yet; the maintainer performs those steps.
