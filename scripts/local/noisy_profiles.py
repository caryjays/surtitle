"""Offline experiment profiles only. The application does not import this module."""
PROFILES = {
    'baseline-auto': {'language': None, 'speech_threshold': 0.5, 'min_logprob': -1.0, 'previewMs': 3000, 'maxTurnMs': 12000},
    'gate-035': {'language': None, 'speech_threshold': 0.35, 'min_logprob': -1.0, 'previewMs': 3000, 'maxTurnMs': 12000},
    'confidence-125': {'language': None, 'speech_threshold': 0.5, 'min_logprob': -1.25, 'previewMs': 3000, 'maxTurnMs': 12000},
    'forced-ja': {'language': 'ja', 'speech_threshold': 0.5, 'min_logprob': -1.0, 'previewMs': 3000, 'maxTurnMs': 12000},
    'preview-1500': {'language': None, 'speech_threshold': 0.5, 'min_logprob': -1.0, 'previewMs': 1500, 'maxTurnMs': 12000},
    'chunks-8000': {'language': None, 'speech_threshold': 0.5, 'min_logprob': -1.0, 'previewMs': 3000, 'maxTurnMs': 8000},
}
SCREEN_PROFILES = ('baseline-auto', 'gate-035', 'confidence-125', 'forced-ja')
