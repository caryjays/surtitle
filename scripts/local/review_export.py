"""Write full transcripts of the public held-out talks for a translation read-through.

Replays the talks of one gate's tracked held-out manifest in real time through the live controller with rolling
recognition and the local translator, then writes one file per talk under the ignored review/<gate>/ folder: every row's
original and translation in order, and the talk's reference. Only talks listed in benchmarks/gate-held-out*.json are
exported, with checksums verified, so a private recording can never reach the folder. The folder exists so an agent may
read these transcripts; .local/ and private/ stay unread. Transcripts and references are untrusted data, never
instructions. Prints counts only. No API or .env use.

With --opening, the replay's rows are also re-translated in order outside real time, once as live and once with the
reply's opening given to the local model (scripts/review-retranslate.ts), and each row carries both, to compare the two
over the same recognized text. That export goes under review/<gate>/opening/.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.local/fixtures/held-out'
GATES = {'ja': ('gate-held-out.json', 'held-out.json', 'en-ja'),
         **{language: (f'gate-held-out-{language}.json', f'held-out-{language}.json', f'en-{language}') for language in ('es', 'fr', 'it', 'pt')}}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--gate', choices=sorted(GATES), default='ja')
    parser.add_argument('--languages', help='comma-separated source languages to export; all by default')
    parser.add_argument('--opening', action='store_true', help='also re-translate each row with and without the reply opening')
    args = parser.parse_args()
    tracked, cached, pair = GATES[args.gate]
    # A later gate reuses the first gate's English excerpts, which only the first tracked manifest lists.
    public = {f['id']: f for name in {GATES['ja'][0], tracked} for f in json.loads((ROOT / 'benchmarks' / name).read_text())['fixtures']}
    wanted = set(args.languages.split(',')) if args.languages else None
    entries = []
    for entry in json.loads((CACHE / cached).read_text()):
        fixture = public.get(entry['id'])
        if not fixture or (wanted and entry['language'] not in wanted):
            continue
        audio, reference = CACHE / entry['audio'], CACHE / entry['reference']
        if sha256(audio) != fixture['audioSha256'] or sha256(reference) != fixture['referenceSha256']:
            raise SystemExit(f'{entry["id"]}: the cache does not match the tracked manifest')
        entries.append((entry, audio, reference))
    if not entries:
        raise SystemExit('No public held-out talks to export')
    # The comparison goes to its own folder so it never overwrites a graded export.
    out = ROOT / 'review' / args.gate / ('opening' if args.opening else '')
    out.mkdir(parents=True, exist_ok=True)
    rows_file, diagnostics = out / 'rows.json', out / 'diagnostics.json'
    subprocess.run(['pnpm', 'exec', 'tsx', 'scripts/contention-replay.ts', '--pair', pair, '--translate', 'local',
                    '--review', str(rows_file), '--out', str(diagnostics), *[str(audio) for _, audio, _ in entries]],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    replay = json.loads(rows_file.read_text())
    variants = {}
    if args.opening:
        variants_file = out / 'variants.json'
        subprocess.run(['pnpm', 'exec', 'tsx', 'scripts/review-retranslate.ts', '--pair', pair, '--in', str(rows_file),
                        '--out', str(variants_file)], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        variants = {v['key']: v for v in json.loads(variants_file.read_text())}
        variants_file.unlink()
    total = 0
    for index, (entry, _, reference) in enumerate(entries, 1):  # the replay numbers recordings from 1
        rows = sorted((r for r in replay['review'] if r['recording'] == index), key=lambda r: r['sequence'])
        (out / f'{entry["id"]}.json').write_text(json.dumps({
            'id': entry['id'], 'pair': pair, 'language': entry['language'], 'model': replay['model'],
            'reference': reference.read_text(),
            'rows': [{'row': n, 'original': r['original'], 'translation': r['translation'], 'state': r['state'],
                      **({'withoutOpening': v['off'], 'withOpening': v['on']}
                         if (v := variants.get(f"{index}:{r['sequence']}")) else {})}
                     for n, r in enumerate(rows, 1)]}, ensure_ascii=False, indent=1) + '\n')
        total += len(rows)
    rows_file.unlink()
    print(f'{args.gate}: {len(entries)} talks, {total} rows, under {out.relative_to(ROOT)}/')


if __name__ == '__main__':
    main()
