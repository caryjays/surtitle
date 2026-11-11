"""Which already-computed prompt prefix a new prompt can reuse. Pure bookkeeping over token lists; the worker owns the
model state each prefix stands for.

Translation prompts share a long fixed start: the instructions, then the direction and glossary. A prefix is learned
when two prompts are seen to share it, so nothing about the prompt's layout is assumed here."""

MIN_PREFIX = 64  # tokens; a shorter shared start is not worth a stored state
MAX_PREFIXES = 4
RECENT = 4


def common(a, b):
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


class Prefixes:
    """plan(tokens) returns (key, length, learn). Start from the stored prefix `key` of `length` tokens, or from nothing
    when key is None. When learn is not zero, extend that start to `learn` tokens and store it with add() before
    generating; otherwise generate from the start as it is."""

    def __init__(self):
        self.stored = {}  # key -> token list, in order of last use
        self.recent = []
        self.next = 0

    def plan(self, tokens):
        tokens = list(tokens)
        # A prefix must leave at least one token to generate from.
        usable = [(len(p), key) for key, p in self.stored.items() if len(p) < len(tokens) and tokens[:len(p)] == p]
        best_length, best = max(usable, default=(0, None))
        learn = max((min(common(tokens, other), len(tokens) - 1) for other in self.recent), default=0)
        self.recent = (self.recent + [tokens])[-RECENT:]
        if best is not None:
            self.stored[best] = self.stored.pop(best)
        # A longer shared start is worth storing only when it adds a real stretch to what is stored already.
        return best, best_length, learn if learn >= best_length + MIN_PREFIX else 0

    def add(self, tokens):
        """Stores a prefix and returns (key, evicted keys)."""
        key, self.next = self.next, self.next + 1
        self.stored[key] = list(tokens)
        evicted = list(self.stored)[:-MAX_PREFIXES]
        for old in evicted:
            del self.stored[old]
        return key, evicted
