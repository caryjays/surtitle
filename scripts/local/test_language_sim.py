import unittest
from language_sim import choose, script_ok, stretch

RATE = 24_000


class Stub:
    """Detection probabilities and per-language decodes, as Decoder returns them."""

    def __init__(self, probs, texts):
        self.probs, self.texts = probs, texts

    def detect(self, pcm, a, b):
        return {'probs': self.probs, 'seconds': 0.1}

    def decode(self, pcm, a, b, language):
        text, logprob = self.texts.get(language, ('', -2.0))
        detected = max(self.probs, key=self.probs.get) if language is None else language
        return {'segments': [{'endMs': (b - a) * 1000 // RATE, 'text': text}] if text else [], 'language': detected,
                'seconds': 0.2, 'logprob': logprob, 'speech': True}


class LanguageRuleTests(unittest.TestCase):
    def test_script_check(self):
        self.assertTrue(script_ok('今日はいい天気です', 'ja'))
        self.assertFalse(script_ok('Cancel policy is different', 'ja'))
        self.assertTrue(script_ok('Cancel policy is different', 'en'))
        self.assertFalse(script_ok('キャンセル policy', 'en'))
        self.assertFalse(script_ok('...', 'en'))

    def test_candidates_recover_a_misdetected_opening(self):
        stub = Stub({'en': 0.47, 'ru': 0.1, 'ja': 0.03}, {'en': ('', -1.3), 'ja': ('ビデオ録画の利用は', -0.4)})
        self.assertEqual(choose('auto', stub, b'', 0, RATE * 2)[:2], ([], None))
        segments, language, seconds = choose('candidates', stub, b'', 0, RATE * 2)
        self.assertEqual((segments[0]['text'], language), ('ビデオ録画の利用は', 'ja'))
        self.assertAlmostEqual(seconds, 0.5)  # detection plus a decode per pair language

    def test_candidates_prefer_the_more_confident_text_in_its_own_script(self):
        stub = Stub({'en': 0.6, 'ja': 0.3}, {'en': ('Thank you.', -0.6), 'ja': ('ありがとう', -0.3)})
        self.assertEqual(choose('candidates', stub, b'', 0, RATE)[1], 'ja')
        stub = Stub({'en': 0.6, 'ja': 0.3}, {'en': ('Thank you.', -0.6), 'ja': ('Thank you.', -0.2)})
        self.assertEqual(choose('candidates', stub, b'', 0, RATE)[1], 'en')

    def test_retry_decodes_the_other_language_only_when_the_first_is_filtered(self):
        stub = Stub({'en': 0.47, 'ja': 0.03}, {'en': ('', -1.3), 'ja': ('ビデオ録画の利用は', -0.4)})
        segments, language, seconds = choose('retry', stub, b'', 0, RATE * 2)
        self.assertEqual((segments[0]['text'], language), ('ビデオ録画の利用は', 'ja'))
        self.assertAlmostEqual(seconds, 0.5)
        stub = Stub({'en': 0.6, 'ja': 0.3}, {'en': ('Hello there', -0.6), 'ja': ('ハロー', -0.3)})
        _, language, seconds = choose('retry', stub, b'', 0, RATE)
        self.assertEqual(language, 'en')
        self.assertAlmostEqual(seconds, 0.3)  # no second decode when the first passes

    def test_third_language_is_rejected(self):
        stub = Stub({'zh': 0.8, 'ja': 0.1, 'en': 0.05}, {'ja': ('如果有些人', -0.5), 'en': ('If some people', -0.5)})
        self.assertEqual(choose('candidates', stub, b'', 0, RATE * 3)[:2], ([], None))

    def test_a_stretch_locks_agreed_text_into_one_row(self):
        stub = Stub({'ja': 0.9, 'en': 0.1}, {'ja': ('今日は', -0.2)})
        rows, clock, decodes = stretch('candidates', stub, b'', 0, RATE * 3, 0.0)
        self.assertEqual(rows, [('ja', '今日は')])
        self.assertGreater(decodes, 1)
        self.assertGreaterEqual(clock, 3.0)


if __name__ == '__main__':
    unittest.main()
