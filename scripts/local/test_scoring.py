import unittest
from scoring import distance, score, units


class ScoringTests(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(units('Ｈｅｌｌｏ, WORLD!', 'en'), ['hello', 'world'])
        self.assertEqual(units('「日本語」、です。', 'ja'), list('日本語です'))

    def test_edit_distance(self):
        self.assertEqual(distance(list('kitten'), list('sitting')), 3)
        self.assertEqual(distance([], ['extra']), 1)
        self.assertEqual(distance(['lost'], []), 1)

    def test_word_vs_character(self):
        self.assertEqual(score('one two three', 'one four three', 'en')['rate'], 1 / 3)
        self.assertEqual(score('日本語', '日本', 'ja')['rate'], 1 / 3)
        self.assertGreater(score('one', 'one two three', 'en')['rate'], 1)

    def test_no_false_numeric_equivalence(self):
        self.assertGreater(score('twenty five', '25', 'en')['rate'], 0)
        self.assertIsNone(score('', '', 'en')['rate'])
