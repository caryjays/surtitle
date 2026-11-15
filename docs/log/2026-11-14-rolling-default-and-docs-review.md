# Rolling becomes the default; a review of the docs

2026-11-14. One decision by the maintainer and a pass over the wiki. No measurements, no paid calls.

## Rolling is the default

`LOCAL_SEGMENTATION` defaults to `rolling`; `turns` remains, by the variable or the console's Session panel while capture is off. The operator page lists Rolling first and no longer labels it experimental. Every gate run, replay and microphone session since 2026-11-06 used rolling, and it is ahead of turns on every held-out measure in [the pair of runs](2026-11-11-outlier-talk-and-settle-pair.md). Gate runs measure rolling; turns is measured only for comparison.

Not verified: a microphone session started without the variable. The fake-provider tests and browser check set the segmentation themselves, so they do not exercise the default.

## What the review found and fixed

`pnpm docs:check` passed throughout; it does not catch a page that is current against its sources and wrong about the project.

- Status had grown to three times the length the practices page asks for, mostly dated narrative with measurements. It is rewritten as a present-tense page: what runs, a table of the gate's six parts, the Spanish pilot, known limits, open problems, what is not verified, next steps. The history it carried is in the entries it links.
- Rolling was called experimental in overview, recognition, architecture, the README, the example environment file and the operator page.
- Operations said no OBS rehearsal had been performed, and described rolling as rehearsed once; its listening procedure covered only listen mode and one pair.
- Recognition gave the settle time as 1 s; it is 0.5 s.
- The roadmap listed five gate parts and one filled language profile; the gate has six parts and three languages have profiles.
- AGENTS.md said Japanese was the only pair, that one cloud translator was implemented, and that no GitHub remote was assumed. The repository is public, so pushing is named there as publishing.
- Lanes called the faint-level sweep planned.
- Gates now says a run needs mains power and a Mac kept awake, and that a run made on a loaded or sleeping machine is void, which is different from rerunning for a better draw. It said held-out outputs go under `private/`; they go beside the manifest, under `.local/` for the public held-out sets.

## Left as it is

Recognition's description of rolling is one paragraph of about 1,100 words. It matches the code where checked and is hard to find a rule in; splitting it is a rewrite of its own.

## Checks

`pnpm check` and `pnpm test:browser` pass.
