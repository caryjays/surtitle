"""Offline comparison of how rolling recognition picks a row's language. Not wired into the live service.

Each gate stream is replayed in virtual time: every clip is one stretch of speech, decoded every second of new
audio like live rolling mode, with its locking, row closing and noise trim. Only the rule that settles a row's
language differs:

  auto         Whisper detects the language on each decode until one returns accepted text (the live rule).
  auto-lock    as auto, but the row's language is settled only when its first text locks.
  pair-detect  Whisper's detection restricted to the session pair; decode in the most likely of the two.
  retry        decode in the pair language detection prefers and, only if every segment is filtered or in the
               wrong script, again in the other; the row's language is settled when its first text locks.
  retry-uncertain  as retry, but the second decode runs only when detection gives the preferred pair language
               less than UNCERTAIN probability.
  candidates   decode in every pair language and keep the best candidate that passes the live filters and is
               written in its language's script; none passing rejects the window. A detection that puts most of
               its probability outside the pair rejects the window as third-language speech.

With --keep-agreed, a decode whose every segment is filtered no longer trims a window whose earlier decodes
returned text; it is skipped, so the accepted decodes on either side of it can still agree.

With --third-row, a closing row is dropped when detection over its whole audio puts more than THIRD of its
probability outside the pair: third-language rejection over a row rather than a short window.

With --noise-confirm T, after a noise trim the next lock in the stretch needs a decode whose lowest segment log
probability is at least T, so a stretch held open by music or noise cannot lock a chance agreement of two hallucinations.

Stress streams, stress-<en|ja>-<prefix|under>, put each tuning and noisy-set clip, none of them gate material, in one
stretch behind STRESS_BED seconds of the gate's music or noise streams: at full level before clean speech (prefix), or
at -12 dB before and under the speech (under). They measure whether a rule loses real speech after noise.

Every decode is cached by stream, window and language under benchmarks/results/language-sim/, so rules that
share windows decode them once and reruns are cheap. Decode times come from the cache, so virtual timing stays
realistic. Public licensed fixtures only; no API or .env use.

  run [--rules auto,candidates] [--streams public-ja,...] [--keep-agreed] [--third-row] [--noise-confirm -0.5]
"""
import argparse
import json
from pathlib import Path
import time
import numpy as np
from gate import ROOT, STREAMS
from scoring import edit_counts

RATE = 24_000  # gate streams and the live worker input
PAIR = ('ja', 'en')
INTERVAL, MIN_WINDOW, SETTLE, FORCE, NOISE, KEEP = 1.0, 0.5, 1.0, 25.0, 3.0, 1.0
SENTENCE_ROW, MAX_ROW = 3.0, 8.0
THIRD = 0.5  # detection probability outside the pair that rejects a window as another language
UNCERTAIN = 0.2  # below this, retry-uncertain also decodes the other pair language
SETTLE_AT_LOCK = {'auto-lock', 'retry', 'retry-uncertain'}
OUT = ROOT / 'benchmarks/results/language-sim'


def script_ok(text, language):
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    japanese = sum('぀' <= c <= 'ヿ' or '一' <= c <= '鿿' for c in letters) / len(letters)
    return japanese >= 0.5 if language == 'ja' else japanese == 0 and all(c.isascii() for c in letters)


