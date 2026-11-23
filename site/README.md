# Project homepage

A standalone static introduction to Surtitle. `index.html`, `style.css`, `main.js`, `favicon.svg` and the share preview `og.png` are the complete website; no dependency installation or build is needed. All assets are local, the fonts are the system's, and the colors follow the system's light or dark setting. The caption illustration uses fixed example text and does not access a microphone, connect to the caption service, or call a model.

From the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory site
```

Open `http://127.0.0.1:4173`. Stop with Ctrl-C. Opening `index.html` directly also works; if clipboard access is unavailable, the copy controls select the text for manual copying.

Keep the setup commands aligned with `package.json` and `docs/wiki/operations.md`, and language claims aligned with `docs/wiki/status.md`. The default branch used by documentation links is `main`.

The site is separate from the local operator console and OBS overlay. GitHub Pages serves it at <https://caryjays.github.io/surtitle/>: `.github/workflows/pages.yml` uploads this folder as it is whenever a push to `main` changes it, so pushing here is publishing and needs the maintainer's approval. The address appears in the page's canonical link and sharing metadata; change those if the host changes.
