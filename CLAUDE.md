# Silly Cam (kid-camera-filters)

Kid-friendly camera filters for Kelly's children's iPhones and iPads. Everything runs on the device;
the page must never make a request to any host but its own after load. No accounts, no analytics,
no uploads. Keep it that way: no fonts, CDNs, images or share targets from other hosts.

## Layout

- `site/` is the whole deployable page: `index.html`, `style.css`, `app.js`, `sw.js`,
  `manifest.webmanifest`, `_headers`, `icons/`, `vendor/` (MediaPipe Tasks Vision 1.2.2 ESM bundle,
  its WASM loader and `face_landmarker.task`, all Apache-2.0 from Google, unmodified).
- `test/` is the Playwright end-to-end check. It is not deployed.
- Filters are two tables in `site/app.js`: `FACE` (drawn in face units: origin between the eyes,
  1 unit = face width, +y down) and `WORLD` (whole-picture effects). Add a row to `FILTERS` to show one.

## Commands

```bash
cd test && npm install          # once
node run.mjs                    # serves site/, fake camera, screenshots to test/shots/, exits 1 on problems
```

The check needs the Chromium that Playwright installs under `%LOCALAPPDATA%\ms-playwright`
(or `SILLYCAM_CHROME=<path to chrome.exe>`). It downloads a test portrait on first run.

## Deploy (GitHub Pages, static)

`.github/workflows/pages.yml` publishes `site/` on every push to `main`. First-time setup (outward-facing,
Kelly's go needed; the repo must be public on a free GitHub plan):

```bash
git init -b main && git add -A && git commit -m "Silly Cam"
gh repo create silly-cam --public --source . --push
gh api -X POST repos/kellyb145/silly-cam/pages -f build_type=workflow
```

The page then lives at `https://kellyb145.github.io/silly-cam/`. All paths in `site/` are relative, so the
subfolder URL is fine. GitHub Pages cannot send headers, so the Content-Security-Policy lives in a
`<meta http-equiv>` tag in `index.html` as well as in `site/_headers` (the latter only matters on Netlify,
which also works: `netlify deploy --prod --dir site`).

## Rules learned the hard way

- Bump `VERSION` in `site/sw.js` on every change, or home-screen copies keep the old build.
- Any CSS rule that sets `display` on an element toggled with the `hidden` attribute needs the global
  `[hidden] { display: none !important }` rule kept in `style.css`; without it an invisible panel
  swallowed the start button's taps.
- iOS opens the camera only on HTTPS (or localhost), so the page cannot be opened as a file.
- Claude artifacts cannot host this: the account has no camera capability and the artifact CSP blocks
  the WASM fetch. That is why it lives on Netlify.
- The first face detection compiles shaders; `loadModel()` warms up on a blank frame so the first
  filter tap does not freeze the picture.
