"""Offline simulation of rolling-window recognition against fixed-cap turns. Not wired into the live service.

Rolling: every --interval seconds, re-decode all audio not yet locked. Text that two consecutive decodes
agree on is stable; whole Whisper segments inside the stable text that end at least --settle seconds before
the newest audio are locked and their audio dropped. Fixed: back-to-back --cap-second chunks, as the live
cap does on continuous speech. Time is virtual: audio arrives in real time and each decode takes as long as
it really took here, so latencies are realistic without waiting. Write output only under private/ for
personal or third-party recordings.
"""
import argparse
import difflib
import json
import statistics
import subprocess
import time
import numpy as np
import mlx.core as mx
from engine import Engine
from quality import accepted_result
from scoring import edit_counts

RATE = 16_000


def decode(engine, audio, language):
    start = time.perf_counter()
    if not engine.speech_gate.has_speech(audio):
        return [], language, time.perf_counter() - start
    result = engine._decode(audio, language, None)
    mx.synchronize()
    kept = []
    for s in result.get('segments', []):
        text, rejected, _ = accepted_result({'segments': [s]})
        if text and not rejected:
            kept.append({'start': s['start'], 'end': s['end'], 'text': s['text']})
    # The stock-phrase and whole-text repetition checks apply to the window as a whole.
    joined, rejected, _ = accepted_result({'segments': [{'text': ''.join(s['text'] for s in kept), 'no_speech_prob': 0,
                                                         'avg_logprob': 0}]}, audio_seconds=len(audio) / RATE)
    if rejected or not joined:
        kept = []
    return kept, result.get('language'), time.perf_counter() - start


def common_prefix(a, b):
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return n


