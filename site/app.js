// Silly Cam — kid-friendly camera filters that run entirely on the device.
// No network calls after the page loads. Face tracking: MediaPipe Face Landmarker
// (Apache-2.0), bundled in ./vendor and executed locally via WebAssembly.
// The MediaPipe bundle is imported lazily inside loadModel() so that a failure to load it
// never stops the camera or the whole-picture filters from working.

import { TAU, ellipse, circle, poly, rrect, line, emoji, zoomPatch, star } from './draw.js';

// Filter packs live in their own files. Each is optional: a pack that fails to load is skipped
// (with a console warning) and the rest of the page keeps working.
async function pack(file, name) {
  try { return (await import(file))[name] || []; }
  catch (e) { console.warn('filter pack unavailable:', file, e); return []; }
}
const ANIMALS = await pack('./filters-animals.js', 'ANIMALS');
const GAMES = await pack('./games.js', 'GAMES');
const AGE = await pack('./filters-age.js', 'AGE');
const WIGS = await pack('./filters-wigs.js', 'WIGS');

const $ = (id) => document.getElementById(id);
const video = $('cam');
const canvas = $('stage');
const ctx = canvas.getContext('2d', { alpha: false });
const work = document.createElement('canvas');            // pixel effects (reduced size)
const wctx = work.getContext('2d', { willReadFrequently: true });
const tiny = document.createElement('canvas');            // pixelate helper
const tctx = tiny.getContext('2d');

const state = {
  facing: 'user',
  mirror: true,
  stream: null,
  landmarker: null,
  modelStatus: 'idle',      // idle | loading | ready | failed
  segmenter: null,
  segStatus: 'idle',        // the hair model loads only when a hair filter is first picked
  segSize: 256,             // width of the frame handed to the hair model (its own input is 512x512)
  variants: new Map(),      // filter id -> chosen variant index
  variantHintShown: false,
  filterIndex: 0,
  lastVideoTime: -1,
  faces: [],
  lastFrame: 0,
  started: false,
  photoFile: null,
  cameraCount: 0,
};
const particles = [];

// Drawing helpers (ellipse, poly, zoomPatch, …) live in draw.js; see its header for the
// face-unit coordinate system every face filter draws in.

// ---------------------------------------------------------------- particles (canvas pixels)
function spawn(p) { if (particles.length < 220) particles.push(p); }
function clearParticles() { particles.length = 0; }
function stepParticles(dt) {
  const H = canvas.height, W = canvas.width;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.rot += p.vr * dt; p.life -= dt;
    if (p.life <= 0 || p.y > H + 60 || p.x < -60 || p.x > W + 60) { particles.splice(i, 1); continue; }
    const a = Math.min(1, p.life / 0.4);
    if (p.kind === 'star') {
      star(ctx, p.x, p.y, p.size, p.rot, p.color, a);
    } else {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = a; ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
  }
}
const PARTY = ['#ff5c8a', '#ffd23f', '#3ddbd9', '#7c4dff', '#69f0ae', '#ff9100'];
function sparkleAt(gx, gy, color) {
  const s = canvas.width * 0.012;
  spawn({ kind: 'star', x: gx, y: gy, vx: (Math.random() - 0.5) * s * 20, vy: -s * (10 + Math.random() * 20), g: s * 40,
    rot: Math.random() * TAU, vr: 3, life: 0.9 + Math.random() * 0.5, size: s * (1 + Math.random() * 1.5), color: color || '#fff6b0' });
}
function confetti() {
  const W = canvas.width, H = canvas.height;
  for (let i = 0; i < 2; i++) {
    spawn({ kind: 'rect', x: Math.random() * W, y: -20, vx: (Math.random() - 0.5) * W * 0.08, vy: H * (0.25 + Math.random() * 0.3),
      g: H * 0.1, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 8, life: 6, size: W * 0.02 * (0.7 + Math.random()),
      color: PARTY[(Math.random() * PARTY.length) | 0] });
  }
}

const FX = { sparkleAt, confetti, spawn };

// ---------------------------------------------------------------- face geometry
const avgOf = (lm, idx, W, H) => {
  let x = 0, y = 0;
  for (const i of idx) { x += lm[i].x; y += lm[i].y; }
  return { x: (x / idx.length) * W, y: (y / idx.length) * H };
};
function faceGeometry(lm, W, H) {
  const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  const L = P(234), R = P(454);                             // cheeks (image-left, image-right)
  const eA = avgOf(lm, [33, 133, 159, 145], W, H);          // eye on image-left
  const eB = avgOf(lm, [263, 362, 386, 374], W, H);         // eye on image-right
  const angle = Math.atan2(eB.y - eA.y, eB.x - eA.x);
  const mid = { x: (eA.x + eB.x) / 2, y: (eA.y + eB.y) / 2 };
  const s = Math.max(1, Math.hypot(R.x - L.x, R.y - L.y));
  const cs = Math.cos(-angle), sn = Math.sin(-angle);
  const local = (p) => {
    const dx = p.x - mid.x, dy = p.y - mid.y;
    return { x: (dx * cs - dy * sn) / s, y: (dx * sn + dy * cs) / s };
  };
  const global = (lx, ly) => {
    const c2 = Math.cos(angle), s2 = Math.sin(angle);
    return { x: mid.x + (lx * c2 - ly * s2) * s, y: mid.y + (lx * s2 + ly * c2) * s };
  };
  const lipTop = P(13), lipBot = P(14), mL = P(61), mR = P(291);
  const open = Math.hypot(lipBot.x - lipTop.x, lipBot.y - lipTop.y) / s;
  return {
    s, angle, mid, local, global, W, H, video, fx: FX,
    eyeA: local(eA), eyeB: local(eB),
    nose: local(avgOf(lm, [1, 4], W, H)),
    lipTop: local(lipTop),
    mouth: { c: local({ x: (lipTop.x + lipBot.x) / 2, y: (lipTop.y + lipBot.y) / 2 }), open, w: Math.hypot(mR.x - mL.x, mR.y - mL.y) / s },
    hair: local(P(10)), chin: local(P(152)),
  };
}

