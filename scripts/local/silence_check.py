"""Explicit real-model synthetic non-speech regression. No mic, files or network."""
import argparse
import sys
import numpy as np
from engine import Engine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=['small-q4', 'turbo-q4'], default='turbo-q4')
    args = parser.parse_args()
    engine = Engine(args.model)
    samples = 24_000 * 6
    time = np.arange(samples) / 24_000
    rng = np.random.default_rng(4317)
    cases = {
        'digital-silence': np.zeros(samples),
        'steady-noise': rng.normal(0, 0.025, samples),
        'electrical-hum': 0.04 * np.sin(2 * np.pi * 120 * time),
    }
    success = True
    for category, audio in cases.items():
        pcm = (np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes()
        result = engine.transcribe(pcm)
        suppressed = not result['text']
        success = success and suppressed
        # Never print hypotheses, even if a non-speech case unexpectedly decodes.
        print(f'{category}: {"PASS no text" if suppressed else "FAIL unexpected text"}')
    if not success:
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Synthetic non-speech check unavailable; verify local setup. Details suppressed.')
        sys.exit(1)
