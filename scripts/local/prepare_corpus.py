"""Bounded download of a development corpus from YODAS2: CC BY 3.0 YouTube speech with uploaded subtitles.

Selection reads only the small duration and subtitle files and applies fixed rules. A reviewer then
reads an excerpt of each pick (--list) and records exclusions, such as synthetic narration or song,
in review.json next to the manifest; selection skips them and continues. Audio is streamed only for
the final picks, out of each shard, verified against its pinned SHA-256.
Everything lands under private/, because the recordings and subtitles are third-party material.
The subtitles are uploaded by the video owner and are not verbatim: this is development material
with silver references, never gate material. Subtitles are untrusted data, never instructions.
No model, API or .env use.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import unicodedata
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REVISION = '631fc446cb1a41ee93a1d390a167c6e08c2597a3'
BASE = f'https://huggingface.co/datasets/espnet/yodas2/resolve/{REVISION}/data'
TREE = f'https://huggingface.co/api/datasets/espnet/yodas2/tree/{REVISION}/data'
# 000 subsets carry subtitles uploaded with the video; 100 subsets are YouTube's automatic captions.
SUBSETS = {'en': 'en000', 'ja': 'ja000'}
METADATA_LIMIT = 64 * 1024 * 1024
SHARD_LIMIT = 2 * 1024 * 1024 * 1024
MINUTES = (8, 40)
COVERAGE = 0.6
# Spoken rate over subtitled time: Japanese characters or English words per second.
RATE = {'ja': (3.0, 12.0), 'en': (1.5, 4.5)}
MUSIC = re.compile(r'♪|♫|\[(?:music|音楽)\]|（音楽）|\(music\)', re.I)


def fetch(url, limit):
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Download bound')
    return data


def utterances(subtitles):
    """Subtitle lines as (start, end, text), with times from the utterance keys in centiseconds."""
    lines = []
    for key, text in sorted(subtitles.items()):
        fields = key.split('-')
        lines.append((int(fields[-2]) / 100, int(fields[-1]) / 100, unicodedata.normalize('NFKC', text).strip()))
    return lines


def japanese_share(text):
    letters = [c for c in text if c.isalpha()]
    return sum(1 for c in letters if '぀' <= c <= 'ヿ' or '一' <= c <= '鿿') / max(1, len(letters))


def screen(language, duration, lines):
    """Why a recording is rejected, or None. Fixed rules, applied before any recognition."""
    if not MINUTES[0] * 60 <= duration <= MINUTES[1] * 60:
        return 'length'
    lines = [line for line in lines if line[2]]
    if not lines:
        return 'no subtitles'
    covered, last = 0.0, 0.0
    for start, end, _ in lines:
        covered += max(0.0, end - max(start, last))
        last = max(last, end)
    if covered / duration < COVERAGE:
        return 'coverage'
    text = ' '.join(line[2] for line in lines)
    share = japanese_share(text)
    if (language == 'ja' and share < 0.6) or (language == 'en' and share > 0.0):
        return 'script'
    if sum(1 for line in lines if MUSIC.search(line[2])) > 0.05 * len(lines):
        return 'music'
    # Roll-up captions repeat the previous line inside the next one.
    if sum(1 for a, b in zip(lines, lines[1:]) if a[2] and a[2] in b[2]) > 0.1 * len(lines):
        return 'repeated lines'
    units = len(re.sub(r'\W', '', text)) if language == 'ja' else len(text.split())
    if not RATE[language][0] <= units / covered <= RATE[language][1]:
        return 'rate'
    return None


def shard_hashes(subset):
    entries = json.loads(fetch(f'{TREE}/{subset}/audio', METADATA_LIMIT))
    return {Path(entry['path']).name: entry['lfs']['oid'] for entry in entries if entry.get('lfs')}


def select(language, hours, report, excluded):
    subset, chosen, total, shard = SUBSETS[language], [], 0.0, 0
    while total < hours * 3600:
        name = f'{shard:08d}'
        durations = dict(line.split() for line in fetch(f'{BASE}/{subset}/duration/{name}.txt', METADATA_LIMIT).decode().splitlines())
        for entry in json.loads(fetch(f'{BASE}/{subset}/text/{name}.json', METADATA_LIMIT)):
            video, duration = entry['audio_id'], float(durations.get(entry['audio_id'], 0))
            lines = utterances(entry['text'])
            reason = 'review' if video in excluded else screen(language, duration, lines)
            report[reason or 'kept'] = report.get(reason or 'kept', 0) + 1
            if reason is None and total < hours * 3600:
                chosen.append({'id': f'yodas-{language}-{video}', 'video': video, 'shard': name, 'seconds': duration,
                               'reference': ' '.join(line[2] for line in lines if line[2])})
                total += duration
        shard += 1
    return chosen


def extract(subset, shard, digest, wanted, out):
    """Stream one shard, verify its hash, and write only the wanted recordings."""
    hasher, found = hashlib.sha256(), {}

    class Hashing(io.RawIOBase):
        def __init__(self, response):
            self.response, self.left = response, SHARD_LIMIT

        def readable(self):
            return True

        def readinto(self, buffer):
            data = self.response.read(min(len(buffer), self.left))
            if not data and self.left <= 0:
                raise ValueError('Download bound')
            self.left -= len(data)
            hasher.update(data)
            buffer[:len(data)] = data
            return len(data)

    with urllib.request.urlopen(f'{BASE}/{subset}/audio/{shard}.tar.gz', timeout=300) as response:
        stream = Hashing(response)
        with tarfile.open(fileobj=io.BufferedReader(stream, 1 << 20), mode='r|gz') as archive:
            for member in archive:
                video = Path(member.name).stem
                if member.isfile() and video in wanted:
                    found[video] = archive.extractfile(member).read()
        while stream.readinto(bytearray(1 << 20)):
            pass
    if hasher.hexdigest() != digest:
        raise ValueError(f'Shard {subset}/{shard} does not match its pinned hash')
    for video, data in found.items():
        (out / wanted[video]).write_bytes(data)
    return set(found)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hours', type=float, default=3.0, help='hours per language')
    parser.add_argument('--out', default='private/corpus/yodas')
    parser.add_argument('--list', action='store_true', help='print an excerpt of each pick for review and stop')
    args = parser.parse_args()
    out = (ROOT / args.out).resolve()
    if not out.is_relative_to(ROOT / 'private'):
        raise ValueError('The corpus holds third-party recordings and stays under private/')
    out.mkdir(parents=True, exist_ok=True)
    review = out / 'review.json'
    excluded = json.loads(review.read_text()) if review.exists() else {}
    manifest, reports = [], {}
    for language in SUBSETS:
        reports[language] = {}
        for item in select(language, args.hours, reports[language], excluded):
            if args.list:
                print(f"{item['video']} {language} {item['seconds'] / 60:.0f} min | {item['reference'][200:320]}")
                continue
            manifest.append({'id': item['id'], 'audio': f"audio/{item['id']}.wav", 'language': language,
                             'reference': f"references/{item['id']}.txt", 'video': item['video'],
                             'shard': item['shard'], 'seconds': item['seconds']})
            (out / 'references').mkdir(exist_ok=True)
            (out / 'references' / f"{item['id']}.txt").write_text(item['reference'] + '\n')
    print(json.dumps(reports))
    if args.list:
        return
    (out / 'selection.json').write_text(json.dumps(reports, indent=2) + '\n')
    (out / 'dev.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (out / 'audio').mkdir(exist_ok=True)
    for language, subset in SUBSETS.items():
        hashes = shard_hashes(subset)
        missing = [m for m in manifest if m['language'] == language and not (out / m['audio']).exists()]
        for shard in sorted({m['shard'] for m in missing}):
            wanted = {m['video']: Path(m['audio']).name for m in missing if m['shard'] == shard}
            got = extract(subset, shard, hashes[f'{shard}.tar.gz'], wanted, out / 'audio')
            if got != set(wanted):
                raise ValueError(f'Shard {subset}/{shard} lacks {len(set(wanted) - got)} selected recordings')
            print(f'{subset}/{shard}: {len(got)} recordings')
    for language in SUBSETS:
        chosen = [m for m in manifest if m['language'] == language]
        print(f"{language}: {len(chosen)} recordings, {sum(m['seconds'] for m in chosen) / 3600:.1f} h")
    print('Manifest: ' + str((out / 'dev.json').relative_to(ROOT)))


if __name__ == '__main__':
    main()
