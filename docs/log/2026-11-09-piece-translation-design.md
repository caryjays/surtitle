# 2026-11-09: translating before a row closes, design proposal

Status: implemented behind a replay-only option the same day; measured in [piece translation](2026-11-09-piece-translation.md). The estimates below were not reached. Evidence: [row length](2026-11-08-row-length.md), [cadence and streaming](2026-11-09-cadence-streaming.md), [GPU contention](2026-11-08-gpu-contention.md).

## Goal

Translations as close to real time as smooth reading allows. The decisions of 2026-10-26 still hold:
- the audience sees settled text only
- text a reader has seen is never rewritten
- text is released at a reading pace

Today a row is translated once, after it closes. With streaming on, the first translated text appears about 3 s after a row's last word, and 5.6 to 7.5 s after its middle (medians, four held-out talks). From the middle of a row, the wait has three parts:
- half the row's audio, about 3 s
- speech end to final text, about 1.8 s
- the first translated text, about 1.2 s

Two cheaper levers were measured and are spent. Shorter rows cut only the slowest captions, because most rows still end at a pause and a length close waits for a lock. A faster decode cadence was cancelled out by slower translation on the shared GPU. What remains is the wait for the row to close: translation starts only once the speaker pauses or the row reaches its length limit.

Not in scope: recognition changes, a different translation model, the cloud translators' prompts.

## Proposal: translate locked pieces

A row keeps its locked original, as today. Its locked text is also cut into **pieces**, each translated once and appended to the row's translation. The display row and its lifecycle stay as they are; only the unit of translation shrinks.

```
locked text of the open row:  [ piece 1 ][ piece 2 ][ piece 3 …locking ]
                                  │          │
           translate when the     ▼          ▼
           translator is idle   tr. 1  +   tr. 2   ─▶ row.translation (append-only)
                                                       │
           row closes ─▶ last piece: whatever locked text is left ─▶ tr. 3 ─▶ row ready
```

### When a piece is cut

The controller holds the untranslated locked text of each open row. It cuts a piece when all three hold:
1. no translation request is running (one in flight at a time, as recognition decodes are);
2. the untranslated text ends at a clause or sentence mark from the profiles (`clauseEnd`, `sentenceEnd`), or holds at least 4 s of audio;
3. it holds at least 1.5 s of audio, so a stray comma does not send a two-word request.

When the row closes, the rest is the last piece, whatever its length. Condition 1 is the backpressure: when translation runs slower than speech, pieces grow instead of queueing. The worst case is today's behaviour, one piece per row.

Cuts fall only where the adapter has already locked whole segments, so a piece never splits a word. The transcriber already sends locked text as `stable` on partial events. Each partial would also need to carry the locked audio length, so the controller can apply the audio thresholds.

### The request

Each piece is one `TranslationInput`:
- `text`: the piece's original
- `context`: the row's earlier pieces with their translations, then the preceding rows, still at most four entries and still `ready` text only
- a new flag, `continues: true`, on every piece but the last: the sentence goes on after this text

The shared instructions already say "A segment may be an unfinished sentence; do not invent its ending." They would gain one line: a piece marked `continues` is translated so the next piece can follow it, and nothing is completed or summarised. The schema of the reply does not change.

Direction: in Auto, a row's language settles at its first lock, before its first piece can be cut, so every piece of a row goes the same way. The direction checks stay.

### Display

`row.translation` is the pieces' translations joined in order: a space for word-scored target languages, nothing for character-scored ones. Streaming applies within the running piece. Earlier pieces are final, so a streamed piece that fails withdraws only its own text.

The pacer already releases appended text at reading pace in its own lane. The protocol does not change: `translation` grows the way a streamed translation grows today. The row becomes `ready` when its last piece is.

### Failure

A failed piece is not shown. Its original moves to the front of the next piece, which is retried with it. If the last piece fails, the row is `failed` but keeps the translations it already has; the original stays whole, as the product contract requires. A clear or new session invalidates every piece in flight, as it does rows today.

### Diagnostics

Content-free additions to the turn trace:
- `pieces`, the count
- the locked audio offset at which each piece was cut
- each piece's request time and the time to its first streamed text

