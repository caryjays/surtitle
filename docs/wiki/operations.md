# Operations

Verified: 2026-11-14 · Sources: package.json, apps/service/main.ts, apps/web/control.html, scripts/local/download_models.py, scripts/local/download_vad.py, scripts/local/download_fixtures.py

Requirements: Apple Silicon Mac, Node 22.9 or later, pnpm, uv, ffmpeg, Google Chrome.

## Commands

| Command | Does |
| --- | --- |
| `pnpm install` | Node dependencies |
| `pnpm local:setup` | Python venv, pinned models, speech detector and public fixtures; repeatable |
| `pnpm local:setup-translator` | the pinned local translation model, about 3 GB; resumes an interrupted download; repeatable |
| `pnpm check` | typecheck, fake-provider tests, docs check, build |
| `pnpm dev:local` | build and run original-only local mode without `.env` |
| `pnpm preflight:listen` | presence checks for key, model files, detector and Python; no API call |
| `pnpm preflight:offline` | presence checks for the recognition and translation models, detector and Python |
| `pnpm dev:offline` | build and run local recognition with local translation, without `.env` |
| `pnpm dev:listen` | build and run local recognition with cloud translation |
| `pnpm build` then `pnpm start:local`, `pnpm start:offline` or `pnpm start:listen` | run the built service |
| `LOCAL_MODEL=small-q4 pnpm dev:local` | try the smaller model |
| `LOCAL_PREVIEWS=off pnpm dev:listen` | disable source previews |
| `LOCAL_SEGMENTATION=turns pnpm dev:local` | start in turns recognition instead of rolling; the console's Session panel also switches it while paused |
| `LANGUAGE_PAIR=en-es pnpm dev:offline` | start in the Spanish pilot pair; the console's Session panel also switches the pair while paused |

After editing source, stop the service, run the `dev:*` command again and reload `/control`. A build alone changes nothing that is running.

## Listening session

1. `pnpm preflight:listen`, then `pnpm dev:listen`; or `pnpm preflight:offline`, then `pnpm dev:offline`, for translation on this Mac with no key and no network. Open `http://127.0.0.1:4317/control` in Chrome.
2. In the Session panel choose the language pair, if not the one the service started in, and the direction: Auto, or one fixed direction for a lecture. Under the diagnostics disclosure pick the microphone; names appear after permission. Reload resets this to System default, so check the Actual input line after Start; it also shows the echo cancellation, noise suppression and automatic gain the browser applied.
3. Click Start microphone. Wait through model warmup and the 1.5 s calibration, during which the whole room must be quiet. Speak when the activity line says Listening.
4. Read. Scrolling back pauses Follow latest; Jump to latest resumes it. Text & spacing adjusts sizes and width. Preview long conversation works only while paused.
5. For a stretch in one language, switch to that fixed direction while active; the next turn uses it. Translate now finalizes a long turn without stopping.
6. If room noise changes, or a notice says sound that rises and falls like speech is staying under the noise gate, click Recalibrate room noise during a quiet gap. Finished captions stay; speech still being recognized at that moment is dropped, pending translations are cancelled and later translations start without earlier context.
7. Pause releases the microphone. Clear screen drops history and restarts the worker. To use the built-in microphone: Pause, select it, Start.

Keep the tab open and the Mac awake and powered. With `dev:listen`, paid requests begin after Start and only for finalized speech.

## OBS

1. Start the service and capture in Chrome first.
2. Add a Browser Source with Local file unchecked, URL `http://127.0.0.1:4317/overlay`, 1920 × 1080 to begin. `localhost` is refused. Add `?lines=3` to change the caption window's height in translation lines, 1 to 8, `pace=off` to show locked text at once, or `early=off` to hold rolling text until it locks, which is later but never rewritten on screen, for example `/overlay?lines=3&pace=off`. The console's Overlay for OBS panel builds and copies this URL, and its Audience view shows the result.
3. Place it above slides, Chrome, Ghostty or camera sources. No permission prompt should appear.
4. Test source reload and scene switching: capture must continue, and the overlay recovers from a snapshot without new inference.
5. Disconnect the overlay to confirm captions disappear within 6 s.

For an in-person event use an extended display with the fullscreen projector and keep `/control` off the projected screen. OBS Virtual Camera carries video only; pick the microphone separately in a call. The maintainer has rehearsed the overlay in OBS with English, Japanese and off-pair speech; steps 4 and 5 are covered by the browser checks and were not part of that rehearsal. See [status](status.md).

## Failure ladder

- Translation fails: originals continue; a category appears on `/control`.
- Recognition or capture fails: captions stop visibly; click Start.
- Venue network fails: `dev:local` and `dev:offline` keep working; cloud translation does not.
- Application fails: switch to a rehearsed off-the-shelf app agreed in advance.

Live cloud translation sends speech-derived text off the laptop. Agree notice and consent with organizers before using it on other people.