def stable_prefix(previous, current):
    stable = current[:common_prefix(previous, current)]
    # Do not end inside a Latin word or number that the next decode may still extend.
    nxt = current[len(stable):len(stable) + 1]
    if stable and stable[-1].isascii() and stable[-1].isalnum() and nxt.isascii() and nxt.isalnum():
        stable = stable.rstrip('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    return stable


def rolling(engine, audio, language, interval, settle, force_after, realtime=False):
    end = len(audio) / RATE
    wall = time.perf_counter()
    clock, last_start, win = 0.0, -interval, 0.0
    lang, previous, locked = language, '', []
    decodes, retracted, shown_before = [], 0, ''
    while True:
        start = max(clock, last_start + interval)
        if start > end + 2 * interval:
            break
        last_start = start
        if realtime:  # Soak mode: keep the real cadence so sustained load and heat are realistic.
            time.sleep(max(0.0, wall + start - time.perf_counter()))
        until = min(start, end)
        if until - win < 0.5:
            clock = start
            continue
        window = audio[int(win * RATE):int(until * RATE)]
        segments, detected, seconds = decode(engine, window, lang)
        clock = start + seconds
        if lang is None and detected in ('en', 'ja'):
            lang = detected  # Auto mode: detect once per stretch of speech, then decode with it known.
        hypothesis = ''.join(s['text'] for s in segments).lstrip()
        stable = stable_prefix(previous, hypothesis)
        # Agreed text so far, locked plus stable, for measuring whether word-level locking would hold.
        agreed = ' '.join([x['text'] for x in locked] + [stable])
        decodes.append({'start': start, 'finish': clock, 'audioEnd': until, 'seconds': seconds, 'agreed': agreed})
        # Lock whole segments inside the stable text that ended before the newest audio.
        k, text = 0, ''
        for i, s in enumerate(segments):
            candidate = ''.join(x['text'] for x in segments[:i + 1]).lstrip()
            settled = s['end'] <= (until - win) - settle or until >= end
            if len(candidate) <= len(stable) and settled:
                k, text = i + 1, candidate
        forced = not k and until - win >= force_after and len(segments) > 1
        if forced:  # Safety: never let the window approach Whisper's 30 s input.
            k, text = len(segments) - 1, ''.join(x['text'] for x in segments[:-1]).lstrip()
        if k:
            cut = win + segments[k - 1]['end']
            locked.append({'text': text, 'audioStart': win + segments[0]['start'], 'audioEnd': cut,
                           'lockedAt': clock, 'forced': forced})
            previous = hypothesis[len(text):].lstrip()
            win = cut
        elif not segments and until - win > 3:
            win, lang, previous = until - 1.0, language, ''  # Silence: drop all but the last second, relearn language.
        else:
            previous = hypothesis
        # Shown text: everything locked plus this decode's tentative remainder.
        shown = ''.join(x['text'] for x in locked) + (hypothesis[len(text):] if k else hypothesis)
        retracted += len(shown_before) - common_prefix(shown_before, shown)
        shown_before = shown
    return locked, decodes, retracted


def fixed(engine, audio, language, cap):
    end = len(audio) / RATE
    clock, locked, decodes = 0.0, [], []
    t = 0.0
    while t < end:
        until = min(t + cap, end)
        start = max(clock, until)
        segments, _, seconds = decode(engine, audio[int(t * RATE):int(until * RATE)], language)
        clock = start + seconds
        decodes.append({'start': start, 'finish': clock, 'audioEnd': until, 'seconds': seconds})
        text = ''.join(s['text'] for s in segments).strip()
        if text:
            locked.append({'text': text, 'audioStart': t + segments[0]['start'], 'audioEnd': until, 'lockedAt': clock,
                           'forced': False})
        t = until
    return locked, decodes, 0


def compact(text, punctuation=True):
    return ''.join(c for c in text if not c.isspace() and (punctuation or c.isalnum()))


def agreement(locked, decodes, punctuation=True):
    """How often text two decodes agreed on differs from what was finally locked, and how much sooner it existed."""
    final = compact(''.join(x['text'] for x in locked), punctuation)
    lock_at = []
    for x in locked:
        lock_at += [x['lockedAt']] * len(compact(x['text'], punctuation))
    # Per decode: agreed characters that the final text contradicts. Consecutive contradicting decodes are one event.
    contradicted, events, bad_before, examples = 0, [], 0, []
    first = [None] * len(final)
    for d in decodes:
        agreed = compact(d['agreed'], punctuation)
        good = common_prefix(agreed, final)
        bad = len(agreed) - good
        contradicted += bad > 0
        if bad and not bad_before:
            events.append(bad)
            examples.append({'at': round(d['finish'], 1), 'agreed': agreed[max(0, good - 15):good + 25],
                             'final': final[max(0, good - 15):good + 25]})
        elif bad:
            events[-1] = max(events[-1], bad)
        bad_before = bad
        for i in range(good):
            if first[i] is None:
                first[i] = d['finish']
    gains = [lock_at[i] - first[i] for i in range(len(final)) if first[i] is not None]
    gains.sort()
    return {'decodesContradicted': contradicted, 'decodes': len(decodes), 'events': len(events),
            'contradictedChars': sum(events), 'finalChars': len(final),
            'secondsSoonerP50': round(statistics.median(gains), 2) if gains else None,
            'secondsSoonerP90': round(gains[int(0.9 * (len(gains) - 1))], 2) if gains else None,
            'examples': examples}


def word_locked(decodes, align=False):
    """Text shown if every agreed word were locked at once. Locked text never changes, so where a later decode
    disagrees, the earlier version stays and new text continues either at the same length offset or, with align,
    after the committed text's end mapped into the new agreed text by a fuzzy match of its last 30 characters."""
    committed = ''
    for d in decodes:
        agreed, start = d['agreed'], len(committed)
        if align and not agreed.startswith(committed):
            tail, lo = committed[-30:], max(0, len(committed) - 60)
            window = agreed[lo:len(committed) + 30]
            blocks = [b for b in difflib.SequenceMatcher(None, tail, window, autojunk=False).get_matching_blocks() if b.size]
            if not blocks:
                continue
            start = lo + blocks[-1].b + blocks[-1].size + (len(tail) - blocks[-1].a - blocks[-1].size)
        committed += agreed[start:]
    return committed


def summary(locked, decodes, retracted, audio_seconds, reference, language):
    def dist(values):
        values = sorted(values)
        return {'p50': round(statistics.median(values), 2), 'p90': round(values[int(0.9 * (len(values) - 1))], 2),
                'max': round(values[-1], 2)} if values else None
    sep = ' ' if language == 'en' else ''
    text = sep.join(x['text'].strip() for x in locked)
    # Display lag: how old the newest shown audio is just before the next decode lands.
    lags = [b['finish'] - a['audioEnd'] for a, b in zip(decodes, decodes[1:])]
    out = {'decodes': len(decodes), 'busy': round(sum(d['seconds'] for d in decodes) / audio_seconds, 3),
           'decodeSeconds': dist([d['seconds'] for d in decodes]),
           'displayLagSeconds': dist(lags),
           'firstWordToLockedSeconds': dist([x['lockedAt'] - x['audioStart'] for x in locked]),
           'lastWordToLockedSeconds': dist([x['lockedAt'] - x['audioEnd'] for x in locked]),
           'lockedChunks': len(locked), 'forcedLocks': sum(x['forced'] for x in locked),
           'retractedChars': retracted, 'lockedChars': len(text)}
    if reference:
        out['score'] = edit_counts(reference, text, language)
    if decodes and 'agreed' in decodes[0]:
        out['agreement'] = agreement(locked, decodes)
        out['agreementIgnoringPunctuation'] = agreement(locked, decodes, punctuation=False)
        if reference:
            out['wordLockScore'] = edit_counts(reference, word_locked(decodes), language)
            out['wordLockAlignedScore'] = edit_counts(reference, word_locked(decodes, align=True), language)
    return out, text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True, action='append', help='repeatable; files are joined in order')
    parser.add_argument('--repeat', type=int, default=1)
    parser.add_argument('--realtime', action='store_true', help='rolling only, at wall-clock pace, for a sustained-load soak')
    parser.add_argument('--out', required=True)
    parser.add_argument('--reference')
    parser.add_argument('--language', choices=['en', 'ja', 'auto'], default='auto')
    parser.add_argument('--interval', type=float, default=1.0)
    parser.add_argument('--settle', type=float, default=1.0)
    parser.add_argument('--force-after', type=float, default=25.0)
    parser.add_argument('--cap', type=float, default=12.0)
    parser.add_argument('--model', choices=['small-q4', 'turbo-q4'], default='turbo-q4')
    args = parser.parse_args()
    pcm = b''.join(subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', str(RATE), 'pipe:1'],
                                  check=True, capture_output=True).stdout for path in args.audio) * args.repeat
    audio = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    reference = open(args.reference).read().strip() if args.reference else None
    engine = Engine(args.model)
    engine.warm()
    language = None if args.language == 'auto' else args.language
    scored = 'en' if args.language == 'en' else 'ja'
    if reference and args.language == 'auto':
        scored = 'ja' if sum('぀' <= c <= '鿿' for c in reference) > len(reference) / 4 else 'en'
    report = {'audioSeconds': len(audio) / RATE, 'settings': vars(args) | {'reference': bool(args.reference)}}
    runs = [('rolling', lambda: rolling(engine, audio, language, args.interval, args.settle, args.force_after, args.realtime))]
    if not args.realtime:
        runs.append(('fixed', lambda: fixed(engine, audio, language, args.cap)))
    for name, run in runs:
        locked, decodes, retracted = run()
        report[name], text = summary(locked, decodes, retracted, len(audio) / RATE, reference, scored)
        report[name + 'Text'] = text
        # Decode time per five minutes of audio shows throttling over a long run.
        buckets = {}
        for d in decodes:
            buckets.setdefault(int(d['start'] // 300), []).append(d['seconds'])
        report[name]['decodeSecondsBy5Min'] = [round(statistics.median(v), 3) for _, v in sorted(buckets.items())]
        report[name + 'Decodes'] = [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in d.items()} for d in decodes]
        report[name + 'Chunks'] = [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in x.items()} for x in locked]
        brief = {k: report[name][k] for k in ('busy', 'displayLagSeconds', 'lastWordToLockedSeconds')}
        if reference:
            s = report[name]['score']
            brief['errorRate'] = round(s['errors'] / s['referenceUnits'], 4)
            brief['deletions'] = s['deletions']
        print(name, json.dumps(brief), flush=True)
    with open(args.out, 'w') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=1)
        handle.write('\n')


if __name__ == '__main__':
    main()
