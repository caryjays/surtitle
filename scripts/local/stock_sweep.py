"""Stock-phrase sweep for a language: what Whisper says in it when there is no speech.

Decodes non-overlapping windows of the gate's non-speech streams, forced into the language, at the stream's level and
20 dB below, without the speech gate, and counts each window's whole text after the live segment filters. Texts that
recur are candidates for the language's stockPhrases in profiles/languages.json; choosing among them is a review, since
a real short reply can be on the list. Public non-speech fixtures only; no API or .env use. Not a gate measure.

  stock_sweep.py --language es [--windows 10,25]
"""
import argparse
import collections
import json
import numpy as np
from scipy.signal import resample_poly
from engine import Engine
from gate import STREAMS, pcm
from quality import PROFILES, _compact, accepted_segments

RATE = 24_000


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--language', required=True, choices=sorted(PROFILES))
    parser.add_argument('--windows', default='10,25')
    args = parser.parse_args()
    engine = Engine('turbo-q4')
    engine.warm()
    known = [_compact(p) for profile in PROFILES.values() for p in profile['stockPhrases']]
    raw_counts, kept_counts, windows = collections.Counter(), collections.Counter(), 0
    for stream in sorted(STREAMS.glob('nonspeech-*.wav')):
        audio = np.frombuffer(pcm(stream), dtype='<i2').astype(np.float32) / 32768
        for seconds in (int(s) for s in args.windows.split(',')):
            size = seconds * RATE
            for start in range(0, len(audio) - size + 1, size):
                for gain in (1.0, 0.1):
                    window = resample_poly(audio[start:start + size] * gain, 2, 3).astype(np.float32)
                    result = engine._decode(window, args.language, None)
                    kept, _, _ = accepted_segments(result, min_logprob=-1.0, audio_seconds=None)
                    windows += 1
                    raw = ' '.join(result.get('text', '').split())
                    text = ' '.join(''.join(s['text'] for s in kept).split())
                    if raw:
                        raw_counts[raw.casefold()] += 1
                    if text:
                        kept_counts[text.casefold()] += 1

    def covered(text):
        compact = _compact(text)
        for phrase in known:
            compact = compact.replace(phrase, '')
        return not compact

    print(json.dumps({'language': args.language, 'windows': windows, 'withText': sum(raw_counts.values()),
                      'passingFilters': sum(kept_counts.values()),
                      'passingAndCovered': sum(n for t, n in kept_counts.items() if covered(t))}))
    for title, counts in (('passing the filters', kept_counts), ('before the filters', raw_counts)):
        print(title)
        for text, n in counts.most_common(40):
            print(f'  {n:4d}  {"listed" if covered(text) else "      "}  {text[:90]}')


if __name__ == '__main__':
    main()