class Decoder:
    """The live worker's decode and filters, plus detection probabilities, cached per window and language."""

    def __init__(self, stream):
        self.path = OUT / f'cache-{stream}.json'
        self.cache = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.engine, self.dirty = None, 0

    def load(self):
        if self.engine is None:
            from engine import Engine
            self.engine = Engine('turbo-q4')
            self.engine.warm()

    def decode(self, pcm, a, b, language):
        key = f'{a}:{b}:{language or "auto"}'
        if key not in self.cache:
            self.load()
            result = self.engine.transcribe(pcm[a * 2:b * 2], language)
            self.cache[key] = {'segments': result['segments'], 'language': result['language'], 'seconds': result['seconds'],
                               'logprob': result['quality']['logprobMin'], 'speech': not result['quality']['speechGateRejected']}
            self.save()
        return self.cache[key]

    def detect(self, pcm, a, b):
        key = f'{a}:{b}:detect'
        if key not in self.cache:
            self.load()
            import mlx.core as mx
            from mlx_whisper.audio import N_FRAMES, N_SAMPLES, log_mel_spectrogram, pad_or_trim
            from mlx_whisper.decoding import detect_language
            from mlx_whisper.transcribe import ModelHolder
            from scipy.signal import resample_poly
            start = time.perf_counter()
            audio = resample_poly(np.frombuffer(pcm[a * 2:b * 2], dtype='<i2').astype(np.float32) / 32768, 2, 3).astype(np.float32)
            model = ModelHolder.get_model(str(self.engine.path), mx.float16)
            mel = pad_or_trim(log_mel_spectrogram(audio, n_mels=model.dims.n_mels, padding=N_SAMPLES), N_FRAMES, axis=-2)
            _, probs = detect_language(model, mel.astype(mx.float16))
            probs = probs[0] if isinstance(probs, list) else probs
            top = dict(sorted(probs.items(), key=lambda kv: -kv[1])[:5])
            self.cache[key] = {'probs': {k: round(float(v), 4) for k, v in top.items()} | {
                k: round(float(probs.get(k, 0)), 4) for k in PAIR}, 'seconds': time.perf_counter() - start}
            self.save()
        return self.cache[key]

    def save(self, force=False):
        self.dirty += 1
        if force or self.dirty >= 20:
            OUT.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.cache, ensure_ascii=False))
            self.dirty = 0


def choose(rule, decoder, pcm, a, b):
    """Decode a window of a row with no language yet: (segments, language or None, seconds)."""
    if rule in ('auto', 'auto-lock'):
        d = decoder.decode(pcm, a, b, None)
        return d['segments'], d['language'] if d['segments'] and d['language'] in PAIR else None, d['seconds']
    detection = decoder.detect(pcm, a, b)
    seconds, probs = detection['seconds'], detection['probs']
    if rule == 'pair-detect':
        language = max(PAIR, key=lambda k: probs[k])
        d = decoder.decode(pcm, a, b, language)
        return d['segments'], language if d['segments'] else None, seconds + d['seconds']
    if rule in ('retry', 'retry-uncertain'):
        order = sorted(PAIR, key=lambda k: -probs[k])
        if rule == 'retry-uncertain' and probs[order[0]] >= UNCERTAIN:
            order = order[:1]
        for language in order:
            d = decoder.decode(pcm, a, b, language)
            seconds += d['seconds']
            if d['segments'] and script_ok(''.join(s['text'] for s in d['segments']), language):
                return d['segments'], language, seconds
        return [], None, seconds
    if sum(probs[k] for k in PAIR) < 1 - THIRD:
        return [], None, seconds
    best = None
    for language in sorted(PAIR, key=lambda k: -probs[k]):
        d = decoder.decode(pcm, a, b, language)
        seconds += d['seconds']
        text = ''.join(s['text'] for s in d['segments'])
        if d['segments'] and script_ok(text, language) and (best is None or d['logprob'] > best[2]):
            best = (d['segments'], language, d['logprob'])
    return (best[0], best[1], seconds) if best else ([], None, seconds)


