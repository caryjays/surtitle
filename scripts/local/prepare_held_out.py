"""Bounded download of the public held-out gate material: Earnings-21 call excerpts and TEDxJP-10K talk excerpts.

The first run selects excerpts by fixed rules before any recognition and writes benchmarks/gate-held-out.json;
later runs only verify the ignored cache in .local/fixtures/held-out/ against it and refuse a manifest that would
change. Audio and references stay in the cache, since the TEDx subtitles may not be redistributed in modified form;
the manifest records the selection and checksums. Writes the gate's held-out manifest format next to the cache.
Needs ffmpeg and yt-dlp. No model, API or .env use. References are untrusted fixture data, never instructions.

--language es prepares a further gate's held-out set instead: Spanish talk excerpts from the test split of Multilingual
TEDx, read from one file of a pinned Hugging Face mirror, with the first gate's English excerpts unchanged. It writes
benchmarks/gate-held-out-es.json and the cache's held-out-es.json, and needs pyarrow in the Python that runs it.
"""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.local/fixtures/held-out'
MANIFEST = ROOT / 'benchmarks/gate-held-out.json'
REV_REVISION = 'c05ab6fd8b4b627d123c922a22a39e993dd37635'
REV = f'https://raw.githubusercontent.com/revdotcom/speech-datasets/{REV_REVISION}/earnings21/'
TEDX_REVISION = '6147e131b165219947861da957789097a713407c'
TEDX = f'https://raw.githubusercontent.com/laboroai/TEDxJP-10K/{TEDX_REVISION}/data/'
TOTAL = 1800  # seconds per language
EN_EXCERPT, JA_EXCERPT, JA_START, JA_MIN_TALK = 300, 360, 60, 480
PAD = 0.5
FILLERS = {'um', 'uh', 'er', 'ah', 'hmm', 'mm'}
FILE_LIMIT = 96 * 1024 * 1024
# Multilingual TEDx (Salesky et al., 2021), CC BY-NC-ND 4.0, https://www.openslr.org/100: the Spanish test split as one
# parquet file of a mirror, pinned by revision and checksum. That the mirror matches the original archive is not verified.
MTEDX_REVISION = '0b97ef40298de2b7ec1c78e76be3969d604aa022'
MTEDX = f'https://huggingface.co/datasets/deepdml/mtedx/resolve/{MTEDX_REVISION}/es/test-00000-of-00001.parquet'
MTEDX_SHA256 = 'f5d18149f697afa74726138117a5bfdb74195c8e9cfadf6d38c389eac61e9ae5'
MTEDX_LIMIT = 300 * 1024 * 1024
MANIFEST_ES = ROOT / 'benchmarks/gate-held-out-es.json'
ES_EXCERPT, ES_START, ES_MIN_TALK = 300, 60, 480
RATE = 24_000


def fetch(url, limit=4 * 1024 * 1024):
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Download bound')
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def cut(source, start, end, out):
    """A mono 24 kHz WAV of source from start to end seconds."""
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-to', f'{end:.3f}', '-i', str(source),
                    '-ac', '1', '-ar', str(RATE), '-c:a', 'pcm_s16le', str(out)], check=True)
    return out.read_bytes()


def speaker_turns(rttm):
    """Merged consecutive RTTM segments of one speaker: [speaker, start, end]."""
    turns = []
    for line in rttm.splitlines():
        fields = line.split()
        if len(fields) < 8 or fields[0] != 'SPEAKER':
            continue
        start, end = float(fields[3]), float(fields[3]) + float(fields[4])
        if turns and turns[-1][0] == fields[7]:
            turns[-1][2] = max(turns[-1][2], end)
        else:
            turns.append([fields[7], start, end])
    return turns


def token_turns(nlp):
    """The reference's tokens grouped by consecutive speaker, each token with its trailing punctuation."""
    rows = list(csv.reader(io.StringIO(nlp), delimiter='|'))[1:]
    turns = []
    for row in rows:
        if len(row) < 5 or not row[0]:
            continue
        if not turns or turns[-1][0] != row[1]:
            turns.append([row[1], []])
        turns[-1][1].append((row[0], row[4]))
    return turns