// ---------------------------------------------------------------- face filters
const FACE = {
  puppy(c, g) {
    for (const sg of [-1, 1]) {
      ellipse(c, sg * 0.56, 0.08, 0.17, 0.42, sg * 0.3, '#7a4a21', '#4e2d12', 0.02);
      ellipse(c, sg * 0.57, 0.12, 0.09, 0.3, sg * 0.3, '#b8793f');
    }
    ellipse(c, g.nose.x, g.nose.y + 0.02, 0.1, 0.075, 0, '#1a1a1a');
    ellipse(c, g.nose.x - 0.035, g.nose.y - 0.005, 0.025, 0.015, 0, 'rgba(255,255,255,0.8)');
    if (g.mouth.open > 0.07) {
      const len = 0.18 + g.mouth.open * 0.6;
      rrect(c, g.mouth.c.x - 0.07, g.mouth.c.y, 0.14, len, 0.07, '#ff6b8b', '#d94a6a', 0.015);
      line(c, g.mouth.c.x, g.mouth.c.y + 0.04, g.mouth.c.x, g.mouth.c.y + len - 0.04, '#d94a6a', 0.012);
    }
  },
  kitty(c, g) {
    for (const sg of [-1, 1]) {
      poly(c, [[sg * 0.18, -0.42], [sg * 0.52, -0.32], [sg * 0.44, -0.88]], '#f49b2b', '#8a4b12', 0.025);
      poly(c, [[sg * 0.25, -0.44], [sg * 0.45, -0.37], [sg * 0.41, -0.74]], '#ffb7c5');
      for (let k = -1; k <= 1; k++) {
        const y1 = g.nose.y + 0.08 + k * 0.04, y2 = g.nose.y + k * 0.12;
        line(c, sg * 0.12, y1, sg * 0.72, y2, 'rgba(0,0,0,0.35)', 0.035);
        line(c, sg * 0.12, y1, sg * 0.72, y2, '#fff', 0.018);
      }
    }
    poly(c, [[g.nose.x - 0.06, g.nose.y - 0.02], [g.nose.x + 0.06, g.nose.y - 0.02], [g.nose.x, g.nose.y + 0.06]], '#ff8aa0', '#c9566f', 0.012);
  },
  bunny(c, g) {
    for (const sg of [-1, 1]) {
      ellipse(c, sg * 0.2, -0.98, 0.12, 0.5, sg * 0.15, '#fff', '#cfcfcf', 0.02);
      ellipse(c, sg * 0.2, -0.95, 0.06, 0.36, sg * 0.15, '#ffb3c6');
    }
    ellipse(c, g.nose.x, g.nose.y + 0.01, 0.06, 0.045, 0, '#ff8aa0');
    if (g.mouth.open > 0.05) {
      rrect(c, g.lipTop.x - 0.075, g.lipTop.y - 0.02, 0.07, 0.13, 0.02, '#fff', '#cfcfcf', 0.012);
      rrect(c, g.lipTop.x + 0.005, g.lipTop.y - 0.02, 0.07, 0.13, 0.02, '#fff', '#cfcfcf', 0.012);
    }
  },
  bear(c, g) {
    for (const sg of [-1, 1]) {
      circle(c, sg * 0.44, -0.5, 0.17, '#6d4c41', '#4e342e', 0.02);
      circle(c, sg * 0.44, -0.5, 0.09, '#d7a98c');
    }
    ellipse(c, g.nose.x, g.nose.y + 0.02, 0.09, 0.065, 0, '#2b1b12');
    ellipse(c, g.nose.x - 0.03, g.nose.y, 0.022, 0.013, 0, 'rgba(255,255,255,0.75)');
  },
  frog(c, g, t) {
    for (const sg of [-1, 1]) {
      circle(c, sg * 0.26, -0.6, 0.15, '#fff', '#43a047', 0.05);
      circle(c, sg * 0.26 + Math.sin(t * 2) * 0.03, -0.6, 0.07, '#111');
    }
    if (g.mouth.open > 0.07) {
      const len = 0.5 + Math.abs(Math.sin(t * 6)) * 0.5;
      line(c, g.mouth.c.x, g.mouth.c.y, g.mouth.c.x + 0.15, g.mouth.c.y + len, '#ff5c8a', 0.08);
      circle(c, g.mouth.c.x + 0.15, g.mouth.c.y + len, 0.07, '#ff5c8a');
    }
  },
  shades(c, g) {
    for (const e of [g.eyeA, g.eyeB]) {
      const grad = c.createLinearGradient(e.x, e.y - 0.09, e.x, e.y + 0.1);
      grad.addColorStop(0, '#3a3a3a'); grad.addColorStop(1, '#000');
      rrect(c, e.x - 0.17, e.y - 0.09, 0.34, 0.19, 0.07, grad, '#111', 0.02);
      line(c, e.x - 0.1, e.y - 0.03, e.x - 0.05, e.y - 0.065, 'rgba(255,255,255,0.6)', 0.02);
    }
    line(c, g.eyeA.x + 0.17, g.eyeA.y - 0.03, g.eyeB.x - 0.17, g.eyeB.y - 0.03, '#111', 0.03);
    line(c, g.eyeA.x - 0.17, g.eyeA.y - 0.03, -0.62, g.eyeA.y - 0.06, '#111', 0.03);
    line(c, g.eyeB.x + 0.17, g.eyeB.y - 0.03, 0.62, g.eyeB.y - 0.06, '#111', 0.03);
  },
  fancy(c, g) {
    rrect(c, -0.5, -0.62, 1.0, 0.09, 0.04, '#141414');
    rrect(c, -0.33, -1.2, 0.66, 0.6, 0.03, '#141414');
    c.fillStyle = '#c62828'; c.fillRect(-0.33, -0.72, 0.66, 0.08);
    const y = g.nose.y + 0.1;
    c.fillStyle = '#3b2412';
    for (const sg of [-1, 1]) {
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(sg * 0.12, y - 0.08, sg * 0.28, y - 0.1, sg * 0.34, y - 0.16);
      c.bezierCurveTo(sg * 0.3, y + 0.02, sg * 0.14, y + 0.07, 0, y + 0.03);
      c.closePath(); c.fill();
    }
    circle(c, g.eyeB.x, g.eyeB.y, 0.13, null, '#e2b53a', 0.03);
    c.beginPath(); c.moveTo(g.eyeB.x + 0.1, g.eyeB.y + 0.08); c.quadraticCurveTo(0.38, 0.08, 0.5, 0.42);
    c.strokeStyle = '#e2b53a'; c.lineWidth = 0.015; c.stroke();
  },
  crown(c, g, t) {
    const grad = c.createLinearGradient(0, -1.05, 0, -0.45);
    grad.addColorStop(0, '#ffe066'); grad.addColorStop(1, '#e0a010');
    poly(c, [[-0.42, -0.45], [-0.42, -0.92], [-0.315, -0.72], [-0.21, -0.98], [-0.105, -0.72], [0, -1.04],
      [0.105, -0.72], [0.21, -0.98], [0.315, -0.72], [0.42, -0.92], [0.42, -0.45]], grad, '#9c6b00', 0.02);
    c.fillStyle = '#c98a06'; c.fillRect(-0.42, -0.53, 0.84, 0.07);
    const jewels = ['#e53935', '#1e88e5', '#43a047', '#1e88e5', '#e53935'];
    [[-0.42, -0.9], [-0.21, -0.96], [0, -1.02], [0.21, -0.96], [0.42, -0.9]].forEach((p, i) => circle(c, p[0], p[1] + 0.06, 0.035, jewels[i], '#7a5200', 0.01));
    if (Math.random() < 0.25) { const gp = g.global((Math.random() - 0.5) * 0.9, -0.75 - Math.random() * 0.3); sparkleAt(gp.x, gp.y); }
  },
  pirate(c, g) {
    ellipse(c, 0, -0.5, 0.62, 0.12, 0, '#111');
    for (const sg of [-1, 1]) ellipse(c, sg * 0.55, -0.6, 0.12, 0.17, 0, '#111');
    ellipse(c, 0, -0.72, 0.4, 0.3, 0, '#111', '#333', 0.015);
    emoji(c, g, '☠️', 0, -0.74, 0.22);
    circle(c, g.eyeB.x, g.eyeB.y, 0.12, '#111');
    line(c, g.eyeB.x - 0.1, g.eyeB.y - 0.08, -0.55, -0.26, '#111', 0.03);
    line(c, g.eyeB.x + 0.1, g.eyeB.y - 0.06, 0.55, -0.12, '#111', 0.03);
    circle(c, -0.55, 0.3, 0.05, null, '#e2b53a', 0.025);
  },
  bigeyes(c, g) {
    for (const e of [g.eyeA, g.eyeB]) {
      zoomPatch(c, g, e.x, e.y, 0.15, 0.15, 2.1, 'circle');
      circle(c, e.x, e.y, 0.15, null, 'rgba(0,0,0,0.25)', 0.015);
    }
  },
  bighead(c, g) {
    zoomPatch(c, g, 0, 0.18, 0.78, 1.05, 1.45, 'ellipse');
  },
  rainbow(c, g, t) {
    if (g.mouth.open < 0.09) return;
    const colors = ['#ff1744', '#ff9100', '#ffea00', '#00e676', '#00b0ff', '#651fff', '#d500f9'];
    const x0 = g.mouth.c.x, y0 = g.mouth.c.y + 0.02;
    c.lineCap = 'round';
    colors.forEach((col, i) => {
      const o = (i - 3) * 0.062;
      c.beginPath();
      c.moveTo(x0 + o, y0);
      c.bezierCurveTo(x0 + o, y0 + 0.7, x0 + o + Math.sin(t * 3) * 0.15, y0 + 1.2, x0 + o + Math.sin(t * 3) * 0.3, y0 + 2.4);
      c.strokeStyle = col; c.lineWidth = 0.065; c.stroke();
    });
    if (Math.random() < 0.5) { const gp = g.global(x0 + Math.sin(t * 3) * 0.3 + (Math.random() - 0.5) * 0.4, y0 + 2.2); sparkleAt(gp.x, gp.y, PARTY[(Math.random() * PARTY.length) | 0]); }
  },
  party(c, g) {
    c.save();
    poly(c, [[-0.24, -0.42], [0.24, -0.42], [0, -1.15]], '#ff4081', '#b0003a', 0.02);
    c.beginPath(); c.moveTo(-0.24, -0.42); c.lineTo(0.24, -0.42); c.lineTo(0, -1.15); c.closePath(); c.clip();
    c.strokeStyle = '#ffd740'; c.lineWidth = 0.06;
    for (let y = -1.1; y < -0.3; y += 0.16) { c.beginPath(); c.moveTo(-0.3, y); c.lineTo(0.3, y - 0.2); c.stroke(); }
    c.restore();
    circle(c, 0, -1.15, 0.07, '#40c4ff', '#0091ea', 0.015);
    confetti();
  },
  hero(c, g) {
    ellipse(c, 0, 0, 0.48, 0.17, 0, '#d50000');
    for (const sg of [-1, 1]) poly(c, [[sg * 0.42, -0.06], [sg * 0.62, -0.22], [sg * 0.5, 0.08]], '#d50000');
    for (const e of [g.eyeA, g.eyeB]) zoomPatch(c, g, e.x, e.y, 0.1, 0.06, 1, 'ellipse');
    emoji(c, g, '⚡', 0, -0.3, 0.16);
  },
  unicorn(c, g) {
    const colors = ['#ff1744', '#ff9100', '#ffea00', '#00e676', '#00b0ff', '#651fff'];
    colors.forEach((col, i) => {
      c.beginPath(); c.arc(0, 0.1, 0.56 + i * 0.045, Math.PI * 1.12, Math.PI * 1.88);
      c.strokeStyle = col; c.lineWidth = 0.045; c.stroke();
    });
    const grad = c.createLinearGradient(-0.1, 0, 0.1, 0);
    grad.addColorStop(0, '#fff3b0'); grad.addColorStop(1, '#e0a010');
    poly(c, [[-0.09, -0.42], [0.09, -0.42], [0, -1.18]], grad, '#b8860b', 0.015);
    c.save();
    c.beginPath(); c.moveTo(-0.09, -0.42); c.lineTo(0.09, -0.42); c.lineTo(0, -1.18); c.closePath(); c.clip();
    for (const y of [-0.52, -0.67, -0.82, -0.97]) line(c, -0.12, y, 0.12, y - 0.1, 'rgba(255,255,255,0.6)', 0.03);
    c.restore();
    for (const sg of [-1, 1]) poly(c, [[sg * 0.22, -0.4], [sg * 0.42, -0.36], [sg * 0.36, -0.62]], '#fff', '#cfcfcf', 0.015);
  },
};