def stable_prefix(previous, current):
    n = 0
    while n < min(len(previous), len(current)) and previous[n] == current[n]:
        n += 1
    stable = current[:n]
    if stable and stable[-1].isascii() and stable[-1].isalnum() and current[n:n + 1].isascii() and current[n:n + 1].isalnum():
        stable = stable.rstrip('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    return stable


def hypothesis(segments):
    return ''.join(s['text'] for s in segments).lstrip()


def lock_count(segments, stable, window_ms, final):
    if final:
        return len(segments), False
    count = 0
    for i, s in enumerate(segments):
        if len(hypothesis(segments[:i + 1])) > len(stable) or s['endMs'] > window_ms - SETTLE * 1000:
            break
        count = i + 1
    if not count and window_ms >= FORCE * 1000 and segments:
        return max(1, len(segments) - 1), True
    return count, False


def join(row, text):
    if not row:
        return text.lstrip()
    if row[-1].isspace() or text[:1].isspace():
        return row + text
    return f'{row} {text}' if row[-1].isascii() and row[-1] not in '。' and text[:1].isascii() and text[:1].isalnum() else row + text


def third_language(decoder, pcm, a, b):
    probs = decoder.detect(pcm, a, min(b, a + 29 * RATE))['probs']
    return sum(probs[k] for k in PAIR) < 1 - THIRD


def stretch(rule, decoder, pcm, a, b, clock, keep_agreed=False, third_row=False, noise_confirm=None):
    """One stretch of speech, samples a to b. Returns rows [(language, text)], the clock, and decode count."""
    rows, row = [], {'language': None, 'text': '', 'audio': 0.0, 'start': a}

    def close(end):
        if not third_row or not third_language(decoder, pcm, row['start'], end):
            rows.append((row['language'], row['text']))

    win, previous, decodes, after_noise = a, '', 0, False
    t = a / RATE + INTERVAL
    while True:
        start = max(clock, t)
        until = min(int(start * RATE), b)
        final = until >= b
        win = max(win, until - int(29 * RATE))  # live rolling never sends Whisper more than its 30 s input
        if (until - win) / RATE >= MIN_WINDOW or (final and until - win >= RATE // 10):
            logprob = None
            if row['language']:
                d = decoder.decode(pcm, win, until, row['language'])
                segments, seconds, logprob = d['segments'], d['seconds'], d['logprob']
            else:
                segments, language, seconds = choose(rule, decoder, pcm, win, until)
                if rule in ('auto', 'auto-lock'):
                    logprob = decoder.decode(pcm, win, until, None)['logprob']
                # auto keeps the live rule; the others settle the row's language only when its text locks.
                row['language'] = None if rule in SETTLE_AT_LOCK else language
            decodes += 1
            clock = start + seconds
            window_ms = (until - win) / RATE * 1000
            count, _ = lock_count(segments, stable_prefix(previous, hypothesis(segments)), window_ms, final)
            if count and after_noise and noise_confirm is not None and (logprob is None or logprob < noise_confirm):
                count = 0
            if count:
                after_noise = False
                if rule in SETTLE_AT_LOCK and not row['language']:
                    row['language'] = language
                locked = segments[:count]
                end = int(locked[-1]['endMs'] * RATE / 1000)
                previous = hypothesis(segments)[len(hypothesis(locked)):].lstrip()
                row['text'] = join(row['text'], ''.join(s['text'] for s in locked))
                row['audio'] += end / RATE
                win += end
                if not final and (row['audio'] >= MAX_ROW or (row['audio'] >= SENTENCE_ROW and row['text'].rstrip()[-1:] in '.!?。！？')):
                    close(win)
                    row = {'language': None, 'text': '', 'audio': 0.0, 'start': win}
            elif not segments and keep_agreed and previous and window_ms < FORCE * 1000:
                pass
            elif not segments and window_ms > NOISE * 1000 and not final:
                win = until - int(KEEP * RATE)
                previous, after_noise = '', True
                if not row['text']:
                    row['language'] = None
            else:
                previous = hypothesis(segments)
        if final:
            break
        t = max(t + INTERVAL, clock)
    if row['text']:
        close(b)
    return rows, clock, decodes


STRESS_BED, STRESS_UNDER = 8.0, 0.25


def stress(stream):
    """Write a stress stream and return its spans; see the module docstring."""
    from gate import level, pcm as read_pcm
    _, language, variant = stream.split('-')
    clips = [f for f in json.loads((ROOT / 'benchmarks/fleurs.json').read_text()) if f['language'] == language]
    clips += [f for f in json.loads((ROOT / 'benchmarks/noisy-ja.json').read_text())['fixtures'] if f['language'] == language]
    beds = [np.frombuffer(read_pcm(STREAMS / f'{name}.wav'), dtype='<i2').astype(np.float32)
            for name in ('nonspeech-music', 'nonspeech-background-noise')]
    parts, spans, position, offset = [], [], 0, 0
    for i, clip in enumerate(clips):
        speech = np.frombuffer(level(read_pcm(ROOT / '.local/fixtures' / f"{clip['id']}.wav"))[0], dtype='<i2').astype(np.float32)
        bed = beds[i % 2]
        n = int(STRESS_BED * RATE) + (len(speech) if variant == 'under' else 0)
        noise = np.resize(bed[offset % len(bed):], n)
        offset += n
        if variant == 'under':
            item = noise * STRESS_UNDER
            item[-len(speech):] += speech
        else:
            item = np.concatenate([noise, speech])
        spans.append((clip, position, position + len(item)))
        parts += [item, np.zeros(RATE, dtype=np.float32)]
        position += len(item) + RATE
    audio = np.clip(np.concatenate(parts), -32768, 32767).astype('<i2').tobytes()
    import subprocess
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(RATE), '-ac', '1', '-i', 'pipe:0',
                    str(STREAMS / f'{stream}.wav')], input=audio, check=True)
    return spans


