# Show text early becomes the default; field session accepted

2026-11-12. Three decisions by the maintainer, and the check that [early text](2026-11-12-early-text.md) listed before a default. No paid calls. Aggregates only.

## Decisions

- Show text early is on by default. The overlay URL takes `early=off` to hold a rolling row's text until it locks; the operator page's checkbox starts ticked. A browser that saved the setting earlier keeps what it saved.
- Gate part 5, the field session, counts as met by the 24.5-minute microphone session in [the session entry](2026-11-12-en-es-microphone-session.md). It is under the 30 minutes the part asks for and its speech was English and Spanish; both are recorded under accepted limits in the gates page, and the part's wording is unchanged.
- No language detection inside a row for now: changes of language were followed well in recent sessions.

## Streams that must show nothing

The gate's third-language and non-speech streams, replayed in real time through the rolling provider on the gate's stream files, counting rows that showed any agreed or locked text before being rejected. A row here is a stretch the recognizer opened.

| Stream | Length | Rows opened | Rows kept | Rejected rows that had shown text |
| --- | --- | --- | --- | --- |
| Third language, `en-ja` pair | 6.1 min | 58 | 0 | 0 |
| Third language, `en-es` pair with neighbour languages | 12.0 min | 115 | 0 | 0 |
| Music | 13.2 min | 3 | 0 | 0 |
| Background noise | 24.5 min | 34 | 0 | 0 |

No text showed early on any of them: agreed text is held back while a row has no locked text and its decode is under the confidence floor, and a stretch in another language is reset before three decodes agree.

## Not done

- The applause stream: the file on disk is a few seconds from a smoke run, so it was not replayed.
- The three-decode rule in a microphone session; the maintainer's session used the two-decode version.
- The gate's lock lag and first text still measure locked text. Measuring shown text is a change to the gate.

## Checks

`pnpm check` and `pnpm test:browser` pass; the browser check now expects agreed text on a plain overlay URL and locked text only with `early=off`.
