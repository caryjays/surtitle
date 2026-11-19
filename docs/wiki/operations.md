# Operations

Verified: 2026-11-19 · Sources: package.json, apps/service/main.ts, apps/web/control.html, scripts/local/download_models.py, scripts/local/download_vad.py, scripts/local/download_fixtures.py

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
| `LANGUAGE_PAIR=en-es pnpm dev:offline` | start in the Spanish pilot pair, or `en-fr`, `en-it`, `en-pt`; the console's Session panel also switches the pair while paused |

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

## Rehearsal under load

A rehearsal checks the live path that replays cannot: a real microphone and room, with the Mac under presentation load. It takes about an hour. Results go in a dated log entry as aggregate numbers; personal notes go in `private/`.

Before:

1. Mains power, other heavy work closed, and the microphone you would use on the day, near the speaker. `pnpm preflight:offline` passes.
2. `pnpm dev:offline`, then `/control` in Chrome. Under Diagnostic log click Start diagnostics; the status says "turn details available". Under Text & spacing enable Show caption diagnostics.
3. In OBS, the overlay as in [OBS](#obs) above a slide deck, and the deck presented. Keep OBS running throughout; the load is part of the test.
4. Pick the microphone, Start, and keep the room quiet through calibration. Check the Actual input line.

During, with Mark problem now at any wrong, late or missing caption:

1. Japanese pair, Auto: ten minutes of talk-like speech in English and Japanese, sentences of every length, with natural pauses, and at least one switch of language at a pause. Watch for rows that show English text in Japanese or the reverse, and for any row that shows its original with no translation.
2. Ten minutes with macOS Voice Isolation on, if Control Center offers a Mic Mode for Chrome, then ten with it off, the same kind of speech.
3. Pause. Switch the pair to `en-fr` (or another Latin pair) in the Session panel, Start, and speak five minutes of English with some French or the pair language.
4. Two minutes from across the room at a normal level, and one minute quieter, to see the masked-speech warning if it comes.
5. Reload the OBS source once and switch scenes once; captions continue.

After:

1. Download diagnostics JSON before closing anything; a reload loses the buffer.
2. `pnpm diag:latency <file>` reports speech to translated text and to display for each Start.
3. Note the load the Mac was under, and anything the log cannot hold: what was said where a mark was made, and how the captions read.

The log tells: last word to first translated text against part 6's targets of a 3.0 s median and 4.5 s p90, rows rejected and why, input levels against the gate, the capture settings Chrome applied, and any automatic recognizer restart. It cannot tell whether a caption was right.

## Failure ladder

- Translation fails: originals continue; a category appears on `/control`.
- Recognition or capture fails: captions stop visibly; click Start.
- Venue network fails: `dev:local` and `dev:offline` keep working; cloud translation does not.
- Application fails: switch to a rehearsed off-the-shelf app agreed in advance.

Live cloud translation sends speech-derived text off the laptop. Agree notice and consent with organizers before using it on other people.
