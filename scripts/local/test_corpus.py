import unittest
import random
from corpus_eval import edit_counts, summarize
from scoring import edit_counts as plain_counts
from prepare_corpus import screen, utterances


def lines(texts, step=3.0, gap=0.0):
    return utterances({f'v-{i:05d}-{int(i * (step + gap) * 100):08d}-{int((i * (step + gap) + step) * 100):08d}': text
                       for i, text in enumerate(texts)})


class CorpusScreenTests(unittest.TestCase):
    def test_times_come_from_the_keys(self):
        self.assertEqual(utterances({'abc-def-00001-00000150-00000420': ' ｔｅｘｔ '}), [(1.5, 4.2, 'text')])

    def test_keeps_steady_english_speech(self):
        talk = lines([f'this is sentence number {i} of the talk' for i in range(200)])
        self.assertIsNone(screen('en', 600, talk))

    def test_keeps_steady_japanese_speech(self):
        talk = lines([f'これは講演の{i}番目の文です' for i in range(200)])
        self.assertIsNone(screen('ja', 600, talk))

    def test_rejections(self):
        talk = [f'this is sentence number {i} of the talk' for i in range(200)]
        self.assertEqual(screen('en', 120, lines(talk[:40])), 'length')
        self.assertEqual(screen('en', 600, lines(talk[:80], gap=4.0)), 'coverage')
        self.assertEqual(screen('ja', 600, lines(talk)), 'script')
        self.assertEqual(screen('en', 600, lines(['♪ la la la ♪'] * 20 + talk[20:])), 'music')
        rolled = [text for line in talk[:100] for text in (line, f'{line} and more')]
        self.assertEqual(screen('en', 600, lines(rolled)), 'repeated lines')
        self.assertEqual(screen('en', 600, lines([f'word{i}' for i in range(200)])), 'rate')


def case(text, language='en', **turn):
    return {'asr': text, 'detectedLanguage': language, 'turn': {'audioMs': 4000, **turn}}


class CorpusSummaryTests(unittest.TestCase):
    def test_fast_alignment_matches_the_plain_scorer(self):
        random.seed(3)
        for _ in range(200):
            language = random.choice(['en', 'ja'])
            pick = (lambda: random.choice('abcd')) if language == 'en' else (lambda: random.choice('日本語です'))
            sep = ' ' if language == 'en' else ''
            reference = sep.join(pick() for _ in range(random.randint(0, 12)))
            hypothesis = sep.join(pick() for _ in range(random.randint(0, 12)))
            fast, plain = edit_counts(reference, hypothesis, language), plain_counts(reference, hypothesis, language)
            self.assertEqual((fast['errors'], fast['referenceUnits']), (plain['errors'], plain['referenceUnits']))
            self.assertLessEqual(fast['deletions'], plain['deletions'])
            self.assertEqual(fast['errors'], fast['substitutions'] + fast['deletions'] + fast['insertions'])

    def test_live_against_subtitles_and_whole_file(self):
        entry = {'id': 'yodas-en-x', 'seconds': 600}
        cases = [case('one two', lockLagMs=1000, firstTextMs=3000, forcedLocks=1), case('five six', 'ja')]
        s = summarize('en', [(entry, 'one two three four five six', 'one two three four five six', cases)])
        self.assertAlmostEqual(s['liveErrorRate'], 2 / 6)
        self.assertAlmostEqual(s['liveDeletionRate'], 2 / 6)
        self.assertEqual(s['wholeFileErrorRate'], 0)
        self.assertAlmostEqual(s['liveMinusWholeFile'], 2 / 6)
        self.assertAlmostEqual(s['lostVsWholeFile'], 2 / 6)
        self.assertEqual((s['wrongLanguageShare'], s['forcedLocks'], s['lockLagP90Ms']), (0.5, 1, 1000))

    def test_lost_text_ignores_subtitle_paraphrase(self):
        entry = {'id': 'yodas-en-y', 'seconds': 600}
        s = summarize('en', [(entry, 'we will begin now', 'so we are going to start', [case('so we are going to start')])])
        self.assertGreater(s['liveErrorRate'], 0)
        self.assertEqual((s['liveMinusWholeFile'], s['lostVsWholeFile']), (0, 0))


if __name__ == '__main__':
    unittest.main()
