"""Consume transient PUBLIC-fixture hypotheses from replay; retain numeric metrics only."""
import hashlib
import json
import math
import re
from pathlib import Path
import statistics
import sys
import time
from noisy_profiles import PROFILES
from noisy_screen import load_inputs
from scoring import edit_counts

ROOT = Path(__file__).resolve().parents[2]


def safe_turn(turn):
    if set(turn) != {'sequence', 'final', 'rejected', 'measurement'} or type(turn['sequence']) is not int or turn['sequence'] < 0:
        raise ValueError('Turn schema')
    if type(turn['final']) is not bool or type(turn['rejected']) is not bool:
        raise ValueError('Turn flags')
    metrics = turn['measurement']
    numeric = {'audioMs', 'trailingQuietMs', 'recognitionQueueMs', 'recognitionInferenceMs', 'commitToFinalMs'}
    flags = {'recognitionClipped', 'adapterRepetitionRejected'}
    for key, value in metrics.items():
        if key in numeric:
            if type(value) not in (float, int) or not math.isfinite(value) or not 0 <= value <= 120000:
                raise ValueError('Timing metric')
        elif key in flags:
            if type(value) is not bool:
                raise ValueError('Metric flag')
        elif key == 'boundary':
            if value not in ('silence', 'max-duration', 'flush', 'mode-change', 'pause', 'recalibration'):
                raise ValueError('Boundary')
        elif key == 'recognitionLanguage':
            if not isinstance(value, str) or not re.fullmatch(r'(?:[a-z]{2,3}|unknown)', value):
                raise ValueError('Language code')
        elif key == 'recognitionFailure':
            if value not in ('runtime', 'protocol', 'startup-timeout', 'inference-timeout', 'queue-expired'):
                raise ValueError('Failure category')
        elif key == 'quality':
            expected = {'speechGateRejected', 'decodedSegments', 'droppedSegments', 'noSpeechDrops', 'lowConfidenceDrops',
                        'repetitionDrops', 'invalidScoreDrops', 'noSpeechMax', 'logprobMin'}
            if set(value) != expected or type(value['speechGateRejected']) is not bool:
                raise ValueError('Quality schema')
            for field in expected - {'speechGateRejected', 'noSpeechMax', 'logprobMin'}:
                if type(value[field]) is not int or not 0 <= value[field] <= 10000:
                    raise ValueError('Quality count')
            for field, lower, upper in [('noSpeechMax', 0, 1), ('logprobMin', -100, 10)]:
                v = value[field]
                if v is not None and (type(v) not in (float, int) or not math.isfinite(v) or not lower <= v <= upper):
                    raise ValueError('Quality score')
        else:
            raise ValueError('Unknown metadata field')
    return {'sequence': turn['sequence'], 'final': turn['final'], 'rejected': turn['rejected'], 'measurement': metrics}


def main():
    raw = sys.stdin.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError('Input bound')
    report = json.loads(raw)
    inputs, prepared = load_inputs()
    cases = {case['id']: (case, reference) for case, _, reference in prepared}
    if (report['model'] not in ('turbo-q4', 'small-q4') or len(report['runs']) > 64
            or not 1 <= len(report['profiles']) <= 6 or len(set(report['profiles'])) != len(report['profiles'])
            or any(profile not in PROFILES for profile in report['profiles'])):
        raise ValueError('Replay schema')
    runs = []
    for run in report['runs']:
        if (run['profile'] not in report['profiles'] or run['id'] not in cases
                or not isinstance(run['hypothesis'], str) or len(run['hypothesis']) > 32000):
            raise ValueError('Replay identity')
        case, reference = cases[run['id']]
        errors = edit_counts(reference, run['hypothesis'], 'ja')
        if len(run['turns']) > 64:
            raise ValueError('Turn bound')
        turns = [safe_turn(turn) for turn in run['turns']]
        if type(run['workerReplies']) is not int or not 0 <= run['workerReplies'] <= 100:
            raise ValueError('Worker reply count')
        for name in ('firstEmittedOriginalMs', 'firstFinalizedOriginalMs', 'lastFinalFromPcmEndMs', 'frameLateMaxMs'):
            value = run[name]
            if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not -30000 <= value <= 120000):
                raise ValueError('Replay timing')
        # Deliberate whitelist: never retain hypothesis/reference/provider IDs/raw errors/config.
        runs.append({'id': case['id'], 'profile': run['profile'], 'condition': case['condition'],
                     'speechExpected': case['speechExpected'], 'audioSeconds': case['seconds'],
                     'firstEmittedOriginalMs': run['firstEmittedOriginalMs'], 'firstFinalizedOriginalMs': run['firstFinalizedOriginalMs'], 'lastFinalFromPcmEndMs': run['lastFinalFromPcmEndMs'],
                     'frameLateMaxMs': run['frameLateMaxMs'], 'workerReplies': run['workerReplies'], 'turns': turns,
                     'outputChars': len(run['hypothesis']), **errors,
                     'CER': errors['errors'] / errors['referenceUnits'] if errors['referenceUnits'] else None})
    output = ROOT / f'benchmarks/results/noisy-replay-{time.time_ns()}.json'
    result = {'experiment': 'controlled-noisy-ja-realtime-replay', 'version': 1, 'model': report['model'],
              'profiles': {name: PROFILES[name] for name in report['profiles']}, 'seed': inputs['seed'],
              'scope': 'Selected controlled conditions for one target sentence; non-speech control only when selected. Not representative conversation. Actual LocalTranscriber/speech gate/Whisper at real-time 50ms PCM, quiet calibration, previews enabled. No browser/OBS/network/translation. First emitted source timing is from target PCM start, not labelled speech onset or browser paint; tail from PCM end, not human-labelled speech end. One pass, profile order not counterbalanced.',
              'inputHashes': {case['id']: case['sha256'] for case, _, _ in prepared},
              'sourceHashes': {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in (
                  'scripts/noisy-stream-experiment.ts', 'packages/providers/local.ts', 'packages/providers/turns.ts',
                  'scripts/local/engine.py', 'scripts/local/quality.py', 'scripts/local/speech_gate.py')},
              'runs': runs}
    output.write_text(json.dumps(result, indent=2) + '\n')
    for name in report['profiles']:
        selected = [r for r in runs if r['profile'] == name]
        speech = [r for r in selected if r['speechExpected']]
        units = sum(r['referenceUnits'] for r in speech)
        first = [r['firstEmittedOriginalMs'] for r in speech if r['firstEmittedOriginalMs'] is not None]
        cer_label = f'{100 * sum(r["errors"] for r in speech) / units:.2f}%' if units else 'n/a'
        first_label = f'{statistics.median(first):.0f}ms' if first else 'none'
        final = [r['firstFinalizedOriginalMs'] for r in speech if r['firstFinalizedOriginalMs'] is not None]
        final_label = f'{statistics.median(final):.0f}ms' if final else 'none'
        print(f'{name}: target CER={cer_label}; '
              f'median first emitted original={first_label}; first finalized={final_label}; '
              f'rejected candidates={sum(turn["rejected"] for r in speech for turn in r["turns"])}/'
              f'{sum(len(r["turns"]) for r in speech)}; false-text controls={sum(not r["speechExpected"] and bool(r["outputChars"]) for r in selected)}/{len(selected)-len(speech)}')
    print(f'Metrics report: {output.relative_to(ROOT)}')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Noisy replay scoring failed (safe schema/scoring/storage category); details suppressed.')
        raise SystemExit(1)
