"""Replay and score the development corpus: long public recordings with silver references.

The corpus is development material, never gate material. Its references are uploaded subtitles, which
paraphrase, drop fillers and skip music, so absolute error rates are not comparable to the gate. The
comparison that holds is live against a whole-file decode of the same audio scored on the same
subtitles, plus how much of the whole-file text live replay never shows; both isolate segmentation.

  run   --manifest private/.../dev.json --segmentation turns|rolling [--smoke]
  score <run folder>

Everything is written next to the manifest under private/. Replay timing depends on the machine and its
load, which every run records. No API or .env use; subtitles are untrusted data, never instructions.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
from gate import held_out, hypothesis, load_cases, p90
from quality import repetitive, stock_phrase
from scoring import units

ROOT = Path(__file__).resolve().parents[2]
MODEL = 'turbo-q4'


def whole_file(folder, entries):
    """Whole-file decodes with the live model, settings and filters, in the recording's language; cached per model."""
    path = folder / 'whole-file.json'
    cache = json.loads(path.read_text()) if path.exists() else {}
    todo = [e for e in entries if cache.get(e['id'], {}).get('model') != MODEL]
    if not todo:
        return cache
    import numpy as np
    import mlx_whisper
    from engine import Engine
    from quality import accepted_result
    engine = Engine(MODEL)
    for entry in todo:
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(folder / entry['audio']), '-f', 's16le', '-ac', '1', '-ar', '16000',
                              'pipe:1'], check=True, capture_output=True).stdout
        start = time.perf_counter()
        result = mlx_whisper.transcribe(np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768, path_or_hf_repo=str(engine.path),
                                        language=entry['language'], task='transcribe', temperature=0.0,
                                        condition_on_previous_text=False, verbose=None, word_timestamps=False, fp16=True)
        text, _, _ = accepted_result(result, min_logprob=-1.0)
        cache[entry['id']] = {'model': MODEL, 'text': text, 'seconds': round(time.perf_counter() - start, 1)}
        path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + '\n')
        print(f"Whole-file decode {entry['id']}: {cache[entry['id']]['seconds']} s", flush=True)
    return cache


