// Hair Colour mask diagnostic.
// Feeds realistic scenes (Creative Commons photos from Wikimedia Commons, downloaded on first run into
// test/scenes/, which is not committed) to the page as the fake camera, selects Hair Colour and measures
// how much of the hair mask lands where hair cannot be: outside a generous zone around every detected
// head. Writes <scene>.png (the page), <scene>-mask.png (the raw mask) and <scene>-overlay.png (mask in
// red over the picture) into test/shots-hair/.
//
//   cd test && node hairdiag.mjs [scene ...]        scenes: cafe classroom wall forest playground
//
// SILLYCAM_SHOTS overrides the output folder. SILLYCAM_CHROME points at a chrome.exe (see run.mjs).
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', 'site');
const SCENES_DIR = path.join(HERE, 'scenes');
const SHOTS = process.env.SILLYCAM_SHOTS ? path.resolve(process.env.SILLYCAM_SHOTS) : path.join(HERE, 'shots-hair');
fs.mkdirSync(SCENES_DIR, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

// crop = [x, y, w, h] as fractions of the source picture; width = fake camera width in pixels.
const C = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/';
const SCENES = {
  cafe: { // CC BY 2.0, "Chil Out Cafe New Orleans Christina Ayala 2008"
    url: C + 'a/ae/Chil_Out_Cafe_New_Orleans_Christina_Ayala_2008.jpg/960px-Chil_Out_Cafe_New_Orleans_Christina_Ayala_2008.jpg',
    crop: [0.22, 0.2, 0.70, 0.75], width: 800, note: 'woman + child, cluttered cafe, dark door behind the hair',
  },
  classroom: { // CC BY-SA 4.0, "Kearns' Chamber"
    url: C + "5/53/Kearns%27_Chamber.jpg/960px-Kearns%27_Chamber.jpg",
    crop: [0.15, 0, 0.60, 1], width: 800, note: 'three teens, cluttered classroom, webcam quality',
  },
  wall: { // CC BY 2.0, "321 365 - March 21, 2009"
    url: C + '2/2d/321_365_-_March_21%2C_2009_%283373614774%29.jpg/960px-321_365_-_March_21%2C_2009_%283373614774%29.jpg',
    crop: [0, 0.1, 1, 0.75], width: 640, note: 'long dark hair, plain wall with a shadow',
  },
  forest: { // CC BY-SA 4.0, "1SkoryaK11"
    url: C + 'a/ab/1SkoryaK11.jpg/960px-1SkoryaK11.jpg',
    crop: [0.2, 0.3, 0.6, 0.6], width: 600, note: 'very long hair against a dark forest',
  },
  playground: { // CC BY-SA 4.0, "Bro & Sis Love"
    url: C + '8/85/Bro_%26_Sis_Love.jpg/960px-Bro_%26_Sis_Love.jpg',
    crop: [0, 0, 0.7, 0.6], width: 800, note: 'girl with long hair holding a baby, tree trunk behind',
  },
};
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
for (const n of wanted) if (!SCENES[n]) { console.error('unknown scene', n, '- known:', Object.keys(SCENES).join(' ')); process.exit(2); }

function findChrome() {
  if (process.env.SILLYCAM_CHROME) return process.env.SILLYCAM_CHROME;
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(base)) throw new Error('No Playwright browsers found; set SILLYCAM_CHROME');
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) for (const sub of ['chrome-win64', 'chrome-win']) {
    const exe = path.join(base, d, sub, 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('No chrome.exe under ' + base + '; set SILLYCAM_CHROME');
}
const EXE = findChrome();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.tflite': 'application/octet-stream', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(SITE, '.' + p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

async function ensureScene(name) {
  const sc = SCENES[name];
  const jpg = path.join(SCENES_DIR, name + '.jpg');
  if (!fs.existsSync(jpg)) {
    console.log('downloading', name, 'from', sc.url);
    const res = await fetch(sc.url, { headers: { 'User-Agent': 'SillyCamTest/1.0 (local dev test images)' } });
    if (!res.ok) throw new Error('download failed ' + res.status);
    fs.writeFileSync(jpg, Buffer.from(await res.arrayBuffer()));
  }
  const clip = path.join(SCENES_DIR, name + '.mjpeg');
  if (!fs.existsSync(clip)) {
    const b = await chromium.launch({ executablePath: EXE, headless: true });
    const p = await b.newPage();
    await p.goto(origin + '/');
    const frameUrl = await p.evaluate(async ({ b64, crop, width }) => {
      const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
      const sx = crop[0] * img.width, sy = crop[1] * img.height, sw = crop[2] * img.width, sh = crop[3] * img.height;
      const c = document.createElement('canvas'); c.width = width; c.height = Math.round((width * sh) / sw) & ~1;
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.9);
    }, { b64: fs.readFileSync(jpg).toString('base64'), crop: sc.crop, width: sc.width });
    await b.close();
    const frame = Buffer.from(frameUrl.split(',')[1], 'base64');
    fs.writeFileSync(clip, Buffer.concat(Array(60).fill(frame)));
  }
  return clip;
}