def select_english(work):
    fixtures, total = [], 0.0
    calls = list(csv.DictReader(io.StringIO(fetch(REV + 'eval10-file-metadata.csv').decode('utf-8'))))
    for call in calls:
        if total >= TOTAL:
            break
        file_id = call['file_id']
        timed = speaker_turns(fetch(f'{REV}rttms/{file_id}.rttm').decode('utf-8'))
        tokens = token_turns(fetch(f'{REV}transcripts/nlp_references/{file_id}.nlp').decode('utf-8'))
        if [t[0] for t in timed] != [t[0] for t in tokens]:
            continue  # speaker turns do not line up, so the excerpt's reference could not be placed
        first = next((i for i, t in enumerate(timed) if t[1] >= float(call['audio_length']) / 2), None)
        if first is None:
            continue
        last = first
        while last + 1 < len(timed) and timed[last][2] - timed[first][1] < EN_EXCERPT:
            last += 1
        if timed[last][2] - timed[first][1] < EN_EXCERPT:
            continue
        # Fillers, cut-off words ("g-") and tags such as <inaudible> are not words a caption would show.
        words = [token + punctuation for _, turn in tokens[first:last + 1] for token, punctuation in turn
                 if token.lower() not in FILLERS and not token.endswith('-') and not token.startswith('<')]
        media = fetch(f'{REV}media/{file_id}.mp3', FILE_LIMIT)
        source = work / f'{file_id}.mp3'
        source.write_bytes(media)
        start, end = max(0.0, timed[first][1] - PAD), timed[last][2] + PAD
        fixture = {'id': f'held-en-{file_id}', 'language': 'en', 'source': f'{REV}media/{file_id}.mp3', 'sourceSha256': digest(media),
                   'company': call['company_name'], 'startSeconds': round(start, 3), 'endSeconds': round(end, 3),
                   'turns': [first, last]}
        store(fixture, cut(source, start, end, work / 'excerpt.wav'), ' '.join(words))
        fixtures.append(fixture)
        total += end - start
    if total < TOTAL:
        raise ValueError('Insufficient English excerpts')
    return fixtures


