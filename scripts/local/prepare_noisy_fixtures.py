"""Explicit bounded download of held-out CC-BY-4.0 FLEURS Japanese read speech.

No model/API/.env use. References are untrusted fixture data, never instructions.
"""
import csv
import hashlib
import io
import json
import re
from pathlib import Path
import tarfile
import urllib.request
import subprocess

ROOT = Path(__file__).resolve().parents[2]
REVISION = '70bb2e84b976b7e960aa89f1c648e09c59f894dd'
BASE = f'https://huggingface.co/datasets/google/fleurs/resolve/{REVISION}/data/ja_jp/'
LIMIT = 8 * 1024 * 1024


def fetch(url, limit, ranged=False):
    request = urllib.request.Request(url, headers={'Range': f'bytes=0-{limit - 1}'} if ranged else {})
    with urllib.request.urlopen(request, timeout=90) as response:
        if ranged and response.status != 206:
            raise ValueError('Expected bounded response')
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Download bound')
    return data


def main():
    destination = ROOT / 'benchmarks/noisy-ja.json'
    if destination.exists():
        cached = json.loads(destination.read_text())
        fixtures = cached.get('fixtures', [])
        if cached.get('revision') != REVISION or cached.get('license') != 'CC-BY-4.0' or len(fixtures) != 8:
            raise ValueError('Reference schema changed')
        if any(not re.fullmatch(r'ja_lab-\d+', f['id']) or not re.fullmatch(r'[a-f0-9]{64}', f['sha256']) for f in fixtures):
            raise ValueError('Reference schema changed')
        if all((ROOT / '.local/fixtures' / (f['id'] + '.wav')).is_file()
               and hashlib.sha256((ROOT / '.local/fixtures' / (f['id'] + '.wav')).read_bytes()).hexdigest() == f['sha256'] for f in fixtures):
            print('Verified 8 cached held-out public JA clips; no network/model/API calls.')
            return
    old = json.loads((ROOT / 'benchmarks/fleurs.json').read_text())
    rows = list(csv.reader(io.StringIO(fetch(BASE + 'test.tsv', 2 * 1024 * 1024).decode('utf-8')), delimiter='\t'))
    old_ja = {f['member'].split('/')[-1]: f for f in old if f['language'] == 'ja'}
    # Verify the reference column against already attributed/pinned source references.
    columns = [col for col in (2, 3) if all(any(len(row) > col and row[1] == name and row[col] == fixture['reference']
               for row in rows) for name, fixture in old_ja.items())]
    if not columns:
        raise ValueError('Reference schema changed')
    column = columns[0]
    references = {row[1]: row for row in rows if len(row) >= 6 and row[0].isdigit() and '/' not in row[1]}
    excluded = {f['id'].split('-')[-1] for f in old}
    prefix = fetch(BASE + 'audio/test.tar.gz', LIMIT, True)
    selected = []
    expanded = 0
    cache = ROOT / '.local/fixtures'
    cache.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(prefix), mode='r|gz') as archive:
        for member in archive:
            expanded += member.size
            if expanded > 64 * 1024 * 1024:
                raise ValueError('Expansion bound')
            row = references.get(member.name.removeprefix('test/'))
            if not row or row[0] in excluded or not member.isfile() or not 44 < member.size <= 2 * 1024 * 1024:
                continue
            data = archive.extractfile(member).read()
            converted = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'],
                                       input=data, check=True, capture_output=True, timeout=15).stdout
            seconds = len(converted) / 48000
            if not 4 <= seconds <= 16:
                continue
            identifier = f'ja_lab-{row[0]}'
            digest = hashlib.sha256(data).hexdigest()
            (cache / f'{identifier}.wav').write_bytes(data)
            selected.append({'id': identifier, 'language': 'ja', 'role': 'target' if len(selected) < 4 else 'distractor',
                             'archive': BASE + 'audio/test.tar.gz', 'member': member.name,
                             'sha256': digest, 'seconds': seconds, 'reference': row[column]})
            excluded.add(row[0])
            if len(selected) == 8:
                break
    if len(selected) != 8:
        raise ValueError('Insufficient fixtures in bounded prefix')
    manifest = {'dataset': 'Google FLEURS', 'revision': REVISION, 'license': 'CC-BY-4.0',
                'scope': 'Held-out read-speech sources, not natural conversation. First eight eligible distinct JA sentence IDs excluding original tuning IDs; archive order, 4-16 seconds; first four targets, next four distractors.',
                'fixtures': selected}
    destination = ROOT / 'benchmarks/noisy-ja.json'
    content = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if destination.exists() and destination.read_text() != content:
        raise ValueError('Refuse to overwrite a different manifest')
    destination.write_text(content)
    print(f'Verified {len(selected)} held-out public JA clips; source duration {sum(f["seconds"] for f in selected):.2f}s; bounded download, no API/model calls.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Noisy fixture preparation failed (safe category: source/schema/checksum/storage). Details suppressed.')
        raise SystemExit(1)
