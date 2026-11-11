# 2026-10-26: rolling recognition, design proposal

Status: proposal for the maintainer's review. Nothing here is implemented. Evidence: [rolling-window simulation](2026-10-26-rolling-window-simulation.md).

## Goal

The maintainer's principle: in captioning, a smooth reading pace matters more than the lowest delay. Bursts are the failure: a block of text landing at once, or text rewritten while someone reads it. Some steady lag is acceptable. No fixed maximum delay is set.

So the design aims for:
- settled text only on the audience overlay
- text released at a reading pace
- no mid-word cuts
- the lag as low as smoothness allows

Rolling recognition supplies settled text earlier and in smaller pieces than the 12 s cap, which leaves room for pacing.

Not in scope: changing the recognizer model, cloud recognition, speaker separation, the field gate and level problems tracked in [status](../wiki/status.md).

## Shape

The caption row stays the unit of display and translation. Within a row, the original has two parts: a locked prefix that never changes, and a provisional tail that each decode may rewrite. The existing transcript events already fit this. `begin` opens a row, `partial` replaces its text, and `final` closes it and queues translation. The only protocol addition is how much of a partial is locked.

```
speech ─▶ TurnDetector (energy; opens and closes a stretch, no 12 s cap)
            │ every ~1 s while open
            ▼
      LocalTranscriber ── decode(audio since lock point) ─▶ worker (stateless; returns segments)
            │  agree twice ─▶ lock whole segments ─▶ append to row
            │  row long enough or stretch ends ─▶ final ─▶ Controller ─▶ translation
            ▼
      partial(text = locked + tail, stable = locked length) ─▶ overlay and control
```

## Components

### Worker RPC

- The `final` reply gains `segments: [{ endMs, text }]`, at most 64 entries, for the lock decision. `text` stays for compatibility.
- The request line limit rises from 900,000 to 2,000,000 bytes. A 25 s window of 24 kHz PCM16 is about 1.6 MB in base64. The worker stays stateless: Node resends the window each time, so a crash or restart loses no hidden state.
- Window cap 25 s, under Whisper's 30 s input.
- The speech gate, per-segment filters, repetition and stock-phrase checks run on every decode as today.

### LocalTranscriber, `rolling` mode

1. A stretch opens when the energy detector opens, as today. It closes on 700 ms of quiet, flush, direction change, pause or recalibration. There is no maximum-duration boundary.
2. While a stretch is open, request a decode of the audio from the lock point to now about every second. A new request waits for the previous reply, so a slow decode delays the next one rather than piling up.
3. Language: forced modes pass it as today. In Auto, the first decode of each row detects the language and later decodes of that row reuse it. Detection costs about 0.3 s per decode, so doing it every time would double the load.
4. Stable text is the common prefix of the last two hypotheses, never ending inside a Latin word or number.
5. Lock every whole segment inside the stable text that ends at least 1 s before the newest audio. Locking appends its text to the row and moves the lock point to the segment's end. Locked text is never rewritten.
6. Each decode emits `partial` with the row's locked text, the new tail, and `stable` set to the locked length.
7. The row closes with `final` when the stretch ends, after one last decode that locks everything; when sentence-final punctuation ends a lock after at least 3 s of locked audio; or at 8 s of locked audio. The provisional tail moves to the next row's `begin` and `partial`. Japanese output rarely has punctuation, so the 8 s rule is what closes Japanese rows during continuous speech.
8. Safety: when the window reaches 25 s without a lock, force-lock all segments but the last. The simulation never needed this.
9. No segments while the energy gate stays open for more than 3 s means noise: drop all but the last second of the window.
10. If a row's whole locked text is a stock sign-off and its stretch has run at least 6 s, drop the row.

The current preview mechanism (`LOCAL_PREVIEWS`, every 3 s, shown after two agreeing hypotheses) does not apply in rolling mode.

### Controller

- No change to row lifecycle, translation queueing, context, invalidation or clear. Rows are finalized at agreed segment ends, so the `truncated` translation flag stays unset in rolling mode.
- `Segment` gains an optional `stable`: the number of characters of `original` that are locked. Partial rows that keep growing are already handled.

### Overlay and control

- The audience overlay shows locked text only, never the provisional tail. The operator control page shows the tail in a lighter style, so the operator can see recognition is alive.
- A pacer in the shared browser renderer releases text at a reading pace instead of the moment it arrives:
  - It reveals the text locally in each client, so the protocol does not change and the overlay and control page can use different settings.
  - The rate drains the backlog over about 4 s, held between a floor and a ceiling: about 8 to 25 characters per second in English and 3 to 10 in Japanese.
  - If the backlog passes a catch-up limit, the rate rises gradually rather than jumping.
  - Translations are paced in the same way in the target language, since that is the lane the audience mainly reads.
