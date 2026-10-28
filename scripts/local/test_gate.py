import json
from pathlib import Path
import re
import unittest
from gate import edits, held_out, p90
from scoring import edit_counts

ROOT = Path(__file__).resolve().parents[2]


class GateScoringTests(unittest.TestCase):
    def test_matches_plain_scoring_without_exclusions(self):
        for reference, hypothesis, language in [('one two three four', 'one too three', 'en'),
                                                ('日本語の文です', '日本の文でした', 'ja'), ('', 'extra words', 'en')]:
            plain, gated = edit_counts(reference, hypothesis, language), edits(reference, hypothesis, language)
            self.assertEqual((gated['errors'], gated['deletions'], gated['referenceUnits']),
                             (plain['errors'], plain['deletions'], plain['referenceUnits']))

    def test_excluded_span_costs_nothing(self):
        result = edits('a b {{c d}} e', 'a b x y z e', 'en')
        self.assertEqual((result['errors'], result['referenceUnits'], result['excludedUnits']), (0, 3, 2))
        self.assertEqual(edits('a b {{c d}} e', 'a b e', 'en')['errors'], 0)
        self.assertEqual(edits('{{固有名詞}}です', 'こゆうめいしです', 'ja')['errors'], 0)

    def test_errors_outside_a_span_still_count(self):
        result = edits('a b {{c}} d e', 'a e', 'en')
        self.assertEqual((result['errors'], result['deletions']), (2, 2))

    def test_p90(self):
        self.assertEqual(p90(list(range(1, 11))), 9)
        self.assertEqual(p90([5]), 5)
        self.assertIsNone(p90([]))

    def test_held_out_manifests_stay_private(self):
        with self.assertRaises(ValueError):
            held_out(ROOT / 'benchmarks/held-out.json')


class GateTargetsTests(unittest.TestCase):
    def test_targets_match_the_wiki_table(self):
        gate = json.loads((ROOT / 'benchmarks/gate-ja.json').read_text())
        page = (ROOT / gate['page']).read_text()
        scale = {'percent': 100, 'points': 100, 'seconds': 0.001}
        for target in gate['targets']:
            if not target['label']:
                continue
            row = next(line for line in page.splitlines() if line.startswith(f"| {target['label']} |"))
            cells = [cell.strip() for cell in row.strip('|').split('|')]
            for language, cell in zip(gate['languages'], cells[1:]):
                shown = float(re.search(r'\d+(?:\.\d+)?', cell).group())
                self.assertAlmostEqual(shown, target['max'][language] * scale[target['unit']], msg=target['key'])


if __name__ == '__main__':
    unittest.main()
