# Status

Verified: 2026-10-28 · Sources: none

This is the handoff page. Rewrite it at the end of every session; `pnpm docs:check` warns when it is older than 14 days. Personal observations belong in `private/`, technical ones here.

## Where things stand

Direction is set in the [roadmap](roadmap.md): an open-source, presenter-controlled caption layer pairing English with one other language per session, Japanese first, then Romance languages, Chinese, Korean and German, each behind a written gate. Stage 0 is in: the pair is configured by `LANGUAGE_PAIR` with one profile per language in `profiles/languages.json`, and English and Japanese are the only profiles; see [language pair](../log/2026-10-27-language-pair.md). No language is added until Japanese passes its [gate](gates.md), whose targets and tooling exist. Its first public and non-speech run failed in both segmentation modes; see [the entry](../log/2026-10-28-japanese-gate.md).

The default profile is local Turbo Q4 with translation off. The listen profile, local recognition with cloud translation, has been used at a live conference with OpenAI Terra. An Anthropic Haiku 5.5 translator exists behind `TRANSLATION_PROVIDER=anthropic` and has only run against fake responses; see [its log entry](../log/2026-10-26-anthropic-translator.md). `pnpm eval:translation` compares OpenAI, Anthropic and local chat-completions translators on frozen public recognizer output; its first paid run found Haiku 5.5 level with Terra on quality and speed at about a twelfth of the cost, Sonnet 5.5 slightly better with a slow tail, and no model repairing recognition errors that need domain inference. See [the eval entry](../log/2026-10-26-translation-eval.md) and [the first results](../log/2026-10-26-first-translation-eval.md).

Automated and passing on 2026-10-27: `pnpm check`, `pnpm test:local-unit`, `pnpm test:browser`, `pnpm test:local-browser`, `pnpm test:listen-browser`. Details in the log entries for [the review](../log/2026-10-26-review-and-wiki.md) and [the public split](../log/2026-10-26-public-private-split.md).

Observed in the field by the maintainer:

- Lecture and Q&A with about 50 people on shared Wi-Fi: local recognition smooth; most translations readable including loanwords; translation lag of 2 to 3 s acceptable; some loanword phrases upset language detection; proper names confused.
- Breakout and group sessions: heavy false rejection. In the last logged interval 39 of 51 candidates were rejected, 30 of them by the speech gate before Whisper, with the energy gate threshold at its 0.004 floor. Raising the hardware input level helped noticeably. The final capture failure was an intentional unplug.

Not verified: Haiku 5.5 translation quality, latency and refusal rate against Terra; OBS Browser Source rehearsal and browser-to-terminal scene continuity; the fixed physical-microphone silence path; a lecture-length soak under thermal load; measured end-of-speech to display latency; held-out accuracy beyond the tiny tuning set.

Experiment: the controlled noisy-Japanese run promoted nothing. Weaker gates matched baseline, faster previews did not speed finals, an 8 s cap hurt accuracy, and the room's rejection was not reproduced. See [NOISY-EXPERIMENT](../log/NOISY-EXPERIMENT.md).

## Open problems, ranked

1. Group-speech false rejection. Two untested hypotheses from the 2026-10-26 code review: Chrome's `echoCancellation` and `noiseSuppression` are hardcoded on in `apps/web/control.ts` and attenuate distant or overlapping speech; and audio reaches Silero with no level normalization while field levels were far below the faint fixture of about 0.015 RMS. Next: add per-turn RMS and peak to `TurnMeasurement` and the applied track settings to `health`; add operator toggles for the two Chrome flags; sweep faint fixtures to −18, −24 and −30 dB offline; if the gate rejects, trial deterministic per-turn gain in the worker before the gate.
2. Capture hard-fails on recoverable local conditions. A third queued final or one 12 s inference timeout requires a manual Start. Candidate: a visible automatic worker restart, and dropping the oldest queued final as `skipped`.
3. Recalibration erases reading history. Keep finalized rows; cancel only pending translations and context.
4. First text waits up to 12 s on continuous speech. Previews do not shorten first finals. A speech-aware boundary would need the gate on the Node side.
5. Language drift and proper names in Japanese Q&A. Forced Lecture mode is the workaround.
6. Minor: snapshots are serialized once per client per tick; a pause that exceeds its drain window reports "recognition unavailable"; torch is installed only for a 2 MB VAD model.