// ---------------------------------------------------------------- world (whole-picture) effects
function withPixels(W, H, maxSide, fn, t) {
  const sc = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(2, Math.round(W * sc)), h = Math.max(2, Math.round(H * sc));
  if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
  wctx.drawImage(video, 0, 0, w, h);
  const img = wctx.getImageData(0, 0, w, h);
  fn(img.data, w, h, t);
  wctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(work, 0, 0, W, H);
}
const THERMAL = (() => {
  const stops = [[0, 0, 0], [40, 0, 90], [0, 40, 200], [0, 200, 220], [40, 220, 40], [250, 240, 0], [255, 120, 0], [255, 20, 20], [255, 255, 255]];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(f)), u = f - k;
    for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = stops[k][ch] * (1 - u) + stops[k + 1][ch] * u;
  }
  return lut;
})();
function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  return [
    0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
    0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283,
    0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072,
  ];
}
let glitchSeed = 0;
function rnd() { glitchSeed = (glitchSeed * 1664525 + 1013904223) >>> 0; return glitchSeed / 4294967296; }

const WORLD = {
  pixels(W, H) {
    const w = Math.max(8, Math.round(W / 16)), h = Math.max(8, Math.round(H / 16));
    if (tiny.width !== w || tiny.height !== h) { tiny.width = w; tiny.height = h; }
    tctx.drawImage(video, 0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
  },
  mirror(W, H) {
    ctx.drawImage(video, 0, 0, W / 2, H, 0, 0, W / 2, H);
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W / 2, H, 0, 0, W / 2, H);
    ctx.restore();
  },
  kaleido(W, H, t) {
    const n = 8, th = TAU / n, cx = W / 2, cy = H / 2, R = Math.hypot(W, H);
    // Zoom so the rotated picture always covers the visible corners.
    const k = (Math.hypot(cx, cy) / Math.min(cx, cy)) * 1.08;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(i * th);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, 0, th + 0.01); ctx.closePath(); ctx.clip();
      if (i % 2) { ctx.rotate(th); ctx.scale(1, -1); }   // mirror every other wedge within its own slice
      ctx.rotate(t * 0.25);
      ctx.scale(k, k);
      ctx.drawImage(video, -cx, -cy, W, H);
      ctx.restore();
    }
  },
  wavy(W, H, t) {
    ctx.drawImage(video, 0, 0, W, H);                      // fills the slivers the shifted strips leave at the edges
    const n = 48, sh = H / n;
    for (let i = 0; i < n; i++) {
      const off = Math.sin(t * 2.2 + i * 0.33) * W * 0.045;
      ctx.drawImage(video, 0, i * sh, W, sh + 1, off, i * sh, W, sh + 1);
    }
  },
  thermal(W, H) {
    withPixels(W, H, 640, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
        d[i] = THERMAL[l * 3]; d[i + 1] = THERMAL[l * 3 + 1]; d[i + 2] = THERMAL[l * 3 + 2];
      }
    });
  },
  cartoon(W, H) {
    withPixels(W, H, 560, (d, w, h) => {
      const lum = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const j = y * w + x, i = j * 4;
        const r = x < w - 1 ? lum[j + 1] : lum[j], b = y < h - 1 ? lum[j + w] : lum[j];
        const edge = Math.abs(lum[j] - r) + Math.abs(lum[j] - b);
        if (edge > 34) { d[i] = d[i + 1] = d[i + 2] = 20; continue; }
        d[i] = (d[i] >> 6) * 85; d[i + 1] = (d[i + 1] >> 6) * 85; d[i + 2] = (d[i + 2] >> 6) * 85;
      }
    });
  },
  negative(W, H) {
    withPixels(W, H, 800, (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } });
  },
  oldtimey(W, H, t) {
    withPixels(W, H, 800, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
        d[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
        d[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
      }
    });
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `rgba(255,255,255,${0.04 + 0.05 * Math.abs(Math.sin(t * 17))})`; ctx.fillRect(0, 0, W, H);
  },
  swirl(W, H, t) {
    const m = hueMatrix((t * 70) % 360);
    withPixels(W, H, 800, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = r * m[0] + g * m[1] + b * m[2];
        d[i + 1] = r * m[3] + g * m[4] + b * m[5];
        d[i + 2] = r * m[6] + g * m[7] + b * m[8];
      }
    });
  },
  popart(W, H) {
    const sc = Math.min(1, 640 / Math.max(W, H));
    const w = Math.round(W * sc), h = Math.round(H * sc);
    if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
    wctx.drawImage(video, 0, 0, w, h);
    const img = wctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      l = Math.max(0, Math.min(255, (l - 128) * 1.8 + 128));
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    wctx.putImageData(img, 0, 0);
    const tints = [['#ff5c8a', '#2b0014'], ['#ffd23f', '#00264d'], ['#3ddbd9', '#4a0072'], ['#69f0ae', '#5c1500']];
    const hw = W / 2, hh = H / 2;
    for (let q = 0; q < 4; q++) {
      const x = (q % 2) * hw, y = Math.floor(q / 2) * hh;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(work, x, y, hw, hh);
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = tints[q][0]; ctx.fillRect(x, y, hw, hh);
      ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = tints[q][1]; ctx.fillRect(x, y, hw, hh);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(2, W * 0.006);
    ctx.strokeRect(0, 0, W, H); line(ctx, hw, 0, hw, H, '#111', ctx.lineWidth); line(ctx, 0, hh, W, hh, '#111', ctx.lineWidth);
  },
  glitch(W, H, t) {
    ctx.drawImage(video, 0, 0, W, H);
    glitchSeed = Math.floor(t * 7) * 7919;
    if (rnd() < 0.7) {
      const n = 3 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const y = rnd() * H, h = 6 + rnd() * H * 0.08, off = (rnd() - 0.5) * W * 0.18;
        ctx.drawImage(video, 0, y, W, h, off, y, W, h);
      }
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#3ddbd9'; ctx.fillRect(0, rnd() * H, W, 3 + rnd() * 10);
      ctx.fillStyle = '#ff5c8a'; ctx.fillRect(0, rnd() * H, W, 3 + rnd() * 10);
      ctx.globalAlpha = 1;
    }
  },
};

