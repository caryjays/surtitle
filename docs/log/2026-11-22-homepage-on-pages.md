# Homepage on GitHub Pages

2026-11-22

## Change

The maintainer approved publishing the homepage. GitHub Pages serves `site/` at <https://caryjays.github.io/surtitle/>. Branch publishing serves only the repository root or `docs/`, so `.github/workflows/pages.yml` uploads `site/` unchanged and deploys it on a push to `main` that changes the folder or the workflow, or when run by hand. It checks out only `site/`, builds nothing, and holds read access to contents plus the two permissions Pages deployment needs. The repository's Pages source is set to GitHub Actions.

The page gained a canonical link, its address in the sharing metadata, and a 1200 × 630 preview image, `site/og.png`, rendered from the page's own demo artwork. `AGENTS.md`, the README, the status page and `site/README.md` now say that the homepage is hosted and that a push touching `site/` redeploys it. The caption service is not hosted and nothing about it changed.

## Verification

The first run of the workflow succeeded. The address, the stylesheet, the script, the icon and the preview image each returned 200 with the expected content type, and the served page carries the fixes of the earlier review. The live page was not opened in a browser, and no sharing preview was checked on a service that renders one.

## Handoff

No custom domain is set. If the host or address changes, update the canonical link and the `og:` addresses in `site/index.html`, and `site/README.md`.
