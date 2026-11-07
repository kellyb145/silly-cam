// Silly Cam end-to-end check.
// Serves ../site, feeds Chromium a fake camera clip made from a portrait photo, clicks Start,
// walks every filter, screenshots each into ./shots, checks the face is found, takes a photo,
// confirms the service worker cached everything, and fails on page errors or any request that
// leaves the test server's origin.
//
//   cd test && npm install && node run.mjs
//
// Needs the Chromium that Playwright installs (any `chromium-*` under %LOCALAPPDATA%\ms-playwright),
// or set SILLYCAM_CHROME to a chrome.exe path.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', 'site');
// SILLYCAM_SHOTS: screenshot folder (default test/shots). SILLYCAM_FILTERS: comma list of filter ids
// to exercise (default all). SILLYCAM_FACES=2: put two copies of the portrait in the fake camera frame.
// SILLYCAM_VARIANTS=1: also screenshot every variant of filters that have them (<id>-v<N>.png).
const SHOTS = process.env.SILLYCAM_SHOTS ? path.resolve(process.env.SILLYCAM_SHOTS) : path.join(HERE, 'shots');
const ONLY = (process.env.SILLYCAM_FILTERS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FACES = Number(process.env.SILLYCAM_FACES || 1);
const VARIANTS = process.env.SILLYCAM_VARIANTS === '1';
const PORTRAIT = path.join(HERE, 'portrait.jpg');
const PORTRAIT_URL = 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(path.join(SITE, 'icons'), { recursive: true });

function findChrome() {
  if (process.env.SILLYCAM_CHROME) return process.env.SILLYCAM_CHROME;
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(base)) throw new Error('No Playwright browsers found; set SILLYCAM_CHROME');
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    for (const sub of ['chrome-win64', 'chrome-win']) {
      const exe = path.join(base, d, sub, 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error('No chrome.exe under ' + base + '; set SILLYCAM_CHROME');
}
const EXE = findChrome();

if (!fs.existsSync(PORTRAIT)) {
  console.log('downloading test portrait from', PORTRAIT_URL);
  const res = await fetch(PORTRAIT_URL);
  if (!res.ok) throw new Error('portrait download failed: ' + res.status);
  fs.writeFileSync(PORTRAIT, Buffer.from(await res.arrayBuffer()));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.json': 'application/json', '.md': 'text/markdown',
};
// Apply site/_headers the way Netlify does, so the Content-Security-Policy is exercised here too.
function loadHeaderRules() {
  const rules = [];
  const txt = fs.existsSync(path.join(SITE, '_headers')) ? fs.readFileSync(path.join(SITE, '_headers'), 'utf8') : '';
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (/^\s/.test(raw)) { if (cur) { const i = raw.indexOf(':'); cur.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim(); } }
    else { cur = { pattern: raw.trim(), headers: {} }; rules.push(cur); }
  }
  return rules;
}
const HEADER_RULES = loadHeaderRules();
function headersFor(p) {
  const out = {};
  for (const r of HEADER_RULES) {
    const ok = r.pattern === p || (r.pattern.endsWith('/*') && p.startsWith(r.pattern.slice(0, -1)));
    if (ok) Object.assign(out, r.headers);
  }
  return out;
}
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const extra = headersFor(p);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(SITE, '.' + p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { console.log('404', p); res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...extra });
  fs.createReadStream(file).pipe(res);
});
// SILLYCAM_URL=https://host/path runs the same checks against a deployed copy instead of site/.
const REMOTE = (process.env.SILLYCAM_URL || '').replace(/\/$/, '');
let origin;
if (REMOTE) {
  origin = REMOTE;
  console.log('testing the live site at', origin, 'with', EXE);
} else {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log('serving', SITE, 'at', origin, 'with', EXE);
}

