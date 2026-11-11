"""Bounded download of the public language-gate fixtures: FLEURS speech in and outside the pair, and MUSAN non-speech.

The first run selects clips by fixed rules before any recognition and writes the manifests;
later runs only verify the cache against them and refuse a manifest that would change.
No model, API or .env use. References are untrusted fixture data, never instructions.
"""
import csv
import hashlib
import argparse
import io
import json
import re
from pathlib import Path
import tarfile
import struct
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.local/fixtures/gate'
FLEURS_REVISION = '70bb2e84b976b7e960aa89f1c648e09c59f894dd'
FLEURS = f'https://huggingface.co/datasets/google/fleurs/resolve/{FLEURS_REVISION}/data/'
FLEURS_LOCALES = {'en': 'en_us', 'ja': 'ja_jp'}
# Languages with a gate of their own beside English, each with its own public manifest; see select_language.
GATE_LOCALES = {'es': 'es_419'}
# Speech outside the pair, which Auto should reject: a kanji language and three Latin-script ones.
OTHER_LOCALES = {'zh': 'cmn_hans_cn', 'ko': 'ko_kr', 'es': 'es_419', 'de': 'de_de'}
PER_OTHER = 10
MUSAN_REVISION = '3edcfdf89b56dbe6a395ff29f9c29489e03d1321'
MUSAN_MIRROR = f'https://huggingface.co/datasets/FluidInference/musan/resolve/{MUSAN_REVISION}/'
MUSAN_ARCHIVE = 'https://www.openslr.org/resources/17/musan.tar.gz'
PER_LANGUAGE = 60
SECONDS = (4, 16)
ARCHIVE_LIMIT = 256 * 1024 * 1024
FILE_LIMIT = 16 * 1024 * 1024
# The first instrumental tracks in the MUSAN archive, CC BY per music/fma/LICENSE, vocals N per ANNOTATIONS.
MUSIC = ['music-fma-0001', 'music-fma-0002', 'music-fma-0003']
APPLAUSE = 'noise-sound-bible-0003'


class Bounded(io.RawIOBase):
    """A response reader that refuses to deliver more than its limit."""
    def __init__(self, response, limit):
        self.response, self.left = response, limit

    def readable(self):
        return True

    def readinto(self, buffer):
        if self.left <= 0:
            raise ValueError('Download bound')
        data = self.response.read(min(len(buffer), self.left))
        self.left -= len(data)
        buffer[:len(data)] = data
        return len(data)


def open_url(url, limit, ranged=False):
    request = urllib.request.Request(url, headers={'Range': f'bytes=0-{limit - 1}'} if ranged else {})
    response = urllib.request.urlopen(request, timeout=90)
    if ranged and response.status != 206:
        raise ValueError('Expected bounded response')
    return response


def fetch(url, limit):
    with open_url(url, limit) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Download bound')
    return data


def members(url):
    """Stream regular archive members as (name, bytes) from a bounded prefix, never touching paths."""
    with open_url(url, ARCHIVE_LIMIT, ranged=True) as response:
        with tarfile.open(fileobj=io.BufferedReader(Bounded(response, ARCHIVE_LIMIT)), mode='r|gz') as archive:
            for member in archive:
                if member.isfile() and 44 < member.size <= FILE_LIMIT:
                    yield member.name, archive.extractfile(member).read()


def seconds(data):
    """Duration from the RIFF header; FLEURS stores float samples, which the wave module refuses."""
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('Not a WAV file')
    offset, byte_rate = 12, None
    while offset + 8 <= len(data):
        kind, size = data[offset:offset + 4], struct.unpack('<I', data[offset + 4:offset + 8])[0]
        if kind == b'fmt ':
            byte_rate = struct.unpack('<I', data[offset + 16:offset + 20])[0]
        if kind == b'data' and byte_rate:
            return min(size, len(data) - offset - 8) / byte_rate
        offset += 8 + size + (size & 1)
    raise ValueError('WAV without audio')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def cached(fixture):
    path = CACHE / f"{fixture['id']}.wav"
    return path.is_file() and digest(path.read_bytes()) == fixture['sha256']


def store(fixture, data):
    if digest(data) != fixture['sha256']:
        raise ValueError('Fixture checksum mismatch')
    (CACHE / f"{fixture['id']}.wav").write_bytes(data)


