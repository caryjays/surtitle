# Development corpus and a second machine

2026-10-28. A second Mac now runs long jobs, and a development corpus of public long-form speech exists for soaks and for finding losses that short clips hide.

## Second machine

The repository runs on a second, faster Mac reached over SSH. Code moves by `git push` to a bare repository on it. `pnpm local:setup`, `pnpm gate:fixtures`, `pnpm check` and `pnpm test:local-unit` pass there, on the same pinned models and fixtures. Long jobs run in `tmux` with logs outside `.local/`. No credentials were copied; nothing it runs calls a paid provider. The ignored `private/` overlay carries only the agent notes, the denylist and the corpus.

Gate results that decide a default still come from the laptop, which is the primary standalone target, because real-time replay output depends on decode speed. This is recorded in [decisions](../wiki/decisions.md).

Setting it up exposed a docs-check bug: `pnpm check` rejected every page dated by an author ahead of the machine's time zone as "in the future". The check now compares with the latest calendar day anywhere, UTC+14. It passed under UTC−11, UTC−7 and UTC+9 clocks, and the old code failed under UTC−7.

## Sources considered

| Source | License | Subtitles | Used |
| --- | --- | --- | --- |
| YODAS2 `en000`, `ja000` | CC BY 3.0 videos only | Uploaded with the video; quality varies from clean to roll-up broadcast captions | yes |
| YODAS2 `en1xx`, `ja100` | CC BY 3.0 | YouTube automatic captions | no: Whisper against similar machine output understates error |
| JTubeSpeech | none found | A list of video IDs and a script that downloads from YouTube | no: YouTube's terms forbid downloading outside its own features |

`ja000` alone is 636 audio shards and 278 GB; one shard holds about 10 hours over 73 videos.

## Selection

`pnpm corpus:fetch --hours 3` reads duration and subtitle files only, screens by fixed rules, lists picks for review, and streams the picked audio from hash-verified shards. Rules: 8 to 40 minutes, subtitles over at least 60% of the time, the expected script, at most 5% music-marked lines, at most 10% roll-up repeats, and 3 to 12 Japanese characters or 1.5 to 4.5 English words per subtitled second.

| | English | Japanese |
| --- | --- | --- |
| Videos screened | 79 | 232 |
| Rejected: length | 57 | 172 |
| Rejected: coverage | 6 | 24 |
| Rejected: rate or music marks | 0 | 5 |
| Excluded on review | 0 | 9 |
| Passed | 16 | 22 |
| Picked, to the hour target | 12, 3.1 h | 13, 3.0 h |
| Length, min / median / max | 10 / 12 / 32 min | 8 / 13 / 30 min |

The first Japanese shard opened with song lyrics, and 6 of the first 10 Japanese picks were news articles read in one style with no punctuation and words split across subtitle lines, likely synthetic narration. The agent read an excerpt of every pick and excluded those six and three whose subtitles read as machine output. English picks needed no exclusions: interviews, podcasts, tutorials and talks. Japanese picks are a seminar, tutorials, a lesson, exercise coaching, news commentary, a lecture reading, travel and product vlogs and a story reading. Little of either set is lecture-style, so it tests breadth rather than the product's main lane.

Audio is 16-bit 24 kHz mono, 1.0 GB in all, stored with subtitles, the manifest and the review list under `private/corpus/yodas/` on the second machine. The manifest uses the held-out format, so `gate.py` can replay and score it, but its references are silver and it is never gate material.

## Replay and scoring

`pnpm corpus:run --manifest private/corpus/yodas/dev.json --segmentation rolling|turns` replays every recording in real time and records the machine's load average, because replay output depends on decode speed. Before the first replay it decodes each recording whole in its known language with the live model, settings and filters, cached per model. `pnpm corpus:score <run folder>` prints aggregates labelled as development numbers, never a gate verdict.

Subtitles paraphrase and skip fillers and music, so absolute rates overstate error. Two measures do not depend on that: live minus whole-file error scored on the same subtitles, and the share of the whole-file text that live replay never displayed, aligned against the whole-file decode itself.

The gate's alignment is pure Python and took 247 s for one 9,000-character pair, about the length of a 30-minute Japanese recording; a full score needs 75 such alignments. The corpus scorer vectorizes the same recurrence with numpy and took 4.6 s on the same pair. Its totals equal the plain scorer's on 200 random pairs in the unit tests; among equally short alignments it prefers fewer deletions, so its deletion counts can be lower than the gate scorer's, never higher.

## Smoke run

`corpus:run --smoke` in rolling mode on the laptop replayed the shortest recording per language, 10.1 minutes English and 8.4 minutes Japanese, in 20 minutes with no failed replay. Load average was 26.7 on 10 CPUs from unrelated work, so its timings are not representative. These are pipeline-check numbers from one recording each, not results:

