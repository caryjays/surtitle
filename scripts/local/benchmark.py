"""Opt-in offline, public-fixture-only benchmark. Does not load .env or call APIs."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import resource
import statistics
import subprocess
import time
from engine import Engine
from scoring import score

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=['small-q4', 'turbo-q4'], required=True)
    parser.add_argument('--mode', choices=['auto', 'forced'], default='auto')
    parser.add_argument('--repeats', type=int, default=2)
    parser.add_argument('--review', action='store_true', help='Explicitly retain public-fixture references/hypotheses in the ignored report')
    args = parser.parse_args()
    if not 1 <= args.repeats <= 10:
        raise ValueError('Repeat limit')
    fixtures = json.loads((ROOT / 'benchmarks/fleurs.json').read_text())
    prepared = []
    for fixture in fixtures:
        path = ROOT / '.local/fixtures' / (fixture['id'] + '.wav')
        if hashlib.sha256(path.read_bytes()).hexdigest() != fixture['sha256']:
            raise ValueError('Unverified fixture')
        pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1'],
                             check=True, capture_output=True).stdout
        prepared.append((fixture, pcm))
    engine = Engine(args.model)
    runs = []
    for repeat in range(args.repeats):
        for fixture, pcm in prepared:
            result = engine.transcribe(pcm, fixture['language'] if args.mode == 'forced' else None)
            scored = score(fixture['reference'], result['text'], fixture['language'])
            run = {'id': fixture['id'], 'language': fixture['language'], 'detectedLanguage': result['language'],
                   'repeat': repeat, 'firstInference': not runs, 'audioSeconds': len(pcm) / 48000,
                   'inferenceSeconds': result['seconds'], 'rtf': result['seconds'] / (len(pcm) / 48000), **scored}
            if args.review:
                run['reference'] = fixture['reference']
                run['hypothesis'] = result['text']
            runs.append(run)
            print(f"{args.model}/{args.mode} {fixture['id']} pass {repeat+1}: {scored['metric']}={100*scored['rate']:.1f}% decode={result['seconds']:.2f}s RTF={run['rtf']:.3f}", flush=True)
    warm = [r for r in runs if not r['firstInference']]
    summary = {}
    for language in ('en', 'ja'):
        selected = [r for r in runs if r['language'] == language]
        summary[language] = {'metric': selected[0]['metric'],
                             'rate': sum(r['errors'] for r in selected) / sum(r['referenceUnits'] for r in selected),
                             'languageCorrect': sum(r['detectedLanguage'] == language for r in selected), 'runs': len(selected)}
    report = {'model': args.model, 'modelMetadata': json.loads((ROOT / 'scripts/local/models.json').read_text())[args.model],
              'speechGate': json.loads((ROOT / 'scripts/local/vad-model.json').read_text()),
              'recognitionFiltering': 'CPU speech gate >=0.5 for 3 consecutive 32ms frames; segment confidence and repetition rejection; no ASR glossary prompt',
              'mode': args.mode, 'repeats': args.repeats, 'scope': 'isolated full clips; no OBS/browser workload; first inference marked separately',
              'platform': platform.platform(), 'python': platform.python_version(),
              'versions': {name: importlib.metadata.version(name) for name in ['mlx', 'mlx-whisper', 'numpy', 'torch']},
              'loadSeconds': engine.load_seconds, 'firstInferenceSeconds': runs[0]['inferenceSeconds'],
              'warmMedianSeconds': statistics.median(r['inferenceSeconds'] for r in warm),
              'warmMaxSeconds': max(r['inferenceSeconds'] for r in warm),
              'warmRTF': sum(r['inferenceSeconds'] for r in warm) / sum(r['audioSeconds'] for r in warm),
              'peakRSSMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2,
              'summary': summary, 'runs': runs}
    dest = ROOT / 'benchmarks/results'; dest.mkdir(parents=True, exist_ok=True)
    output = dest / f'{args.model}-{args.mode}-{time.time_ns()}.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f"SUMMARY {args.model}/{args.mode}: load={engine.load_seconds:.2f}s warm median={report['warmMedianSeconds']:.2f}s RTF={report['warmRTF']:.3f} peakRSS={report['peakRSSMiB']:.0f}MiB")
    print(f"{'Public-fixture review' if args.review else 'Metrics only (no hypotheses retained)'}: {output.relative_to(ROOT)}")


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Local benchmark failed. Check local setup, fixture checksums and model files. Details suppressed.')
        raise SystemExit(1)
