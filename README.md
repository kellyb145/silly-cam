# Silly Cam

Kid-friendly camera filters for iPhone and iPad (and any modern browser). Everything runs on the
device: the camera feed is drawn to a canvas, face props are tracked with a locally bundled model,
and the page makes no network requests after it loads. No account, no uploads, no analytics.

## Layout

| Path | Purpose |
| --- | --- |
| `site/index.html`, `site/style.css`, `site/app.js` | The whole app. Filters live in `app.js` (`FACE` and `WORLD` tables). |
| `site/vendor/` | MediaPipe Tasks Vision 1.2.2 (ESM bundle + WebAssembly) and the `face_landmarker.task` model. Apache-2.0, Google. |
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

## Adding a filter

Add a function to `FACE` (drawn in face units: origin between the eyes, 1 unit = face width, +y down)
or `WORLD` (receives the canvas width, height and time), then add a row to `FILTERS` with an emoji
and a name.
