import unittest
from prefix_cache import MAX_PREFIXES, Prefixes, common


class PrefixesTest(unittest.TestCase):
    def test_common_prefix_length(self):
        self.assertEqual(common([1, 2, 3], [1, 2, 4]), 2)
        self.assertEqual(common([1, 2], [1, 2, 3]), 2)
        self.assertEqual(common([], [1]), 0)

    def test_a_prefix_is_learned_from_two_prompts_and_reused_by_the_third(self):
        head = list(range(100))
        p = Prefixes()
        self.assertEqual(p.plan(head + [900, 901]), (None, 0, 0))  # nothing to compare with yet
        self.assertEqual(p.plan(head + [800]), (None, 0, 100))  # shares 100 tokens with the first
        key, evicted = p.add(head)
        self.assertEqual(evicted, [])
        self.assertEqual(p.plan(head + [700, 701, 702]), (key, 100, 0))

    def test_a_longer_shared_start_becomes_its_own_prefix_and_the_longest_match_wins(self):
        system, glossary = list(range(100)), list(range(200, 280))
        p = Prefixes()
        p.plan(system + [1, 1]); p.plan(system + [2, 2])
        short, _ = p.add(system)
        self.assertEqual(p.plan(system + glossary + [5]), (short, 100, 0))
        self.assertEqual(p.plan(system + glossary + [6]), (short, 100, 180))  # extend the stored 100 to 180
        long, _ = p.add(system + glossary)
        self.assertEqual(p.plan(system + glossary + [7]), (long, 180, 0))
        self.assertEqual(p.plan(system + [9]), (short, 100, 0))  # the other direction still has its shorter prefix
        # A few more shared tokens are not worth another stored state.
        self.assertEqual(p.plan(system + glossary + [7, 8, 9, 1]), (long, 180, 0))

    def test_short_shared_starts_are_not_stored_and_a_prefix_never_covers_the_whole_prompt(self):
        p = Prefixes()
        p.plan(list(range(30)) + [1])
        self.assertEqual(p.plan(list(range(30)) + [2]), (None, 0, 0))
        q = Prefixes()
        whole = list(range(100))
        q.plan(whole)
        self.assertEqual(q.plan(whole), (None, 0, 99))  # the same prompt again: one token is left to generate from
        key, _ = q.add(whole[:99])
        self.assertEqual(q.plan(whole), (key, 99, 0))
        r = Prefixes()
        r.plan(whole + [1]); r.plan(whole + [2]); r.add(whole)
        self.assertEqual(r.plan(whole), (None, 0, 99))  # the stored 100 would leave nothing to generate from

    def test_the_least_recently_used_prefix_is_evicted(self):
        p = Prefixes()
        keys = [p.add([i] * 100)[0] for i in range(MAX_PREFIXES)]
        p.plan([0] * 100 + [5])  # touches the first
        _, evicted = p.add([9] * 100)
        self.assertEqual(evicted, [keys[1]])


if __name__ == '__main__':
    unittest.main()