const HAIR_COLOURS = [
  ['Pink', '#ff4fa3'], ['Blue', '#2f7bff'], ['Purple', '#8a3cff'], ['Green', '#2ecc71'],
  ['Red', '#ff2d2d'], ['Blonde', '#ffd76a'], ['White', '#f4f4f4'], ['Rainbow', null],
];
const HAIR_FILTER = {
  id: 'haircolor', name: 'Hair Colour', icon: '🎨', segment: true,
  variants: HAIR_COLOURS.map((h) => h[0]),
  scene(c, geoms, t, dt, W, H, v, env) {
    if (!env.hair) { if (state.segStatus === 'loading') env.hud('Getting the hair magic ready…'); return; }
    env.hud(geoms.length ? '' : 'Come closer so I can see your face');
    const m = env.hair;
    // Build a coloured copy of the mask, then blend it onto the picture so only hair changes.
    const tint = document.createElement('canvas'); tint.width = m.w; tint.height = m.h;
    const tc = tint.getContext('2d');
    tc.drawImage(m.canvas, 0, 0);
    tc.globalCompositeOperation = 'source-in';
    const colour = HAIR_COLOURS[v][1];
    if (colour) tc.fillStyle = colour;
    else {
      const grad = tc.createLinearGradient(0, 0, m.w, m.h);
      ['#ff2d2d', '#ff9100', '#ffea00', '#00e676', '#00b0ff', '#8a3cff'].forEach((col, i, arr) => grad.addColorStop(((i / (arr.length - 1)) + t * 0.1) % 1, col));
      tc.fillStyle = grad;
    }
    tc.fillRect(0, 0, m.w, m.h);
    c.imageSmoothingEnabled = true;
    c.globalCompositeOperation = 'color';
    c.drawImage(tint, 0, 0, W, H);
    c.globalCompositeOperation = 'soft-light';
    c.globalAlpha = 0.6;
    c.drawImage(tint, 0, 0, W, H);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  },
};

