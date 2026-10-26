"""Deterministic transparent scoring; no model judge and no training on references."""
import unicodedata


def units(text, language):
    text = unicodedata.normalize('NFKC', text).casefold()
    # Punctuation is a word boundary for EN, removed for JA. Preserve kana/kanji and numbers.
    text = ''.join(' ' if unicodedata.category(c)[0] in ('P', 'S', 'Z') else c for c in text)
    return text.split() if language == 'en' else list(''.join(text.split()))


def distance(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, a in enumerate(reference, 1):
        current = [i]
        for j, b in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j-1] + (a != b)))
        previous = current
    return previous[-1]


def edit_counts(reference, hypothesis, language):
    """One deterministic minimum-edit alignment; ties prefer substitution, deletion, insertion."""
    ref, hyp = units(reference, language), units(hypothesis, language)
    # Tuples: total, substitutions, deletions, insertions.
    previous = [(j, 0, 0, j) for j in range(len(hyp) + 1)]
    for i, a in enumerate(ref, 1):
        current = [(i, 0, i, 0)]
        for j, b in enumerate(hyp, 1):
            if a == b:
                current.append(previous[j - 1])
            else:
                diagonal, above, left = previous[j - 1], previous[j], current[-1]
                choices = [(diagonal[0] + 1, diagonal[1] + 1, diagonal[2], diagonal[3]),
                           (above[0] + 1, above[1], above[2] + 1, above[3]),
                           (left[0] + 1, left[1], left[2], left[3] + 1)]
                current.append(min(choices, key=lambda value: value[0]))
        previous = current
    total, substitutions, deletions, insertions = previous[-1]
    return {'errors': total, 'substitutions': substitutions, 'deletions': deletions, 'insertions': insertions,
            'referenceUnits': len(ref)}


def score(reference, hypothesis, language):
    ref, hyp = units(reference, language), units(hypothesis, language)
    errors = distance(ref, hyp)
    return {'metric': 'WER' if language == 'en' else 'CER', 'errors': errors,
            'referenceUnits': len(ref), 'rate': errors / len(ref) if ref else None}