- Text scrolls up line by line in a fixed window, as roll-up captions do, rather than whole rows swapping. Whether the original keeps its own small lane above the translation is a rehearsal question.

### Diagnostics

- `Boundary` gains `length` for a row closed by the 8 s or punctuation rule.
- `TurnMeasurement` gains:
  - `decodes`: count per row
  - `firstTextMs`: from row begin to first displayed text
  - `lockLagMs`: median from a segment's end to its lock
  - `forcedLocks`
- Quality counters sum across a row's decodes. No text in diagnostics.

### Configuration

`LOCAL_SEGMENTATION=turns|rolling`, default `turns`. Listen mode opts in with a flag until the promotion criteria below are met. Live defaults stay frozen until then.

## Expected timing

Per character, from when it was spoken to when locked text holding it exists. Simulated on the held-out recordings: four Japanese, two English, all fast, scripted video speech. The pacer is the one above with a 4 s drain.

| Median delay (p90) | Unpaced | Paced |
| --- | --- | --- |
| Today, 12 s cap, English | 6.7 s (11.5), with up to 280 characters landing in one second | 11.9 s (13.6) |
| Rolling, English | 5.1 s (8.6) | 9.5 s (11.0) |
| Today, 12 s cap, Japanese | 6.8 s (11.7), with up to 107 characters landing in one second | 11.8 s (13.1) |
| Rolling, Japanese | 4.1 s (7.2) | 8.4 s (10.0) |

With pacing, the most text released in one second falls to 28 characters in English and 11 in Japanese. Rolling with pacing reads smoothly and still runs ahead of today's cap with the same pacing. The paced lag is mostly the drain time plus the length of each locked piece.

Lag can fall further without bursts by locking smaller pieces. The design locks whole Whisper segments, a median of 5.4 s in English and 3.1 s in Japanese. Locking each word once two decodes agree on it was measured and rejected: it raised error from 1.4% to 2.6% in English and from 3.9% to 6.2% in Japanese for text about 1 to 3 s sooner, because later decodes often correct the first agreed version; see [the simulation entry](2026-10-26-rolling-window-simulation.md). Translation adds about 2 s after a row closes; the pacer then smooths its release too.

## Translation timing

Translate each row once, at `final`. Rows close on natural units, so translations arrive as even, readable pieces:
- a sentence end after at least 3 s of locked audio
- a pause in speech
- otherwise 8 s of locked audio

A pause closes a row only if it has at least about 2 s or 15 characters; anything shorter merges into the next row so tiny captions do not flicker past.

Re-translating a growing row was considered and set aside. It would show a translation 2 to 3 s sooner, but rewriting text under the reader is the burst the principle rules out.

## Risks

- Sustained load: an hour-long real-time soak held decode time flat at about 0.38 s, with the decoder 38% busy; see [the simulation entry](2026-10-26-rolling-window-simulation.md). Headroom with OBS and a browser running is unmeasured.
- Flicker: the tail is rewritten about as often as text is locked. It appears only on the operator page; the audience sees locked, paced text.
- Pacing on slower, unscripted speech: the simulation used fast video speech. Live lectures and Q&A are slower, so backlog and lag should be lower, but the floor rates must not stall a sparse speaker. Tune at rehearsal.
- Code-switching inside a row is decoded in the row's language until the row closes. The mixed recording behaved well because the switch followed a pause.
- Stock-phrase hallucinations on short windows: the rule is moved to the locked-row level, step 10 above.
- The field gate and level problems are unchanged. Rolling recognition does not fix rejection before Whisper.

## Plan

1. Worker `segments` reply and line limit, with Python tests.
2. `LocalTranscriber` rolling mode behind the flag. Fake-worker tests:
   - two-hypothesis agreement and lock
   - locked text never retracts
   - forced lock
   - stretch end locks everything
   - direction change and recalibration
   - clear invalidates in-flight decodes
   - stale replies are ignored
   - backpressure keeps one decode in flight
3. `scripts/replay-cases.ts --segmentation rolling` runs the held-out recordings through the real code path. Its numbers must match the simulation: Japanese CER at or below 5%, display lag p90 at or below 2 s, no forced locks.
4. `stable` in the protocol; the pacer and roll-up rendering in the shared renderer, with settings per surface; browser tests with scripted snapshot timings: steady release, no rewrite of revealed text, catch-up, clear and new-session reset.
5. Maintainer rehearsal in listen mode with the flag on. Then decide on the default and record it in decisions.

## Decided

Smooth reading over minimum delay, 2026-10-26. That settles:
- the audience overlay shows locked text only
- translation runs once per row
- the pacer is in scope

## Open for rehearsal

- Pacer rates and drain time on real lectures and Q&A.
- Roll-up window height, and whether the original keeps its own lane.