// Filters are grouped; the tab row above the chip strip jumps to a group's first filter.
const GROUPS = [
  ['animals', '🐾', 'Animals'],
  ['silly', '🎉', 'Silly'],
  ['games', '🎮', 'Games'],
  ['looks', '💇', 'Looks'],
  ['effects', '🌈', 'Effects'],
];
const tag = (list, group) => list.map((f) => ({ ...f, group }));
const FILTERS = [
  { id: 'normal', name: 'Just Me', icon: '🙂' },
  ...tag(ANIMALS, 'animals'),
  ...tag([
    { id: 'puppy', name: 'Puppy', icon: '🐶', face: FACE.puppy },
    { id: 'kitty', name: 'Kitty', icon: '🐱', face: FACE.kitty },
    { id: 'bunny', name: 'Bunny', icon: '🐰', face: FACE.bunny },
    { id: 'bear', name: 'Bear', icon: '🐻', face: FACE.bear },
    { id: 'frog', name: 'Frog', icon: '🐸', face: FACE.frog },
    { id: 'unicorn', name: 'Unicorn', icon: '🦄', face: FACE.unicorn },
  ], 'animals'),
  ...tag([
    { id: 'shades', name: 'Cool Shades', icon: '😎', face: FACE.shades },
    { id: 'fancy', name: 'Fancy', icon: '🎩', face: FACE.fancy },
    { id: 'crown', name: 'Royal', icon: '👑', face: FACE.crown },
    { id: 'pirate', name: 'Pirate', icon: '🏴‍☠️', face: FACE.pirate },
    { id: 'hero', name: 'Hero', icon: '🦸', face: FACE.hero },
    { id: 'party', name: 'Party', icon: '🎉', face: FACE.party },
    { id: 'rainbow', name: 'Rainbow Mouth', icon: '🌈', face: FACE.rainbow },
    { id: 'bigeyes', name: 'Big Eyes', icon: '👀', face: FACE.bigeyes },
    { id: 'bighead', name: 'Big Head', icon: '🎈', face: FACE.bighead },
  ], 'silly'),
  ...tag(GAMES, 'games'),
  ...tag(AGE, 'looks'),
  ...tag(WIGS, 'looks'),
  ...tag([HAIR_FILTER], 'looks'),
  ...tag([
    { id: 'pixels', name: 'Pixels', icon: '🧱', world: WORLD.pixels },
    { id: 'mirror', name: 'Mirror', icon: '🪞', world: WORLD.mirror },
    { id: 'kaleido', name: 'Kaleidoscope', icon: '🔮', world: WORLD.kaleido },
    { id: 'wavy', name: 'Wavy', icon: '🌊', world: WORLD.wavy },
    { id: 'thermal', name: 'Heat Vision', icon: '🔥', world: WORLD.thermal },
    { id: 'cartoon', name: 'Cartoon', icon: '✏️', world: WORLD.cartoon },
    { id: 'negative', name: 'Opposite', icon: '🔁', world: WORLD.negative },
    { id: 'oldtimey', name: 'Old Timey', icon: '🎞️', world: WORLD.oldtimey },
    { id: 'swirl', name: 'Color Swirl', icon: '🎨', world: WORLD.swirl },
    { id: 'popart', name: 'Pop Art', icon: '🖼️', world: WORLD.popart },
    { id: 'glitch', name: 'Glitch', icon: '📺', world: WORLD.glitch },
  ], 'effects'),
];

// The detector sometimes reports the same face twice; keep one of any pair whose noses sit
// closer together than a third of a face width.
function dedupeFaces(list) {
  const keep = [];
  for (const lm of list) {
    const w = Math.hypot(lm[454].x - lm[234].x, lm[454].y - lm[234].y) || 0.01;
    const dup = keep.some((k) => Math.hypot(k[1].x - lm[1].x, k[1].y - lm[1].y) < w * 0.34);
    if (!dup) keep.push(lm);
  }
  return keep;
}