const rows = [];
for (const name of wanted) {
  const clip = await ensureScene(name);
  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`,
      '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, permissions: ['camera'] });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/^(W\d{4}|INFO:)/.test(m.text())) console.log(`[${name} console.error]`, m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  await page.goto(origin + '/');
  await page.waitForFunction(() => window.__sillycam, null, { timeout: 20000 });
  await page.evaluate((seg) => { window.__sillycam.debug.keepHairConf = true; if (seg) window.__sillycam.state.segSize = seg; }, Number(process.env.SILLYCAM_SEG || 0));
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__sillycam && window.__sillycam.state.started, null, { timeout: 20000 });
  await page.waitForFunction(() => !['loading', 'idle'].includes(window.__sillycam.state.modelStatus), null, { timeout: 180000 });
  await page.evaluate(() => window.__sillycam.setFilter('haircolor'));
  await page.waitForFunction(() => window.__sillycam.env.hair && window.__sillycam.state.segStatus === 'ready', null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const s = window.__sillycam;
    const hair = s.env.hair, faces = s.state.faces;
    const { canvas: m, w, h } = hair;
    const d = m.getContext('2d').getImageData(0, 0, w, h).data;
    // One zone per detected head: a box 2.8 face widths wide, from 1.3 above the eye line to 3 below
    // (long hair hangs down). Mask weight outside every zone is bleed for certain.
    const heads = faces.map((lm) => {
      const L = lm[234], R = lm[454];
      const fw = Math.hypot((R.x - L.x) * w, (R.y - L.y) * h);
      return { cx: ((L.x + R.x) / 2) * w, cy: ((L.y + R.y) / 2) * h, fw };
    });
    let total = 0, far = 0, coreMass = 0;
    const inZone = (x, y) => heads.some((hd) => Math.abs(x - hd.cx) < 1.4 * hd.fw && y > hd.cy - 1.3 * hd.fw && y < hd.cy + 4.5 * hd.fw);
    const inCore = (x, y) => heads.some((hd) => Math.abs(x - hd.cx) < 1.0 * hd.fw && y > hd.cy - 1.1 * hd.fw && y < hd.cy + 0.4 * hd.fw);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = d[(y * w + x) * 4 + 3]; if (!a) continue;
      total += a;
      if (!inZone(x, y)) far += a;
      if (inCore(x, y)) coreMass += a;
    }
    // Raw confidences: how much of the sure-hair core and of the far bleed survives each threshold.
    const conf = s.debug.hairConf;
    const TH = [0.3, 0.5, 0.6, 0.7, 0.8, 0.9];
    const keep = TH.map(() => ({ core: 0, far: 0 }));
    let coreRef = 0, farRef = 0;
    if (conf && conf.w === w && conf.h === h) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = conf.data[y * w + x]; if (c <= 0.3) continue;
        const core = inCore(x, y), farP = !inZone(x, y);
        if (core && c > 0.5) coreRef++;
        if (farP && c > 0.5) farRef++;
        TH.forEach((t, i) => { if (c > t) { if (core) keep[i].core++; if (farP) keep[i].far++; } });
      }
    }
    const thresholds = Object.fromEntries(TH.map((t, i) => [t, `${coreRef ? Math.round((100 * keep[i].core) / coreRef) : 0}/${farRef ? Math.round((100 * keep[i].far) / farRef) : 0}`]));
    // coreKeep: how much of the model's sure hair around the head (confidence > 0.5) the final mask keeps.
    const coreKeep = coreRef ? Math.round((100 * coreMass) / 255 / coreRef) : 0;
    const video = document.getElementById('cam');
    const ov = document.createElement('canvas'); ov.width = w; ov.height = h;
    const oc = ov.getContext('2d');
    oc.drawImage(video, 0, 0, w, h);
    const red = document.createElement('canvas'); red.width = w; red.height = h;
    const rc = red.getContext('2d'); rc.drawImage(m, 0, 0); rc.globalCompositeOperation = 'source-in'; rc.fillStyle = '#ff2020'; rc.fillRect(0, 0, w, h);
    oc.globalAlpha = 0.6; oc.drawImage(red, 0, 0);
    oc.globalAlpha = 1; oc.strokeStyle = '#00e5ff'; oc.lineWidth = 2;
    for (const hd of heads) oc.strokeRect(hd.cx - 1.4 * hd.fw, hd.cy - 1.3 * hd.fw, 2.8 * hd.fw, 5.8 * hd.fw);
    const bg = document.createElement('canvas'); bg.width = w; bg.height = h;
    const bc = bg.getContext('2d'); bc.fillStyle = '#000'; bc.fillRect(0, 0, w, h); bc.drawImage(m, 0, 0);
    return { w, h, faces: faces.length, maskPx: Math.round(total / 255), farPx: Math.round(far / 255), farPct: total ? Math.round((1000 * far) / total) / 10 : 0,
      thresholds, coreKeep, mask: bg.toDataURL('image/png'), overlay: ov.toDataURL('image/png'), delegate: s.debug.delegate, video: [video.videoWidth, video.videoHeight] };
  });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  fs.writeFileSync(path.join(SHOTS, `${name}-mask.png`), Buffer.from(r.mask.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(SHOTS, `${name}-overlay.png`), Buffer.from(r.overlay.split(',')[1], 'base64'));
  rows.push({ scene: name, video: r.video.join('x'), mask: `${r.w}x${r.h}`, faces: r.faces, maskPx: r.maskPx, farPx: r.farPx, farPct: r.farPct, coreKeep: r.coreKeep, ...(process.env.SILLYCAM_THRESHOLDS ? Object.fromEntries(Object.entries(r.thresholds).map(([k, v]) => ['th' + k, v])) : {}) });
  await browser.close();
}
console.table(rows);
server.close();
