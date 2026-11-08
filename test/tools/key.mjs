// Keys the flat studio background out of an animal portrait and fades everything below the chin away,
// writing a 512x512 WebP with alpha (for the site) and a PNG (to look at).
//   node key.mjs in.(png|jpg) out-basename chinY [lo hi]
//   chinY: the chin's vertical position as a fraction of the height; lo/hi: colour-distance thresholds (0..255)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const [,, inFile, outBase, chinYArg, loArg, hiArg] = process.argv;
const chinY = Number(chinYArg), lo = Number(loArg || 14), hi = Number(hiArg || 50);
const base = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const exe = path.join(base, dir, 'chrome-win64', 'chrome.exe');
const b = await chromium.launch({ executablePath: exe, headless: true });
const p = await b.newPage();
const mime = inFile.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
const res = await p.evaluate(async ({ data, chinY, lo, hi }) => {
  const img = new Image(); img.src = data; await img.decode();
  const W = img.width, H = img.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, W, H), d = id.data;
  // background colour: median of the border pixels
  const border = [];
  for (let i = 0; i < W; i++) { border.push(i, (H - 1) * W + i); }
  for (let j = 0; j < H; j++) { border.push(j * W, j * W + W - 1); }
  const med = (ch) => { const v = border.map((i) => d[i * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const dist = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = Math.max(Math.abs(d[i * 4] - bg[0]), Math.abs(d[i * 4 + 1] - bg[1]), Math.abs(d[i * 4 + 2] - bg[2]));
  // flood fill from the border through background-like pixels, so grey fur inside the head is kept
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (const i of border) if (dist[i] < hi && !seen[i]) { seen[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), px = i % W, py = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (!seen[n] && dist[n] < hi) { seen[n] = 1; stack.push(n); }
    }
  }
  const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  let keyed = 0;
  for (let i = 0; i < W * H; i++) {
    let a = 1;
    if (seen[i]) { a = smooth((dist[i] - lo) / (hi - lo)); keyed++; }
    const y = ((i / W) | 0) / H;
    a *= 1 - smooth((y - (chinY + 0.03)) / 0.12);          // nothing below the chin
    if (a < 1) {
      // take the background's share back out of the colour so the fringe does not go grey
      for (let ch = 0; ch < 3; ch++) {
        const v = a > 0.02 ? (d[i * 4 + ch] - (1 - a) * bg[ch]) / a : d[i * 4 + ch];
        d[i * 4 + ch] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
    d[i * 4 + 3] = Math.round(a * 255);
  }
  x.putImageData(id, 0, 0);
  const o = document.createElement('canvas'); o.width = o.height = 512;
  const oc = o.getContext('2d'); oc.imageSmoothingQuality = 'high'; oc.drawImage(c, 0, 0, 512, 512);
  return { bg, keyedPct: Math.round((100 * keyed) / (W * H)), webp: o.toDataURL('image/webp', 0.9), png: o.toDataURL('image/png'), W, H };
}, { data: `data:${mime};base64,` + fs.readFileSync(inFile).toString('base64'), chinY, lo, hi });
await b.close();
fs.writeFileSync(outBase + '.webp', Buffer.from(res.webp.split(',')[1], 'base64'));
fs.writeFileSync(outBase + '.png', Buffer.from(res.png.split(',')[1], 'base64'));
console.log(`${path.basename(inFile)} ${res.W}x${res.H} bg rgb(${res.bg.join(',')}) keyed ${res.keyedPct}% -> ${outBase}.webp ${fs.statSync(outBase + '.webp').size} bytes`);