## Standing priorities

- Local recognition stays a hard requirement. Cloud recognition is not a substitute.
- Live defaults stay frozen until a controlled comparison shows a benefit.
- No paid calls, audience recording, remote exposure or publishing without explicit authorization.
- The OBS presentation stack comes after the personal companion is reliable.

## Housekeeping

The project is now named Surtitle in the package, README, NOTICE and wiki; the working directory and the Git remote still carry the old name until the maintainer renames them. The tree is prepared for a fresh public history: personal context moved to the ignored `private/` overlay, Apache 2.0 license and NOTICE added, leak scan wired into `pnpm check`. The existing single commit still contains the pre-split documents, so the first public commit should start a new history rather than build on it. Dev dependencies `typescript`, `esbuild` and `@types/node` are behind by major versions; not urgent.

## Next session

1. Recognition first: own recordings show segmentation losing 11 to 50% of speech, cuts at the 12 s cap triggering most translation invention, and file-name terms no translator recovers; see [prompt variants](../log/2026-10-26-prompt-variants.md). A 29-minute held-out set confirms that deletion at cap boundaries dominates live error and adds stock-phrase hallucinations and a silent calibration failure; see [held-out transcription](../log/2026-10-26-held-out-transcription.md). The stock-phrase quality rule is in. An offline simulation of a rolling window re-decoded every second, which locks text two decodes agree on, cut display lag from about 13 s to under 1.5 s and Japanese CER from 12.5% to 3.8% on that set; see [rolling-window simulation](../log/2026-10-26-rolling-window-simulation.md). The live design is proposed in [rolling recognition design](../log/2026-10-26-rolling-recognition-design.md): settled text only on the overlay, released by a reading-pace pacer, one translation per row. An hour-long soak held decode time flat, and word-level locking was measured and rejected. The maintainer approved building it. Steps 1 to 3 are in: worker segment ends, and rolling mode behind `LOCAL_SEGMENTATION=rolling`, which replayed on the held-out set at 2.3% WER and 4.2% CER with no forced locks; see [rolling replay](../log/2026-10-27-rolling-replay.md). Next: step 4, the `stable` field, a reading-pace pacer and roll-up rendering; then the calibration warning, the vocabulary prompt with silence checks, and the lost opening speech.
2. The Japanese gate has targets in [gates](gates.md) and tooling: `pnpm gate:fixtures`, `gate:run` and `gate:score`. The first run, public and non-speech only, failed: rolling loses Japanese text on read FLEURS clips that the full-clip decode keeps, turns misses the Japanese public target narrowly, and background noise produced one English row in each mode; see [the entry](../log/2026-10-28-japanese-gate.md). Next: compare rolling and full-clip output per Japanese clip to find the loss, decide on whole-row English stock phrases such as "you", fix and rerun. The held-out set, at least 20 minutes per language of new speech with hand-corrected references under `private/`, needs the maintainer. `scripts/replay-cases.ts` still hardcodes English and Japanese language mapping. Stage 0 left two profile fields for later: recognition hints, which wait on the vocabulary prompt, and a script setting, which waits on Chinese. The step 4 pacer rates belong in the profiles.
3. Translation is paused until transcription improves. Haiku with the cut flag (`~cut`) is the leading low-cost candidate; it still needs the held-out run, an OpenAI-judge cross-check and a local candidate, Qwen3.5-4B first, with Gemma 4 and HY-MT 1.5 as further candidates. The local eval should score every planned language. Defaults stay frozen until then.
4. The perceived later-session slowdown is not translation or decode time per the field stage timings; it tracks long turns, fewer previews and rejections. The controlled local replay of identical audio is the next step there.
5. Rename the working directory, create the fresh initial commit, create the `surtitle` repository, then publish when ready.
6. Diagnostics additions and source profiles, which replace the two planned capture toggles: Close mic, Line feed, Far field and App audio, per [lanes](lanes.md), with the active profile in `health` and diagnostics, and a source identifier on frames, traces and rows. Restart and reload; confirm with `pnpm test:browser`.
7. Faint-level sweep with the noisy harness.
8. Room session with diagnostics on, comparing Chrome processing on and off; download the log.
9. Availability changes for problem 2, then recalibration for problem 3.