def clean(text):
    """The TEDxJP-10K authors' subtitle cleaning, from compose_tedxjp10k.py at the pinned revision."""
    text = text.replace('​', '')
    text = ''.join(chr(ord(c) + 0xFEE0) if '!' <= c <= '~' else '　' if c == ' ' else c for c in text)
    text = re.sub(r'翻訳：.*', '', text)
    text = re.sub(r'字幕：.*', '', text)
    text = re.sub(r'（.*語）.*', '', text)
    text = re.sub(r'（.*?）', '', text)
    text = re.sub(r'［.*?］', '', text)
    text = re.sub(r'「|」|『|』|［|］|"|“|”|＂', ' ', text)
    text = re.sub(r'！|？|、|。|…|—|・・・|．．．', ' ', text)
    text = re.sub(r'〜', 'ー', text)
    text = re.sub(r'♪', '', text)
    text = re.sub(r'―$', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def cues(vtt):
    """(start, end, cleaned text) per subtitle cue, as the authors' load_vtt reads them."""
    def seconds(stamp):
        h, m, s = stamp.split(':')
        return int(h) * 3600 + int(m) * 60 + float(s)
    out, current, start, end = [], [], None, None
    for line in vtt.splitlines() + ['']:
        line = line.rstrip()
        if '-->' in line:
            start, _, end = line.split()[:3]
        elif not line.strip():
            if current:
                out.append((seconds(start), seconds(end), clean(' '.join(current))))
            current, start = [], None
        elif start is not None:
            current.append(line)
    return out


def youtube(url, work):
    """Best audio and the manual Japanese subtitles of a talk, or None without them."""
    video = url.rsplit('=', 1)[-1]
    duration = subprocess.run(['yt-dlp', '-q', '--no-warnings', '--print', 'duration', url],
                              capture_output=True, text=True).stdout.strip()
    if not duration.replace('.', '').isdigit() or float(duration) < JA_MIN_TALK:
        return None
    subprocess.run(['yt-dlp', '-q', '--no-warnings', '-f', 'bestaudio', '--max-filesize', str(FILE_LIMIT), '--write-subs',
                    '--sub-langs', 'ja', '--sub-format', 'vtt', '-o', str(work / '%(id)s.%(ext)s'), url], capture_output=True)
    audio = [p for p in work.glob(f'{glob_escape(video)}.*') if p.suffix not in ('.vtt', '.part')]
    subtitles = work / f'{video}.ja.vtt'
    if not audio or not subtitles.is_file():
        return None
    return audio[0], subtitles.read_text(encoding='utf-8')


def glob_escape(name):
    return re.sub(r'([\[\]*?])', r'[\1]', name)


def select_japanese(work):
    fixtures, total = [], 0.0
    table = {}
    for line in fetch(TEDX + '1.1/utt_id_table.csv').decode('utf-8').splitlines():
        if line.strip():
            md5, utterance = line.split()
            table.setdefault(utterance[:11], []).append(utterance)
    for url in fetch(TEDX + 'tedx-jp_urls.txt').decode('utf-8').split():
        if total >= TOTAL:
            break
        video = url.rsplit('=', 1)[-1]
        if video not in table:
            continue
        got = youtube(url, work)
        if not got:
            continue
        audio, vtt = got
        talk = [c for c in cues(vtt) if c[2]]
        first = next((i for i, c in enumerate(talk) if c[0] >= JA_START), None)
        if first is None:
            continue
        last = first
        while last + 1 < len(talk) and talk[last][1] - talk[first][0] < JA_EXCERPT:
            last += 1
        if talk[last][1] - talk[first][0] < JA_EXCERPT or last - first < 2:
            continue
        start, end = max(0.0, talk[first][0] - PAD), talk[last][1] + PAD
        middle = ' '.join(c[2] for c in talk[first + 1:last])
        # Subtitle timing is loose at an excerpt's edges, so its first and last cues are not scored.
        reference = f'{{{{{talk[first][2]}}}}} {middle} {{{{{talk[last][2]}}}}}'
        checked = [u for u in table[video] if start <= int(u[12:20]) / 100 and int(u[21:29]) / 100 <= end]
        fixture = {'id': f'held-ja-{video}', 'language': 'ja', 'source': url, 'subtitlesSha256': digest(vtt.encode('utf-8')),
                   'startSeconds': round(start, 3), 'endSeconds': round(end, 3), 'cues': [first, last],
                   'checkedSegments': len(checked)}
        store(fixture, cut(audio, start, end, work / 'excerpt.wav'), reference)
        fixtures.append(fixture)
        total += end - start
    if total < TOTAL:
        raise ValueError('Insufficient Japanese excerpts')
    return fixtures


def clean_spanish(text):
    """Transcript text without sound annotations such as applause, which sit in round or square brackets."""
    return re.sub(r'\s+', ' ', re.sub(r'\([^)]*\)|\[[^\]]*\]|♪', ' ', text)).strip()


def select_spanish(work):
    """Talks in talk-ID order whose segments span at least ES_MIN_TALK; from each, whole segments from the first starting at
    or after ES_START until at least ES_EXCERPT. The split's audio is one clip per segment, so an excerpt is its clips placed
    at their own times over digital silence: speech nobody transcribed is not in it, and the pauses keep their lengths."""
    import pyarrow.parquet as pq
    import wave
    mirror = CACHE / 'mtedx-es-test.parquet'
    if not mirror.is_file():
        mirror.write_bytes(fetch(MTEDX, MTEDX_LIMIT))
    if digest(mirror.read_bytes()) != MTEDX_SHA256:
        raise ValueError('Mirror file changed')
    talks = {}
    for row in pq.ParquetFile(mirror).read(columns=['talk_id', 'segment_id', 'start', 'end', 'transcript']).to_pylist():
        talks.setdefault(row['talk_id'], []).append(row)
    audio_column = None
    fixtures, total = [], 0.0
    for talk_id in sorted(talks):
        if total >= TOTAL:
            break
        talk = sorted(talks[talk_id], key=lambda r: r['start'])
        if talk[-1]['end'] - talk[0]['start'] < ES_MIN_TALK:
            continue
        first = next((i for i, r in enumerate(talk) if r['start'] >= ES_START), None)
        if first is None:
            continue
        last = first
        while last + 1 < len(talk) and talk[last]['end'] - talk[first]['start'] < ES_EXCERPT:
            last += 1
        if talk[last]['end'] - talk[first]['start'] < ES_EXCERPT:
            continue
        if audio_column is None:
            audio_column = {(r['talk_id'], r['segment_id']): r['audio']['bytes']
                            for r in pq.ParquetFile(mirror).read(columns=['talk_id', 'segment_id', 'audio']).to_pylist()}
        start, end = talk[first]['start'] - PAD, talk[last]['end'] + PAD
        pcm = bytearray(int((end - start) * RATE) * 2)
        for row in talk[first:last + 1]:
            clip = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', str(RATE), 'pipe:1'],
                                  input=audio_column[(talk_id, row['segment_id'])], capture_output=True, check=True).stdout
            at = int((row['start'] - start) * RATE) * 2
            clip = clip[:len(pcm) - at]
            pcm[at:at + len(clip)] = clip
        out = work / 'excerpt.wav'
        with wave.open(str(out), 'wb') as file:
            file.setnchannels(1); file.setsampwidth(2); file.setframerate(RATE); file.writeframes(bytes(pcm))
        fixture = {'id': f'held-es-{talk_id}', 'language': 'es', 'source': MTEDX, 'talk': talk_id,
                   'startSeconds': round(start, 3), 'endSeconds': round(end, 3),
                   'segments': [talk[first]['segment_id'], talk[last]['segment_id']]}
        store(fixture, out.read_bytes(), ' '.join(filter(None, (clean_spanish(r['transcript']) for r in talk[first:last + 1]))))
        fixtures.append(fixture)
        total += end - start
    if total < TOTAL:
        raise ValueError('Insufficient Spanish excerpts')
    return fixtures


