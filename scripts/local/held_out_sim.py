"""Offline replay of the held-out recordings through rolling recognition, to compare decode variants. Not wired into the
live service.

Each recording is cut into stretches by the energy detector's rules as the gate calibrates them on digital silence, and
each stretch is replayed in virtual time with the live rolling rules: a decode after every second of new audio, the row's
language settled when its text locks, a lone filtered decode skipped, a decode outside the pair retried in the pair, and a
confident decode needed after a noise trim. Scores use the gate's `edits` against the same references, beside a one-pass
decode of each recording, so the differences read like the gate's held-out targets. A simulation, never a gate result.

Variants:
  --gain file     scale the whole recording so its 90th-percentile 50 ms RMS is 0.1, as the gate levels public clips
  --gain agc      a slow automatic gain toward 0.1 RMS, at most 20 dB, as a browser's automatic gain might apply
  --norm p90      scale each decode window the same way, before the speech gate and Whisper: a worker-side change
  --loop MODE     decode again when the repetition filter drops text; see RECOVERIES
  --prompt N      prompt each decode with the last N characters locked in the recording
  --silence MS    close a stretch after this much quiet instead of the live 700 ms
  --left S        start each decode window up to S seconds early, over audio already locked or between stretches, and
                  keep only the text after it; not combined with --loop
  --language L    a forced direction instead of Auto

Decodes are cached per recording and variant under .local/experiments/held-out-sim/, with the rows each variant produced.
Prints counts and rates only. No API or .env use.

  held_out_sim.py [--manifest .local/fixtures/held-out/held-out.json] [--talks ja|en|id,...] [variant flags]
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
import numpy as np
from gate import ROOT, edits, held_out, pcm as read_pcm
import language_sim
from language_sim import FORCE, INTERVAL, KEEP, MAX_ROW, MIN_WINDOW, NOISE, RATE, SENTENCE_ROW, hypothesis, join, stable_prefix

PAIR = ('ja', 'en')
OUT = ROOT / '.local/experiments/held-out-sim'
FRAME = RATE // 20  # 50 ms
LEVEL, PEAK = 0.1, 0.99
NOISE_CONFIRM = -0.5
RECOVERIES = ('temperature', 'shift', 'tail')


def frame_levels(audio, frame):
    frames = audio[:len(audio) // frame * frame].reshape(-1, frame)
    return np.sqrt(np.maximum(0, (frames ** 2).mean(axis=1) - frames.mean(axis=1) ** 2))


def stretches(audio, silence_ms=700):
    """Sample spans the energy detector opens, as packages/providers/turns.ts does after calibrating on digital silence."""
    floor, threshold = 0.0, 0.004
    active, onset, silence, start, last_end, out = False, 0, 0, 0, 0, []
    levels = frame_levels(audio, FRAME)
    for i, value in enumerate(levels):
        voiced = value >= threshold * (0.65 if active else 1)
        if not active:
            onset = onset + 1 if voiced else 0
            if not voiced:
                floor = floor * 0.995 + value * 0.005
                threshold = min(0.95, max(0.004, floor * 2.5))
            if onset < 3:
                continue
            active, start, silence = True, max(last_end, i - 5), 0
            continue
        silence = 0 if voiced else silence + 50
        if silence >= silence_ms:
            out.append((start * FRAME, (i + 1) * FRAME))
            active, onset, silence, last_end = False, 0, 0, i + 1
    if active:
        out.append((start * FRAME, len(levels) * FRAME))
    return out


def p90_gain(audio, frame):
    levels = frame_levels(audio, frame)
    loud = np.percentile(levels, 90) if len(levels) else 0
    peak = np.abs(audio).max() if len(audio) else 0
    return min(LEVEL / loud, PEAK / peak) if loud > 0 and peak > 0 else 1.0


def agc(audio, frame, max_gain=10.0, release_seconds=1.5):
    """A slow gain toward LEVEL: the envelope rises at once and falls over release_seconds."""
    levels = frame_levels(audio, frame)
    decay = 0.5 ** (frame / RATE / release_seconds)
    envelope, gains = 0.0, np.empty(len(levels))
    for i, value in enumerate(levels):
        envelope = max(value, envelope * decay)
        gains[i] = min(max_gain, max(0.25, LEVEL / envelope)) if envelope > 0 else max_gain
    centers = (np.arange(len(levels)) + 0.5) * frame
    return np.clip(audio * np.interp(np.arange(len(audio)), centers, gains), -PEAK, PEAK)


class Decoder:
    """The live worker's decode and filters with the variant applied, cached per window, language and prompt."""

    def __init__(self, name, args):
        self.args = args
        self.path = OUT / f'cache-{name}-{variant_name(args)}.json'
        self.cache = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.dirty = 0

    engine = None

    @classmethod
    def load(cls):
        if cls.engine is None:
            from engine import Engine
            cls.engine = Engine('turbo-q4')
            cls.engine.warm()
        return cls.engine

    def save(self, force=False):
        self.dirty += 1
        if force or self.dirty >= 20:
            OUT.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.cache, ensure_ascii=False))
            self.dirty = 0

    def decode(self, audio, a, b, language, prompt=None, lead=None):
        """Decode samples a to b. With lead, the window starts there instead, and only text after a is returned."""
        lead = a if lead is None else lead
        key = (f'{a}:{b}:{language or "auto"}' + (':' + hashlib.sha1(prompt.encode()).hexdigest()[:12] if prompt else '')
               + (f':lead{lead}' if lead != a else ''))
        if key not in self.cache:
            self.cache[key] = self.transcribe(audio[lead:b], language, prompt, (a - lead) / RATE)
            self.save()
        return self.cache[key]

    def filtered(self, engine, audio, language, prompt, skip=0.0, **options):
        import mlx.core as mx
        import mlx_whisper
        from quality import accepted_segments
        result = mlx_whisper.transcribe(audio, path_or_hf_repo=str(engine.path), language=language, task='transcribe',
                                        condition_on_previous_text=False, verbose=None, word_timestamps=False, fp16=True,
                                        initial_prompt=prompt, **({'temperature': 0.0} | options))
        mx.synchronize()
        if skip:
            # Left context: keep segments whose middle falls in the new audio, on the new audio's clock.
            result = {**result, 'segments': [{**s, 'start': max(0.0, s['start'] - skip), 'end': s['end'] - skip}
                                             for s in result.get('segments', []) if (s['start'] + s['end']) / 2 >= skip]}
        return result, *accepted_segments(result, audio_seconds=len(audio) / 16_000 - skip)

    def recover(self, engine, audio, language, prompt, result, kept, rejected, quality):
        """Decode again after a repetition drop. Returns the replacement, or the original when nothing better came back."""
        from quality import accepted_segments
        mode, chars = self.args.loop, len(''.join(s['text'] for s in kept))
        if mode == 'temperature':
            for temperature in (0.2, 0.4, 0.6):
                again = self.filtered(engine, audio, language, prompt, temperature=temperature)
                if not again[3]['repetitionDrops'] and len(''.join(s['text'] for s in again[1])) > chars:
                    return again
            return result, kept, rejected, quality
        # Where the first dropped repetitive segment starts: text before it is kept, audio from there decodes again.
        from quality import repetitive
        segments = result.get('segments', [])
        first = next((i for i, s in enumerate(segments) if repetitive(s.get('text', ''))), None)
        if first is None:
            first = 0  # the joined text was repetitive, not one segment
        head = {**result, 'segments': segments[:first]}
        start = float(segments[first]['start']) if segments else 0.0
        offsets = (0.0, 0.5, 1.0) if mode == 'shift' else (0.0,)
        best = None
        for offset in offsets:
            cut = int((start + offset) * 16_000)
            if len(audio) - cut < 8_000:
                break
            if cut == 0 and offset == 0.0:
                continue  # the same window again
            tail, _, _, tail_quality = self.filtered(engine, audio[cut:], language, prompt)
            if tail_quality['repetitionDrops']:
                continue
            shifted = [{**s, 'start': s['start'] + cut / 16_000, 'end': s['end'] + cut / 16_000} for s in tail.get('segments', [])]
            merged = {**result, 'segments': head['segments'] + shifted}
            again = (merged, *accepted_segments(merged, audio_seconds=len(audio) / 16_000))
            if not again[3]['repetitionDrops'] and len(''.join(s['text'] for s in again[1])) > chars:
                best = again
                break
        return best or (result, kept, rejected, quality)

    def transcribe(self, pcm, language, prompt, skip=0.0):
        from quality import pair_retry_language, script_matches, segment_ends
        from scipy.signal import resample_poly
        engine = self.load()
        start = time.perf_counter()
        audio = resample_poly(pcm, 2, 3).astype(np.float32)
        if self.args.norm == 'p90':
            audio = np.clip(audio * p90_gain(audio, 800), -1, 1).astype(np.float32)
        if not engine.speech_gate.has_speech(audio[int(skip * 16_000):]):
            return {'segments': [], 'language': language or 'unknown', 'seconds': time.perf_counter() - start, 'logprob': None,
                    'speech': False, 'repetition': 0, 'recovered': 0, 'retried': 0}
        result, kept, rejected, quality = self.filtered(engine, audio, language, prompt, skip)
        repetition, recovered = quality['repetitionDrops'], 0
        if repetition and self.args.loop:
            again = self.recover(engine, audio, language, prompt, result, kept, rejected, quality)
            recovered = int(again[0] is not result)
            result, kept, rejected, quality = again
        retried = 0
        if language is None and kept and result.get('language') not in PAIR:
            retry = pair_retry_language(engine.detect(audio), PAIR)
            if retry:
                again, kept2, rejected2, quality2 = self.filtered(engine, audio, retry, prompt, skip)
                if kept2 and script_matches(''.join(s['text'] for s in kept2), retry):
                    result, kept, rejected, quality, retried = {**again, 'language': retry}, kept2, rejected2, quality2, 1
        return {'segments': segment_ends(kept, len(audio) / 16 - skip * 1000), 'language': result.get('language', 'unknown'),
                'seconds': time.perf_counter() - start, 'logprob': quality['logprobMin'], 'speech': True,
                'repetition': repetition, 'recovered': recovered, 'retried': retried}