def write_manifest(path, manifest):
    content = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if path.exists() and path.read_text() != content:
        raise ValueError('Refuse to overwrite a different manifest')
    path.write_text(content)


def fleurs_references(locale):
    rows = list(csv.reader(io.StringIO(fetch(f'{FLEURS}{locale}/test.tsv', 4 * 1024 * 1024).decode('utf-8')), delimiter='\t'))
    # Column 2 is the raw transcript; the tuning manifest was copied from it.
    return {row[1]: row for row in rows if len(row) >= 6 and row[0].isdigit() and '/' not in row[1]}


def first_clips(language, locale, references, used, count):
    """The first count distinct sentence IDs in test-archive order, 4 to 16 s, not in used."""
    taken = set(used)
    selected = []
    for name, data in members(f'{FLEURS}{locale}/audio/test.tar.gz'):
        row = references.get(name.removeprefix('test/'))
        if not row or row[0] in taken or not SECONDS[0] <= seconds(data) <= SECONDS[1]:
            continue
        fixture = {'id': f'gate-{language}-{row[0]}', 'language': language,
                   'archive': f'{FLEURS}{locale}/audio/test.tar.gz', 'member': name, 'sha256': digest(data),
                   'seconds': round(seconds(data), 2), 'reference': row[2]}
        store(fixture, data)
        selected.append(fixture)
        taken.add(row[0])
        if len(selected) == count:
            return selected
    raise ValueError('Insufficient fixtures in bounded prefix')


def select_fleurs():
    """First distinct sentence IDs in archive order, 4 to 16 s, unused by any earlier fixture set."""
    used = {f['id'].split('-')[-1] for f in json.loads((ROOT / 'benchmarks/fleurs.json').read_text())}
    used |= {f['id'].split('-')[-1] for f in json.loads((ROOT / 'benchmarks/noisy-ja.json').read_text())['fixtures']}
    fixtures = []
    for language, locale in FLEURS_LOCALES.items():
        references = fleurs_references(locale)
        for tuning in json.loads((ROOT / 'benchmarks/fleurs.json').read_text()):
            row = references.get(tuning['member'].removeprefix('test/'))
            if tuning['language'] == language and (not row or row[2] != tuning['reference']):
                raise ValueError('Reference schema changed')
        fixtures += first_clips(language, locale, references, used, PER_LANGUAGE)
    return {'dataset': 'Google FLEURS', 'revision': FLEURS_REVISION, 'license': 'CC-BY-4.0',
            'scope': f'Language-gate public set: the first {PER_LANGUAGE} distinct sentence IDs per language in test-archive order, '
                     f'{SECONDS[0]} to {SECONDS[1]} s, excluding every ID in fleurs.json and noisy-ja.json; chosen before recognition.',
            'fixtures': fixtures}


def select_language(language):
    """A further gate's public set: that language's first clips, with the English clips of the first gate unchanged."""
    other = json.loads((ROOT / 'benchmarks/gate-other.json').read_text())['fixtures']
    used = {f['id'].split('-')[-1] for f in other if f['language'] == language}
    english = [f for f in json.loads((ROOT / 'benchmarks/gate-fleurs.json').read_text())['fixtures'] if f['language'] == 'en']
    locale = GATE_LOCALES[language]
    fixtures = first_clips(language, locale, fleurs_references(locale), used, PER_LANGUAGE)
    return {'dataset': 'Google FLEURS', 'revision': FLEURS_REVISION, 'license': 'CC-BY-4.0',
            'scope': f'Language-gate public set for {language}: its first {PER_LANGUAGE} distinct sentence IDs in test-archive order, '
                     f'{SECONDS[0]} to {SECONDS[1]} s, excluding its IDs in gate-other.json, chosen before recognition; and the '
                     'English fixtures of gate-fleurs.json, unchanged.',
            'fixtures': fixtures + english}


def select_other():
    """Speech outside the pair, which should display nothing: the first FLEURS test clips of each other language."""
    fixtures = [f for language, locale in OTHER_LOCALES.items()
                for f in first_clips(language, locale, fleurs_references(locale), set(), PER_OTHER)]
    return {'dataset': 'Google FLEURS', 'revision': FLEURS_REVISION, 'license': 'CC-BY-4.0',
            'scope': f'Third-language set: the first {PER_OTHER} distinct sentence IDs per language in test-archive order, '
                     f'{SECONDS[0]} to {SECONDS[1]} s, chosen before recognition. Any displayed row is an error. These IDs are '
                     'excluded from a future gate in their own language.',
            'fixtures': fixtures}


