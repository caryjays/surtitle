"""Pure, offline recognition-output checks; never logs or persists speech."""
import math
import re
import unicodedata
import zlib


def repetitive(text):
    compact = ''.join(c for c in unicodedata.normalize('NFKC', text)
                      if not c.isspace() and not unicodedata.category(c).startswith(('P', 'Z')))
    if len(compact) < 40:
        return False
    if re.fullmatch(r'(.{1,32})\1{7,}', compact, flags=re.DOTALL):
        return True
    raw = text.encode('utf-8')
    return len(raw) >= 160 and len(raw) / len(zlib.compress(raw)) > 4


def quality_metadata(speech_gate_rejected=False):
    return {'speechGateRejected': speech_gate_rejected, 'decodedSegments': 0, 'droppedSegments': 0,
            'noSpeechDrops': 0, 'lowConfidenceDrops': 0, 'repetitionDrops': 0, 'invalidScoreDrops': 0,
            'noSpeechMax': None, 'logprobMin': None}


def accepted_result(result, min_logprob=-1.0):
    """Retain good segments, not a hallucinated tail after real speech.

    Whisper temperature=0 has no fallback candidates to cure repetition. Its
    built-in no-speech rule can also keep high-confidence hallucinations, so
    explicitly reject loops and strongly suspect silence/low-confidence output.
    Thresholds are safeguards, not calibrated speech-confidence probabilities.
    """
    if not math.isfinite(min_logprob) or not -2 <= min_logprob <= -0.5:
        raise ValueError('Confidence threshold outside experiment bounds')
    quality = quality_metadata()
    segments = result.get('segments', [])
    if not isinstance(segments, list):
        quality['invalidScoreDrops'] = 1
        return '', True, quality
    quality['decodedSegments'] = len(segments)
    kept = []
    rejected = False
    for segment in segments:
        text = segment.get('text', '')
        if not isinstance(text, str) or not text.strip():
            continue
        no_speech = segment.get('no_speech_prob', 0)
        logprob = segment.get('avg_logprob', 0)
        if (not isinstance(no_speech, (int, float)) or not math.isfinite(no_speech)
                or not isinstance(logprob, (int, float)) or not math.isfinite(logprob)):
            quality['invalidScoreDrops'] += 1
            quality['droppedSegments'] += 1
            rejected = True
            continue
        quality['noSpeechMax'] = max(quality['noSpeechMax'] or 0, min(1, max(0, no_speech)))
        quality['logprobMin'] = min(quality['logprobMin'] if quality['logprobMin'] is not None else 10,
                                   max(-100, min(10, logprob)))
        no_speech_drop = no_speech >= 0.9 or (no_speech >= 0.6 and logprob < -0.4)
        low_confidence_drop = logprob < min_logprob
        # Match the original short-circuit path: already rejected segments do not
        # need another regex/compression pass just to collect diagnostics.
        repetition_drop = not (no_speech_drop or low_confidence_drop) and repetitive(text)
        suspect = no_speech_drop or low_confidence_drop or repetition_drop
        if suspect:
            quality['noSpeechDrops'] += int(no_speech_drop)
            quality['lowConfidenceDrops'] += int(low_confidence_drop)
            quality['repetitionDrops'] += int(repetition_drop)
            quality['droppedSegments'] += 1
            rejected = True
        else:
            kept.append(text)
    text = ''.join(kept).strip()
    if repetitive(text):
        quality['repetitionDrops'] += 1
        quality['droppedSegments'] = quality['decodedSegments']
        return '', True, quality
    # A partly accepted result is useful speech, not a fully rejected turn.
    return text, rejected and not text, quality


def accepted_text(result):
    text, rejected, _ = accepted_result(result)
    return text, rejected