// ---------------------------------------------------------------- render loop
function frame(now) {
  requestAnimationFrame(frame);
  if (!state.started || video.readyState < 2 || !video.videoWidth) return;
  const W = video.videoWidth, H = video.videoHeight;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const dt = Math.min(0.05, (now - state.lastFrame) / 1000) || 0;
  state.lastFrame = now;
  const t = now / 1000;
  const f = FILTERS[state.filterIndex];
  const v = state.variants.get(f.id) || 0;

  if (f.world) f.world(W, H, t, v);
  else ctx.drawImage(video, 0, 0, W, H);

  let geoms = [];
  if ((f.face || f.scene) && state.landmarker) {
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      try {
        const res = state.landmarker.detectForVideo(video, now);
        state.faces = dedupeFaces(res.faceLandmarks || []);
      } catch (e) {
        console.error('detect failed', e);
        state.faces = [];
      }
    }
    geoms = state.faces.map((lm) => faceGeometry(lm, W, H));
    if (f.face) {
      for (const g of geoms) {
        ctx.save();
        ctx.translate(g.mid.x, g.mid.y);
        ctx.rotate(g.angle);
        ctx.scale(g.s, g.s);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        f.face(ctx, g, t, v);
        ctx.restore();
      }
    }
  }
  if (f.segment) ENV.hair = segmentHair(now, geoms);
  if (f.scene) {
    ctx.save();
    f.scene(ctx, geoms, t, dt, W, H, v, ENV);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  stepParticles(dt);
  debug.frames++;
}

// Things a scene filter (games, hair colour) can use. hud(text) shows text in a DOM strip above
// the picture (DOM, because the canvas is mirrored for the front camera and text would flip);
// say(text) is the big centred label; hair is the latest hair mask (see segmentHair).
const ENV = {
  video,
  hud(text) { const el = $('hud'); if (el.textContent !== text) el.textContent = text; el.hidden = !text; },
  say: (text) => showName(text),
  fx: FX,
  hair: null,
  best(key, score) {   // per-device best score, optional convenience only
    try {
      const k = 'sillycam-best-' + key;
      const prev = Number(localStorage.getItem(k) || 0);
      if (score > prev) localStorage.setItem(k, String(score));
      return Math.max(prev, score);
    } catch { return score; }
  },
};

// ---------------------------------------------------------------- hair segmentation (for hair colour)
// Runs MediaPipe's small hair_segmenter on a downscaled frame and returns {canvas, w, h} where the
// canvas is white where hair is (alpha from the model's confidence), transparent elsewhere.
// The model confidently calls dark clothing, dark furniture and shadows "hair" (measured 2026-11-08 on
// five real scenes: up to a quarter of the mask landed away from any head, a 512 input changed nothing,
// and a stricter confidence cut removed real hair as fast as the spill). Hair can only be where a head
// is, so gateHair() keeps the mask inside a soft zone around each detected face and cuts the neck and
// chest line out. No face in view means no colour (a short grace covers a missed frame).
const hairIn = document.createElement('canvas');
const hairInCtx = hairIn.getContext('2d', { willReadFrequently: true });
const hairOut = document.createElement('canvas');
const hairOutCtx = hairOut.getContext('2d');
let hairImage = null;
let segLastTime = -1;
const gate = document.createElement('canvas');
const gateCtx = gate.getContext('2d');
let gateSeenAt = -1e9;
const GATE_GRACE_MS = 700;
function softBlob(c, cx, cy, rx, ry) {   // ellipse, solid to 78% of its radius then fading to nothing
  c.save(); c.translate(cx, cy); c.scale(rx, ry);
  const gr = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.78, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr; c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill();
  c.restore();
}
function gateHair(geoms, w, h, now) {
  if (geoms.length) {
    gateSeenAt = now;
    if (gate.width !== w || gate.height !== h) { gate.width = w; gate.height = h; }
    gateCtx.clearRect(0, 0, w, h);
    const k = w / geoms[0].W;                     // mask pixels per video pixel
    const inFace = (g, draw) => { gateCtx.save(); gateCtx.translate(g.mid.x * k, g.mid.y * k); gateCtx.rotate(g.angle); gateCtx.scale(g.s * k, g.s * k); draw(g); gateCtx.restore(); };
    for (const g of geoms) inFace(g, () => {
      // A turned head shows a narrower face while the head extends behind it: the nose offset says
      // which way, so the zone shifts to the back of the head and grows with the turn.
      const yaw = Math.max(-0.4, Math.min(0.4, g.nose.x));
      const grow = 1 + Math.abs(yaw);
      softBlob(gateCtx, -yaw * 1.2, -0.2, 1.2 * grow, 1.25 * grow);   // hair volume around the head
      softBlob(gateCtx, -yaw * 0.8, 1.5, 1.35 * grow, 2.2);           // hair hanging down to the shoulders and chest
    });
    gateCtx.globalCompositeOperation = 'destination-out';
    for (const g of geoms) inFace(g, () => {        // the neck and the middle of the chest are never hair
      const gr = gateCtx.createLinearGradient(-0.5, 0, 0.5, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.35, 'rgba(0,0,0,1)'); gr.addColorStop(0.65, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      gateCtx.fillStyle = gr;
      const top = g.chin.y + 0.05;
      gateCtx.beginPath(); gateCtx.moveTo(-0.3, top); gateCtx.lineTo(0.3, top); gateCtx.lineTo(0.55, 3.8); gateCtx.lineTo(-0.55, 3.8); gateCtx.closePath(); gateCtx.fill();
    });
    gateCtx.globalCompositeOperation = 'source-over';
  } else if (now - gateSeenAt > GATE_GRACE_MS || gate.width !== w || gate.height !== h) {
    hairOutCtx.clearRect(0, 0, w, h);
    return;
  }
  hairOutCtx.globalCompositeOperation = 'destination-in';
  hairOutCtx.drawImage(gate, 0, 0);
  hairOutCtx.globalCompositeOperation = 'source-over';
}
function segmentHair(now, geoms) {
  if (state.segStatus === 'idle') loadSegmenter();
  if (!state.segmenter) return null;
  if (video.currentTime === segLastTime) return ENV.hair;
  segLastTime = video.currentTime;
  const W = video.videoWidth, H = video.videoHeight;
  const w = state.segSize, h = Math.max(16, Math.round((w * H) / W));
  if (hairIn.width !== w || hairIn.height !== h) { hairIn.width = w; hairIn.height = h; hairOut.width = w; hairOut.height = h; hairImage = hairOutCtx.createImageData(w, h); }
  hairInCtx.drawImage(video, 0, 0, w, h);
  try {
    state.segmenter.segmentForVideo(hairIn, now, (result) => {
      const masks = result.confidenceMasks;
      if (masks && masks.length) {
        // hair_segmenter: index 1 = hair (index 0 = background)
        const m = masks[Math.min(1, masks.length - 1)].getAsFloat32Array();
        if (debug.keepHairConf) debug.hairConf = { w, h, data: Float32Array.from(m) };   // test harness only
        const d = hairImage.data;
        for (let i = 0, j = 0; i < m.length; i++, j += 4) {
          const a = m[i];
          d[j] = 255; d[j + 1] = 255; d[j + 2] = 255; d[j + 3] = a > 0.5 ? 255 : a > 0.25 ? Math.round((a - 0.25) * 1020) : 0;
        }
        hairOutCtx.putImageData(hairImage, 0, 0);
        gateHair(geoms, w, h, now);
      }
      result.close();
    });
  } catch (e) {
    console.error('hair segmentation failed', e);
    return null;
  }
  return { canvas: hairOut, w, h };
}
async function loadSegmenter() {
  state.segStatus = 'loading';
  try {
    const { ImageSegmenter, FilesetResolver } = await import('./vendor/vision_bundle.js');
    const fileset = await FilesetResolver.forVisionTasks('./vendor');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: './vendor/hair_segmenter.tflite', delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    try { state.segmenter = await ImageSegmenter.createFromOptions(fileset, opts('GPU')); }
    catch (e) { console.warn('GPU hair segmentation unavailable, using CPU', e); state.segmenter = await ImageSegmenter.createFromOptions(fileset, opts('CPU')); }
    state.segStatus = 'ready';
  } catch (e) {
    console.error('hair segmenter failed to load', e);
    state.segStatus = 'failed';
    toast('Hair colour is not available right now.', 3000);
  }
}

// ---------------------------------------------------------------- model
async function loadModel() {
  state.modelStatus = 'loading';
  updateChips();
  try {
    const { FaceLandmarker, FilesetResolver } = await import('./vendor/vision_bundle.js');
    const fileset = await FilesetResolver.forVisionTasks('./vendor');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: './vendor/face_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numFaces: 3,
      // 0.3 (default 0.5) finds the smaller faces of two or three kids sharing the frame; the
      // presence check stays at 0.5 so a lowered detector does not add ghost faces.
      minFaceDetectionConfidence: 0.3,
      minFacePresenceConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    try {
      state.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
      debug.delegate = 'GPU';
    } catch (e) {
      console.warn('GPU face tracking unavailable, using CPU', e);
      state.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU'));
      debug.delegate = 'CPU';
    }
    // Warm up once on a blank frame so the first real detection does not stall the picture.
    try {
      const warm = document.createElement('canvas');
      warm.width = 256; warm.height = 256;
      warm.getContext('2d').fillRect(0, 0, 256, 256);
      state.landmarker.detectForVideo(warm, performance.now());
    } catch (e) { console.warn('warm-up skipped', e); }
    state.modelStatus = 'ready';
  } catch (e) {
    console.error('face model failed to load', e);
    state.modelStatus = 'failed';
    if (state.started) toast('Face filters could not load. The picture filters still work.', 4000);
  }
  updateChips();
}

// ---------------------------------------------------------------- camera
function stopCamera() {
  if (state.stream) { for (const tr of state.stream.getTracks()) tr.stop(); }
  state.stream = null;
}
let cameraBusy = false;   // one camera request at a time; a second tap while switching is ignored
async function startCamera(facing) {
  if (cameraBusy) { const e = new Error('camera busy'); e.name = 'BusyError'; throw e; }
  cameraBusy = true;
  try {
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const e = new Error('mediaDevices unavailable'); e.name = 'InsecureContextError'; throw e;
    }
    const want = { audio: false, video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(want);
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    state.stream = stream;
    video.muted = true;
    video.srcObject = stream;
    // The stream is attached and the element has autoplay; a rejected play() is not a camera error.
    try { await video.play(); } catch (e) { console.warn('video.play() rejected', e); }
    const track = stream.getVideoTracks()[0];
    const mode = track.getSettings ? track.getSettings().facingMode : undefined;
    state.mirror = mode ? mode === 'user' : facing === 'user';
    canvas.classList.toggle('mirror', state.mirror);
    state.lastVideoTime = -1;
    state.faces = [];
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      state.cameraCount = devs.filter((d) => d.kind === 'videoinput').length;
    } catch { state.cameraCount = 1; }
    $('flipBtn').hidden = state.cameraCount < 2;
  } finally {
    cameraBusy = false;
  }
}
function cameraErrorText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'The camera is turned off for this page. Ask a grown-up to allow it (Settings > Apps > Safari > Camera).';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
  if (n === 'NotReadableError') return 'Another app is using the camera. Close it and try again.';
  if (n === 'InsecureContextError') return 'The camera only works when this page is opened from a web address that starts with https://';
  if (n === 'BusyError') return 'One moment, the camera is still switching.';
  return 'The camera could not start. Try again.';
}

