import json
from pathlib import Path
import re
import unittest
import subprocess
import tempfile
from gate import digest, edits, held_out, implementation, load_gate, p90, public_clips
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


class RunIdentityTests(unittest.TestCase):
    def test_the_implementation_digest_follows_uncommitted_and_untracked_files_and_skips_ignored_ones(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
            (root / 'scripts').mkdir()
            (root / 'scripts/a.py').write_text('one')
            (root / '.gitignore').write_text('scripts/secret\n')
            (root / 'README.md').write_text('outside the implementation')
            first = implementation(root)
            self.assertEqual(first['files'], 1)
            (root / 'README.md').write_text('changed')
            (root / 'scripts/secret').write_text('ignored')
            self.assertEqual(implementation(root), first)
            (root / 'scripts/a.py').write_text('two')
            second = implementation(root)
            self.assertNotEqual(second['sha256'], first['sha256'])
            (root / 'scripts/b.py').write_text('new')
            self.assertEqual(implementation(root)['files'], 2)
            self.assertNotEqual(implementation(root)['sha256'], second['sha256'])

    def test_a_gate_digest_changes_with_a_target_and_not_with_key_order(self):
        gate = load_gate('ja')
        self.assertEqual(digest(gate), digest(dict(reversed(list(gate.items())))))
        changed = json.loads(json.dumps(gate))
        changed['targets'][0]['max']['ja'] += 0.001
        self.assertNotEqual(digest(gate), digest(changed))


class GateFileTests(unittest.TestCase):
    def test_a_gate_names_its_languages_pair_and_public_clips(self):
        gate = load_gate('ja')
        self.assertEqual((gate['languages'], gate['pair']), (['ja', 'en'], 'en-ja'))
        clips = public_clips(gate)
        self.assertEqual({c['language'] for c in clips}, {'ja', 'en'})
        self.assertEqual([c['language'] for c in public_clips(gate, 3)], ['ja'] * 3 + ['en'] * 3)
        for bad in ('xx', '../gate-ja', 'fleurs'):
            with self.assertRaises((ValueError, OSError, KeyError)):
                load_gate(bad)


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
