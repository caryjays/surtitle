# A host load probe for rehearsals; French and Portuguese read-throughs

2026-11-19, after [the first rehearsal under load](2026-11-19-rehearsal-under-load.md). No paid calls. The read-throughs read the ignored `review/` folder under its rule; aggregates only.

## Host load probe

In the rehearsal, French translation requests stepped from under 1 s to 3 to 6 s partway through, short rows included, and the diagnostics could not say why. The candidates were OBS, another app, thermal throttling on a fanless Mac, or the application. The service now runs a sampler, `scripts/local/host_probe.py`, beside local recognition on macOS. Every 2 s it reports each group's GPU busy share (the captions workers, OBS, the browser, the display server, the rest), the thermal state, Low Power Mode and the power source. Its readings go to the snapshot, the Health panel, the content-free `health` diagnostic and a per-minute table in `pnpm diag:latency`. See [diagnostics](../wiki/diagnostics.md#host-load).

How it reads, checked on this Mac:

- Per-process GPU time comes from the `AppUsage` of each Metal client in `ioreg -l`, without privileges, in about 15 ms. `ioreg` prints a node's properties alphabetically, so a client's `AppUsage` comes before its `IOUserClientCreator`. A first parser that paired them by order credited each client's time to the next client, and a test load showed up under an unrelated process. The parser now pairs them per node, and a Python test holds the layout.
- With the fix, an MLX matrix-multiply loop started by the probe's parent read as 93 to 94% `ours` over three samples. With no load, all groups read under 2%.
- IOKit's `Device Utilization %` read between 0 and 46% while that loop kept the GPU over 90% busy, so the probe does not use it.
- The thermal state and Low Power Mode come from NSProcessInfo through the Objective-C runtime with ctypes, with no PyObjC. Both read nominal and off at rest. A state above nominal has not been seen yet.
- In a live `dev:local` service, the snapshot carried the sample and the probe exited with the service.
- On a synthetic diagnostics file, `pnpm diag:latency` showed a request-time step in the same minute as a rise in OBS share.

Not verified: the probe under a real rehearsal with OBS showing its preview, and a thermal state above nominal.

## French and Portuguese read-throughs

Four agent sessions, one per direction, graded the `local` translations in `review/fr/cloud/` and `review/pt/cloud/`. These are the offline profile re-translated as live over the rows of [the comparison](2026-11-19-local-vs-cloud-haiku.md). They used the rubric in [gates](../wiki/gates.md#translation-read-through), read each talk whole and ignored the cloud translations. One judge, one model family, the family of the session that wrote this entry. The grades are kept as `<id>.local.grades.json` beside each transcript.

| Direction | Talks | Rows graded | Rows with a recognition error | Mean grade, clean rows | Clean rows at 2 or lower | Invention, all rows | Rows without a translation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| French to English | 6 | 370 | 46 (12%) | 4.58 | 4 (1.2%) | 3 (0.8%) | 9 |
| English to French | 6 | 288 | 38 (13%) | 4.16 | 8 (3.2%) | 6 (2.1%) | 1 |
| Portuguese to English | 6 | 267 | 32 (12%) | 4.67 | 2 (0.9%) | 2 (0.7%) | 1 |
| English to Portuguese | 6 | 277 | 34 (12%) | 4.26 | 3 (1.2%) | 3 (1.1%) | 3 |

Part 4's targets are a mean of at least 4.3, no clean row at 2 or lower, and invention on at most 2%:

- French to English and Portuguese to English meet the mean and the invention targets. They miss only the low rows, by 4 and 2.
- English to Portuguese misses the mean narrowly and the low rows.
- English to French misses all three, invention by 0.1 point.

This does not stand in for part 4. Into English, Portuguese and French have the two highest means of the ten directions read so far, and Portuguese has the fewest grade-3 rows.

What the four read-throughs share with Italian and Japanese:

- Into English, the losses are a subject or person picked wrong where the source leaves it out, idioms and slang taken literally, and names and terms that change within a talk.
- In French to English, sentences split across rows are a source of their own: a fragment translated without the rest of its sentence can come out with the opposite meaning.
- All nine French rows without a translation had empty recognized text. In Italian, most rows without a translation had recognized text that came back unresolved.
- Out of English, the earnings calls grade lowest and the biotech calls highest, as into Italian and Japanese. Finance and oil-field terms take their everyday sense and change within a call, and misheard jargon is carried literally.
- The errors that cost a grade point are specific to the output language. French has wrong noun gender, agreement slips, coined non-words and English words left in place, and keeps formal address throughout. Portuguese has wrong gender, Brazilian and European forms mixed within the industrial calls, and address that drifts within an answer.
- Recognition errors account for most of the damage in a few talks: a sung opening, a comic talk and a music talk. The translator renders the misrecognized text faithfully.
- Numbers and percentages carry accurately in all four directions, with two small slips into English.

## Next

1. Repeat the French Start of the rehearsal with the probe running, and read the per-minute table.
2. A larger local model or a term list kept during the talk remain the candidates for the losses out of English. Translation quality stays parked by the maintainer's call.