def select_nonspeech():
    """MUSAN background noises and applause from a pinned mirror, plus instrumental music from the original archive."""
    tree = f'https://huggingface.co/api/datasets/FluidInference/musan/tree/{MUSAN_REVISION}/noise/'
    files = {item['path']: item for folder in ('free-sound', 'sound-bible')
             for item in json.loads(fetch(tree + folder, 1024 * 1024)) if item['path'].endswith('.wav')}
    annotations = fetch(MUSAN_MIRROR + 'noise/free-sound/ANNOTATIONS', 64 * 1024).decode('utf-8')
    background = re.findall(r'^(noise-free-sound-\d{4})\s*$', annotations.split('\n\n')[0], flags=re.M)
    fixtures = []
    for name in background + [APPLAUSE]:
        folder = 'free-sound' if name.startswith('noise-free-sound') else 'sound-bible'
        path = f'noise/{folder}/{name}.wav'
        if path not in files:
            continue
        data = fetch(MUSAN_MIRROR + path, FILE_LIMIT)
        if digest(data) != files[path]['lfs']['oid']:
            raise ValueError('Mirror checksum mismatch')
        fixture = {'id': name, 'category': 'applause' if name == APPLAUSE else 'background-noise',
                   'source': MUSAN_MIRROR + path, 'sha256': digest(data), 'seconds': round(seconds(data), 2),
                   'license': 'CC-BY-3.0' if name == APPLAUSE else 'public domain'}
        store(fixture, data)
        fixtures.append(fixture)
    wanted = set(MUSIC)
    for member, data in members(MUSAN_ARCHIVE):
        name = Path(member).stem
        if name not in wanted:
            continue
        fixture = {'id': name, 'category': 'music', 'archive': MUSAN_ARCHIVE, 'member': member, 'sha256': digest(data),
                   'seconds': round(seconds(data), 2), 'license': 'CC-BY'}
        store(fixture, data)
        fixtures.append(fixture)
        wanted.discard(name)
        if not wanted:
            break
    if wanted:
        raise ValueError('Music absent from bounded archive prefix')
    return {'dataset': 'MUSAN', 'license': 'per file, see benchmarks/README.md', 'mirrorRevision': MUSAN_REVISION,
            'scope': 'Language-gate non-speech set: every MUSAN free-sound file annotated as a background noise that the pinned '
                     'mirror holds, the one applause recording, and the first three instrumental tracks of the original archive.',
            'fixtures': fixtures}


def restore(manifest):
    """Fetch whatever the cache lacks, by the manifest's own sources and checksums."""
    pending = [f for f in manifest['fixtures'] if not cached(f)]
    for fixture in [f for f in pending if 'source' in f]:
        store(fixture, fetch(fixture['source'], FILE_LIMIT))
    for archive in sorted({f['archive'] for f in pending if 'archive' in f}):
        wanted = {f['member']: f for f in pending if f.get('archive') == archive}
        for name, data in members(archive):
            if name in wanted:
                store(wanted.pop(name), data)
                if not wanted:
                    break
        if wanted:
            raise ValueError('Selected clips absent from bounded archive prefix')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language', choices=sorted(GATE_LOCALES), help='also prepare this language\'s public set, gate-fleurs-<language>.json')
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    sets = [('gate-fleurs.json', select_fleurs), ('gate-nonspeech.json', select_nonspeech), ('gate-other.json', select_other)]
    if args.language:
        sets.append((f'gate-fleurs-{args.language}.json', lambda: select_language(args.language)))
    for name, select in sets:
        path = ROOT / 'benchmarks' / name
        if path.exists():
            manifest = json.loads(path.read_text())
            restore(manifest)
        else:
            manifest = select()
            write_manifest(path, manifest)
        print(f"Verified {len(manifest['fixtures'])} gate fixtures from {manifest['dataset']} "
              f"({sum(f['seconds'] for f in manifest['fixtures']) / 60:.1f} min); cache only, no model or API calls.")


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Gate fixture setup failed (safe category: source/schema/checksum/storage). Details suppressed.')
        raise SystemExit(1)
