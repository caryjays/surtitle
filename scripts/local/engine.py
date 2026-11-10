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
from quality import accepted_segments, pair_retry_language, quality_metadata, script_matches, segment_ends
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

    def detect(self, audio):
        """Whisper's language probabilities for 16 kHz audio."""
        from mlx_whisper.audio import N_FRAMES, N_SAMPLES, log_mel_spectrogram, pad_or_trim
        from mlx_whisper.decoding import detect_language
        model = ModelHolder.get_model(str(self.path), mx.float16)
        mel = pad_or_trim(log_mel_spectrogram(audio, n_mels=model.dims.n_mels, padding=N_SAMPLES), N_FRAMES, axis=-2)
        _, probs = detect_language(model, mel.astype(mx.float16))
        return probs[0] if isinstance(probs, list) else probs

    def transcribe(self, pcm24, language=None, prompt=None, *, pair=None, speech_threshold=0.5, min_logprob=-1.0):
        if (language is not None and language not in PROFILES) or not 4800 <= len(pcm24) <= 24_000 * 2 * 30 or len(pcm24) % 2:
            raise ValueError('Invalid local audio')
        if pair is not None and (not isinstance(pair, (list, tuple)) or len(pair) != 2 or any(p not in PROFILES for p in pair)):
            raise ValueError('Invalid language pair')
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
        if language is None and pair and kept and result.get('language') not in pair:
            # Detected outside the session pair: misheard pair speech decodes again in the pair, third-language speech
            # does not, and the adapter locks nothing from a decode outside the pair.
            retry = pair_retry_language(self.detect(audio), pair)
            if retry:
                again = self._decode(audio, retry, prompt)
                mx.synchronize()
                kept2, rejected2, quality2 = accepted_segments(again, min_logprob=min_logprob, audio_seconds=len(audio) / 16_000)
                if kept2 and script_matches(''.join(s['text'] for s in kept2), retry):
                    result, kept, rejected, quality = {**again, 'language': retry}, kept2, rejected2, {**quality2, 'pairRetries': 1}
        text = ''.join(s['text'] for s in kept).strip()
        return {'text': text[:4000], 'rejected': rejected, 'segments': segment_ends(kept, len(audio) / 16),
                'language': result.get('language', 'unknown'),
                'seconds': time.perf_counter() - start, 'quality': quality, 'clipped': len(text) > 4000}

