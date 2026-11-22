import unittest
from scoring import distance, score, units


class ScoringTests(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(units('Ｈｅｌｌｏ, WORLD!', 'en'), ['hello', 'world'])
        self.assertEqual(units('「日本語」、です。', 'ja'), list('日本語です'))

    def test_chinese_scripts_fold_and_japanese_does_not(self):
        self.assertEqual(units('這裏的軟件，後來發展了。', 'zh'), units('这里的软件后来发展了', 'zh'))
        self.assertEqual(score('后来发展了', '後來發展了', 'zh')['errors'], 0)
        self.assertEqual(units('ご視聴', 'ja'), list('ご視聴'))

    def test_chinese_scores_latin_runs_as_words(self):
        self.assertEqual(units('我 們 講 self-supervised learning 的 BERT, 2021年', 'zh'),
                         ['我', '们', '讲', 'self', 'supervised', 'learning', '的', 'bert', '2021', '年'])
        self.assertEqual(score('講 decoder', '讲 decoders', 'zh')['errors'], 1)
        self.assertEqual(units('GPT', 'ja'), list('gpt'))

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
