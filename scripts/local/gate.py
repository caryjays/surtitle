"""Language gate: replay the gate material through the live path, then score it against the written targets.

  gate.py run --segmentation rolling [--gate ja] [--held-out private/gate/held-out.json]
  gate.py score benchmarks/results/gate-<run> [--held-out private/gate/held-out.json] [--targets current|run]

A gate is benchmarks/gate-<language>.json: its languages, the pair replayed, its public manifest and its targets;
`score` takes the gate from the run. A run records its gate file and a digest of the implementation that ran; `score` uses the
current gate file unless told `--targets run`, and says when either changed since. `run` replays every stream in real time with scripts/replay-cases.ts, so it takes as long as the audio.
Public and non-speech outputs go to ignored benchmarks/results/; held-out outputs stay next to their
manifest under private/. `score` prints aggregates only. Offline: no .env, no network.

A held-out manifest lists recordings as {"id", "audio", "language": a gate language or "mixed", "reference"}, with
paths relative to the manifest. A reference is the hand-corrected transcript; text inside {{ }} is a span the
reviewer could not resolve, excluded from scoring. A reviewer rates each replayed row in place by adding
"rating": "plausible" | "minor" | "major" | "hallucination" to its case.
"""
import argparse
import hashlib
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
from languages import PROFILES
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


def load_gate(name):
    if not re.fullmatch(r'[a-z]{2,3}', name):
        raise ValueError('Gate name')
    gate = json.loads((ROOT / f'benchmarks/gate-{name}.json').read_text())
    if gate['gate'] != name or sorted(gate['pair'].split('-')) != sorted(gate['languages']) or any(l not in PROFILES for l in gate['languages']):
        raise ValueError('Gate file')
    return gate


# What a run's output depends on: the service, adapter, worker and scripts, the profiles, and the gate files and manifests.
IMPLEMENTATION = ('apps', 'packages', 'scripts', 'profiles', 'benchmarks', 'package.json', 'pnpm-lock.yaml')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def implementation(root=ROOT):
    """A digest of every commit-eligible file under IMPLEMENTATION as it is on disk, committed or not.

    A commit and a dirty flag do not identify an uncommitted tree; this does. Ignored files are never read.
    """
    listed = subprocess.run(['git', 'ls-files', '-z', '-co', '--exclude-standard', '--', *IMPLEMENTATION], cwd=root,
                            check=True, capture_output=True).stdout.decode().split('\0')
    total, count = hashlib.sha256(), 0
    for name in sorted(filter(None, listed)):
        path = Path(root) / name
        if not path.is_file():
            continue  # deleted but not yet committed
        total.update(name.encode() + b'\0' + hashlib.sha256(path.read_bytes()).digest())
        count += 1
    return {'sha256': total.hexdigest(), 'files': count}


def public_clips(gate, keep=None):
    """The gate's public clips per language, in manifest order; keep limits a smoke run."""
    fixtures = json.loads((ROOT / 'benchmarks' / gate['public']).read_text())['fixtures']
    return [f for language in gate['languages'] for f in [f for f in fixtures if f['language'] == language][:keep]]


def replay(audio, out, segmentation, prefix, pair):
    subprocess.run(['pnpm', 'exec', 'tsx', 'scripts/replay-cases.ts', '--audio', str(audio), '--out', str(out), '--id', prefix, '--pair', pair,
                    '--calibrate', '--room-tone', 'silence', '--segmentation', segmentation], cwd=ROOT, check=True)


def inside(path, folder):
    return path.resolve().is_relative_to((ROOT / folder).resolve())


def held_out(manifest_path, languages=()):
    manifest_path = Path(manifest_path)
    if not (inside(manifest_path, 'private') or inside(manifest_path, '.local')):
        raise ValueError('Held-out manifests and their results stay under private/ or the ignored .local/ cache')
    entries = json.loads(manifest_path.read_text())
    for entry in entries:
        if entry['language'] not in (*languages, 'mixed') or not re.fullmatch(r'[\w-]+', entry['id']):
            raise ValueError('Held-out manifest entry')
    return manifest_path.resolve().parent, entries


def offline_decodes(folder, entries, results, engine):
    """One-pass decodes of each held-out excerpt in its language: what the model alone gets wrong against these references."""
    import numpy as np
    from scipy.signal import resample_poly
    offline = []
    for entry in entries:
        if entry['language'] == 'mixed':
            continue
        audio = np.frombuffer(pcm(folder / entry['audio']), dtype='<i2').astype(np.float32) / 32768
        offline.append({'id': entry['id'], 'text': engine._decode(resample_poly(audio, 2, 3).astype(np.float32), entry['language'], None)['text']})
    (results / 'offline.json').write_text(json.dumps(offline, ensure_ascii=False, indent=2) + '\n')