`pnpm diag:latency` then measures speech to first translated text per piece, so the middle and first word of a row are measured instead of estimated from the row's audio.

### Configuration

The controller takes a `translationUnit` option, `row` or `piece`; live stays `row`. As with the row rules and cadence, only `pnpm replay:contention --units piece` sets it until a comparison and a rehearsal support a change. Rolling segmentation only: turns mode has no locked text before its final.

## Expected timing

Estimated from measured parts, not measured. The streaming live run of 2026-11-09 gives lock lag about 2.1 s and request to first translated text about 1.2 s, at the median. With pieces of about 2.5 s of audio:

| From | Today, streaming | Pieces, estimate |
| --- | --- | --- |
| Last word of a row | about 3 s | about 3 s (the last piece closes as rows do today) |
| Middle of a row | 5.6 to 7.5 s | about 4.5 s: lock lag, half a piece, first text |
| First word of a row | 8 to 13 s | about 4.5 to 5.5 s |

The middle and first word would then come within about a second of the 3 to 4 s goal. The longer rows of Japanese continuous speech gain most.

## Costs and risks

- **Quality.** A piece carries less of its sentence. Japanese to English suffers most, since the verb comes last: a clause ending in 、 often has no predicate yet. English to Japanese reads in English order, as a simultaneous interpreter's would. This is the main risk and the first thing to measure.
- **Seams.** The model may repeat context in a piece or drop words at a cut. The prompt already forbids translating context; seams need checking in the eval below.
- **GPU load.** Requests rise two to three times per minute of speech. Each carries the full system prompt and context, several hundred tokens that have not been counted, so prefill grows with them. Condition 1 caps the rate at one request in flight. Recognition decodes still share the GPU, and the contention entry measured what that costs. mlx-lm's prompt cache could reuse the system prompt's computation and recover some of it; not tried.
- **Cloud cost.** The same design works with the cloud translators, at two to three times the requests and input tokens. It stays local-only until the maintainer asks otherwise.
- **Reading.** The translation grows in clause-sized steps instead of whole rows. The pacer smooths the rate; whether the steps read well is a rehearsal question.

## Alternatives considered

| Option | Why not first |
| --- | --- |
| Re-translate the growing row and replace the shown translation | Rewrites text under the reader, ruled out on 2026-10-26 |
| Re-translate the growing row and show only the prefix two translations agree on, as recognition locks | Every lock costs a full request on a GPU that is already the bottleneck. Japanese word order keeps the agreed prefix short until the sentence ends. Worth trying if fixed pieces read poorly |
| Shorter rows | Measured on 2026-11-08: cuts only the slowest captions |
| Faster decode cadence | Measured on 2026-11-09: no net gain with local translation |
| Smaller translation model | Qwen3.5-2B ran away on live rows, 2026-11-08 |

## Plan

1. **Quality first, offline.** Split held-out talk transcripts and the public eval cases at clause marks, the way the piece rule would, and translate the pieces with their context on the local model. Report validity, glossary terms, and a seam check, with no text in the output. Write a review file under `.local/experiments/` that the maintainer reads against whole-row translations. A judged comparison needs the paid judge and the maintainer's authorization. Stop here if pieces read clearly worse.
2. Controller: `translationUnit: piece` behind the replay flag, with fake-provider tests:
   - pieces are cut only at locked boundaries with the audio thresholds
   - one request in flight, with pieces growing under backpressure
   - translations appended in order, never rewritten
   - a failed piece merges into the next
   - row-level failure keeps earlier pieces
   - context holds only finished translations
   - clear and new session invalidate pieces in flight
3. Replay the four held-out talks with pieces against rows, back to back, alternating order: per-piece speech to first translated text, failures, lock lag and decode time under the added load.
4. The maintainer's rehearsal with `pnpm dev:offline`. Then decide the default and record it in decisions.

## Open for the maintainer

- Whether a 1.5 s minimum and a 4 s maximum piece suit real lectures, or whether pieces should follow sentences only, trading time for quality.
- Whether the operator page should mark piece boundaries in the translation.
- Whether step 1 may use the paid judge.