| | English | Japanese |
| --- | --- | --- |
| Live error against subtitles | 15.7% | 33.1% |
| Whole-file error against subtitles | 12.7% | 32.7% |
| Whole-file text never shown live | 3.0% | 3.8% |
| Forced locks, stock or repetitive rows, wrong language | 0 | 0 |

The Japanese subtitle track diverges from the speech enough that the whole-file decode scores 32.7%, which is why the whole-file comparison carries the signal here.

The laptop's load during the smoke also means today's gate runs may have run under load; their run metadata did not record it. Gate runs now record the load average, and [gates](../wiki/gates.md) asks for a machine without other heavy work.

## First full run, 2026-10-30 and 31

On the laptop overnight, at commit `08f1449`, in this order: corpus rolling, corpus turns, gate rolling, gate turns. Load average medians were 1.4 to 2.1 and maxima at most 4.4. The laptop ran from its internal battery for about four and a half hours in the middle of the rolling corpus run, through most of its Japanese recordings, with Low Power Mode off; every replay's wall time matched its audio length, so nothing paused. No replay failed.

Two recordings are corpus defects and are left out below: one English pick is Russian speech with translated English subtitles, which the script check on subtitles cannot see, and one Japanese pick has text captions over music and no speech, where both modes and the whole-file decode correctly produced nothing. A third Japanese pick has subtitles that paraphrase heavily, so its error against subtitles is high in every mode; it stays in.

| Development corpus | Rolling EN | Turns EN | Rolling JA | Turns JA |
| --- | --- | --- | --- | --- |
| Recordings, minutes | 11, 154.7 | 11, 154.7 | 12, 170.2 | 12, 170.2 |
| Live error against subtitles | 8.5% | 9.1% | 21.8% | 22.8% |
| Whole-file error against subtitles | 7.4% | 7.4% | 22.3% | 22.3% |
| Live minus whole-file | +1.1 pts | +1.7 pts | −0.5 pts | +0.5 pts |
| Whole-file text never shown live | 1.7% | 1.7% | 4.4% | 3.8% |
| Wrong language | 0.0% | 0.0% | 0.7% | 0.2% |
| Lock lag p90, first text p90 | 3.1 s, 8.8 s | | 2.9 s, 8.1 s | |

Forced locks: one per language in rolling. Stock or repetitive rows: none in either mode.

| Gate public set, rerun | Rolling JA | Turns JA | Rolling EN | Turns EN |
| --- | --- | --- | --- | --- |
| Public error | 9.11% | 6.23% | 4.87% | 4.47% |
| Live minus full-clip | 4.00 pts | 1.12 pts | 0.56 pts | 0.16 pts |
| Non-speech rows | 3 | 1 | | |

Turns reproduced its first gate run exactly; rolling did not (10.48% and 5.37 points on the first run), as expected from a mode whose output depends on decode timing. Rolling's non-speech rows were "You" on background noise and "Thank you." twice on instrumental music, rows of 3.2 to 4.0 s, under the 6 s minimum at which the stock-phrase rule applies to a rolling row.

### Where rolling loses Japanese

Aligning each public stream's live text against the concatenated whole-clip decodes and attributing every lost character to its clip: rolling lost 103 of 2,753 Japanese characters, 82 of them in the first quarter of a clip, across 12 of 60 clips; turns lost 6. The first rolling run showed the same pattern, 101 of 142 at clip starts. The affected clips are 10.5 to 14.7 s sentences without a pause, and what is missing is the opening phrase, 4 to 25 characters. English lost 7 of 1,245 words.

Untested mechanism: when a decode returns no accepted segment and the open window exceeds `ROLLING.noiseMs` (3 s), rolling treats the window as noise and drops all but its last second (`packages/providers/local.ts`). Early decodes of a long Japanese sentence, which Whisper returns as one segment, may come back empty or filtered, so the opening is discarded. English yields segments sooner. On the corpus the same effect is diluted, since long recordings hold fewer sentence openings per minute: rolling's never-shown share is 0.6 points above turns in Japanese and equal in English.

## Open

- Confirm the rolling noise-drop mechanism with per-decode logging on the public Japanese stream, fix it, and rerun the gate and corpus in rolling mode.
- Rolling non-speech rows under the 6 s stock-phrase minimum.
- Script checks see only subtitles: add a whole-file language check, or review audio language, before picks are final; replace the two defective picks.
- Rows for a third language are displayed with an unknown language; whether to reject them is a product question.
- More lecture-style material: the shard-order picks are mostly casual. Raising the minimum length or scanning more shards would tilt toward talks.
- Uploaded Japanese subtitles sometimes split words with spaces or paraphrase; the whole-file comparison absorbs this, but absolute rates do not.
