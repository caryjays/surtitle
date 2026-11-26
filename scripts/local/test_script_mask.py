import unittest
from script_mask import holding


class HoldingTest(unittest.TestCase):
    pieces = ['the', ' 월', '漢', 'かな', ' カタ', '2', '。', 'A中', '�', '', '한글']

    def test_tokens_with_chinese_characters_or_kana_are_listed_and_hangul_latin_and_digits_are_not(self):
        self.assertEqual(holding(self.pieces, ['CJK', 'IDEOGRAPHIC', 'HIRAGANA', 'KATAKANA']), [2, 3, 4, 6, 7])

    def test_one_kind_alone(self):
        self.assertEqual(holding(self.pieces, ['HANGUL']), [1, 10])

    def test_a_partial_character_and_an_empty_token_are_never_listed(self):
        self.assertEqual(holding(['�', ''], ['CJK']), [])


if __name__ == '__main__':
    unittest.main()
