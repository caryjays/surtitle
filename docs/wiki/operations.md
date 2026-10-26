# Operations

Verified: 2026-10-26 · Sources: package.json, apps/service/main.ts, apps/web/control.html, scripts/local/download_models.py, scripts/local/download_vad.py, scripts/local/download_fixtures.py

Requirements: Apple Silicon Mac, Node 22.9 or later, pnpm, uv, ffmpeg, Google Chrome.

## Commands

| Command | Does |
| --- | --- |
| `pnpm install` | Node dependencies |
| `pnpm local:setup` | Python venv, pinned models, speech detector and public fixtures; repeatable |
| `pnpm check` | typecheck, fake-provider tests, docs check, build |
| `pnpm dev:local` | build and run original-only local mode without `.env` |
| `pnpm preflight:listen` | presence checks for key, model files, detector and Python; no API call |
| `pnpm dev:listen` | build and run local recognition with cloud translation |
| `pnpm build` then `pnpm start:local` or `pnpm start:listen` | run the built service |
| `LOCAL_MODEL=small-q4 pnpm dev:local` | try the smaller model |
| `LOCAL_PREVIEWS=off pnpm dev:listen` | disable source previews |

After editing source, stop the service, run the `dev:*` command again and reload `/control`. A build alone changes nothing that is running.

## Listening session

1. `pnpm preflight:listen`, then `pnpm dev:listen`. Open `http://127.0.0.1:4317/control` in Chrome.
2. Choose Conversation · EN ↔ JA or Lecture · Japanese → English. Under the diagnostics disclosure pick the microphone; names appear after permission. Reload resets this to System default, so check the Actual input line after Start.
3. Click Start microphone. Wait through model warmup and the 1.5 s calibration, during which the whole room must be quiet. Speak when the activity line says Listening.
4. Read. Scrolling back pauses Follow latest; Jump to latest resumes it. Text & spacing adjusts sizes and width. Preview long conversation works only while paused.
5. For Japanese-only Q&A switch to Lecture while active; the next turn uses the new direction. Translate now finalizes a long turn without stopping.
6. If room noise changes, click Recalibrate room noise during a quiet gap. It clears history and pending translations.
7. Pause releases the microphone. Clear screen drops history and restarts the worker. To use the built-in microphone: Pause, select it, Start.

Keep the tab open and the Mac awake and powered. Paid requests begin after Start and only for finalized speech.

## OBS

1. Start the service and capture in Chrome first.
2. Add a Browser Source with Local file unchecked, URL `http://127.0.0.1:4317/overlay`, 1920 × 1080 to begin. `localhost` is refused.
3. Place it above slides, Chrome, Ghostty or camera sources. No permission prompt should appear.
4. Test source reload and scene switching: capture must continue, and the overlay recovers from a snapshot without new inference.
5. Disconnect the overlay to confirm captions disappear within 6 s.

For an in-person event use an extended display with the fullscreen projector and keep `/control` off the projected screen. OBS Virtual Camera carries video only; pick the microphone separately in a call. These steps are implemented URL and layout contracts; an OBS rehearsal has not been performed. See [status](status.md).

## Failure ladder

- Translation fails: originals continue; a category appears on `/control`.
- Recognition or capture fails: captions stop visibly; click Start.
- Venue network fails: `dev:local` keeps working; cloud translation does not.
- Application fails: switch to a rehearsed off-the-shelf app agreed in advance.

Live cloud translation sends speech-derived text off the laptop. Agree notice and consent with organizers before using it on other people.
