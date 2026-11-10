import math
import unittest
from quality import (accepted_segments, accepted_text, accepted_result, pair_retry_language, quality_metadata, repetitive,
                     script_matches, segment_ends)


def segment(text, no_speech=0.01, logprob=-0.2):
    return {'text': text, 'no_speech_prob': no_speech, 'avg_logprob': logprob}


class QualityTests(unittest.TestCase):
    def test_repetitive_hallucinations(self):
        for text in ['鮑、' * 60, 'クラス' * 100, 'ギャルスティック ' * 30, 'Class, ' * 90]:
            self.assertTrue(repetitive(text))
            self.assertEqual(accepted_text({'segments': [segment(text)]}), ('', True))

    def test_real_short_repetition_survives(self):
        for text in ['One, two, three, four.', 'Yes, yes, yes.', 'はい、はい。',
                     'このモデルの推論速度を測定したいです。']:
            self.assertEqual(accepted_text({'segments': [segment(text)]}), (text, False))

    def test_silence_and_low_confidence(self):
        for entry in [segment('Invented speech', 0.95, -0.1),
                      segment('Invented speech', 0.7, -0.8),
                      segment('Uncertain speech', 0.1, -1.2),
                      segment('Invalid scores', float('nan'))]:
            self.assertEqual(accepted_text({'segments': [entry]}), ('', True))

    def test_good_speech_is_not_lost_with_bad_tail(self):
        self.assertEqual(accepted_text({'segments': [segment('Actual question.'), segment('Class, ' * 90)]}),
                         ('Actual question.', False))

    def test_metadata_reports_partial_filtering_without_changing_accepted_speech(self):
        result = {'segments': [segment('A real question.'), segment('uncertain', 0.1, -1.2), segment('noise', 0.95, -0.1)]}
        text, rejected, metrics = accepted_result(result)
        self.assertEqual((text, rejected), ('A real question.', False))
        self.assertEqual(metrics['decodedSegments'], 3)
        self.assertEqual(metrics['droppedSegments'], 2)
        self.assertEqual(metrics['noSpeechDrops'], 1)
        self.assertEqual(metrics['lowConfidenceDrops'], 1)
        self.assertEqual(metrics['noSpeechMax'], 0.95)
        self.assertEqual(metrics['logprobMin'], -1.2)
        self.assertNotIn('text', metrics)

    def test_metadata_distinguishes_speech_gate_invalid_scores_and_repetition(self):
        self.assertTrue(quality_metadata(True)['speechGateRejected'])
        _, _, invalid = accepted_result({'segments': [segment('invalid', float('nan'))]})
        self.assertEqual(invalid['invalidScoreDrops'], 1)
        self.assertIsNone(invalid['noSpeechMax'])
        _, rejected, repeated = accepted_result({'segments': [segment('Class, ' * 90)]})
        self.assertTrue(rejected)
        self.assertEqual(repeated['repetitionDrops'], 1)
        self.assertEqual(repeated['droppedSegments'], 1)

    def test_diagnostic_counters_preserve_pre_update_acceptance_at_score_boundaries(self):
        # Independent reference of the pre-telemetry filter; no inference or retained speech.
        def previous(entries):
            kept = []
            rejected = False
            for entry in entries:
                text = entry['text']
                ns = entry['no_speech_prob']
                lp = entry['avg_logprob']
                if not math.isfinite(ns) or not math.isfinite(lp):
                    rejected = True
                elif ns >= 0.9 or (ns >= 0.6 and lp < -0.4) or lp < -1.0 or repetitive(text):
                    rejected = True
                else:
                    kept.append(text)
            text = ''.join(kept).strip()
            return ('', True) if repetitive(text) else (text, rejected and not text)
        for ns in [0, 0.59, 0.6, 0.89, 0.9, 1, float('nan')]:
            for lp in [-1.01, -1, -0.41, -0.4, 0, float('nan')]:
                for text in ['Synthetic test sentence.', 'はい、はい。', 'Class, ' * 90]:
                    entries = [segment(text, ns, lp)]
                    self.assertEqual(accepted_text({'segments': entries}), previous(entries))
                    mixed = [segment('A valid fixture.'), *entries]
                    self.assertEqual(accepted_text({'segments': mixed}), previous(mixed))

    def test_stock_sign_off_from_a_long_turn_is_rejected(self):
        for text in ['ご視聴ありがとうございました', 'お疲れ様でした。', 'Thank you for watching!', ' Thank you. Thank you.']:
            text_out, rejected, metrics = accepted_result({'segments': [segment(text)]}, audio_seconds=12)
            self.assertEqual((text_out, rejected), ('', True))
            self.assertEqual(metrics['stockPhraseDrops'], 1)
            self.assertEqual(metrics['droppedSegments'], 1)

    def test_stock_sign_off_said_for_real_survives(self):
        # Short audio, unknown duration, or a sign-off inside real speech is kept.
        for text, seconds in [('ご視聴ありがとうございました', 3), ('Thank you.', 5.9), ('Thank you.', None),
                              ('今日はお疲れ様でした、また来週。', 12), ('Thank you for the question.', 12)]:
            text_out, rejected, metrics = accepted_result({'segments': [segment(text)]}, audio_seconds=seconds)
            self.assertEqual((text_out, rejected), (text, False))
            self.assertEqual(metrics['stockPhraseDrops'], 0)

    def test_empty_decoder_output_is_not_invented(self):
        self.assertEqual(accepted_text({'text': 'ignored', 'segments': []}), ('', False))

    def test_accepted_segments_keep_end_times_of_good_segments_only(self):
        result = {'segments': [dict(segment('First part.'), end=2.4), dict(segment('noise', 0.95, -0.1), end=3.0),
                               dict(segment(' Second part.'), end=5.1)]}
        kept, rejected, _ = accepted_segments(result)
        self.assertFalse(rejected)
        self.assertEqual(kept, [{'text': 'First part.', 'end': 2.4}, {'text': ' Second part.', 'end': 5.1}])
        self.assertEqual(accepted_result(result)[0], 'First part. Second part.')
        self.assertEqual(accepted_segments({'segments': [dict(segment('Class, ' * 90), end=9.0)]})[:2], ([], True))
        self.assertEqual(accepted_segments({'segments': [dict(segment('ご視聴ありがとうございました'), end=11.0)]},
                                           audio_seconds=12)[:2], ([], True))

    def test_segment_ends_are_clamped_ordered_and_bounded(self):
        self.assertEqual(segment_ends([{'text': 'a', 'end': 1.234}, {'text': 'b', 'end': 10.4}], 10_000),
                         [{'endMs': 1234, 'text': 'a'}, {'endMs': 10_000, 'text': 'b'}])
        for bad in (None, float('nan'), float('inf'), -0.5, True):
            self.assertEqual(segment_ends([{'text': 'a', 'end': 1.0}, {'text': 'b', 'end': bad}, {'text': 'c', 'end': 3.0}], 5000),
                             [{'endMs': 1000, 'text': 'a'}])
        self.assertEqual(segment_ends([{'text': 'a', 'end': 2.0}, {'text': 'b', 'end': 1.0}], 5000), [{'endMs': 2000, 'text': 'a'}])
        self.assertEqual(len(segment_ends([{'text': 'a', 'end': i / 10} for i in range(100)], 30_000)), 64)
        self.assertEqual(segment_ends([{'text': 'x' * 3000, 'end': 1.0}, {'text': 'y' * 1001, 'end': 2.0}], 5000),
                         [{'endMs': 1000, 'text': 'x' * 3000}])