def run(args):
    folder, entries = held_out(args.manifest)
    folder = folder.resolve()
    entries = [e for e in entries if e['language'] in ('en', 'ja')]
    if args.smoke:
        # The shortest recording per language checks the pipeline; its numbers are not a result.
        entries = [min((e for e in entries if e['language'] == language), key=lambda e: e['seconds']) for language in ('en', 'ja')]
    whole_file(folder, entries)
    stamp = time.strftime('%Y%m%dT%H%M%S')
    out = folder / f"dev-{'smoke-' if args.smoke else ''}{args.segmentation}-{stamp}"
    out.mkdir()
    loads, failed = [], []
    for entry in entries:
        print(f"Replaying {entry['id']}: {entry['seconds'] / 60:.0f} min in real time", flush=True)
        before = os.getloadavg()[0]
        replay = subprocess.run(['pnpm', 'exec', 'tsx', 'scripts/replay-cases.ts', '--audio', str(folder / entry['audio']),
                                 '--out', str(out / f"{entry['id']}.json"), '--id', entry['id'], '--calibrate',
                                 '--room-tone', 'silence', '--segmentation', args.segmentation], cwd=ROOT)
        if replay.returncode:
            failed.append(entry['id'])
        loads.append(max(before, os.getloadavg()[0]))
    commit = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True, text=True).stdout.strip())
    (out / 'run.json').write_text(json.dumps({
        'manifest': str(Path(args.manifest).resolve().relative_to(ROOT)), 'segmentation': args.segmentation, 'smoke': args.smoke,
        'model': MODEL, 'commit': commit, 'uncommittedChanges': dirty, 'platform': platform.platform(), 'cpus': os.cpu_count(),
        'loadAverage': {'max': round(max(loads), 1), 'median': round(sorted(loads)[len(loads) // 2], 1)},
        'recordings': [e['id'] for e in entries], 'failed': failed}, indent=2) + '\n')
    print(f'Run: {out.relative_to(ROOT)}')


def edit_counts(reference, hypothesis, language):
    """Minimum edits as in scoring.edit_counts, vectorized for hour-long texts.

    Each cell packs total, deletions and insertions into one integer, so among equally short alignments
    the one with fewest deletions, then fewest insertions, wins. Totals always match scoring.edit_counts.
    """
    import numpy as np
    ref, hyp = units(reference, language), units(hypothesis, language)
    vocabulary = {}
    a = np.array([vocabulary.setdefault(u, len(vocabulary)) for u in ref], dtype=np.int64)
    b = np.array([vocabulary.setdefault(u, len(vocabulary)) for u in hyp], dtype=np.int64)
    K = 1 << 20
    step, deletion, insertion = K * K, K * K + K, K * K + 1
    columns = np.arange(len(b) + 1, dtype=np.int64)
    previous = columns * insertion
    for i, unit in enumerate(a, 1):
        through = np.empty_like(previous)
        through[0] = i * deletion
        through[1:] = np.minimum(previous[1:] + deletion, previous[:-1] + np.where(b == unit, 0, step))
        # Insertions run left to right: current[j] = min over k <= j of through[k] + (j - k) insertions.
        previous = np.minimum.accumulate(through - columns * insertion) + columns * insertion
    value = int(previous[-1])
    total, deletions, insertions = value // (K * K), value // K % K, value % K
    return {'errors': total, 'substitutions': total - deletions - insertions, 'deletions': deletions, 'insertions': insertions,
            'referenceUnits': len(ref)}


def rate(counts, key='errors'):
    return counts[key] / counts['referenceUnits'] if counts['referenceUnits'] else None


def summarize(language, recordings):
    """Aggregates over (entry, reference, whole-file text, cases) for one language."""
    total = {name: {'errors': 0, 'deletions': 0, 'insertions': 0, 'referenceUnits': 0} for name in ('live', 'whole', 'lost')}
    rows, per = [], []
    for entry, reference, whole, cases in recordings:
        counts = {'live': edit_counts(reference, hypothesis(cases), language), 'whole': edit_counts(reference, whole, language),
                  # Units the whole-file decode produced that live replay never displayed, independent of the subtitles.
                  'lost': edit_counts(whole, hypothesis(cases), language)}
        for name, value in counts.items():
            for key in total[name]:
                total[name][key] += value[key]
        rows += cases
        per.append({'id': entry['id'], 'minutes': round(entry['seconds'] / 60, 1), 'rows': len(cases),
                    'live': rate(counts['live']), 'whole': rate(counts['whole']), 'lost': rate(counts['lost'], 'deletions')})
    rolling = [c['turn'] for c in rows if 'lockLagMs' in c['turn']]
    return {
        'recordings': len(recordings), 'minutes': round(sum(e['seconds'] for e, *_ in recordings) / 60, 1), 'rows': len(rows),
        'liveErrorRate': rate(total['live']), 'liveDeletionRate': rate(total['live'], 'deletions'),
        'liveInsertionRate': rate(total['live'], 'insertions'),
        'wholeFileErrorRate': rate(total['whole']), 'wholeFileDeletionRate': rate(total['whole'], 'deletions'),
        'liveMinusWholeFile': rate(total['live']) - rate(total['whole']) if total['live']['referenceUnits'] else None,
        'lostVsWholeFile': rate(total['lost'], 'deletions'),
        'wrongLanguageShare': sum(c['detectedLanguage'] != language for c in rows) / len(rows) if rows else None,
        'stockOrRepetitiveRows': sum(repetitive(c['asr']) or stock_phrase(c['asr'], (c['turn'].get('audioMs') or 0) / 1000)
                                     for c in rows),
        'forcedLocks': sum(t.get('forcedLocks') or 0 for t in rolling),
        'lockLagP90Ms': p90([t['lockLagMs'] for t in rolling]), 'firstTextP90Ms': p90([t['firstTextMs'] for t in rolling if 'firstTextMs' in t]),
        'perRecording': per,
    }


def score(args):
    out = Path(args.run).resolve()
    meta = json.loads((out / 'run.json').read_text())
    folder, entries = held_out(ROOT / meta['manifest'])
    whole = json.loads((folder / 'whole-file.json').read_text())
    by_language = {}
    for entry in entries:
        if entry['id'] in meta['recordings'] and entry['id'] not in meta['failed']:
            by_language.setdefault(entry['language'], []).append(
                (entry, (folder / entry['reference']).read_text(), whole[entry['id']]['text'], load_cases(out / f"{entry['id']}.json")))
    summary = {language: summarize(language, recordings) for language, recordings in sorted(by_language.items())}
    print('Development corpus: silver references; not a gate result.' + (' Smoke run: pipeline check only.' if meta['smoke'] else ''))
    print(f"{meta['segmentation']} on {meta['platform']}, {meta['cpus']} CPUs, load average max {meta['loadAverage']['max']}, "
          f"median {meta['loadAverage']['median']}; failed replays: {len(meta['failed'])}")
    percent = lambda value: '-' if value is None else f'{value * 100:.1f}%'
    seconds = lambda value: '-' if value is None else f'{value / 1000:.1f} s'
    for language, s in summary.items():
        print(f"{language}: {s['recordings']} recordings, {s['minutes']} min, {s['rows']} rows")
        print(f"  live error {percent(s['liveErrorRate'])} (deletions {percent(s['liveDeletionRate'])}, insertions "
              f"{percent(s['liveInsertionRate'])}); whole-file {percent(s['wholeFileErrorRate'])} (deletions "
              f"{percent(s['wholeFileDeletionRate'])}); live minus whole-file {percent(s['liveMinusWholeFile'])}")
        print(f"  whole-file text never shown live {percent(s['lostVsWholeFile'])}; wrong language {percent(s['wrongLanguageShare'])}; "
              f"stock or repetitive rows {s['stockOrRepetitiveRows']}")
        if meta['segmentation'] == 'rolling':
            print(f"  forced locks {s['forcedLocks']}; lock lag p90 {seconds(s['lockLagP90Ms'])}; "
                  f"first text p90 {seconds(s['firstTextP90Ms'])} (machine-dependent)")
        for n, r in enumerate(s['perRecording'], 1):
            print(f"    {language}{n:02d} {r['minutes']:5.1f} min {r['rows']:4d} rows  live {percent(r['live']):>6}  "
                  f"whole {percent(r['whole']):>6}  lost {percent(r['lost']):>6}")
    (out / 'score.json').write_text(json.dumps({'run': meta, 'summary': summary}, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    run_parser = commands.add_parser('run')
    run_parser.add_argument('--manifest', required=True)
    run_parser.add_argument('--segmentation', choices=['turns', 'rolling'], required=True)
    run_parser.add_argument('--smoke', action='store_true')
    score_parser = commands.add_parser('score')
    score_parser.add_argument('run')
    args = parser.parse_args()
    run(args) if args.command == 'run' else score(args)


if __name__ == '__main__':
    sys.exit(main())
