# Decisions

Verified: 2026-10-26 · Sources: none

Append-only, newest last. To reverse a decision, add a new entry and mark the old one superseded.

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-18 | One Node process, one loopback origin, esbuild-bundled plain TypeScript, no UI framework, Zod at every boundary | Fewest moving parts for a one-operator tool |
| 2026-10-18 | The browser AudioWorklet resamples to 24 kHz PCM16 in 50 ms frames; MediaRecorder is not used | Provider PCM contract and exact timing control |
| 2026-10-18 | Service-side energy VAD with 700 ms quiet, 12 s cap and 300 ms pre-roll; turns are transport boundaries | Bounded, testable, provider-independent |
| 2026-10-18 | Identity model: session UUID, display generation, monotonic sequence, epoch for translation jobs; late results only update their own row | Prevents stale or reordered captions |
| 2026-10-18 | Cloud providers for the first slice: `gpt-live-transcribe` over Realtime with local commits, and `gpt-5.6-terra` over Responses with strict JSON and `store: false` | Current provider documentation; deprecated minis avoided. Cloud recognition has never run live |
| 2026-10-18 | Loopback bind, exact Host and Origin, CSP, single control owner, read-only overlays, no secret in the browser | Local hosting does not excuse open access |
| 2026-10-21 | Local-first: MLX Whisper in an isolated stdio Python worker behind the existing `Transcriber` seam, with no provider framework | Local recognition became a hard requirement after a venue run on shared Wi-Fi |
| 2026-10-21 | Turbo Q4 over Small Q4; keep the 12 s cap | Better EN WER and JA CER on the tuning set; 6 s and 8 s caps hurt Japanese |
| 2026-10-21 | `dev:local` and `start:local` never load `.env`; every launch defaults to local recognition with translation off | No paid stage by accident |
| by 2026-10-24 | Listen profile: local recognition plus cloud translation; Conversation is per-turn auto, Lecture is `ja-en`; a preset change commits the current turn with its old hint; no session cap for local; 60-row history; four-row frozen context; previews need two agreeing hypotheses | Personal lecture and conversation use before OBS |
| by 2026-10-24 | Silence fix: CPU Silero gate before Whisper, 1.5 s room calibration, browser AGC off, glossary no longer injected into Whisper, repetition rejection in worker, adapter and controller | The first physical-microphone test hallucinated in silence and fed paid translation |
| by 2026-10-24 | Diagnostics are opt-in, content-free, schema-bound and browser-held until explicit download | Field debugging without retaining anyone's speech |
| after 2026-10-24 | Version-2 turn telemetry: per-turn boundary, timing, language, filter and translation metadata through a strict `TurnTrace`, with no behavior change | Version-1 logs could not separate splitting from loss |
| after 2026-10-24 | The reader renders only on caption changes and reuses the network-validated snapshot | Sluggishness was reported after the telemetry upgrade |
| 2026-10-26 | Noisy-Japanese experiment: no live default changed | Lower thresholds matched baseline; faster previews did not speed finals; an 8 s cap hurt CER |
| 2026-10-26 | Documentation split into a present-tense wiki and a dated log, with `pnpm docs:check` inside `pnpm check` | Stacked dated sections across twelve files went stale and contradicted each other |
| 2026-10-26 | The repository is public by default under Apache 2.0; personal context lives only in the ignored `private/` overlay, which agents read after the tracked `AGENTS.md`; the glossary resolves to the private file when present and to a tracked generic example otherwise | One codebase keeps a public profile current without porting; a scrubbed fork would rot |
| 2026-10-26 | `pnpm docs:check` scans every commit-eligible file for leak patterns and a private denylist, and refuses links from public docs into `private/` | A future session log is the likeliest place for a private detail to slip |
| 2026-10-26 | Project named Surtitle, the theatre term for live translated text above a stage | Language-neutral so other language pairs can follow; descriptive of live-event use; no competing software uses the name and the npm, PyPI and GitHub names were free |
