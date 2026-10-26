"""Deterministic public-fixture perturbations. No audience input, models, APIs or .env.

Synthetic speed/noise/competing-read-speech cases are NOT natural conversation recordings.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import random
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
RATE = 24000
SEED = 20261021
CONDITIONS = ('clean', 'fast-125', 'noise-6db', 'babble-6db', 'babble-0db', 'faint-minus12db')
CONTROL_CONDITIONS = ('silence', 'noise-low', 'noise-high', 'hum-50hz', 'hum-220hz', 'modulated-noise')


def pcm_values(data):
    result = array.array('h')
    result.frombytes(data)
    if sys.byteorder != 'little':
        result.byteswap()
    return result


def pcm_bytes(values):
    data = array.array('h', values)
    if sys.byteorder != 'little':
        data.byteswap()
    return data.tobytes()


def rms(values):
    return math.sqrt(sum((x / 32768) ** 2 for x in values) / len(values)) if values else 0


def quantize(values):
    return array.array('h', (max(-32768, min(32767, round(x * 32768))) for x in values))


def normalize(values):
    if not values:
        raise ValueError('Empty audio')
    levels = sorted(rms(values[i:i + 1200]) for i in range(0, len(values), 1200))
    p90 = levels[min(len(levels) - 1, int(len(levels) * 0.9))]
    peak = max(abs(x) for x in values) / 32768
    gain = min(0.06 / p90, 0.9 / peak, 100) if p90 and peak else 1
    return quantize(x / 32768 * gain for x in values), gain


def mix(target, background, snr_db):
    """Scale summed interference to an explicit whole-clip SNR; prevent clipping jointly."""
    if len(target) != len(background) or not target or not math.isfinite(snr_db) or not -30 <= snr_db <= 30:
        raise ValueError('Mixture length/SNR')
    target_rms = rms(target)
    background_rms = math.sqrt(sum(x * x for x in background) / len(background))
    scale = target_rms / (10 ** (snr_db / 20) * background_rms) if background_rms else 0
    combined = [t / 32768 + b * scale for t, b in zip(target, background)]
    peak = max(abs(x) for x in combined)
    joint = min(1, 0.98 / peak) if peak else 1
    return quantize(x * joint for x in combined), joint


def babble(backgrounds, length, seed):
    rng = random.Random(seed)
    offsets = [rng.randrange(len(values)) for values in backgrounds]
    return [sum(values[(i + offset) % len(values)] / 32768 for values, offset in zip(backgrounds, offsets)) / len(backgrounds)
            for i in range(length)]


def sources():
    manifest = json.loads((ROOT / 'benchmarks/noisy-ja.json').read_text())
    if manifest['license'] != 'CC-BY-4.0' or manifest['revision'] != '70bb2e84b976b7e960aa89f1c648e09c59f894dd':
        raise ValueError('Fixture provenance')
    prepared = []
    for fixture in manifest['fixtures']:
        if not re.fullmatch(r'ja_lab-\d+', fixture['id']) or fixture['role'] not in ('target', 'distractor'):
            raise ValueError('Fixture identity')
        data = (ROOT / '.local/fixtures' / (fixture['id'] + '.wav')).read_bytes()
        if hashlib.sha256(data).hexdigest() != fixture['sha256']:
            raise ValueError('Fixture checksum')
        converted = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', str(RATE), '-ac', '1', 'pipe:1'],
                                   input=data, check=True, capture_output=True, timeout=20).stdout
        values, gain = normalize(pcm_values(converted))
        prepared.append({**fixture, 'audio': values, 'gain': gain, 'source': data})
    if sum(f['role'] == 'target' for f in prepared) != 4 or sum(f['role'] == 'distractor' for f in prepared) != 4:
        raise ValueError('Corpus size')
    return manifest, prepared


def cases():
    manifest, prepared = sources()
    backgrounds = [f['audio'] for f in prepared if f['role'] == 'distractor'][:3]
    for index, fixture in enumerate(f for f in prepared if f['role'] == 'target'):
        target = fixture['audio']
        interference = babble(backgrounds, len(target), SEED + index)
        rng = random.Random(SEED + 100 + index)
        noise = [rng.gauss(0, 1) for _ in target]
        for condition in CONDITIONS:
            joint = 1
            if condition == 'clean':
                values = target
            elif condition == 'fast-125':
                data = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-af', 'atempo=1.25', '-f', 's16le',
                                       '-ar', str(RATE), '-ac', '1', 'pipe:1'], input=fixture['source'], check=True,
                                      capture_output=True, timeout=20).stdout
                values = quantize(x / 32768 * fixture['gain'] for x in pcm_values(data))
            elif condition == 'faint-minus12db':
                values = quantize(x / 32768 * 10 ** (-12 / 20) for x in target)
            else:
                values, joint = mix(target, noise if condition == 'noise-6db' else interference,
                                    0 if condition == 'babble-0db' else 6)
            yield {'id': f'{fixture["id"]}--{condition}', 'condition': condition, 'referenceId': fixture['id'],
                   'speechExpected': True, 'normalizationGain': fixture['gain'], 'jointAntiClipScale': joint}, values
    length = RATE * 6
    for condition in CONTROL_CONDITIONS:
        rng = random.Random(SEED)
        if condition == 'silence':
            values = array.array('h', [0]) * length
        elif condition.startswith('hum-'):
            frequency = 50 if condition == 'hum-50hz' else 220
            values = quantize(0.04 * math.sin(2 * math.pi * frequency * i / RATE) for i in range(length))
        elif condition == 'modulated-noise':
            values = quantize(rng.gauss(0, 1) * (0.015 + 0.02 * (1 + math.sin(2 * math.pi * 4 * i / RATE))) for i in range(length))
        else:
            values = quantize(rng.gauss(0, 0.025 if condition == 'noise-low' else 0.08) for _ in range(length))
        yield {'id': f'control--{condition}', 'condition': condition, 'referenceId': None,
               'speechExpected': False, 'normalizationGain': 1, 'jointAntiClipScale': 1}, values


def prepare():
    dest = ROOT / '.local/experiments/noisy'
    dest.mkdir(parents=True, exist_ok=True)
    records = []
    for metadata, values in cases():
        path = dest / (metadata['id'] + '.pcm')
        data = pcm_bytes(values)
        path.write_bytes(data)
        records.append({**metadata, 'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(data).hexdigest(),
                        'seconds': len(values) / RATE})
    report = {'version': 1, 'sampleRate': RATE, 'seed': SEED, 'cases': records,
              'scope': 'Synthetic perturbations of held-out licensed read speech; not natural group recordings. Babble is three other JA read-speech clips; references score the designated target only, not all voices.'}
    output = ROOT / 'benchmarks/results/noisy-inputs.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Prepared {len(records)} deterministic cases ({sum(r["seconds"] for r in records):.2f}s). Public fixtures only; no models, microphone, API or .env.')


if __name__ == '__main__':
    try:
        prepare()
    except Exception:
        print('Noisy case preparation failed (fixture/conversion/storage); details suppressed.')
        raise SystemExit(1)
