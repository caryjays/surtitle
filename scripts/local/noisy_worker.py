"""Isolated opt-in experiment worker; production launches never use this file."""
import sys
from engine import Engine
from noisy_profiles import PROFILES
from worker import main, send


if __name__ == '__main__':
    try:
        profile = PROFILES[sys.argv[2]]

        class ExperimentEngine(Engine):
            def transcribe(self, pcm24, language=None, prompt=None):
                return super().transcribe(pcm24, language, prompt, speech_threshold=profile['speech_threshold'],
                                          min_logprob=profile['min_logprob'])

        main(ExperimentEngine)
    except Exception:
        send({'type': 'error'})
        raise SystemExit(1)