def run(args):
    gate = load_gate(args.gate)
    languages = gate['languages']
    started = implementation()
    nonspeech = json.loads((ROOT / 'benchmarks/gate-nonspeech.json').read_text())['fixtures']
    other = json.loads((ROOT / 'benchmarks/gate-other.json').read_text())['fixtures']
    if gate.get('other'):  # the gate's own further third languages
        other += json.loads((ROOT / 'benchmarks' / gate['other']).read_text())['fixtures']
    stamp = time.strftime('%Y%m%dT%H%M%S')
    out = ROOT / 'benchmarks/results' / f"gate-{args.gate}-{'smoke-' if args.smoke else ''}{args.segmentation}-{stamp}"
    out.mkdir(parents=True)
    # --smoke checks the pipeline on the first clips of each stream; its numbers are not a gate result.
    keep = 3 if args.smoke else None
    fleurs = public_clips(gate, keep)
    streams = {f'public-{language}': [f for f in fleurs if f['language'] == language] for language in languages}
    streams |= {f'nonspeech-{category}': [f for f in nonspeech if f['category'] == category][:keep]
                for category in sorted({f['category'] for f in nonspeech})}
    # Speech outside the pair is reported, not yet gated.
    streams['third-language'] = [f for f in other if f['language'] not in languages][:keep]
    gains, loads = {}, []
    for name, clips in streams.items():
        loads.append(os.getloadavg()[0])
        print(f'Replaying {name}: {sum(c["seconds"] for c in clips) / 60:.1f} min in real time', flush=True)
        stream, gains[name] = write_stream(name, clips)
        replay(stream, out / f'{name}.json', args.segmentation, name, gate['pair'])
    if args.held_out:
        folder, entries = held_out(args.held_out, languages)
        results = folder / f'results-{args.segmentation}-{stamp}'
        results.mkdir()
        for entry in entries:
            print(f'Replaying held-out {entry["id"]}', flush=True)
            loads.append(os.getloadavg()[0])
            replay(folder / entry['audio'], results / f'{entry["id"]}.json', args.segmentation, entry['id'], gate['pair'])
    silence = subprocess.run([sys.executable, str(ROOT / 'scripts/local/silence_check.py')], capture_output=True, text=True)
    # Full-clip decodes of the same level-matched clips in Auto, the reference point for what segmentation loses.
    from engine import Engine
    engine = Engine('turbo-q4')
    if args.held_out:
        offline_decodes(folder, entries, results, engine)
        print(f'Held-out results: {results.relative_to(ROOT)}')
    full = [{'id': f['id'], 'language': f['language'], 'text': engine.transcribe(level(pcm(CACHE / f"{f['id']}.wav"))[0], None)['text']}
            for f in fleurs]
    (out / 'full-clip.json').write_text(json.dumps(full, ensure_ascii=False, indent=2) + '\n')
    commit = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True, text=True).stdout.strip())
    (out / 'run.json').write_text(json.dumps({
        'gate': args.gate, 'segmentation': args.segmentation, 'smoke': args.smoke, 'model': 'turbo-q4', 'commit': commit, 'uncommittedChanges': dirty,
        # The gate file as it was, so the targets the run was made against survive later edits, and the tree that ran.
        'gateDefinition': gate, 'gateSha256': digest(gate), 'implementation': started,
        'implementationChangedDuringRun': implementation() != started,
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
    # Runs from before gates were named are Japanese gate runs.
    gate = load_gate(meta.get('gate', 'ja'))
    recorded = meta.get('gateDefinition')
    # Targets may change by a dated decision, so the current file scores by default; --targets run scores as the run was declared.
    gate_changed = None if recorded is None else digest(recorded) != digest(gate)
    if args.targets == 'run':
        if recorded is None:
            raise ValueError('This run predates recorded gate definitions; score it with the current targets')
        gate = recorded
    elif gate_changed:
        print(f"Note: benchmarks/gate-{gate['gate']}.json changed since this run; scoring with the current file. --targets run uses the run's.")
    scorer = implementation()
    tree_changed = None if 'implementation' not in meta else meta['implementation'] != scorer
    if tree_changed:
        print('Note: the implementation changed since this run; stock-phrase and repetition checks use the current profiles and code.')
    if meta.get('implementationChangedDuringRun'):
        print('Note: the implementation changed while this run was replaying.')
    languages = gate['languages']
    if meta.get('smoke'):
        print('Smoke run: pipeline check only, not a gate result.')
    fleurs = public_clips(gate, 3 if meta.get('smoke') else None)
    full = {f['id']: f for f in json.loads((run_dir / 'full-clip.json').read_text())}
    measured = {}
    rows = {language: [] for language in languages}  # (case, expected language or None)

    for language in languages:
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
    third = run_dir / 'third-language.json'
    third_rows = {}
    for case in load_cases(third) if third.exists() else []:
        third_rows[case['detectedLanguage']] = third_rows.get(case['detectedLanguage'], 0) + 1

    if args.held_out:
        folder, entries = held_out(args.held_out, languages)
        results = Path(args.held_out_results) if args.held_out_results else None
        if not results or not (inside(results, 'private') or inside(results, '.local')):
            raise ValueError('Pass --held-out-results, the private results folder of the run')
        totals = {language: {'errors': 0, 'deletions': 0, 'referenceUnits': 0, 'excludedUnits': 0} for language in languages}
        offline_path = results / 'offline.json'
        offline = {o['id']: o['text'] for o in json.loads(offline_path.read_text())} if offline_path.exists() else {}
        offline_totals = {language: {'errors': 0, 'deletions': 0, 'referenceUnits': 0} for language in languages}
        compared = {language: {'errors': 0, 'deletions': 0, 'referenceUnits': 0} for language in languages}
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
            if entry['id'] in offline:
                for key in compared[language]:
                    compared[language][key] += counts[key]
                counts = edits((folder / entry['reference']).read_text(), offline[entry['id']], language)
                for key in offline_totals[language]:
                    offline_totals[language][key] += counts[key]
        for language, total in totals.items():
            if total['referenceUnits']:
                measured.setdefault('heldoutErrorRate', {})[language] = total['errors'] / total['referenceUnits']
                measured.setdefault('heldoutDeletionRate', {})[language] = total['deletions'] / total['referenceUnits']
                measured.setdefault('heldoutExcludedShare', {})[language] = (
                    total['excludedUnits'] / (total['referenceUnits'] + total['excludedUnits']))
        for language, total in offline_totals.items():
            if total['referenceUnits']:
                measured.setdefault('heldoutOfflineRate', {})[language] = total['errors'] / total['referenceUnits']
                # Gated: what the live path loses over the model's own one-pass decode, on the excerpts both decoded.
                live = compared[language]
                measured.setdefault('heldoutOverOffline', {})[language] = (
                    (live['errors'] - total['errors']) / total['referenceUnits'])
                measured.setdefault('heldoutDeletionsOverOffline', {})[language] = (
                    (live['deletions'] - total['deletions']) / total['referenceUnits'])
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
            print(f"{status:14} {target['key']:27} {scope:4} {shown:>9}  (max {limit})")
    info = {key: measured[key] for key in ('publicFullClipRate', 'heldoutErrorRate', 'heldoutDeletionRate', 'heldoutOfflineRate',
                                           'heldoutExcludedShare') if key in measured}
    for key, values in info.items():
        print(f"{'info':14} {key:27} " + ', '.join(f'{k} {v * 100:.2f}%' for k, v in values.items()))
    if third.exists():
        print(f"{'info':14} {'thirdLanguageRows':27} {sum(third_rows.values())} rows, by row language "
              + (', '.join(f'{k} {v}' for k, v in sorted(third_rows.items())) or 'none'))
        info['thirdLanguageRows'] = third_rows
    print(f'Not scored here: the stock-phrase review of new {PROFILES[gate['gate']]['name']} phrases, translation (pnpm eval:translation) and the field session.')
    verdict = 'FAIL' if failed else 'INCOMPLETE' if missing else 'PASS on the measured parts'
    print(f'Recognition parts: {verdict}')
    (run_dir / 'score.json').write_text(json.dumps({'run': meta, 'heldOut': bool(args.held_out),
                                                     'scoredWith': {'targetsFrom': args.targets, 'gateSha256': digest(gate),
                                                                    'gateChangedSinceRun': gate_changed, 'implementation': scorer,
                                                                    'implementationChangedSinceRun': tree_changed},
                                                     'targets': report,
                                                     'info': info, 'verdict': verdict}, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    run_parser = commands.add_parser('run')
    run_parser.add_argument('--segmentation', choices=['turns', 'rolling'], required=True)
    run_parser.add_argument('--gate', default='ja')
    run_parser.add_argument('--held-out')
    run_parser.add_argument('--smoke', action='store_true')
    score_parser = commands.add_parser('score')
    score_parser.add_argument('run')
    score_parser.add_argument('--held-out')
    score_parser.add_argument('--held-out-results')
    score_parser.add_argument('--targets', choices=['current', 'run'], default='current')
    args = parser.parse_args()
    (run if args.command == 'run' else score)(args)


if __name__ == '__main__':
    main()
