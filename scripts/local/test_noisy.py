import array
import json
import math
from pathlib import Path
import unittest
from noisy_cases import ROOT, babble, mix, normalize, pcm_bytes, pcm_values, rms
from noisy_profiles import PROFILES
from noisy_score_stream import safe_turn
from noisy_screen import aggregate
from quality import accepted_result
from scoring import distance, edit_counts, units


class NoisyExperimentTests(unittest.TestCase):
    def test_sources_are_pinned_licensed_and_exclude_original_tuning_ids(self):
        corpus = json.loads((ROOT / 'benchmarks/noisy-ja.json').read_text())
        old = json.loads((ROOT / 'benchmarks/fleurs.json').read_text())
        self.assertEqual(corpus['license'], 'CC-BY-4.0')
        self.assertEqual(len(corpus['fixtures']), 8)
        old_ids = {f['id'].split('-')[-1] for f in old}
        new_ids = {f['id'].split('-')[-1] for f in corpus['fixtures']}
        self.assertEqual(len(new_ids), 8)
        self.assertFalse(old_ids & new_ids)
        self.assertEqual(sum(f['role'] == 'target' for f in corpus['fixtures']), 4)
        self.assertEqual(sum(f['role'] == 'distractor' for f in corpus['fixtures']), 4)
        for fixture in corpus['fixtures']:
            self.assertEqual(len(fixture['sha256']), 64)
            self.assertIn(corpus['revision'], fixture['archive'])
            self.assertTrue(4 <= fixture['seconds'] <= 16)

    def test_pcm_round_trip_and_normalization_bound(self):
        values = array.array('h', [0, 32767, -32768])
        self.assertEqual(pcm_values(pcm_bytes(values)), values)
        quiet = array.array('h', [100, -100]) * 2400
        normalized, gain = normalize(quiet)
        self.assertGreater(gain, 1)
        self.assertLessEqual(max(abs(x) for x in normalized), 0.9 * 32768 + 1)
        self.assertAlmostEqual(rms(normalized), 0.06, places=4)
        with self.assertRaises(ValueError):
            normalize([])

    def test_mixture_has_requested_whole_clip_snr_without_clipping(self):
        target = array.array('h', [2000, -2000, 2000, -2000]) * 1000
        background = [math.sin(i * 0.013) for i in range(len(target))]
        result, joint = mix(target, background, 6)
        target_scaled = [x / 32768 * joint for x in target]
        interference = [x / 32768 - t for x, t in zip(result, target_scaled)]
        target_power = sum(x * x for x in target_scaled)
        background_power = sum(x * x for x in interference)
        self.assertAlmostEqual(10 * math.log10(target_power / background_power), 6, places=2)
        self.assertLessEqual(max(abs(x) for x in result), 0.98 * 32768 + 1)
        with self.assertRaises(ValueError):
            mix(target, background, float('nan'))

    def test_babble_is_reproducible_and_bounded(self):
        sources = [array.array('h', [1, 2, 3]), array.array('h', [-4, 6])]
        self.assertEqual(babble(sources, 200, 123), babble(sources, 200, 123))
        self.assertEqual(len(babble(sources, 200, 123)), 200)
        self.assertLess(max(abs(v) for v in babble(sources, 200, 123)), 1)

    def test_candidate_confidence_does_not_disable_no_speech_or_repetition_checks(self):
        low = {'text': 'Synthetic phrase.', 'no_speech_prob': 0.1, 'avg_logprob': -1.2}
        self.assertTrue(accepted_result({'segments': [low]})[1])
        self.assertEqual(accepted_result({'segments': [low]}, min_logprob=-1.25)[:2], ('Synthetic phrase.', False))
        self.assertTrue(accepted_result({'segments': [{**low, 'no_speech_prob': 0.95}]}, min_logprob=-1.25)[1])
        loop = {**low, 'text': 'Class, ' * 90, 'avg_logprob': -0.1}
        self.assertTrue(accepted_result({'segments': [loop]}, min_logprob=-1.25)[1])
        for value in (float('nan'), -3, 0):
            with self.assertRaises(ValueError):
                accepted_result({'segments': []}, min_logprob=value)

    def test_profiles_change_one_factor_and_preserve_baseline_defaults(self):
        baseline = PROFILES['baseline-auto']
        self.assertEqual((baseline['speech_threshold'], baseline['min_logprob'], baseline['previewMs'], baseline['maxTurnMs']), (0.5, -1.0, 3000, 12000))
        for name, profile in PROFILES.items():
            if name == 'baseline-auto':
                continue
            self.assertEqual(sum(profile[key] != baseline[key] for key in baseline), 1)

    def test_summary_separates_non_speech_false_text_and_accepted_timing(self):
        base = {'profile': 'baseline-auto', 'condition': 'test', 'referenceUnits': 10, 'errors': 2,
                'outputChars': 8, 'rejected': False, 'speechExpected': True, 'quality': {'speechGateRejected': False}, 'inferenceSeconds': 0.7}
        rejected = {**base, 'outputChars': 0, 'rejected': True, 'quality': {'speechGateRejected': True}, 'inferenceSeconds': 0.01}
        result = aggregate([base, rejected])[0]
        self.assertEqual(result['noText'], 1)
        self.assertEqual(result['acceptedInferenceSeconds']['median'], 0.7)
        self.assertNotEqual(result['inferenceSeconds']['median'], 0.7)
        self.assertEqual(aggregate([{**base, 'referenceUnits': 0, 'speechExpected': False}])[0]['falseTextOnNonSpeech'], 1)

    def test_replay_metadata_rejects_text_and_unknown_fields(self):
        turn = {'sequence': 0, 'final': True, 'rejected': False, 'measurement': {'recognitionInferenceMs': 10, 'recognitionLanguage': 'ja'}}
        self.assertEqual(safe_turn(turn), turn)
        for bad in [{**turn, 'text': 'must not be retained'},
                    {**turn, 'measurement': {'text': 'must not be retained'}},
                    {**turn, 'measurement': {'recognitionLanguage': 'not-a-code'}},
                    {**turn, 'measurement': {'recognitionInferenceMs': float('nan')}}]:
            with self.assertRaises(ValueError):
                safe_turn(bad)

    def test_edit_counts_match_existing_distance_and_account_for_omissions(self):
        for reference, hypothesis in [('abc', 'adc'), ('abc', 'ac'), ('ac', 'abc'), ('', 'abc'), ('abc', ''), ('甲乙丙', '乙丁')]:
            counts = edit_counts(reference, hypothesis, 'ja')
            self.assertEqual(counts['errors'], distance(units(reference, 'ja'), units(hypothesis, 'ja')))
            self.assertEqual(counts['errors'], counts['substitutions'] + counts['deletions'] + counts['insertions'])
        self.assertEqual(edit_counts('abc', '', 'ja')['deletions'], 3)
