"""Pure, offline recognition-output checks; never logs or persists speech."""
import math
import re
import unicodedata
import zlib
from languages import PROFILES


def repetitive(text):
    compact = ''.join(c for c in unicodedata.normalize('NFKC', text)
                      if not c.isspace() and not unicodedata.category(c).startswith(('P', 'Z')))
    if len(compact) < 40:
        return False
    if re.fullmatch(r'(.{1,32})\1{7,}', compact, flags=re.DOTALL):
        return True
    raw = text.encode('utf-8')
    return len(raw) >= 160 and len(raw) / len(zlib.compress(raw)) > 4


# Sign-offs Whisper emits in place of ordinary speech. Said for real, they are short audio;
# from a long turn they replaced whatever was spoken. Compared after compacting. Every profile's
# phrases apply, since a hallucination need not be in the session's languages.
STOCK_PHRASES = tuple(phrase for profile in PROFILES.values() for phrase in profile['stockPhrases'])
STOCK_MIN_SECONDS = 6.0


def _compact(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text).casefold()
                   if not c.isspace() and not unicodedata.category(c).startswith(('P', 'Z', 'S')))


def stock_phrase(text, audio_seconds):
    compact = _compact(text)
    if not compact or audio_seconds is None or audio_seconds < STOCK_MIN_SECONDS:
        return False
    for phrase in STOCK_PHRASES:
        compact = compact.replace(_compact(phrase), '')
    return not compact


def quality_metadata(speech_gate_rejected=False):
    return {'speechGateRejected': speech_gate_rejected, 'decodedSegments': 0, 'droppedSegments': 0,
            'noSpeechDrops': 0, 'lowConfidenceDrops': 0, 'repetitionDrops': 0, 'stockPhraseDrops': 0, 'invalidScoreDrops': 0,
            'noSpeechMax': None, 'logprobMin': None}


def accepted_result(result, min_logprob=-1.0, audio_seconds=None):
    """Accepted text, rejection and quality metadata; see accepted_segments."""
    segments, rejected, quality = accepted_segments(result, min_logprob, audio_seconds)
    return ''.join(s['text'] for s in segments).strip(), rejected, quality


def accepted_segments(result, min_logprob=-1.0, audio_seconds=None):
    """Retain good segments, not a hallucinated tail after real speech.

    Whisper temperature=0 has no fallback candidates to cure repetition. Its
    built-in no-speech rule can also keep high-confidence hallucinations, so
    explicitly reject loops and strongly suspect silence/low-confidence output.
    With audio_seconds, a long turn that decodes to nothing but a stock sign-off is rejected.
    Thresholds are safeguards, not calibrated speech-confidence probabilities.
    Kept segments carry their text and the decoder's end time in seconds, or None if it gave none.
    """
    if not math.isfinite(min_logprob) or not -2 <= min_logprob <= -0.5:
        raise ValueError('Confidence threshold outside experiment bounds')
    quality = quality_metadata()
    segments = result.get('segments', [])
    if not isinstance(segments, list):
        quality['invalidScoreDrops'] = 1
        return [], True, quality
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
            kept.append({'text': text, 'end': segment.get('end')})
    text = ''.join(s['text'] for s in kept).strip()
    if repetitive(text):
        quality['repetitionDrops'] += 1
        quality['droppedSegments'] = quality['decodedSegments']
        return [], True, quality
    if stock_phrase(text, audio_seconds):
        quality['stockPhraseDrops'] += 1
        quality['droppedSegments'] = quality['decodedSegments']
        return [], True, quality
    if not text:
        kept = []
    # A partly accepted result is useful speech, not a fully rejected turn.
    return kept, rejected and not text, quality


def segment_ends(kept, audio_ms):
    """Where each kept segment ends, for locking text in a rolling window. Ends past the audio are clamped to it,
    since Whisper decodes a padded 30 s window. A segment without a valid end, or past the 64-entry or
    4000-character bounds, ends the list, so the caller never locks text it cannot place."""
    out, chars, previous = [], 0, 0
    for segment in kept:
        end, text = segment['end'], segment['text']
        if isinstance(end, bool) or not isinstance(end, (int, float)) or not math.isfinite(end) or end < 0:
            break
        end_ms = min(round(end * 1000), math.floor(audio_ms))
        chars += len(text)
        if end_ms < previous or len(out) == 64 or chars > 4000:
            break
        previous = end_ms
        out.append({'endMs': end_ms, 'text': text})
    return out


def accepted_text(result):
    text, rejected, _ = accepted_result(result)
    return text, rejected
