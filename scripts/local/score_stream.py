"""Private stdin benchmark scoring; writes metrics only unless --review is explicit."""
import json
from pathlib import Path
import statistics
import sys
import time
from scoring import score

ROOT = Path(__file__).resolve().parents[2]
try:
    raw = sys.stdin.buffer.read(100_001)
    if len(raw) > 100_000:
        raise ValueError('Report too large')
    report = json.loads(raw)
    fixtures = {f['id']: f for f in json.loads((ROOT / 'benchmarks/fleurs.json').read_text())}
    for run in report['runs']:
        fixture = fixtures[run['id']]
        hypothesis = run.pop('hypothesis')
        run.update(score(fixture['reference'], hypothesis, fixture['language']))
        if '--review' in sys.argv:
            run.update(reference=fixture['reference'], hypothesis=hypothesis)
    report['summary'] = {}
    for language in ('en', 'ja'):
        runs = [r for r in report['runs'] if r['language'] == language]
        report['summary'][language] = {'metric': runs[0]['metric'],
            'rate': sum(r['errors'] for r in runs) / sum(r['referenceUnits'] for r in runs)}
    timings = [t for r in report['runs'] for t in r['timings']]
    report['medianCommitToFinalMs'] = statistics.median(t['commitToFinalMs'] for t in timings)
    report['maxCommitToFinalMs'] = max(t['commitToFinalMs'] for t in timings)
    report['medianTailLatencyMs'] = statistics.median(r['tailLatencyMs'] for r in report['runs'])
    report['maxTailLatencyMs'] = max(r['tailLatencyMs'] for r in report['runs'])
    dest = ROOT / 'benchmarks/results'; dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"stream-{report['model']}-{report['mode']}-{report['maxTurnMs']}-{time.time_ns()}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print('Streaming summary:', json.dumps(report['summary']))
    print(f"Commit→final median {report['medianCommitToFinalMs']:.0f}ms; max {report['maxCommitToFinalMs']:.0f}ms")
    print(f"Estimated last-voiced-frame→last-final median {report['medianTailLatencyMs']:.0f}ms; max {report['maxTailLatencyMs']:.0f}ms")
    print(f'Report: {path.relative_to(ROOT)}')
except Exception:
    print('Stream scoring failed. No content or exception details logged.')
    raise SystemExit(1)