// ---- step 1: icons and the fake-camera clip, rendered by Chromium's canvas
const b0 = await chromium.launch({ executablePath: EXE, headless: true });
const p0 = await b0.newPage();
await p0.goto(origin + '/');
for (const size of REMOTE ? [] : [512, 192, 180].filter((s) => !fs.existsSync(path.join(SITE, 'icons', `icon-${s}.png`)))) {
  const dataUrl = await p0.evaluate((size) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#ff5c8a'); g.addColorStop(1, '#5b2bd6');
    const r = size * 0.22;
    x.beginPath(); x.moveTo(r, 0); x.lineTo(size - r, 0); x.quadraticCurveTo(size, 0, size, r); x.lineTo(size, size - r);
    x.quadraticCurveTo(size, size, size - r, size); x.lineTo(r, size); x.quadraticCurveTo(0, size, 0, size - r); x.lineTo(0, r);
    x.quadraticCurveTo(0, 0, r, 0); x.closePath(); x.fillStyle = g; x.fill();
    x.fillStyle = '#ffd23f'; x.beginPath(); x.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2); x.fill();
    x.font = `${Math.round(size * 0.46)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#000';
    x.fillText('🤪', size / 2, size / 2 + size * 0.03);
    return c.toDataURL('image/png');
  }, size);
  fs.writeFileSync(path.join(SITE, 'icons', `icon-${size}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
}
const mjpeg = path.join(HERE, FACES === 2 ? 'faces2.mjpeg' : 'face.mjpeg');
if (!fs.existsSync(mjpeg)) {
  const portraitB64 = fs.readFileSync(PORTRAIT).toString('base64');
  const frameUrl = await p0.evaluate(async ({ b64, faces }) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 800;
    const x = c.getContext('2d');
    x.fillStyle = '#556'; x.fillRect(0, 0, 640, 800);
    if (faces === 2) {
      // two people sharing the frame: the second one mirrored and a little smaller, like two kids
      // leaning into a selfie; faces are roughly a quarter of the frame width each
      const s = 560 / img.height, w = img.width * s, h = 560;
      x.drawImage(img, -40, 120, w, h);
      x.save(); x.translate(640, 0); x.scale(-1, 1);
      x.drawImage(img, -20, 230, w * 0.9, h * 0.9);
      x.restore();
    } else {
      const s = Math.max(640 / img.width, 800 / img.height);
      const w = img.width * s, h = img.height * s;
      x.drawImage(img, (640 - w) / 2, (800 - h) / 2, w, h);
    }
    return c.toDataURL('image/jpeg', 0.92);
  }, { b64: portraitB64, faces: FACES });
  const frame = Buffer.from(frameUrl.split(',')[1], 'base64');
  const tmp = mjpeg + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, Buffer.concat(Array(60).fill(frame)));
  fs.renameSync(tmp, mjpeg);
  console.log('fake camera clip written', mjpeg, frame.length, 'bytes/frame');
}
await b0.close();