// ---------------------------------------------------------------- UI
let toastTimer = 0;
function toast(msg, ms) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2000);
}
let nameTimer = 0;
function showName(name) {
  const el = $('name');
  el.textContent = name; el.classList.add('show');
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => el.classList.remove('show'), 1400);
}
function buildTabs() {
  const row = $('tabs');
  row.innerHTML = '';
  for (const [group, icon, label] of GROUPS) {
    const first = FILTERS.findIndex((f) => f.group === group);
    if (first < 0) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.id = 'tab-' + group;
    b.innerHTML = `<span aria-hidden="true">${icon}</span> ${label}`;
    b.addEventListener('click', () => setFilter(first));
    row.appendChild(b);
  }
}
function updateTabs() {
  const g = FILTERS[state.filterIndex].group;
  for (const [group] of GROUPS) {
    const b = $('tab-' + group);
    if (b) b.classList.toggle('active', group === g);
  }
}
function buildChips() {
  const box = $('chips');
  box.innerHTML = '';
  FILTERS.forEach((f, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.id = 'chip-' + f.id; b.setAttribute('role', 'tab');
    b.innerHTML = `<span class="ico" aria-hidden="true">${f.icon}</span><span class="lbl">${f.name}</span>`;
    b.addEventListener('click', () => {
      if (i === state.filterIndex && f.variants && f.variants.length > 1) nextVariant();
      else setFilter(i);
    });
    box.appendChild(b);
  });
  updateChips();
}
function updateChips() {
  const waiting = state.modelStatus !== 'ready';
  FILTERS.forEach((f, i) => {
    const b = $('chip-' + f.id);
    if (!b) return;
    b.classList.toggle('active', i === state.filterIndex);
    b.classList.toggle('waiting', !!(f.face || f.scene) && waiting);
    b.setAttribute('aria-selected', i === state.filterIndex ? 'true' : 'false');
  });
}
function filterLabel(f) {
  const v = state.variants.get(f.id) || 0;
  return f.variants && f.variants.length > 1 ? `${f.name}: ${f.variants[v]}` : f.name;
}
function nextVariant() {
  const f = FILTERS[state.filterIndex];
  const v = ((state.variants.get(f.id) || 0) + 1) % f.variants.length;
  state.variants.set(f.id, v);
  if (f.reset) f.reset(v);
  showName(filterLabel(f));
}
function setFilter(i) {
  const n = FILTERS.length;
  const prev = FILTERS[state.filterIndex];
  state.filterIndex = ((i % n) + n) % n;
  clearParticles();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ENV.hud('');
  const f = FILTERS[state.filterIndex];
  if (prev !== f && f.reset) f.reset(state.variants.get(f.id) || 0);
  updateChips();
  updateTabs();
  showName(filterLabel(f));
  const b = $('chip-' + f.id);
  if (b && b.scrollIntoView) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  if ((f.face || f.scene) && state.modelStatus === 'loading') toast('Getting the face magic ready…', 2500);
  else if ((f.face || f.scene) && state.modelStatus === 'failed') toast('Face filters are not available right now.', 2500);
  else if (f.variants && f.variants.length > 1 && !state.variantHintShown) { state.variantHintShown = true; toast('Tap the same button again for more!', 2500); }
}

