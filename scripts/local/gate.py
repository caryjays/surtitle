"""Language gate: replay the gate material through the live path, then score it against the written targets.

  gate.py run --segmentation rolling [--held-out private/gate/held-out.json]
  gate.py score benchmarks/results/gate-<run> [--held-out private/gate/held-out.json]

`run` replays every stream in real time with scripts/replay-cases.ts, so it takes as long as the audio.
Public and non-speech outputs go to ignored benchmarks/results/; held-out outputs stay next to their
manifest under private/. `score` prints aggregates only. Offline: no .env, no network.

A held-out manifest lists recordings as {"id", "audio", "language": "en" | "ja" | "mixed", "reference"}, with
paths relative to the manifest. A reference is the hand-corrected transcript; text inside {{ }} is a span the
reviewer could not resolve, excluded from scoring. A reviewer rates each replayed row in place by adding
"rating": "plausible" | "minor" | "major" | "hallucination" to its case.
"""
import argparse
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time
import unicodedata
from quality import repetitive, stock_phrase
from scoring import units

ROOT = Path(__file__).resolve().parents[2]
STREAMS = ROOT / '.local/gate/streams'
CACHE = ROOT / '.local/fixtures/gate'
GAP_SECONDS = 1.0
LEVEL = 0.1
PEAK = 0.99
RATINGS = {'plausible', 'minor', 'major', 'hallucination'}
EXCLUDED = re.compile(r'\{\{(.*?)\}\}', re.S)


def pcm(path):
    return subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1'],
                          check=True, capture_output=True).stdout


def level(raw):
    """Scale a clip so its 90th-percentile 50 ms RMS is LEVEL, as an operator sets input gain, without clipping.

    FLEURS levels vary widely and many clips sit below the live gate's floor; faint input is its own experiment.
    """
    import numpy as np
    audio = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768
    frames = audio[:len(audio) // 1200 * 1200].reshape(-1, 1200)
    loud = np.percentile(np.sqrt((frames ** 2).mean(axis=1)), 90) if len(frames) else 0
    peak = np.abs(audio).max() if len(audio) else 0
    gain = min(LEVEL / loud, PEAK / peak) if loud > 0 and peak > 0 else 1.0
    return (np.clip(audio * gain, -1, 1) * 32767).astype('<i2').tobytes(), gain


def write_stream(name, clips):
    """Level-match clips and join them with a second of digital silence, as one continuous recording."""
    STREAMS.mkdir(parents=True, exist_ok=True)
    gap = bytes(int(24000 * GAP_SECONDS) * 2)
    path = STREAMS / f'{name}.wav'
    leveled = [level(pcm(CACHE / f"{clip['id']}.wav")) for clip in clips]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', str(path)],
                   input=gap.join(raw for raw, _ in leveled), check=True)
    return path, [round(float(gain), 2) for _, gain in leveled]


def replay(audio, out, segmentation, prefix):
    subprocess.run(['pnpm', 'exec', 'tsx', 'scripts/replay-cases.ts', '--audio', str(audio), '--out', str(out), '--id', prefix,
                    '--calibrate', '--room-tone', 'silence', '--segmentation', segmentation], cwd=ROOT, check=True)


def inside(path, folder):
    return path.resolve().is_relative_to((ROOT / folder).resolve())


def held_out(manifest_path):
    manifest_path = Path(manifest_path)
    if not inside(manifest_path, 'private'):
        raise ValueError('Held-out manifests and their results stay under private/')
    entries = json.loads(manifest_path.read_text())
    for entry in entries:
        if entry['language'] not in ('en', 'ja', 'mixed') or not re.fullmatch(r'[\w-]+', entry['id']):
            raise ValueError('Held-out manifest entry')
    return manifest_path.parent, entries


