# Piece translation quality, read against rows

2026-11-10. The [piece translation](2026-11-09-piece-translation.md) entry left quality open. The two pairs of review files from that run, piece a against row a and piece b against row b, were read side by side for all four held-out talks. A scratch script aligned each pair per talk on identical originals. About 60% of rows lined up; the rest were split differently by recognition between runs and were read as running text. No text from the files is reproduced here.

## Result

Pieces read worse than rows on every talk in both runs. The damage they cause recurs at the same places in both runs, so it is not run-to-run noise.

| Talk | Direction | Pieces against rows |
| --- | --- | --- |
| English 1, English 2 | EN→JA | Clearly worse: clauses run together and word order breaks across joins; one join reversed a statement's meaning in run a |
| Japanese 1 | JA→EN, short pauses | Worse: joins, and rows cut short where the last piece failed |
| Japanese 2 | JA→EN, long continuous rows | Close: joins show as missing sentence breaks, and the meaning mostly survives |

Quality cost lines up with the latency result inversely: the talk where pieces saved most time, Japanese 2, lost least, and EN→JA lost most while saving less.

## Damage only pieces cause

- **Unmarked joins.** Translations are concatenated as they come. Into Japanese, two clauses run on with no punctuation between them; into English, a capitalized word lands mid-sentence.
- **No reordering across a join.** English to Japanese needs reordering, and once a piece is shown it can't be undone. Some joined sentences are garbled where the row's version is correct.
- **Meaning lost at a join.** In one case a forecast came out with its direction reversed, and in another a qualifier was dropped. The row versions were correct.
- **Fragments.** An unfinished clause is translated as it stands, and the row then completes the thought from the whole sentence.
- **A failed last piece drops the rest of the row's translation.** The earlier pieces stay, so the row shows a sentence cut short. This is the cost of the previous entry's finding that every failed piece was a row's last one.

## Problems in both units

These show up in rows too, so pieces don't cause them:
- **Short rows padded with context.** A row of one or two words sometimes comes back as a paragraph repeating earlier translations, in both units and both runs. Once, a normal-length row also had repeated text appended.
- **Glossary leaking into the output.** One sentence came back as a list of glossary terms. The controller sends the whole glossary with every request, row or piece, so nothing limits this to pieces. It was seen once.
- **Chinese characters** in Japanese and English output, once per unit, likely a weakness of the 4B model.
- **Wrong number scale.** Japanese renderings of "tens of millions" came out a hundred times too large, in both units and both runs.

Rows also made errors pieces did not: in both row runs one positive statement came out negated, and one row repeated an earlier question onto an unrelated line.

## Decision and open items

- The live translation unit stays `row`, and pieces stay replay-only. Recorded in [decisions](../wiki/decisions.md).
- One way to keep pieces: retranslate the whole row when it closes and replace the piece text. That would remove the join damage, but it rewrites text the reader has seen, which the 2026-10-26 decision rules out. Whether to allow it is the maintainer's call.
- Two fixes that apply to both units:
  - don't send very short rows to the model, or send them without earlier context;
  - send only the glossary entries whose terms appear in the text being translated.

  Both need a before-and-after replay.
