# Silly Cam

Kid-friendly camera filters for iPhone and iPad (and any modern browser). Everything runs on the
device: the camera feed is drawn to a canvas, face props are tracked with a locally bundled model,
and the page makes no network requests after it loads. No account, no uploads, no analytics.

## Layout

| Path | Purpose |
| --- | --- |
| `site/index.html`, `site/style.css`, `site/app.js` | The whole app. Filters live in `app.js` (`FACE` and `WORLD` tables). |
| `site/vendor/` | MediaPipe Tasks Vision 1.2.2 (ESM bundle + WebAssembly), the `face_landmarker.task` model and the `hair_segmenter.tflite` model. Apache-2.0, Google. One patch in `vision_bundle.js`: the usage-logging client's `flush()` is a no-op, so the library never posts telemetry to `odml.pa.googleapis.com` (the page's Content-Security-Policy blocks it as well). Re-apply after any upgrade. |
| `site/sw.js`, `site/manifest.webmanifest`, `site/icons/` | Offline cache and Add-to-Home-Screen support. |
| `site/_headers` | Netlify-only headers (the same Content-Security-Policy is also a meta tag in `index.html`). |
| `.github/workflows/pages.yml` | Publishes `site/` to GitHub Pages on push to `main`. |
| `test/run.mjs` | End-to-end check with a fake camera (see below). Not deployed. |

## Hosting

iOS only opens the camera on an HTTPS page, so `site/` has to be served, not opened as a file.
Any static host works.

**GitHub Pages (the set-up here).** `.github/workflows/pages.yml` publishes `site/` on every push to
`main`. One-time setup from this folder:

```bash
git init -b main && git add -A && git commit -m "Silly Cam"
gh repo create silly-cam --public --source . --push
gh api -X POST repos/<github user>/silly-cam/pages -f build_type=workflow
```

The page is then at `https://<github user>.github.io/silly-cam/`.

**Netlify** also works with no repo: `netlify deploy --prod --dir site`, or drag the `site` folder onto
<https://app.netlify.com/drop>.

On the iPad: open the page in Safari, tap Share, then **Add to Home Screen**. It then opens
full-screen like an app and keeps working without internet.

## Updating

After changing any file, bump `VERSION` in `site/sw.js` so installed home-screen copies refresh.
Vendor files are served with Netlify's default revalidation (no long `max-age`), so a MediaPipe
upgrade under the same file names cannot mix old and new files in the cache.

Kill switch: if a deployed build is broken on devices, replace `site/sw.js` with the following and deploy.
Every device picks it up on its next online launch, drops the cache, and loads the page normally.

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then((clients) => clients.forEach((c) => c.navigate(c.url)))
));
```

## Test

```bash
cd test
npm install
node run.mjs
```

This serves `site/`, feeds Chromium a fake camera clip made from a portrait photo, clicks through every
filter, screenshots each one into `test/shots/`, takes a photo, checks the offline cache filled, and
fails if the page makes any request to a host other than the test server.

## Filters

The chip strip is grouped by the tab row: Animals (full-face masks in `site/filters-animals.js` plus
the ear-and-nose props), Silly (props), Games (`site/games.js`: Ring Nose, Snack Catch, Dodge; 30-second
rounds, any face in frame can play), Looks (`site/filters-age.js`: Grandpa, Grandma, Baby; Wigs in
`site/filters-wigs.js`; Hair Colour, which recolours real hair with MediaPipe's hair segmenter) and
Effects (whole-picture effects). Up to three faces are tracked at once.

A filter with `variants: [...]` cycles through them when its chip is tapped again (Wigs, Hair Colour).

## Adding a filter

Face filters draw in face units (origin between the eyes, 1 unit = face width, +y down) with the
helpers in `site/draw.js`; whole-picture effects receive the canvas width, height and time; games and
other scene filters implement `scene(ctx, faces, t, dt, W, H, variant, env)` and use `env.hud(text)`
for the score strip (DOM, because the canvas is mirrored). Add the object to the matching pack file or
to `FILTERS` in `app.js`, and add any new file to the lists in `sw.js`.
