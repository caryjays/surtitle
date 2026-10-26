# Roadmap

Verified: 2026-10-26 · Sources: none

Milestones from the original plan with their standing. Detail lives in [status](status.md).

| Milestone | Standing |
| --- | --- |
| 0. Confirm implementation choices | Done. Providers, audio format and credential path are in [decisions](decisions.md) |
| 1. Vertical slice: microphone to bilingual captions in OBS | Implemented; real EN then JA in OBS not yet rehearsed |
| Personal companion, pulled forward | Implemented and used live by the owner; group-speech reliability open |
| 2. Rehearsal-safe: reconnection, device loss, preflight, profiles, shortcuts | Bounds, failure categories and a preflight command exist; hotkeys, profiles and session export not started |
| 3. Reusable event and video-call workflow | Not started |
| 4. Benchmark alternative inference: laptop-local, a remote machine on a private network, cloud | Laptop-local benchmarked on a tuning set; remote and cloud not benchmarked |

Deferred on purpose: remote call audio, echo and deduplication, multi-microphone mixing, speaker attribution, automatic failover, native overlays, synthesized interpretation, hosted or multi-user delivery.
