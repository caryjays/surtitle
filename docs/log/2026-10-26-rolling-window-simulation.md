# 2026-10-26: rolling-window recognition, offline simulation

Backend: local Turbo Q4 only, no cloud calls. Recording content stays in `private/`; this entry reports aggregates only.

## Question

Continuous speech waits for the 12 s turn cap before anything is final, and the cap cuts words. Can the recognizer instead show text within a second or two and correct it as more audio arrives?

## Decode cost

Turbo Q4 pads every input to 30 s, so a decode costs nearly the same at any window length: 0.33 s for 2 s of audio and 0.48 s for 20 s with the language known, 0.64 s and 0.79 s with detection. Decoding small blocks separately buys no speed, only worse accuracy. Re-decoding one growing window is the cheaper design.

## Method

`scripts/local/rolling_sim.py` simulates two strategies on a recording in virtual time: audio arrives in real time and each decode takes as long as it really took on the maintainer's laptop.

- Rolling: every 1 s, decode all audio not yet locked. The prefix two consecutive decodes agree on is stable. Whole Whisper segments inside it that end at least 1 s before the newest audio are locked, their audio dropped. In Auto, the language is detected on the first decode after silence and then held. The speech gate, quality filters and stock-phrase rule apply to every decode. A forced lock at 25 s is a safety net.
- Fixed: back-to-back 12 s chunks, the live cap on continuous speech.

Run on the seven held-out recordings, 29 minutes, scored against the silver references from [held-out transcription](2026-10-26-held-out-transcription.md), and on the earlier mixed-language recording without a reference.

```sh
cd scripts/local && ../../.local/venv/bin/python rolling_sim.py --audio <recording> --reference <silver.txt> --out <private/...json>
```

## Results

| | Rolling, 1 s | Fixed, 12 s |
| --- | --- | --- |
| English WER (1815 words) | 1.4%, deletions 0.3% | 2.9%, deletions 0.8% |
| Japanese CER (7216 chars) | 3.8%, deletions 1.3% | 12.5%, deletions 9.6% |
| Display lag, p90 per recording: how old the newest shown audio is | 1.37 to 1.48 s | 12.7 to 13.0 s |
| End of a segment to locked, p90 per recording | 2.7 to 3.5 s | 0.7 to 1.0 s after the chunk |
| Decoder busy share | 34 to 44% | 6 to 8% |
| Forced locks | 0 | n/a |

- Rolling was better on every recording. The fixed-chunk numbers are close to the live replay of the same recordings, 4.8% WER and 10.6% CER. The references come from a whole-file decode, so errors both share are not counted. The deletion gap does not depend on that.
- Locked text arrived as sentence- or clause-length chunks. No stock-phrase hallucinations and no duplicated chunks. The one repeated chunk is speech the speaker repeated.
- The provisional tail is rewritten often. Retracted characters were 0.8 times the final English text and 0.6 times the Japanese, so the overlay must show the tail distinctly and only ever append locked text.
- Mixed recording: the embedded English clip came out in English. The whole-file decode had rendered it in Japanese. The opening seconds that every live replay lost were captured. A few short asides of under 2 s were dropped.

## Not established

- Sustained load alongside the browser, OBS and translation. The soak below ran the decoder alone.
- Live input: the simulation has no energy turn detector, no room noise and no microphone levels. Field rejection problems still apply.
- Code-switching within one stretch of speech: the held language would decode a switch in the wrong language until the next silence.
- Translation on locked chunks, overlay presentation of the provisional tail, and the controller's turn model are not designed yet.

## Sustained-load soak

Run on 2026-10-27, finishing after midnight. `rolling_sim.py --realtime` kept the real 1 s cadence over 62 minutes of audio: all nine private recordings joined, played twice. Decoder only, on the maintainer's laptop. Browser, OBS and translation were not running, and power and thermal state were not recorded.

| Measure | Result |
| --- | --- |
| Decodes | 3748, 919 locks, 0 forced |
| Decoder busy share | 37.6% |
| Decode time | median 0.38 s, p90 0.41 s, max 1.22 s |
| Median decode time per 5 minutes | 0.366 to 0.394 s across all 13 intervals, no upward drift |
| Display lag | p50 1.38 s, p90 1.41 s, max 2.22 s |
| End of a segment to locked | p50 2.06 s, p90 3.28 s, max 10.4 s |

No throttling showed over an hour. Headroom with a browser and OBS running is still to be checked at rehearsal.

## Word-level locking

Run on 2026-10-27. The question: would locking each word as soon as two consecutive decodes agree on it, rather than whole Whisper segments, give earlier text without hurting accuracy? `rolling_sim.py` now records, per decode, the locked text plus the agreed prefix, and scores two word-locked transcripts built from them: one that continues after a disagreement at the same length offset, and one that maps the committed end into the new text with a fuzzy match. Same seven held-out recordings, about 29 minutes, silver references. A reran segment-locked baseline matched the earlier run.

| | English WER | Japanese CER |
| --- | --- | --- |
| Segment locking (design) | 1.4% | 3.9% |
| Word locking, length offset | 2.6% | 6.2% |
| Word locking, fuzzy alignment | 3.4% | 6.5% |

- Agreed text was later contradicted 71 times, about 2.5 times a minute, ignoring punctuation. In English most were capitalisation or punctuation; about a third of all events were real word changes.
- The real changes cut both ways. Later decodes often corrected a mis-heard technical term, and sometimes replaced a correct word with a wrong one. Word locking freezes the first version, so it keeps the earlier errors and loses the later corrections, and the seam after a disagreement adds duplicated or dropped characters.
- Gain: text would exist a median of 2 to 3 s sooner in English and about 1 s sooner in Japanese, 3 to 6 s at p90.

Conclusion: keep segment locking. The gain is smaller than the pacer's own drain time, and accuracy roughly halves its margin over today's 12 s cap in English and gives back over half of it in Japanese.
