"""Explicit offline-only paired noise screen. Metrics only unless --review is given.

Full-clip quality/rejection screen, NOT streaming or time-to-first-caption latency.
"""
import argparse
from collections import defaultdict
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import statistics
import time
from noisy_cases import ROOT, CONDITIONS, CONTROL_CONDITIONS
from noisy_profiles import PROFILES, SCREEN_PROFILES
from scoring import score


def distribution(values):
    values = sorted(v for v in values if v is not None)
    return {'n': len(values), 'median': statistics.median(values), 'max': max(values)} if values else {'n': 0}


def aggregate(runs):
    groups = defaultdict(list)
    for run in runs:
        groups[(run['profile'], run['condition'])].append(run)
    result = []
    for (profile, condition), rows in groups.items():
        units = sum(row['referenceUnits'] for row in rows)
        result.append({'profile': profile, 'condition': condition, 'runs': len(rows),
                       'CER': sum(row['errors'] for row in rows) / units if units else None,
                       'referenceUnits': units, 'noText': sum(row['outputChars'] == 0 for row in rows),
                       'rejected': sum(row['rejected'] for row in rows),
                       'speechGateRejected': sum(row['quality']['speechGateRejected'] for row in rows),
                       'falseTextOnNonSpeech': sum(not row['speechExpected'] and row['outputChars'] > 0 for row in rows),
                       'inferenceSeconds': distribution([row['inferenceSeconds'] for row in rows]),
                       'acceptedInferenceSeconds': distribution([row['inferenceSeconds'] for row in rows if row['outputChars']])})
    return result


def load_inputs():
    inputs = json.loads((ROOT / 'benchmarks/results/noisy-inputs.json').read_text())
    manifest = json.loads((ROOT / 'benchmarks/noisy-ja.json').read_text())
    if manifest['license'] != 'CC-BY-4.0' or manifest['revision'] != '70bb2e84b976b7e960aa89f1c648e09c59f894dd':
        raise ValueError('Source provenance')
    references = {f['id']: f['reference'] for f in manifest['fixtures'] if re.fullmatch(r'ja_lab-\d+', f['id']) and isinstance(f['reference'], str) and len(f['reference']) <= 4000}
    if inputs['version'] != 1 or inputs['sampleRate'] != 24000 or len(inputs['cases']) > 64:
        raise ValueError('Input schema')
    loaded = []
    for case in inputs['cases']:
        if not re.fullmatch(r'(ja_lab-\d+|control)--[a-z0-9-]+', case['id']):
            raise ValueError('Input identity')
        if type(case['speechExpected']) is not bool or case['condition'] not in (*CONDITIONS, *CONTROL_CONDITIONS):
            raise ValueError('Case metadata')
        expected_id = f'{case["referenceId"]}--{case["condition"]}' if case['speechExpected'] else f'control--{case["condition"]}'
        if case['id'] != expected_id or (case['speechExpected'] and case['referenceId'] not in references):
            raise ValueError('Case reference')
        expected = f'.local/experiments/noisy/{case["id"]}.pcm'
        if case['path'] != expected:
            raise ValueError('Input allowlist')
        pcm = (ROOT / expected).read_bytes()
        if hashlib.sha256(pcm).hexdigest() != case['sha256'] or not 4800 <= len(pcm) <= 30 * 48000:
            raise ValueError('Input integrity')
        reference = references[case['referenceId']] if case['speechExpected'] else ''
        loaded.append((case, pcm, reference))
    return inputs, loaded


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', action='store_true', required=True, help='Explicit real local model opt-in; no cloud calls')
    parser.add_argument('--model', choices=['turbo-q4', 'small-q4'], default='turbo-q4')
    parser.add_argument('--profiles', default=','.join(SCREEN_PROFILES))
    parser.add_argument('--repeats', type=int, choices=(1, 2, 3), default=1)
    parser.add_argument('--review', action='store_true', help='Explicitly retain PUBLIC-fixture references/hypotheses only')
    args = parser.parse_args()
    profiles = args.profiles.split(',')
    if not profiles or len(profiles) > 4 or len(set(profiles)) != len(profiles) or any(p not in SCREEN_PROFILES for p in profiles):
        raise ValueError('Screen profile allowlist')
    inputs, prepared = load_inputs()
    # Imports/load happen only on this explicit integration path, never in unit tests.
    from engine import Engine
    engine = Engine(args.model)
    engine.warm()
    runs = []
    for repeat in range(args.repeats):
        for index, (case, pcm, reference) in enumerate(prepared):
            # Rotate order to reduce always-first timing bias. Same PCM bytes/reference for every profile.
            shift = (index + repeat) % len(profiles)
            for name in profiles[shift:] + profiles[:shift]:
                profile = PROFILES[name]
                result = engine.transcribe(pcm, profile['language'], speech_threshold=profile['speech_threshold'], min_logprob=profile['min_logprob'])
                language = result['language'] if isinstance(result['language'], str) and re.fullmatch('[a-z]{2,3}', result['language']) else 'unknown'
                scored = score(reference, result['text'], 'ja')
                run = {'id': case['id'], 'condition': case['condition'], 'profile': name, 'repeat': repeat,
                       'speechExpected': case['speechExpected'], 'audioSeconds': len(pcm) / 48000,
                       'inferenceSeconds': result['seconds'], 'rejected': result['rejected'], 'quality': result['quality'],
                       'detectedLanguage': language, 'outputChars': len(result['text']), **scored}
                if args.review:
                    run.update(reference=reference, hypothesis=result['text'])
                runs.append(run)
            print(f'Screened case {index + 1}/{len(prepared)} pass {repeat + 1}; {len(profiles)} paired profiles; metrics only.', flush=True)
    summary = aggregate(runs)
    report = {'experiment': 'controlled-noisy-ja-screen', 'version': 1, 'model': args.model,
              'profiles': {name: PROFILES[name] for name in profiles}, 'seed': inputs['seed'], 'repeats': args.repeats,
              'scope': 'Full clips, no segmentation/previews/browser/translation; not end-to-end latency. Synthetic perturbations of held-out read speech, not spontaneous conversation. Babble CER scores designated target only; other legitimate voices count as interference.',
              'provenance': json.loads((ROOT / 'benchmarks/noisy-ja.json').read_text())['revision'],
              'versions': {name: importlib.metadata.version(name) for name in ('mlx', 'mlx-whisper', 'torch')},
              'sourceHashes': {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in (
                  'scripts/local/engine.py', 'scripts/local/quality.py', 'scripts/local/speech_gate.py', 'scripts/local/noisy_cases.py')},
              'inputHashes': {case['id']: case['sha256'] for case, _, _ in prepared},
              'summary': summary, 'runs': runs}
    output = ROOT / f'benchmarks/results/noisy-screen-{time.time_ns()}.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    for name in profiles:
        selected = [run for run in runs if run['profile'] == name]
        speech = [r for r in selected if r['speechExpected']]
        units = sum(r['referenceUnits'] for r in speech)
        false = sum(not r['speechExpected'] and bool(r['outputChars']) for r in selected)
        print(f'{name}: target CER={100 * sum(r["errors"] for r in speech) / units:.2f}%; no-text speech={sum(not r["outputChars"] for r in speech)}/{len(speech)}; false-text non-speech={false}/{len(selected)-len(speech)}')
    print(f'Metrics report: {output.relative_to(ROOT)}')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Noisy screen failed (runtime/fixture/profile/storage); details suppressed, no raw model errors.')
        raise SystemExit(1)
