"""Exercise real stdio message construction with a fake engine, no models/audio devices/network."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from quality import quality_metadata


class WorkerTests(unittest.TestCase):
    def run_worker(self, language, extra_request=None, audio='AAAA', calls=None):
        calls = [] if calls is None else calls
        class FakeEngine:
            def __init__(self, model):
                pass

            def warm(self):
                pass

            def transcribe(self, pcm, hint, prompt, pair=None):
                calls.append(pair)
                return {'text': 'Synthetic fixture', 'language': language, 'seconds': 0.123,
                        'rejected': False, 'clipped': False, 'quality': quality_metadata(),
                        'segments': [{'endMs': 1200, 'text': 'Synthetic fixture'}]}

        with patch.dict(sys.modules, {'engine': types.SimpleNamespace(Engine=FakeEngine)}):
            spec = importlib.util.spec_from_file_location('fixture_worker', Path(__file__).with_name('worker.py'))
            worker = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(worker)
        request = json.dumps({'id': 'fixture', 'audio': audio, 'language': None, **(extra_request or {})}) + '\n'
        stdin = io.TextIOWrapper(io.BytesIO(request.encode()))
        stdout = io.StringIO()
        with patch.object(sys, 'argv', ['worker.py', 'fake']), patch.object(sys, 'stdin', stdin), patch.object(sys, 'stdout', stdout):
            worker.main()
        return [json.loads(line) for line in stdout.getvalue().splitlines()]

    def test_actual_rpc_keeps_normalized_language_and_safe_decoder_language_separate(self):
        ready, final = self.run_worker('ru')
        self.assertEqual(ready, {'type': 'ready'})
        self.assertEqual(final['language'], 'unknown')
        self.assertEqual(final['inferenceMs'], 123)
        self.assertEqual(final['measurement']['recognitionLanguage'], 'ru')
        self.assertFalse(final['measurement']['recognitionClipped'])
        self.assertEqual(final['measurement']['quality'], quality_metadata())
        self.assertNotIn('text', final['measurement'])

    def test_production_rpc_cannot_enable_experiment_thresholds(self):
        with self.assertRaises(ValueError):
            self.run_worker('ja', {'speech_threshold': 0.35})
        with self.assertRaises(ValueError):
            self.run_worker('ja', {'min_logprob': -1.25})

    def test_rpc_does_not_send_arbitrary_language_strings_in_metadata(self):
        _, final = self.run_worker('not a language code or a diagnostic message')
        self.assertEqual(final['measurement']['recognitionLanguage'], 'unknown')

    def test_reply_carries_segment_ends(self):
        _, final = self.run_worker('en')
        self.assertEqual(final['segments'], [{'endMs': 1200, 'text': 'Synthetic fixture'}])

    def test_rpc_frame_fits_thirty_seconds_of_audio_and_no_more(self):
        thirty_seconds = 'A' * (24_000 * 2 * 30 * 4 // 3)
        self.assertEqual(self.run_worker('en', audio=thirty_seconds)[1]['type'], 'final')
        with self.assertRaises(ValueError):
            self.run_worker('en', audio='A' * 2_000_000)
