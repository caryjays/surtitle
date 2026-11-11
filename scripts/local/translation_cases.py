"""Freeze public-fixture recognition output as translation-eval cases. Offline; no .env, no API calls.

Each case pairs the live recognizer's text with the public reference, so a translation
eval can see real recognition errors and a judge can score against what was actually said.
Output goes to the ignored benchmarks/results/ directory; regenerate only when recognition changes.

--gate <language> freezes that gate's public clips instead, both languages of its pair, to translation-cases-<language>.json.
"""
import argparse
import hashlib
import importlib.metadata
import json
import subprocess
from pathlib import Path
import time
from engine import Engine

ROOT = Path(__file__).resolve().parents[2]

VARIANTS = ('fast-125', 'noise-6db', 'babble-6db', 'babble-0db', 'faint-minus12db')


def wav_pcm(path):
    return subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1'],
                          check=True, capture_output=True).stdout


def verified(path, sha256):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != sha256:
        raise ValueError('Unverified fixture')
    return data


def load_sources():
    sources = []
    for fixture in json.loads((ROOT / 'benchmarks/fleurs.json').read_text()):
        path = ROOT / '.local/fixtures' / (fixture['id'] + '.wav')
        verified(path, fixture['sha256'])
        sources.append((fixture['id'], fixture['id'], 'clean', fixture['language'], fixture['reference'], wav_pcm(path)))
    manifest = json.loads((ROOT / 'benchmarks/noisy-ja.json').read_text())
    if manifest['license'] != 'CC-BY-4.0':
        raise ValueError('Source provenance')
    for fixture in manifest['fixtures']:
        path = ROOT / '.local/fixtures' / (fixture['id'] + '.wav')
        verified(path, fixture['sha256'])
        sources.append((fixture['id'], fixture['id'], 'clean', 'ja', fixture['reference'], wav_pcm(path)))
    noisy = ROOT / 'benchmarks/results/noisy-inputs.json'
    if noisy.exists():
        references = {f['id']: f['reference'] for f in manifest['fixtures']}
        for case in json.loads(noisy.read_text())['cases']:
            if case['speechExpected'] and case['condition'] in VARIANTS and case['path'] == f'.local/experiments/noisy/{case["id"]}.pcm':
                pcm = verified(ROOT / case['path'], case['sha256'])
                sources.append((case['id'], case['referenceId'], case['condition'], 'ja', references[case['referenceId']], pcm))
    return sources


def gate_sources(gate):
    sources = []
    manifest = json.loads((ROOT / 'benchmarks' / gate['public']).read_text())
    if manifest['license'] != 'CC-BY-4.0':
        raise ValueError('Source provenance')
    for fixture in manifest['fixtures']:
        path = ROOT / '.local/fixtures/gate' / (fixture['id'] + '.wav')
        verified(path, fixture['sha256'])
        sources.append((fixture['id'], fixture['id'], 'clean', fixture['language'], fixture['reference'], wav_pcm(path)))
    return sources


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=['small-q4', 'turbo-q4'], default='turbo-q4')
    parser.add_argument('--gate', help="a gate's public clips instead of the tuning fixtures, such as es")
    args = parser.parse_args()
    gate = json.loads((ROOT / f'benchmarks/gate-{args.gate}.json').read_text()) if args.gate else None
    if args.gate and (not args.gate.isalpha() or gate['gate'] != args.gate):
        raise ValueError('Gate file')
    pair = tuple(gate['languages']) if gate else ('en', 'ja')
    sources = gate_sources(gate) if gate else load_sources()
    name = f'translation-cases-{args.gate}.json' if gate else 'translation-cases.json'
    engine = Engine(args.model)
    cases, rejected = [], 0
    for case_id, reference_id, condition, language, reference, pcm in sources:
        # Auto language matches the Conversation preset, where recognition errors are most varied.
        result = engine.transcribe(pcm, None, **({'pair': list(pair)} if gate else {}))
        if result['rejected'] or not result['text'].strip():
            rejected += 1
            print(f'{case_id}: rejected by recognition, not a translation case', flush=True)
            continue
        detected = result['language'] if result['language'] in pair else 'unknown'
        cases.append({'id': case_id, 'referenceId': reference_id, 'condition': condition, 'language': language,
                      'detectedLanguage': detected, 'reference': reference, 'asr': result['text']})
        print(f'{case_id}: {len(result["text"])} chars, detected {detected}', flush=True)
    output = {'version': 1, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'recognition': {'model': args.model, 'language': 'auto', 'prompt': None,
                              'mlxWhisper': importlib.metadata.version('mlx-whisper')},
              'source': 'Google FLEURS, CC BY 4.0; see benchmarks/README.md', 'rejected': rejected, 'cases': cases}
    dest = ROOT / 'benchmarks/results'
    dest.mkdir(parents=True, exist_ok=True)
    (dest / name).write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(cases)} cases, {rejected} rejected: benchmarks/results/{name}')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Case generation failed. Check local setup, fixtures (pnpm local:fixtures, local:noisy-fixtures, local:noisy-prepare) and model files. Details suppressed.')
        raise SystemExit(1)
