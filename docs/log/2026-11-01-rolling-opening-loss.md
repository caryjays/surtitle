# Rolling opening loss: a longer noise hold, measured and reverted

2026-11-01. The suspected cause of rolling's lost Japanese openings, its noise rule, was confirmed with per-decode logging. A fix that held such windows longer made the loss worse and was reverted. The code is as it was at `08f1449`.

## Confirming the mechanism

A replay of the public Japanese gate stream with temporary per-decode logging, at `08f1449`, made 631 rolling decodes and 13 noise trims. Eight trims hit clip openings before the row had any text, at clips 5, 24, 40, 41, 45, 55, 57 and 59. In each, Silero had passed the audio as speech, and every segment of a 3 to 4 s decode had been dropped by the low-confidence filter. The rule "no segments in a window over 3 s keeps only the last second" then discarded about 3 s of real speech. The other five trims, at clip ends, were windows the speech detector rejected and cost nothing.

## The attempted fix

When the worker reported the speech detector passed the window (`speechGateRejected` false) and still returned no segment, the trim waited for an 8 s window instead of 3 s. Two fake-worker tests covered it. The full rolling gate rerun on the laptop, load average median 1.6 and max 2.7:

| Public set | Before, rerun | With the 8 s hold |
| --- | --- | --- |
| Japanese error | 9.11% | 16.24% |
| Japanese live minus full-clip | 4.00 pts | 11.13 pts |
| Japanese deletions | 134 | 343 |
| English error | 4.87% | 4.47% |
| Non-speech rows | 3 | 4 |
| Wrong-language share, Japanese | 0.00% | 1.64% |

The same clips lost whole sentences instead of opening phrases: clip 40 lost 116 characters against 25, clip 55 all 36 against 10, clip 5 38 against 9.

## Why it failed

A logged replay of clips 40 and 41 under the fix shows the decodes alternating. A filtered decode, with segment log probabilities of −1.1 to −1.75 against the −1.0 floor, is followed by an accepted one, then a filtered one again. Two consecutive decodes never agree, so nothing locks however long the window grows. When the speech stretch ends, its closing decode carries the whole held window and is rejected in one piece, losing the sentence. The 3 s trim lost less only because later windows, starting nearer the sentence's end, happened to decode cleanly.

The loss therefore comes from the per-segment confidence floor applied to partial windows, which the whole-clip decode passes with full context. The noise rule only decides how much is discarded. Lowering the floor for rolling decodes that the speech detector passed is the next candidate. It needs the non-speech set to hold, since rolling's music and noise rows also pass the detector.

## Open

- Measure segment log probabilities on the affected clips' rolling windows and on the non-speech rows before choosing a floor for rolling partial decodes.
- Decide whether a filtered decode should reset agreement, as now, or be skipped so the accepted decodes on either side can agree.
- The corpus rolling rerun waits for a fix that improves the gate.