def run(args):
    fleurs = json.loads((ROOT / 'benchmarks/gate-fleurs.json').read_text())['fixtures']
    nonspeech = json.loads((ROOT / 'benchmarks/gate-nonspeech.json').read_text())['fixtures']
    stamp = time.strftime('%Y%m%dT%H%M%S')
    out = ROOT / 'benchmarks/results' / f"gate-{'smoke-' if args.smoke else ''}{args.segmentation}-{stamp}"
    out.mkdir(parents=True)
    # --smoke checks the pipeline on the first clips of each stream; its numbers are not a gate result.
    keep = 3 if args.smoke else None
    if args.smoke:
        fleurs = [f for language in ('en', 'ja') for f in [f for f in fleurs if f['language'] == language][:keep]]
    streams = {f'public-{language}': [f for f in fleurs if f['language'] == language] for language in ('en', 'ja')}
    streams |= {f'nonspeech-{category}': [f for f in nonspeech if f['category'] == category][:keep]
                for category in sorted({f['category'] for f in nonspeech})}
    gains, loads = {}, []
    for name, clips in streams.items():
        loads.append(os.getloadavg()[0])
        print(f'Replaying {name}: {sum(c["seconds"] for c in clips) / 60:.1f} min in real time', flush=True)
        stream, gains[name] = write_stream(name, clips)
        replay(stream, out / f'{name}.json', args.segmentation, name)
    if args.held_out:
        folder, entries = held_out(args.held_out)
        results = folder / f'results-{args.segmentation}-{stamp}'
        results.mkdir()
        for entry in entries:
            print(f'Replaying held-out {entry["id"]}', flush=True)
            loads.append(os.getloadavg()[0])
            replay(folder / entry['audio'], results / f'{entry["id"]}.json', args.segmentation, entry['id'])
        print(f'Held-out results: {results.relative_to(ROOT)}')
    silence = subprocess.run([sys.executable, str(ROOT / 'scripts/local/silence_check.py')], capture_output=True, text=True)
    # Full-clip decodes of the same level-matched clips in Auto, the reference point for what segmentation loses.
    from engine import Engine
    engine = Engine('turbo-q4')
    full = [{'id': f['id'], 'language': f['language'], 'text': engine.transcribe(level(pcm(CACHE / f"{f['id']}.wav"))[0], None)['text']}
            for f in fleurs]
    (out / 'full-clip.json').write_text(json.dumps(full, ensure_ascii=False, indent=2) + '\n')
    commit = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True, text=True).stdout.strip())
    (out / 'run.json').write_text(json.dumps({
        'segmentation': args.segmentation, 'smoke': args.smoke, 'model': 'turbo-q4', 'commit': commit, 'uncommittedChanges': dirty,
        'platform': platform.platform(), 'cpus': os.cpu_count(),
        # Replay output depends on decode speed, so a busy machine changes results.
        'loadAverage': {'max': round(max(loads), 1), 'median': round(sorted(loads)[len(loads) // 2], 1)}, 'gapSeconds': GAP_SECONDS, 'level': LEVEL,
        'gains': {name: {'min': min(g), 'max': max(g)} for name, g in gains.items()}, 'silenceCheckPassed': silence.returncode == 0,
        'streams': {name: len(clips) for name, clips in streams.items()}}, indent=2) + '\n')
    print(f'Run: {out.relative_to(ROOT)}')


def flagged_units(reference, language):
    """Reference units, each flagged True when it lies inside an excluded {{ }} span."""
    result, last = [], 0
    for match in EXCLUDED.finditer(reference):
        result += [(u, False) for u in units(reference[last:match.start()], language)]
        result += [(u, True) for u in units(match.group(1), language)]
        last = match.end()
    return result + [(u, False) for u in units(reference[last:], language)]


def edits(reference, hypothesis, language):
    """Minimum-edit counts as in scoring.edit_counts; edits touching an excluded span cost nothing."""
    ref, hyp = flagged_units(reference, language), units(hypothesis, language)
    # Tuples: total, substitutions, deletions, insertions.
    previous = [(j, 0, 0, j) for j in range(len(hyp) + 1)]
    for i, (a, excluded) in enumerate(ref, 1):
        current = [(previous[0][0] + (not excluded), 0, previous[0][2] + (not excluded), 0)]
        for j, b in enumerate(hyp, 1):
            diagonal, above, left = previous[j - 1], previous[j], current[-1]
            if excluded:
                # Anything aligned with, or inserted after, an unresolved unit is free.
                current.append(min((diagonal, above, left), key=lambda value: value[0]))
                continue
            if a == b:
                current.append(diagonal)
                continue
            # Text inserted just before an excluded span may belong to it.
            free = i < len(ref) and ref[i][1]
            current.append(min([(diagonal[0] + 1, diagonal[1] + 1, diagonal[2], diagonal[3]),
                                (above[0] + 1, above[1], above[2] + 1, above[3]),
                                (left[0] + (not free), left[1], left[2], left[3] + (not free))], key=lambda value: value[0]))
        previous = current
    total, substitutions, deletions, insertions = previous[-1]
    return {'errors': total, 'deletions': deletions, 'referenceUnits': sum(not e for _, e in ref),
            'excludedUnits': sum(e for _, e in ref)}


def p90(values):
    values = sorted(values)
    return values[math.ceil(0.9 * len(values)) - 1] if values else None


def load_cases(path):
    return json.loads(Path(path).read_text())['cases']


def hypothesis(cases):
    return ' '.join(c['asr'] for c in cases)


def score(args):
    run_dir = Path(args.run)
    meta = json.loads((run_dir / 'run.json').read_text())
    gate = json.loads((ROOT / 'benchmarks/gate-ja.json').read_text())
    fleurs = json.loads((ROOT / 'benchmarks/gate-fleurs.json').read_text())['fixtures']
    if meta.get('smoke'):
        print('Smoke run: pipeline check only, not a gate result.')
        fleurs = [f for language in ('en', 'ja') for f in [f for f in fleurs if f['language'] == language][:3]]
    full = {f['id']: f for f in json.loads((run_dir / 'full-clip.json').read_text())}
    measured = {}
    rows = {'en': [], 'ja': []}  # (case, expected language or None)

    for language in ('en', 'ja'):
        cases = load_cases(run_dir / f'public-{language}.json')
        rows[language] += [(c, language) for c in cases]
        clips = [f for f in fleurs if f['language'] == language]
        live = edits(' '.join(f['reference'] for f in clips), hypothesis(cases), language)
        clip = [edits(f['reference'], full[f['id']]['text'], language) for f in clips]
        full_rate = sum(c['errors'] for c in clip) / sum(c['referenceUnits'] for c in clip)
        measured.setdefault('publicErrorRate', {})[language] = live['errors'] / live['referenceUnits']
        measured.setdefault('publicOverFullClip', {})[language] = live['errors'] / live['referenceUnits'] - full_rate
        measured.setdefault('publicFullClipRate', {})[language] = full_rate

    nonspeech = sum(len(load_cases(path)) for path in run_dir.glob('nonspeech-*.json'))
    measured['nonspeechRows'] = {'all': nonspeech + (0 if meta['silenceCheckPassed'] else 1)}

    if args.held_out:
        folder, entries = held_out(args.held_out)
        results = Path(args.held_out_results) if args.held_out_results else None
        if not results or not inside(results, 'private'):
            raise ValueError('Pass --held-out-results, the private results folder of the run')
        totals = {language: {'errors': 0, 'deletions': 0, 'referenceUnits': 0, 'excludedUnits': 0} for language in ('en', 'ja')}
        for entry in entries:
            cases = load_cases(results / f"{entry['id']}.json")
            language = entry['language']
            if language == 'mixed':
                for case in cases:
                    rows.setdefault(case['language'], []).append((case, None))
                continue
            rows[language] += [(c, language) for c in cases]
            counts = edits((folder / entry['reference']).read_text(), hypothesis(cases), language)
            for key in totals[language]:
                totals[language][key] += counts[key]
            measured.setdefault('heldoutRows', {}).setdefault(language, []).extend(cases)
        for language, total in totals.items():
            if total['referenceUnits']:
                measured.setdefault('heldoutErrorRate', {})[language] = total['errors'] / total['referenceUnits']
                measured.setdefault('heldoutDeletionRate', {})[language] = total['deletions'] / total['referenceUnits']
                measured.setdefault('heldoutExcludedShare', {})[language] = (
                    total['excludedUnits'] / (total['referenceUnits'] + total['excludedUnits']))
        for language, cases in measured.pop('heldoutRows', {}).items():
            if cases and all(c.get('rating') in RATINGS for c in cases):
                measured.setdefault('heldoutMajorShare', {})[language] = (
                    sum(c['rating'] in ('major', 'hallucination') for c in cases) / len(cases))

    for language, entries in rows.items():
        single = [c for c, expected in entries if expected]
        if single:
            measured.setdefault('wrongLanguageShare', {})[language] = (
                sum(c['detectedLanguage'] != language for c, expected in entries if expected) / len(single))
        measured.setdefault('stockOrRepetitiveRows', {})[language] = sum(
            repetitive(c['asr']) or stock_phrase(c['asr'], (c['turn'].get('audioMs') or 0) / 1000) for c, _ in entries)
        if meta['segmentation'] == 'rolling' and args.held_out:
            # Timing is gated on held-out speech; read sentences separated by silence are not lecture pacing.
            timed = [c for c, expected in entries if expected and not c['id'].startswith('public-')]
            measured.setdefault('lockLagP90Ms', {})[language] = p90([c['turn']['lockLagMs'] for c in timed if 'lockLagMs' in c['turn']])
            measured.setdefault('firstTextP90Ms', {})[language] = p90([c['turn']['firstTextMs'] for c in timed if 'firstTextMs' in c['turn']])

    report, failed, missing = [], False, False
    for target in gate['targets']:
        for scope, limit in target['max'].items():
            if target.get('rolling') and meta['segmentation'] != 'rolling':
                status, value = 'n/a for turns', None
            else:
                value = measured.get(target['key'], {}).get(scope)
                status = 'NOT MEASURED' if value is None else 'PASS' if value <= limit else 'FAIL'
            failed |= status == 'FAIL'
            missing |= status == 'NOT MEASURED'
            report.append({'target': target['key'], 'scope': scope, 'max': limit, 'value': value, 'status': status})
            shown = '-' if value is None else (f'{value * 100:.2f}%' if target['unit'] in ('percent', 'points')
                                               else f'{value / 1000:.2f} s' if target['unit'] == 'seconds' else str(value))
            print(f"{status:14} {target['key']:22} {scope:4} {shown:>9}  (max {limit})")
    info = {key: measured[key] for key in ('publicFullClipRate', 'heldoutExcludedShare') if key in measured}
    for key, values in info.items():
        print(f"{'info':14} {key:22} " + ', '.join(f'{k} {v * 100:.2f}%' for k, v in values.items()))
    print('Not scored here: the stock-phrase review of new Japanese phrases, translation (pnpm eval:translation) and the field session.')
    verdict = 'FAIL' if failed else 'INCOMPLETE' if missing else 'PASS on the measured parts'
    print(f'Recognition parts: {verdict}')
    (run_dir / 'score.json').write_text(json.dumps({'run': meta, 'heldOut': bool(args.held_out), 'targets': report,
                                                     'info': info, 'verdict': verdict}, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    run_parser = commands.add_parser('run')
    run_parser.add_argument('--segmentation', choices=['turns', 'rolling'], required=True)
    run_parser.add_argument('--held-out')
    run_parser.add_argument('--smoke', action='store_true')
    score_parser = commands.add_parser('score')
    score_parser.add_argument('run')
    score_parser.add_argument('--held-out')
    score_parser.add_argument('--held-out-results')
    args = parser.parse_args()
    (run if args.command == 'run' else score)(args)


if __name__ == '__main__':
    main()