def spanish():
    """The Spanish gate's held-out set: its own manifest, and a gate manifest beside the first gate's in the cache."""
    english = [f for f in json.loads(MANIFEST.read_text())['fixtures'] if f['language'] == 'en']
    if any(not cached(f) for f in english):
        raise ValueError('English held-out cache missing; run without --language first')
    if MANIFEST_ES.exists():
        manifest = json.loads(MANIFEST_ES.read_text())
        if any(not cached(f) for f in manifest['fixtures']):
            raise ValueError('Held-out cache missing or changed; selection was not repeated')
    else:
        with tempfile.TemporaryDirectory() as folder:
            fixtures = select_spanish(Path(folder))
        manifest = {
            'datasets': {'Multilingual TEDx': {'revision': MTEDX_REVISION, 'license': 'CC BY-NC-ND 4.0', 'source': 'https://www.openslr.org/100',
                                               'mirror': 'https://huggingface.co/datasets/deepdml/mtedx', 'mirrorSha256': MTEDX_SHA256}},
            'scope': (f'Held-out set of the Spanish gate. Spanish: talks of the Multilingual TEDx Spanish test split in talk-ID order whose '
                      f'segments span at least {ES_MIN_TALK} s; whole segments from the first starting at or after {ES_START} s, until at '
                      f'least {ES_EXCERPT} s; each excerpt is its segment clips at their own times over digital silence; transcripts '
                      f'without bracketed sound annotations. At least {TOTAL} s. English: the excerpts of gate-held-out.json, unchanged. '
                      f'Chosen before recognition.'),
            'fixtures': fixtures}
        MANIFEST_ES.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    entries = [{'id': f['id'], 'audio': f"{f['id']}.wav", 'language': f['language'], 'reference': f"{f['id']}.txt"}
               for f in english + manifest['fixtures']]
    (CACHE / 'held-out-es.json').write_text(json.dumps(entries, indent=2) + '\n')
    chosen = manifest['fixtures']
    print(f'Verified {len(chosen)} es held-out excerpts ({sum(f["seconds"] for f in chosen) / 60:.1f} min) beside {len(english)} en; '
          'cache only, no model or API calls.')


