# Roadmap

Verified: 2026-11-10 · Sources: none

Where the project is going and in what order. What is done and open right now lives in [status](status.md); the reasons are in [decisions](decisions.md).

## Identity

Surtitle is a local-first live caption layer for bilingual talks, controlled by the presenter. Each session pairs English with one other language. Japanese is the first pair and gets polished before any other is added. The maintainer builds it for their own lectures and publishes it as open source. Closed productization, hosting, accounts and paid tiers are a separate venture and out of scope.

It serves presenters who speak while the room reads, and attendees who listen and read alone, through one pipeline. The five concrete setups, Remote call, Hosted stage, Direct stage, Open floor and Audience seat, are defined in [lanes](lanes.md).

Built-in meeting and slide-tool captions cover the common case. Surtitle is for presenters who need control over direction, terms, composition beyond slides, and where recognition runs.

## Stack

The service and pages stay TypeScript. Recognition stays in a Python worker because MLX models and ports appear there first. Latency is set by turn boundaries, decode time on the GPU and the translation round trip; none of these depend on the orchestration language, so no Rust rewrite is planned. OBS integration means the Browser Source plus obs-websocket control from the service. A native OBS plugin would tie capture to the OBS process, which the product contract forbids. If setup friction blocks adoption, the fix is packaging the worker: pinned environments, a VAD without torch, perhaps a bundled worker. A port, if ever needed, would target Swift with mlx-swift.

## Language sequence

| Stage | Pair | Notes |
| --- | --- | --- |
| 0 | Generalize the pair | Protocol takes a configured pair, modes become `auto` and the two directions, language-specific rules move into one profile per language. The gate runner, replay and translation eval take a gate or pair as well. This work does not wait for the Japanese gate. Japanese stays the only filled profile. No new language |
| 1 | EN ↔ JA | Must pass the Japanese gate below |
| 2 | EN ↔ ES, then FR and IT | Shared profile shape: spaces, Latin punctuation, WER scoring. Spanish goes first, alone, as the pilot that proves the per-language gate tooling. Risk: per-language stock-phrase hallucinations, and close neighbours such as Portuguese as third languages |
| 3 | EN ↔ ZH, Simplified and Traditional | Reuses Japanese CJK work: CER, `。！？`, no spaces. Script normalized with OpenCC as a profile setting; regional vocabulary handled by glossary and context |
| 4 | EN ↔ KO | Easier recognition than Japanese; translation shares the dropped-subject and word-order problems |
| 5 | EN ↔ DE | Clause-final verbs make mid-sentence cuts force guessing; depends on rolling mode locking only settled segments |

Through the medium term every pair includes English, and a session runs one pair. Several languages in one session, or pairs without English, are a long-term possibility once models handle them reliably; they are not designed for now. The per-language profiles and source identifiers keep that option open without building for it.

## Gates

A language ships when it meets written criteria, measured through the real code path. The targets are in [gates](gates.md):

1. A public licensed fixture set, such as FLEURS or Common Voice, plus held-out recordings.
2. Held-out error and deletions over the model's own one-pass decode of the same recordings, under targets set before the run.
3. A stock-phrase and repetition sweep for that language.
4. A translation eval run in both directions.
5. For Japanese only: one field session with diagnostics and no capture failure, and the calibration warning shipped.

Most of the cost of a new language is building its evaluation, so the Japanese eval tooling is built to be reused per language.

## Supporting tracks

These run alongside the language sequence and do not wait for it.

- Capture: source profiles per [lanes](lanes.md) replace the hardcoded browser processing flags, and a source identifier goes on every frame, trace and row. Two simultaneous sources with direction set by source follow the Japanese gate. A native per-app audio helper comes last. Network microphones and phone readers over the LAN are not planned.
- Local translation: the eval scores every planned language from the start, so a Japanese-only local model is not chosen by accident. A no-key path from clone to bilingual captions is the main adoption goal.
- OBS control through obs-websocket from the operator page.
- Worker packaging for a ten-minute install.
- A short screen recording of the overlay over slides and a terminal while the language switches.

## Milestones

Milestones from the original plan with their standing.

| Milestone | Standing |
| --- | --- |
| 0. Confirm implementation choices | Done. Providers, audio format and credential path are in [decisions](decisions.md) |
| 1. Vertical slice: microphone to bilingual captions in OBS | Implemented; real EN then JA in OBS not yet rehearsed |
| Personal companion, pulled forward | Implemented and used live by the owner; group-speech reliability open |
| 2. Rehearsal-safe: reconnection, device loss, preflight, profiles, shortcuts | Bounds, failure categories and a preflight command exist; hotkeys, profiles and session export not started |
| 3. Reusable event and video-call workflow | Not started |
| 4. Benchmark alternative inference: laptop-local, a remote machine on a private network, cloud | Laptop-local benchmarked on a tuning set; remote and cloud not benchmarked |

Deferred on purpose: mixing several microphones into one stream, cross-source echo cancellation, network microphones, speaker attribution, automatic failover, native overlays, synthesized interpretation, hosted or multi-user delivery, accounts and paid tiers.
