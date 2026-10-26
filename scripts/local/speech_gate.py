"""Offline CPU Silero VAD, following upstream's 16 kHz / 512-sample JIT API.

Only the pinned model from explicit setup is loaded. No torch.hub, model fetch,
transcript logging, or cross-turn recurrent state. Model license: MIT.
"""
from pathlib import Path
import warnings
import numpy as np
import torch


class SpeechGate:
    def __init__(self):
        path = Path(__file__).resolve().parents[2] / '.local/models/silero-vad/model.jit'
        if not path.is_file():
            raise ValueError('Run local speech detector setup first')
        torch.set_num_threads(1)
        with warnings.catch_warnings():
            warnings.filterwarnings('ignore', message=r'.*torch\.jit\.load.*deprecated.*', category=FutureWarning)
            self.model = torch.jit.load(str(path), map_location='cpu').eval()

    def has_speech(self, audio, threshold=0.5):
        # Non-default thresholds are used only by explicit offline experiments.
        if not 0.2 <= threshold <= 0.9:
            raise ValueError('Speech threshold outside experiment bounds')
        # Three positive consecutive frames (~96 ms), shorter than upstream's
        # 250 ms utterance minimum so brief conversational replies can survive.
        self.model.reset_states()
        run = 0
        found = False
        with torch.no_grad():
            for start in range(0, len(audio), 512):
                chunk = audio[start:start + 512]
                if len(chunk) < 512:
                    chunk = np.pad(chunk, (0, 512 - len(chunk)))
                probability = self.model(torch.from_numpy(chunk.astype(np.float32, copy=False)), 16000).item()
                run = run + 1 if probability >= threshold else 0
                if run >= 3:
                    found = True
                    break
        self.model.reset_states()
        return found
