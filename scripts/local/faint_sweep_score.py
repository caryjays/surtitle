"""Score a faint-level sweep from scripts/faint-sweep.ts against the public references. Prints aggregates only."""
import json
import sys
from collections import defaultdict
from pathlib import Path

from scoring import edit_counts

ROOT = Path(__file__).resolve().parents[2]


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.local/experiments/faint-sweep/results.json'
    fixtures = json.loads((ROOT / 'benchmarks/fleurs.json').read_text()) + json.loads((ROOT / 'benchmarks/noisy-ja.json').read_text())['fixtures']
    references = {f['id']: f['reference'] for f in fixtures}
    groups = defaultdict(lambda: defaultdict(int))
    for r in json.loads(path.read_text())['results']:
        counts = edit_counts(references[r['id']], r['text'], r['language'])
        group = groups[(r['bed'], r['level'], r['language'])]
        for key in ('errors', 'deletions', 'referenceUnits'):
            group[key] += counts[key]
        group['clips'] += 1
        group['silent'] += not r['text']
    for (bed, level, language), g in sorted(groups.items(), key=lambda item: (item[0][0], -item[0][1], item[0][2])):
        print(f"bed {bed} level {level:>4} dB {language}: clips {g['clips']}, no text {g['silent']}, "
              f"error {100 * g['errors'] / g['referenceUnits']:.1f}%, deletions {100 * g['deletions'] / g['referenceUnits']:.1f}%")


if __name__ == '__main__':
    main()
