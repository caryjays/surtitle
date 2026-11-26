"""Which tokens a reply must not use so that it holds no writing of the named kinds."""
import unicodedata


def holding(pieces, prefixes):
    """Ids of the tokens whose text holds a character whose Unicode name starts with one of the prefixes.

    pieces is every token decoded on its own. A token that is only part of a character's bytes decodes to no such
    character and is never listed, so a rare character built from byte tokens can still be generated."""
    prefixes, named = tuple(prefixes), {}

    def held(char):
        if char not in named:
            named[char] = unicodedata.name(char, '').startswith(prefixes)
        return named[char]
    return [i for i, piece in enumerate(pieces) if any(held(c) for c in piece)]
