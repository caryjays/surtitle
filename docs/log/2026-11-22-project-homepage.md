# Project homepage

2026-11-22

## Change

Added a standalone static homepage in `site/`, with a project introduction, an explicitly illustrative English/Japanese caption example, GitHub and documentation links, setup commands for local captions and offline translation, a paid-cloud disclosure, and an OBS walkthrough. The page uses local CSS and SVG artwork, system fonts and a small script for direction, profile and copy controls. No dependencies were added.

The default instructions keep translation off. Offline translation has a separate setup choice. Language readiness follows the wiki rather than treating every selectable language as released. README links to the page and documents its loopback preview command. The caption application and live defaults are unchanged.

## Verification

Browser inspection covered desktop at 1440 pixels and mobile at 390 pixels, with a further overflow check at 320 pixels. Both mobile widths fit the document without horizontal page overflow. Direction switching updates the source, translation and language attributes. The offline setup selector shows the translator setup and preflight commands; copy commands and copy overlay URL returned the expected clipboard text. The cloud disclosure expands. No browser warnings or errors were reported.

JavaScript syntax, local asset and anchor references, repository documentation/privacy checks, and the ordinary `pnpm check` suite are the handoff checks. The preview command is `python3 -m http.server 4173 --bind 127.0.0.1 --directory site`; the page also opens directly from `site/index.html`.

## Scope and handoff

No recognition or translation backend ran, no model was downloaded, and no paid call, microphone session or OBS rehearsal was performed for this static page. Existing live-path verification gaps remain in the status page. Nothing was pushed or deployed. Publication needs maintainer approval under the repository's standing rule; the site can be served by a static host after that decision.

## Completed checks

`pnpm check` passed: typecheck, all 209 ordinary tests, the documentation/privacy scan and the build. The first full test run failed one existing timing assertion in `tests/rolling.test.ts`; all 36 tests in that file passed in isolation, then the full suite passed. The initial sandbox run could not open the test runner's IPC socket, so the suite ran with that permission granted. Explicit separators in the homepage's SVG path avoid a false positive in the address leak scan. Static references, JavaScript syntax and `git diff --check` passed. No live caption behavior was changed to address the test failure.

## Review pass

A review the same day found that the README and the status page, already committed, link to `site/` and to this entry while both are still untracked, so those links are dead in the published repository until the files are committed or the lines are withdrawn. That is left to the maintainer, with the publication decision.

Fixed on the page: the OBS section named a heading id that did not exist; the clone command ran off the terminal box on a phone, and now each command wraps under itself; the demo's footer line met the caption box at 320 pixels, and the demo is now laid out in flow rather than by fixed positions; the decorative caption no longer announces itself as a live region. The setup steps are numbered from the install commands, and the microphone step names Chrome's permission prompt and where the input picker is. The row for this entry in the log index moved to its place in date order.

The stylesheet was rewritten mobile-first with system fonts, looser heading tracking, a dark palette that follows the system setting, and no `!important` size overrides. Sharing metadata was added without an image or address, since no host exists.

The README's quick start told `dev:local` users to stay quiet through calibration. Only the translation profiles calibrate, as [recognition](../wiki/recognition.md) says, and the sentence now says so.

Checked in headless Chrome at 1440, 820, 390 and 320 pixels in the light palette, and at 1440, 390, 320 and 300 in the dark one. A scripted run switched the setup profile and the caption direction and copied the commands, with the clipboard stubbed; the copied text matched the seven offline commands and the page had no horizontal overflow. Real clipboard access was not exercised. `pnpm check` passed afterwards: typecheck, all 209 ordinary tests, the documentation and privacy scan, and the build.