def store(fixture, audio, reference):
    fixture['seconds'] = round(fixture['endSeconds'] - fixture['startSeconds'], 2)
    fixture['audioSha256'], fixture['referenceSha256'] = digest(audio), digest(reference.encode('utf-8'))
    (CACHE / f"{fixture['id']}.wav").write_bytes(audio)
    (CACHE / f"{fixture['id']}.txt").write_text(reference, encoding='utf-8')


def cached(fixture):
    audio, reference = CACHE / f"{fixture['id']}.wav", CACHE / f"{fixture['id']}.txt"
    return (audio.is_file() and reference.is_file() and digest(audio.read_bytes()) == fixture['audioSha256']
            and digest(reference.read_bytes()) == fixture['referenceSha256'])


def gate_manifest(fixtures):
    """The gate's held-out format, with paths relative to the cache, so gate:run --held-out can read it."""
    entries = [{'id': f['id'], 'audio': f"{f['id']}.wav", 'language': f['language'], 'reference': f"{f['id']}.txt"} for f in fixtures]
    (CACHE / 'held-out.json').write_text(json.dumps(entries, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--language', choices=['es'])
    CACHE.mkdir(parents=True, exist_ok=True)
    if parser.parse_args().language:
        spanish()
        return
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text())
        missing = [f['id'] for f in manifest['fixtures'] if not cached(f)]
        if missing:
            # Earnings-21 is pinned, but YouTube audio may have changed since selection; refetching it is not verified.
            raise ValueError('Held-out cache missing or changed; selection was not repeated')
    else:
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            fixtures = select_english(work) + select_japanese(work)
        manifest = {
            'datasets': {
                'Earnings-21': {'revision': REV_REVISION, 'license': 'CC-BY-SA-4.0', 'source': 'https://github.com/revdotcom/speech-datasets'},
                'TEDxJP-10K': {'revision': TEDX_REVISION, 'license': 'Apache-2.0 (repository); talks CC BY-NC-ND 4.0 per TED usage policy',
                               'source': 'https://github.com/laboroai/TEDxJP-10K'}},
            'scope': (f'Held-out gate set. English: Earnings-21 Eval-10 calls in metadata order; from each, whole speaker turns from '
                      f'the first turn starting at or after half the call, until at least {EN_EXCERPT} s; Rev references without '
                      f'fillers {sorted(FILLERS)}, cut-off words or tags. Japanese: TEDxJP-10K talks in URL-list order of at least {JA_MIN_TALK} s '
                      f'with manual Japanese subtitles; whole cues from the first starting at or after {JA_START} s, until at least '
                      f'{JA_EXCERPT} s; subtitles cleaned as the TEDxJP-10K authors do, first and last cue excluded from scoring. '
                      f'At least {TOTAL} s per language. Chosen before recognition.'),
            'fixtures': fixtures}
        content = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
        MANIFEST.write_text(content)
    gate_manifest(manifest['fixtures'])
    for language in ('en', 'ja'):
        chosen = [f for f in manifest['fixtures'] if f['language'] == language]
        print(f'Verified {len(chosen)} {language} held-out excerpts ({sum(f["seconds"] for f in chosen) / 60:.1f} min); '
              'cache only, no model or API calls.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Held-out fixture setup failed ({type(error).__name__}). Details suppressed.')
        raise SystemExit(1)