def layout(stream):
    if stream.startswith('stress-'):
        return stress(stream)
    fixtures = json.loads((ROOT / 'benchmarks/gate-fleurs.json').read_text())['fixtures']
    if stream.startswith('public-'):
        clips = [f for f in fixtures if f['language'] == stream.split('-')[1]]
    elif stream == 'third-language':
        clips = json.loads((ROOT / 'benchmarks/gate-other.json').read_text())['fixtures']
    else:
        category = stream.split('-', 1)[1]
        clips = [f for f in json.loads((ROOT / 'benchmarks/gate-nonspeech.json').read_text())['fixtures'] if f['category'] == category]
    spans, position = [], 0
    for clip in clips:
        samples = round(clip['seconds'] * RATE)
        spans.append((clip, position, position + samples))
        position += samples + RATE  # a second of digital silence between clips
    return spans


def run(args):
    import subprocess
    report = {}
    for stream in args.streams.split(','):
        if stream.startswith('stress-'):
            stress(stream)
        pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(STREAMS / f'{stream}.wav'), '-f', 's16le', '-ac', '1', '-ar', str(RATE),
                              'pipe:1'], check=True, capture_output=True).stdout
        decoder = Decoder(stream)
        for rule in args.rules.split(','):
            rows, decodes, busy, clock = [], 0, 0.0, 0.0
            started = time.perf_counter()
            for clip, a, b in layout(stream):
                clock = max(clock, a / RATE)
                before = clock
                found, clock, n = stretch(rule, decoder, pcm, a, min(b, len(pcm) // 2), clock, args.keep_agreed, args.third_row, args.noise_confirm)
                rows += [(clip.get('id'), language, text) for language, text in found]
                decodes += n
                busy += clock - before
            decoder.save(force=True)
            result = {'rows': len(rows), 'decodes': decodes, 'wallSeconds': round(time.perf_counter() - started, 1)}
            if stream.startswith(('public-', 'stress-')):
                language = stream.split('-')[1]
                clips = layout(stream)
                reference = ' '.join(c['reference'] for c, _, _ in clips)
                result['score'] = edit_counts(reference, ' '.join(text for _, _, text in rows), language)
                result['errorRate'] = round(result['score']['errors'] / result['score']['referenceUnits'], 4)
                result['wrongLanguageRows'] = sum(lang != language for _, lang, _ in rows)
            else:
                result['texts'] = [text for _, _, text in rows]
            name = rule + ('+keep' if args.keep_agreed else '') + ('+third' if args.third_row else '') + (
                f'+confirm{args.noise_confirm}' if args.noise_confirm is not None else '')
            report.setdefault(stream, {})[name] = result
            print(stream, name, json.dumps({k: v for k, v in result.items() if k != 'score'} | (
                {'deletions': result['score']['deletions']} if 'score' in result else {}), ensure_ascii=False), flush=True)
            (OUT / f'rows-{stream}-{name}.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f'report-{time.strftime("%Y%m%dT%H%M%S")}.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    run_parser = commands.add_parser('run')
    run_parser.add_argument('--rules', default='auto,pair-detect,candidates')
    run_parser.add_argument('--streams', default='public-ja,public-en,nonspeech-music,nonspeech-background-noise,nonspeech-applause,'
                                                'third-language')
    run_parser.add_argument('--keep-agreed', action='store_true')
    run_parser.add_argument('--third-row', action='store_true')
    run_parser.add_argument('--noise-confirm', type=float)
    run(parser.parse_args())


if __name__ == '__main__':
    main()
