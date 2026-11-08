# Silly Cam (kid-camera-filters)

Kid-friendly camera filters for Kelly's children's iPhones and iPads. Everything runs on the device;
the page must never make a request to any host but its own after load. No accounts, no analytics,
no uploads. Keep it that way: no fonts, CDNs, images or share targets from other hosts.

## Layout

- `site/` is the whole deployable page: `index.html`, `style.css`, `app.js`, `sw.js`,
  `manifest.webmanifest`, `_headers`, `icons/`, `vendor/` (MediaPipe Tasks Vision 1.2.2 ESM bundle,
  its WASM loader, `face_landmarker.task` and `hair_segmenter.tflite`, all Apache-2.0 from Google).
- `vendor/vision_bundle.js` carries ONE patch: the telemetry client's `flush(t,e){` now starts with
  `this.i=[];t?.();return;` so MediaPipe never posts usage logs to `odml.pa.googleapis.com` (found
  2026-11-07 when the segmenter triggered it; the CSP blocked it, the patch removes the attempt).
  Any MediaPipe upgrade must re-apply it and re-run the harness, which fails on a CSP violation.
- `test/` is the Playwright end-to-end check. It is not deployed.
- `site/app.js` is the engine (camera, face tracking, render loop, chips, tabs, hair segmentation);
  `site/draw.js` holds the shared drawing helpers and documents the face-unit coordinate system.
  Filter packs are separate files loaded with a tolerant dynamic import (a broken pack is skipped,
  the page still runs): `filters-animals.js` (full-face masks), `games.js` (scene filters with a
  score strip), `filters-age.js` (Grandpa/Grandma/Baby), `filters-wigs.js` (one filter with variants).
  `filters-photo.js` is the photo animal pack: a real animal picture (`animals/*.webp`, transparent
  background, chest faded out) stretched over the tracked face mesh by `mesh.js` (WebGL; `facemesh.json`
  is MediaPipe's canonical mesh with the eye and inner-mouth triangles removed so the real eyes and mouth
  show through), plus the whole head drawn flat behind it, lined up on the eyes. Each animal carries nine
  hand-read alignment points (eyes, nose, mouth corners, chin, top, face sides) that a thin-plate spline
  turns into per-landmark texture coordinates.
  Built-in props and whole-picture effects stay in `app.js` (`FACE`, `WORLD`), and `FILTERS` assigns
  every filter a group for the tab row.
- Adding a photo animal: generate a front-facing, symmetric portrait on a plain light background
  (Canva `generate-image` worked; its free plan has no background remover and hands back 200 px
  previews, so full size comes from placing the media on a design page and `export-design`), run
  `node test/tools/key.mjs in.png site/animals/<name> <chinY>` (flat background keyed out, 512 px WebP),
  read the nine points off `node test/tools/grid.mjs grid.png in.png`, add a `DEFS` entry in
  `filters-photo.js`, list the WebP in `sw.js` BIG (and raise the harness's cache count), add the id to
  the harness `faceIds`, then run `SILLYCAM_FILTERS=photo-<name> node test/run.mjs` and look at the shot.
- Filter object shape: `{ id, name, icon, group, face(c,g,t,v) | world(W,H,t,v) | scene(c,faces,t,dt,W,H,v,env), variants?, reset?(v), segment? }`.
  Tapping the active chip cycles `variants`. `segment: true` runs the hair segmenter and puts the
  mask in `env.hair`.
- The harness takes `SILLYCAM_FILTERS=a,b` (subset), `SILLYCAM_SHOTS=dir`, `SILLYCAM_VARIANTS=1`,
  `SILLYCAM_FACES=2` (two faces in the fake camera) and `SILLYCAM_URL=https://…` (test a deployed copy).
- `test/hairdiag.mjs` is the Hair Colour check: five real scenes (Creative Commons photos, downloaded on
  first run into the ignored `test/scenes/`) go through the page as the fake camera and it reports, per
  scene, how much mask weight lands away from any detected head (`farPct`, should stay in low single
  digits) and how much of the model's sure hair around the head the final mask keeps (`coreKeep`, should
  stay near 100). `SILLYCAM_SEG=512` changes the model input width, `SILLYCAM_THRESHOLDS=1` adds the
  confidence-threshold columns. Run it after any change to `segmentHair`/`gateHair` or a MediaPipe upgrade.

## Commands

```bash
cd test && npm install          # once
node run.mjs                    # serves site/, fake camera, screenshots to test/shots/, exits 1 on problems
```

The check needs the Chromium that Playwright installs under `%LOCALAPPDATA%\ms-playwright`
(or `SILLYCAM_CHROME=<path to chrome.exe>`). It downloads a test portrait on first run.

## Deploy (GitHub Pages, static)

Live since 2026-11-07 at `https://kellyb145.github.io/silly-cam/` from the public repo
`github.com/kellyb145/silly-cam`. `.github/workflows/pages.yml` publishes `site/` on every push to `main`,
so a deploy is: edit, bump `VERSION` in `site/sw.js`, run the test, commit, `git push`. Check the run with
`gh run list -R kellyb145/silly-cam`. To check a deployed copy end to end:
`SILLYCAM_URL=https://kellyb145.github.io/silly-cam node test/run.mjs`.

All paths in `site/` are relative, so the
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
- The hair segmenter confidently calls dark clothing, dark furniture and shadows "hair" (Kelly's kids'
  iPads, 2026-11-08: colour on the background, and wandering with two faces). Measured with
  `test/hairdiag.mjs`: a 512 input changed nothing and a stricter confidence cut removed real hair as
  fast as the spill. The fix is geometry: `gateHair()` keeps the mask inside a soft zone around each
  detected face (head volume plus hair hanging to the shoulders, widened toward the back of a turned
  head, with the neck-and-chest line cut out). No face in view means no hair colour, by design.
