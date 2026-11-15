# Corrections after a review of the branch

2026-11-15. A review of the `french-italian-portuguese` branch against the code and the stored gate results. The results in the branch's entries match the stored scores; what follows was corrected. No code changed, no measurements, no paid calls.

## Dates follow the Mac's clock

By the maintainer's decision, dates in the docs follow the Mac's clock, which also dates the commits. The session that added French, Italian and Portuguese dated its work a day later than the Mac: the gate files, the stock-phrase sweeps and all three gate runs are of 2026-11-14 by the Mac's clock, as their result folder names show. That entry is renamed to [2026-11-14-french-italian-portuguese.md](2026-11-14-french-italian-portuguese.md) and its date line set to match, before the branch is published; its decision in [decisions](../wiki/decisions.md) and the gates page now read 2026-11-14. The gate files were written about fifteen minutes before the first smoke run, so the order the entry states holds. Two wiki pages that carried a verified date later than the Mac's clock are set to today.

## An edited entry restored

The branch had edited [the entry of 2026-11-14 on rolling as the default](2026-11-14-rolling-default-and-docs-review.md), which was already published, to add a second decision. That entry is restored as published. The decision it carried is recorded here:

The maintainer overruled the roadmap's rule that no language starts before Japanese passes, on 2026-11-14. Japanese recognition tuning reached its stop rule on 2026-11-11, and what is open in its gate is the paid translation eval and the maintainer's own reviews. Each language still ships only by passing its own gate, written before its measurements. French and Italian were named as next, in the Spanish pilot's shape.

## An unmeasured target

The Spanish, French, Italian and Portuguese gate runs score the share of held-out rows rated major or hallucinated as not measured, since no rows have been rated. The status page and the overview said Spanish and Italian pass every accuracy target; they now say every measured target. The statement in [the Spanish pilot](2026-11-11-spanish-pilot.md) and in [the entry of 2026-11-14](2026-11-14-french-italian-portuguese.md) is to be read the same way.

## The `review/` folder

The rule in `AGENTS.md` lets only `scripts/local/review_export.py` write the ignored `review/` folder. It also held the output of the scratch harness that re-translated two talks with context variants, described in [the read-through](2026-11-14-translation-read-through.md). That output came from the same public talks; it is moved to the ignored `.local/experiments/translation-context/`, so the folder holds only exports again.

## Wording

The recognition page said the pair retry checks Latin letters for English and Spanish. The check applies to every word-scored profile, so to French, Italian and Portuguese as well.

## Verification

`pnpm check` passes.