// ---- step 2: the real run with a fake camera
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${mjpeg}`,
    '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, permissions: ['camera'] });
const page = await context.newPage();
const problems = [];
const requests = new Set();
page.on('console', (m) => {
  const txt = m.text();
  if (/^(W\d{4}|INFO:)/.test(txt)) return;                 // MediaPipe's own info chatter
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, txt.slice(0, 300));
  if (m.type() === 'error') problems.push('console error: ' + txt.slice(0, 300));
});
page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('[pageerror]', e.message); });
page.on('request', (r) => requests.add(r.url()));

await page.goto(origin + '/');
await page.screenshot({ path: path.join(SHOTS, '00-start.png') });
await page.click('#startBtn');
await page.waitForFunction(() => window.__sillycam && window.__sillycam.state.started, null, { timeout: 20000 });
await page.waitForFunction(() => !['loading', 'idle'].includes(window.__sillycam.state.modelStatus), null, { timeout: 180000 });
const model = await page.evaluate(() => ({ status: window.__sillycam.state.modelStatus, delegate: window.__sillycam.debug.delegate, video: [document.getElementById('cam').videoWidth, document.getElementById('cam').videoHeight] }));
console.log('model:', JSON.stringify(model));
if (model.status !== 'ready') problems.push('face model status ' + model.status);

const results = [];
const allFilters = await page.evaluate(() => window.__sillycam.filters);
const unknown = ONLY.filter((id) => !allFilters.includes(id));
if (unknown.length) problems.push('unknown filter ids requested: ' + unknown.join(', '));
const filters = ONLY.length ? allFilters.filter((id) => ONLY.includes(id)) : allFilters;
const variantCounts = await page.evaluate(() => Object.fromEntries(window.__sillycam.variantCounts()));
for (const id of filters) {
  await page.evaluate((id) => window.__sillycam.setFilter(id), id);
  const f0 = await page.evaluate(() => window.__sillycam.debug.frames);
  await page.waitForTimeout(id.startsWith('game') ? 5500 : 700);   // games count down ~3 s before play starts
  const r = await page.evaluate((id) => ({ id, faces: window.__sillycam.faceCount(), frames: window.__sillycam.debug.frames }), id);
  r.framesDrawn = r.frames - f0;
  results.push(r);
  await page.screenshot({ path: path.join(SHOTS, `${id}.png`) });
  if (VARIANTS && variantCounts[id] > 1) {
    for (let v = 1; v < variantCounts[id]; v++) {
      await page.evaluate(() => window.__sillycam.nextVariant());
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, `${id}-v${v}.png`) });
    }
    await page.evaluate(() => window.__sillycam.nextVariant());   // back to variant 0
  }
}
console.table(results.map((r) => ({ id: r.id, faces: r.faces, frames: r.framesDrawn })));
const faceIds = ['puppy', 'kitty', 'bunny', 'shades', 'crown', 'rainbow', 'bigeyes', 'bighead',
  'fox', 'catface', 'tiger', 'panda', 'lion', 'dogface', 'grandpa', 'grandma', 'baby', 'wigs', 'haircolor'];
for (const r of results) {
  if (r.framesDrawn < 5) problems.push(`filter ${r.id} drew only ${r.framesDrawn} frames`);
  if (faceIds.includes(r.id) && r.faces < 1) problems.push(`filter ${r.id} found no face`);
  if (faceIds.includes(r.id) && FACES === 2 && r.faces < 2) problems.push(`filter ${r.id} found ${r.faces} face(s) with two in frame`);
}

// photo flow
await page.evaluate(() => window.__sillycam.setFilter('puppy'));
await page.waitForTimeout(400);
await page.click('#snapBtn');
await page.waitForSelector('#photo:not([hidden])', { timeout: 10000 });
await page.screenshot({ path: path.join(SHOTS, 'zz-photo.png') });
const photoOk = await page.evaluate(() => { const i = document.getElementById('photoImg'); return i.naturalWidth > 0 && i.src.startsWith('blob:'); });
if (!photoOk) problems.push('photo review did not show a picture');
await page.click('#backBtn');

// service worker + cache
const sw = await page.evaluate(async () => {
  const timeout = new Promise((r) => setTimeout(() => r({ ready: false }), 30000));
  const run = (async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 60; i++) {
      const keys = await caches.keys();
      if (keys.length) { const c = await caches.open(keys[0]); const ks = await c.keys(); if (ks.length >= 18) return { ready: true, cache: keys[0], entries: ks.length }; }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { ready: true, cache: 'incomplete' };
  })();
  return Promise.race([run, timeout]);
});
console.log('service worker:', JSON.stringify(sw));
if (!sw.ready || sw.cache === 'incomplete') problems.push('service worker cache incomplete: ' + JSON.stringify(sw));

const siteOrigin = new URL(origin).origin;   // blob: URLs carry the origin only, never the path
const foreign = [...requests].filter((u) => !u.startsWith(origin) && !u.startsWith('blob:' + siteOrigin) && !u.startsWith('data:'));
if (foreign.length) problems.push('foreign requests: ' + foreign.join(', '));
console.log('requests:', requests.size, 'foreign:', foreign.length);

await browser.close();
if (!REMOTE) server.close();
if (problems.length) { console.log('\nPROBLEMS:'); for (const p of problems) console.log(' -', p); process.exit(1); }
console.log('\nALL CHECKS PASSED');
