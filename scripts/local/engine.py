"""MLX inference shared by benchmark and pipe worker. No networking or persistence."""
import os
from pathlib import Path
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

import mlx.core as mx
import mlx_whisper
from mlx_whisper.transcribe import ModelHolder
import numpy as np
from scipy.signal import resample_poly
from languages import PROFILES
from quality import accepted_segments, quality_metadata, segment_ends
from speech_gate import SpeechGate

ROOT = Path(__file__).resolve().parents[2]


class Engine:
    def __init__(self, model):
        if model not in ('small-q4', 'turbo-q4'):
            raise ValueError('Unknown local model')
        self.path = ROOT / '.local/models' / model
        if not (self.path / 'weights.npz').is_file() or not (self.path / 'config.json').is_file():
            raise ValueError('Run local model setup first')
        start = time.perf_counter()
        ModelHolder.get_model(str(self.path), mx.float16)
        mx.synchronize()
        self.speech_gate = SpeechGate()
        self.load_seconds = time.perf_counter() - start

    def warm(self):
        # Deliberately bypass speech rejection ONLY for synthetic compilation.
        self.speech_gate.has_speech(np.zeros(16_000, dtype=np.float32))
        self._decode(np.zeros(16_000, dtype=np.float32), 'en', None)
        mx.synchronize()

    def _decode(self, audio, language, prompt):
        return mlx_whisper.transcribe(
            audio, path_or_hf_repo=str(self.path), language=language, task='transcribe',
            temperature=0.0, condition_on_previous_text=False, verbose=None,
            word_timestamps=False, fp16=True, initial_prompt=prompt,
        )

    def transcribe(self, pcm24, language=None, prompt=None, *, speech_threshold=0.5, min_logprob=-1.0):
        if (language is not None and language not in PROFILES) or not 4800 <= len(pcm24) <= 24_000 * 2 * 30 or len(pcm24) % 2:
            raise ValueError('Invalid local audio')
        if prompt is not None and (not isinstance(prompt, str) or len(prompt) > 1000):
            raise ValueError('Invalid vocabulary prompt')
        start = time.perf_counter()
        audio = np.frombuffer(pcm24, dtype='<i2').astype(np.float32) / 32768
        audio = resample_poly(audio, 2, 3).astype(np.float32)
        if not self.speech_gate.has_speech(audio, threshold=speech_threshold):
            return {'text': '', 'rejected': True, 'language': language or 'unknown', 'segments': [],
                    'seconds': time.perf_counter() - start, 'quality': quality_metadata(True), 'clipped': False}
        result = self._decode(audio, language, prompt)
        mx.synchronize()
        kept, rejected, quality = accepted_segments(result, min_logprob=min_logprob, audio_seconds=len(audio) / 16_000)
        text = ''.join(s['text'] for s in kept).strip()
        return {'text': text[:4000], 'rejected': rejected, 'segments': segment_ends(kept, len(audio) / 16),
                'language': result.get('language', 'unknown'),
                'seconds': time.perf_counter() - start, 'quality': quality, 'clipped': len(text) > 4000}

