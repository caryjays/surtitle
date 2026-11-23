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

With --cloud, which is paid, the replay uses Claude Haiku 5.5 as the live translator, as the dev:listen profile with
TRANSLATION_PROVIDER=anthropic, and its rows are then re-translated in order outside real time by the local model as live
and by Haiku, so each row carries the live translation and both re-translations. The diagnostics file gives Haiku's
timings per talk for `pnpm diag:latency`. It goes under review/<gate>/cloud/. The process loads .env for the key, which
nothing here prints.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.local/fixtures/held-out'
GATES = {'ja': ('gate-held-out.json', 'held-out.json', 'en-ja'),
         **{language: (f'gate-held-out-{language}.json', f'held-out-{language}.json', f'en-{language}') for language in ('es', 'fr', 'it', 'pt')},
         # Taiwan Mandarin lectures, shown in Traditional as a Taiwan audience would read them.
         'zh': ('gate-held-out-zh.json', 'held-out-zh.json', 'en-zh-Hant'),
         'ko': ('gate-held-out-ko.json', 'held-out-ko.json', 'en-ko')}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--gate', choices=sorted(GATES), default='ja')
    parser.add_argument('--languages', help='comma-separated source languages to export; all by default')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--opening', action='store_true', help='also re-translate each row with and without the reply opening')
    mode.add_argument('--cloud', action='store_true', help='paid: replay with Claude Haiku live, then re-translate each row locally and with Haiku')
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
    out = ROOT / 'review' / args.gate / ('opening' if args.opening else 'cloud' if args.cloud else '')
    out.mkdir(parents=True, exist_ok=True)
    rows_file, diagnostics = out / 'rows.json', out / 'diagnostics.json'
    # Paid runs load .env inside node for the key; nothing here reads or prints it.
    runner = ['node', '--env-file-if-exists=.env', '--import', 'tsx'] if args.cloud else ['pnpm', 'exec', 'tsx']
    translate = ['--translate', 'anthropic', '--paid'] if args.cloud else ['--translate', 'local']
    subprocess.run([*runner, 'scripts/contention-replay.ts', '--pair', pair, *translate,
                    '--review', str(rows_file), '--out', str(diagnostics), *[str(audio) for _, audio, _ in entries]],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    replay = json.loads(rows_file.read_text())
    variants = {}
    if args.opening or args.cloud:
        variants_file = out / 'variants.json'
        compare = ['--compare', 'cloud', '--paid'] if args.cloud else ['--compare', 'opening']
        subprocess.run([*runner, 'scripts/review-retranslate.ts', '--pair', pair, '--in', str(rows_file),
                        '--out', str(variants_file), *compare], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        variants = {v['key']: v for v in json.loads(variants_file.read_text())}
        variants_file.unlink()
    total = 0
    for index, (entry, _, reference) in enumerate(entries, 1):  # the replay numbers recordings from 1
        rows = sorted((r for r in replay['review'] if r['recording'] == index), key=lambda r: r['sequence'])
        (out / f'{entry["id"]}.json').write_text(json.dumps({
            'id': entry['id'], 'pair': pair, 'language': entry['language'], 'model': replay['model'], 'recording': index,
            'reference': reference.read_text(),
            'rows': [{'row': n, 'original': r['original'], 'translation': r['translation'], 'state': r['state'],
                      **({k: o for k, o in v.items() if k != 'key'}
                         if (v := variants.get(f"{index}:{r['sequence']}")) else {})}
                     for n, r in enumerate(rows, 1)]}, ensure_ascii=False, indent=1) + '\n')
        total += len(rows)
    rows_file.unlink()
    print(f'{args.gate}: {len(entries)} talks, {total} rows, under {out.relative_to(ROOT)}/')


if __name__ == '__main__':
    main()