def stretch(decoder, audio, a, b, clock, stats, context, prompt_chars, fixed=None, silence_ms=700, left=0.0):
    """One stretch of speech, samples a to b, under the live rolling rules. Returns rows [(language, text)] and the clock."""
    rows, row = [], {'language': fixed, 'text': '', 'audio': 0.0}
    win, previous, after_noise = a, '', False
    t = a / RATE + INTERVAL
    while True:
        start = max(clock, t)
        until = min(int(start * RATE), b)
        final = until >= b
        win = max(win, until - int(29 * RATE))
        if (until - win) / RATE >= MIN_WINDOW or (final and until - win >= RATE // 10):
            prompt = (context[0] + row['text'])[-prompt_chars:] if prompt_chars else None
            lead = max(0, win - int(left * RATE), until - int(29.5 * RATE)) if left else None
            d = decoder.decode(audio, win, until, row['language'], prompt or None, lead)
            segments, language = d['segments'], d['language']
            if not row['language'] and language not in PAIR:
                stats['otherDrops'] += bool(segments)
                segments = []
            stats['decodes'] += 1
            stats['repetitionDecodes'] += bool(d['repetition'])
            stats['recovered'] += d['recovered']
            stats['pairRetries'] += d['retried']
            stats['gateRejects'] += not d['speech']
            clock = start + d['seconds']
            window_ms = (until - win) / RATE * 1000
            count, forced = language_sim.lock_count(segments, stable_prefix(previous, hypothesis(segments)), window_ms, final)
            if count and after_noise and (d['logprob'] is None or d['logprob'] < NOISE_CONFIRM):
                count = 0
                stats['unconfirmed'] += 1
                if final:
                    stats['lostSeconds'] += window_ms / 1000
            if count:
                after_noise = False
                row['language'] = row['language'] or language
                locked = segments[:count]
                end = int(locked[-1]['endMs'] * RATE / 1000)
                stats['forcedLocks'] += forced
                if not final:
                    stats['lags'].append(clock - (win + end) / RATE)
                previous = hypothesis(segments)[len(hypothesis(locked)):].lstrip()
                row['text'] = join(row['text'], ''.join(s['text'] for s in locked))
                row['audio'] += end / RATE
                win += end
                if not final and (row['audio'] >= MAX_ROW or (row['audio'] >= SENTENCE_ROW and row['text'].rstrip()[-1:] in '.!?。！？')):
                    rows.append((row['language'], row['text']))
                    context[0] += row['text']
                    row = {'language': fixed, 'text': '', 'audio': 0.0}
            elif not segments and previous and window_ms < FORCE * 1000 and not final:
                stats['skips'] += 1
            elif not segments and window_ms > NOISE * 1000 and not final:
                stats['trims'] += 1
                stats['lostSeconds'] += (until - win) / RATE - KEEP
                win = until - int(KEEP * RATE)
                previous, after_noise = '', True
                if not row['text']:
                    row['language'] = fixed
            else:
                if final and not segments and d['speech']:
                    stats['emptyCloses'] += 1
                    stats['lostSeconds'] += window_ms / 1000
                previous = hypothesis(segments)
        if final:
            # From the last voiced frame to the closing reply: the stretch ends silence_ms after it.
            stats['tails'].append(clock - (b / RATE - silence_ms / 1000))
            break
        t = max(t + INTERVAL, clock)
    if row['text']:
        rows.append((row['language'], row['text']))
        context[0] += row['text']
    return rows, clock


def variant_name(args):
    return '+'.join(filter(None, ['live', args.gain and f'gain-{args.gain}', args.norm and f'norm-{args.norm}',
                                  args.loop and f'loop-{args.loop}', args.prompt and f'prompt{args.prompt}',
                                  args.settle != 0.5 and f'settle{args.settle}', args.silence != 700 and f'silence{args.silence}',
                                  args.left and f'left{args.left}',
                                  args.language and f'forced-{args.language}'])) or 'live'


def offline(entry, audio, tag):
    """The model's one-pass decode of the recording in its language, cached."""
    path = OUT / f"offline-{entry['id']}-{tag}.json"
    if not path.exists():
        from scipy.signal import resample_poly
        engine = Decoder.load()
        OUT.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'text': engine._decode(resample_poly(audio, 2, 3).astype(np.float32), entry['language'], None)['text']},
                                   ensure_ascii=False))
    return json.loads(path.read_text())['text']


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--manifest', default=str(ROOT / '.local/fixtures/held-out/held-out.json'))
    parser.add_argument('--talks', default='ja,en')
    parser.add_argument('--gain', choices=['file', 'agc'])
    parser.add_argument('--norm', choices=['p90'])
    parser.add_argument('--loop', choices=RECOVERIES)
    parser.add_argument('--prompt', type=int, default=0)
    parser.add_argument('--settle', type=float, default=0.5)
    parser.add_argument('--silence', type=int, default=700, help='quiet that closes a stretch, in ms; live is 700')
    parser.add_argument('--left', type=float, default=0.0, help='seconds of already locked audio decoded again before each window')
    parser.add_argument('--language', choices=PAIR, help='a forced direction instead of Auto')
    args = parser.parse_args()
    language_sim.SETTLE = args.settle
    folder, entries = held_out(args.manifest, PAIR)
    wanted = args.talks.split(',')
    name = variant_name(args)
    totals = {}
    for entry in entries:
        if entry['language'] not in wanted and entry['id'] not in wanted:
            continue
        raw = np.frombuffer(read_pcm(folder / entry['audio']), dtype='<i2').astype(np.float32) / 32768
        audio, gain = raw, 1.0
        if args.gain == 'file':
            gain = p90_gain(raw, FRAME)
            audio = np.clip(raw * gain, -1, 1).astype(np.float32)
        elif args.gain == 'agc':
            audio = agc(raw, FRAME).astype(np.float32)
        decoder = Decoder(entry['id'], args)
        stats = {key: 0 for key in ('decodes', 'repetitionDecodes', 'recovered', 'pairRetries', 'gateRejects', 'otherDrops', 'unconfirmed',
                                    'forcedLocks', 'skips', 'trims', 'emptyCloses')} | {'lostSeconds': 0.0, 'lags': [], 'tails': []}
        rows, clock, context = [], 0.0, ['']
        spans = stretches(audio, args.silence)
        for a, b in spans:
            clock = max(clock, a / RATE)
            found, clock = stretch(decoder, audio, a, b, clock, stats, context, args.prompt, args.language, args.silence, args.left)
            rows += found
        decoder.save(force=True)
        (OUT / f"rows-{entry['id']}-{name}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n')
        reference = (folder / entry['reference']).read_text()
        language = entry['language']
        live = edits(reference, ' '.join(text for _, text in rows), language)
        base = edits(reference, offline(entry, raw, 'raw'), language)
        lags, tails = sorted(stats.pop('lags')), sorted(stats.pop('tails'))
        total = totals.setdefault(language, {'errors': 0, 'deletions': 0, 'offErrors': 0, 'offDeletions': 0, 'units': 0})
        for key, value in (('errors', live['errors']), ('deletions', live['deletions']), ('offErrors', base['errors']),
                           ('offDeletions', base['deletions']), ('units', live['referenceUnits'])):
            total[key] += value
        units = live['referenceUnits']
        print(entry['id'], name, json.dumps({
            'gain': round(float(gain), 2), 'medianRms': round(float(np.median(frame_levels(raw, FRAME))), 4),
            'stretches': len(spans), 'stretchSeconds': round(sum(b - a for a, b in spans) / RATE, 1), 'rows': len(rows),
            'wrongLanguageRows': sum(lang != language for lang, _ in rows), 'units': units,
            'error': round(live['errors'] / units * 100, 2), 'deletions': round(live['deletions'] / units * 100, 2),
            'offlineError': round(base['errors'] / units * 100, 2), 'offlineDeletions': round(base['deletions'] / units * 100, 2),
            'lockLag': [round(lags[len(lags) // 2], 2), round(lags[int(len(lags) * 0.9)], 2)] if lags else None,
            'speechEndToFinal': [round(tails[len(tails) // 2], 2), round(tails[int(len(tails) * 0.9)], 2)] if tails else None,
            **{k: round(v, 1) if isinstance(v, float) else v for k, v in stats.items()}}), flush=True)
    for language, total in totals.items():
        print(f'TOTAL {language} {name}', json.dumps({
            'error': round(total['errors'] / total['units'] * 100, 2), 'deletions': round(total['deletions'] / total['units'] * 100, 2),
            'overOffline': round((total['errors'] - total['offErrors']) / total['units'] * 100, 2),
            'deletionsOverOffline': round((total['deletions'] - total['offDeletions']) / total['units'] * 100, 2)}), flush=True)


if __name__ == '__main__':
    main()
