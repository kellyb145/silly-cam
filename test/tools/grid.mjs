// Lays images out on a labelled 0.0–1.0 grid so landmark positions can be read off by eye.
//   node grid.mjs out.png img1.png img2.png ...
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const [,, out, ...imgs] = process.argv;
const base = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const exe = path.join(base, dir, 'chrome-win64', 'chrome.exe');
const b = await chromium.launch({ executablePath: exe, headless: true });
const p = await b.newPage();
const data = imgs.map((f) => 'data:image/' + (f.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(f).toString('base64'));
const dataUrl = await p.evaluate(async (data) => {
  const S = 500, M = 30, cols = 2, rows = Math.ceil(data.length / cols);
  const c = document.createElement('canvas'); c.width = cols * (S + M * 2); c.height = rows * (S + M * 2);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < data.length; i++) {
    const img = new Image(); img.src = data[i]; await img.decode();
    const ox = (i % cols) * (S + M * 2) + M, oy = Math.floor(i / cols) * (S + M * 2) + M;
    x.drawImage(img, ox, oy, S, S);
    x.font = '12px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let k = 0; k <= 20; k++) {
      const t = k / 20, major = k % 2 === 0;
      x.strokeStyle = major ? 'rgba(0,255,255,0.9)' : 'rgba(255,0,255,0.5)'; x.lineWidth = major ? 1 : 0.5;
      x.beginPath(); x.moveTo(ox + t * S, oy); x.lineTo(ox + t * S, oy + S); x.stroke();
      x.beginPath(); x.moveTo(ox, oy + t * S); x.lineTo(ox + S, oy + t * S); x.stroke();
      if (major) {
        x.fillStyle = '#000';
        x.fillText(t.toFixed(1), ox + t * S, oy - 12);
        x.fillText(t.toFixed(1), ox - 16, oy + t * S);
      }
    }
    x.fillStyle = '#c00'; x.font = 'bold 14px sans-serif'; x.textAlign = 'left'; x.fillText('#' + i, ox + 4, oy + S + 14);
  }
  return c.toDataURL('image/png');
}, data);
fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
await b.close();
console.log('wrote', out);
