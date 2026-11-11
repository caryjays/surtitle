# An `en-es` microphone session: the overlay window and a language change inside a row

2026-11-12. The maintainer ran a session in `en-es` through the microphone with offline translation and diagnostics on, and stopped it after about nine minutes with two problems. This entry reads the diagnostics download, which holds no speech text, and records both fixes. No paid calls.

## The session

- About five minutes in turns mode, the page's default, then rolling from the next Start.
- The browser applied echo cancellation, noise suppression and automatic gain.
- Rolling, Spanish: 20 rows, all translated; translation request time 0.7 to 3.0 s.

## A long translation pushed out by short rows

A row of 8.3 s of audio closed, and its translation arrived 1.9 s later. Within the next 6 s three rows of 1.4 to 1.8 s each closed and were translated. The overlay's window is bottom anchored and about four translation lines tall; a short row with its translation takes about half of it. Translations are released at reading pace in row order, so the long one was still being released when the short rows' originals, which are a separate lane, took the bottom of the window and pushed it out.

Fix, `apps/web/audience.ts`: the window follows the translation being read. The earliest shown row whose translation is pending or not all released keeps that text inside the window; later rows that would show only in part below the window are hidden until the roll returns to its bottom anchor. With translation off nothing changes. `pnpm test:browser` replays the case through a mocked overlay socket: a long translation in release and three short rows after it. The cost is that the originals of later rows show late while a long translation is read; whether that reads well is the maintainer's to judge in a session.

## No rows after a change to English

The last row began in Spanish, locked text 3.7 s in, and stayed open for 72 s until the pause: 75 decodes, 40 segments dropped as low confidence, lowest log probability −1.76, nothing more locked. The talker had gone on in English inside the row without a pause.

In Auto a row keeps the language of its first locked text, and every later decode is forced to it. English decoded as Spanish was filtered; a window over 3 s with no segments is trimmed to its last second, and the rule that makes Auto detect the language again applied only to a row with no text. This row held text, so the next window was forced to Spanish again, for as long as the stretch lasted. The Spanish text it held also waited those 72 s for its translation.

Fix, `packages/providers/local.ts`: a noise trim closes a row that holds text, boundary `length`, and the stretch goes on in a new row, which in Auto detects its language afresh. A rolling test with a fake worker that hears a second language as low-confidence text in the first fails without the change.

## What the fix does not cover

Replays of public gate clips through the rolling provider in real time, Spanish then English with no pause, one or two runs each:

| Change of language | Result |
| --- | --- |
| At the end of a Spanish sentence | The next row is English |
| 5 s into a Spanish sentence | The 11 s of English that follow lock as Spanish text in the Spanish row: of 49 words, 38 are in the Spanish references only and none in the English only. The row closed at 15.7 s of audio; the same before and after the fix |

When the forced decode stays confident, Whisper writes the English speech as Spanish, a translation shown as the original, until the row closes; the next row detects again. The damage is bounded by the row. Catching it needs detection during a row. One detection call takes about 310 ms, a full encoder pass, against a decode every second, and on 2 s and 5 s windows of four English clips it gave English 0.99 or more. It is not built: a row's language is kept because detection on short windows is upset by loanwords in the Japanese pair, so a rule that lets detection override it needs the language simulator and a gate run first, and recognition tuning is paused.

## A second session, with both fixes

The maintainer ran 24.5 minutes in rolling with offline translation and reported being pleased with it. From the diagnostics download:

| Measure | Value |
| --- | --- |
| Rows translated | 186 of 186 shown: 115 English, 71 Spanish |
| Rows rejected | 7, none shown |
| Changes of language between shown rows | 10, each followed by rows in the new language |
| Longest row | 17.4 s of audio; no row stayed open as in the first session |
| Lock lag, median and p90 | 2.1 s, 3.7 s |
| First text, median and p90 | 5.2 s, 9.8 s |
| Speech end to final, median and p90 | 2.0 s, 3.7 s |
| Translation request, median and p90 | 1.9 s, 2.8 s |
| Recognizer restarts, queued decodes, translation failures | 0, 0, 0 |

Lock lag and first text sit over the gate's targets by about what the gate runs show. The download cannot tell whether a change of language fell inside a row, so it does not show the row close at a noise trim at work; it shows no stuck row. The overlay window rule is seen only through the maintainer's report.