function setupSwipe() {
  let sx = 0, sy = 0, active = false;
  canvas.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; active = true; });
  canvas.addEventListener('pointerup', (e) => {
    if (!active) return; active = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 80) setFilter(state.filterIndex + (dx < 0 ? 1 : -1));
  });
  canvas.addEventListener('pointercancel', () => { active = false; });
}

const shot = document.createElement('canvas');   // one reusable canvas: iOS caps total canvas memory per page
async function snap() {
  const out = shot;
  if (out.width !== canvas.width || out.height !== canvas.height) { out.width = canvas.width; out.height = canvas.height; }
  const o = out.getContext('2d');
  o.setTransform(1, 0, 0, 1, 0, 0);
  if (state.mirror) { o.translate(out.width, 0); o.scale(-1, 1); }
  o.drawImage(canvas, 0, 0);
  const flash = $('flash');
  flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.92));
  if (!blob) { toast('Could not take the picture.'); return; }
  state.photoFile = new File([blob], `silly-cam-${Date.now()}.jpg`, { type: 'image/jpeg' });
  const img = $('photoImg');
  if (img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(blob);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [state.photoFile] }));
  $('saveHint').hidden = canShare;
  $('photo').hidden = false;
}
async function savePhoto() {
  const f = state.photoFile;
  if (!f) return;
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: 'Silly Cam' }); } catch (e) { if (e && e.name !== 'AbortError') console.warn(e); }
    return;
  }
  const a = document.createElement('a');
  a.href = $('photoImg').src; a.download = f.name;
  document.body.appendChild(a); a.click(); a.remove();
}

let wakeLock = null;
async function keepAwake() {
  try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* optional */ }
}

function showStartScreen(message) {
  state.started = false;
  stopCamera();
  const msg = $('startMsg');
  msg.textContent = message || ''; msg.hidden = !message;
  $('startBtn').disabled = false;
  $('start').hidden = false;
  $('topbar').hidden = true;
  $('dock').hidden = true;
}
async function start() {
  const btn = $('startBtn'), msg = $('startMsg');
  btn.disabled = true; msg.hidden = true;
  try {
    await startCamera(state.facing);
  } catch (e) {
    console.warn('camera start failed', e);
    msg.textContent = cameraErrorText(e); msg.hidden = false;
    btn.disabled = false;
    return;
  }
  state.started = true;
  $('start').hidden = true;
  $('topbar').hidden = false;
  $('dock').hidden = false;
  keepAwake();
  showName(FILTERS[state.filterIndex].name);
  if (state.modelStatus === 'loading') toast('Getting the face magic ready…', 2500);
  if (state.modelStatus === 'failed') toast('Face filters could not load. The picture filters still work.', 4000);
}

async function flip() {
  if (cameraBusy) return;
  const prev = state.facing;
  state.facing = prev === 'user' ? 'environment' : 'user';
  try {
    await startCamera(state.facing);
  } catch (e) {
    console.warn('camera switch failed', e);
    toast(cameraErrorText(e), 3000);
    state.facing = prev;
    try { await startCamera(prev); }                      // go back to the camera that was working
    catch (e2) { console.warn('camera restart failed', e2); showStartScreen(cameraErrorText(e2)); }
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.started || cameraBusy) return;
  keepAwake();
  const tr = state.stream && state.stream.getVideoTracks()[0];
  if (!tr || tr.readyState !== 'live') {
    try { await startCamera(state.facing); }
    catch (e) { console.warn('camera resume failed', e); showStartScreen(cameraErrorText(e)); }
  } else {
    video.play().catch(() => {});
  }
});

// debug hooks (harmless; used by the automated test)
const debug = { frames: 0, delegate: null };
window.__sillycam = {
  get state() { return state; },
  get debug() { return debug; },
  filters: FILTERS.map((f) => f.id),
  setFilter: (id) => setFilter(FILTERS.findIndex((f) => f.id === id)),
  nextVariant,
  get env() { return ENV; },
  variantCounts: () => FILTERS.map((f) => [f.id, f.variants ? f.variants.length : 1]),
  faceCount: () => state.faces.length,
};

// ---------------------------------------------------------------- boot
buildTabs();
buildChips();
updateTabs();
setupSwipe();
$('startBtn').addEventListener('click', start);
$('startBtn').textContent = "Let's go!";
$('startBtn').disabled = false;
$('flipBtn').addEventListener('click', flip);
$('snapBtn').addEventListener('click', snap);
$('saveBtn').addEventListener('click', savePhoto);
$('backBtn').addEventListener('click', () => { $('photo').hidden = true; });
requestAnimationFrame(frame);
// Register the offline cache only after the model has loaded (or failed), so the service worker's
// install reuses the files the page just fetched instead of downloading ~19 MB a second time.
const secureHost = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
loadModel().finally(() => {
  if ('serviceWorker' in navigator && secureHost) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('offline cache unavailable', e));
  }
});
