// Silly Cam wigs: one filter with eight hairstyle variants, each in its own colour. Everything is
// drawn vector-style in face units (see draw.js): the wig silhouette goes down first, the real face
// is punched back through it with zoomPatch (k = 1), then fringes and front pieces go over the forehead.
import { ellipse, circle, poly, curve, line, zoomPatch, furPattern, seeded, TAU } from './draw.js';

// ---------- colour helpers ----------
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
function palette(base, accent) {
  return {
    base,
    light: mix(base, '#ffffff', 0.38),
    dark: mix(base, '#000000', 0.3),
    line: mix(base, '#000000', 0.55),
    accent,
  };
}
const RAINBOW = { rainbow: true, base: '#ff3b3b', light: '#ffffff', dark: '#000000', line: '#3a1f5e', accent: '#ffffff' };
const RAINBOW_STOPS = ['#ff3b3b', '#ff9f1c', '#ffe03b', '#3ddc5b', '#3b8bff', '#a14dff'];
const INK = 'rgba(0,0,0,0.28)';     // darker strand lines, work on any base colour
const SHINE = 'rgba(255,255,255,0.42)'; // lighter strand lines / highlights

// Vertical gradient (lighter at the top) or the rainbow sweep.
function grad(c, p, y0, y1) {
  if (p.rainbow) {
    const gr = c.createLinearGradient(-1, y0, 1, y1);
    RAINBOW_STOPS.forEach((col, i) => gr.addColorStop(i / (RAINBOW_STOPS.length - 1), col));
    return gr;
  }
  const gr = c.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, p.light);
  gr.addColorStop(0.45, p.base);
  gr.addColorStop(1, p.dark);
  return gr;
}

// ---------- shape helpers ----------
// A closed smooth blob through control points (midpoints are on-curve, so corners are rounded).
function blob(pts) {
  const n = pts.length, path = new Path2D();
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(pts[n - 1], pts[0]);
  path.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const nx = mid(pts[i], pts[(i + 1) % n]);
    path.quadraticCurveTo(pts[i][0], pts[i][1], nx[0], nx[1]);
  }
  path.closePath();
  return path;
}
function jagged(pts) {
  const path = new Path2D();
  pts.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
  path.closePath();
  return path;
}
// Fill a hair shape: gradient base, two soft-light fur passes for texture, thin dark outline.
// strokeBelow: only outline the part of the shape below that y (front pieces sit on top of the
// main hair mass, so their upper edge must not read as a hat brim).
function paint(c, g, path, p, y0, y1, lw = 0.02, strokeBelow) {
  c.fillStyle = grad(c, p, y0, y1);
  c.fill(path);
  c.save();
  c.globalCompositeOperation = 'soft-light';
  c.fillStyle = furPattern(c, g, '#000000', 11);
  c.fill(path);
  c.fillStyle = furPattern(c, g, '#ffffff', 23);
  c.fill(path);
  c.restore();
  c.save();
  if (strokeBelow !== undefined) { c.beginPath(); c.rect(-3, strokeBelow, 6, 6); c.clip(); }
  c.strokeStyle = p.line; c.lineWidth = lw; c.stroke(path);
  c.restore();
}
function strand(c, pts, color, lw) { curve(c, pts, null, color, lw); }
// Punch the real face back through the wig. The ellipse top sits just below the detected hairline
// (g.hair, about y -0.4 nominally but lower on big foreheads) so the wig always covers the real hair,
// and the bottom clears the chin so the neck shows.
function punchFace(c, g) {
  const top = hairY(g) + 0.05, bottom = (g.chin ? g.chin.y : 0.85) + 0.3;
  zoomPatch(c, g, 0, (top + bottom) / 2, 0.6, (bottom - top) / 2, 1, 'ellipse');
}
function hairY(g) { return g.hair ? Math.min(-0.15, Math.max(-0.6, g.hair.y)) : -0.4; }

// A front hair piece over the real hairline: covers y -0.68 .. about -0.33 with a soft lower edge.
// part: true draws a centre parting with strands sweeping to each side.
function capFront(c, g, p, part) {
  const e = Math.min(hairY(g) + 0.1, -0.17);   // lower edge: below the real hairline, above the brows
  const path = blob([[-0.66, e + 0.2], [-0.64, -0.5], [-0.35, -0.68], [0, -0.72], [0.35, -0.68], [0.64, -0.5], [0.66, e + 0.2],
    [0.56, e + 0.1], [0.34, e], [0, e], [-0.34, e], [-0.56, e + 0.1]]);
  paint(c, g, path, p, -0.9, 0.8, 0.016, e - 0.22);
  if (part) {
    line(c, 0, -0.72, 0, e - 0.04, INK, 0.02);
    for (const sg of [-1, 1]) {
      strand(c, [[sg * 0.03, -0.62], [sg * 0.25, -0.56], [sg * 0.52, e + 0.05]], INK, 0.014);
      strand(c, [[sg * 0.03, -0.5], [sg * 0.2, -0.42], [sg * 0.44, e + 0.1]], SHINE, 0.012);
    }
  } else {
    for (const x of [-0.42, -0.22, 0, 0.22, 0.42]) strand(c, [[x, e + 0.02], [x * 1.1, -0.5], [x * 1.25, -0.68]], INK, 0.013);
    for (const x of [-0.32, -0.11, 0.11, 0.32]) strand(c, [[x, e - 0.02], [x * 1.1, -0.52], [x * 1.2, -0.66]], SHINE, 0.011);
  }
}
// A straight fringe with a scalloped lower edge, from the hair top down to just above the brows.
function bangs(c, g, p) {
  const e = Math.min(hairY(g) + 0.14, -0.1);   // scallop tips: below the real hairline, above the brows
  const pts = [[-0.58, e - 0.04], [-0.6, -0.55], [-0.3, -0.72], [0, -0.75], [0.3, -0.72], [0.6, -0.55], [0.58, e - 0.04]];
  for (let i = 0; i < 7; i++) {
    const x = 0.5 - i * (1 / 6);
    pts.push([x, i % 2 ? e - 0.06 : e]);
  }
  const path = blob(pts);
  paint(c, g, path, p, -0.9, 0.8, 0.016, e - 0.3);
  for (const x of [-0.44, -0.3, -0.15, 0, 0.15, 0.3, 0.44]) strand(c, [[x, -0.62], [x * 1.05, -0.4], [x * 1.08, e - 0.08]], INK, 0.013);
  for (const x of [-0.37, -0.22, -0.07, 0.07, 0.22, 0.37]) strand(c, [[x, -0.6], [x * 1.04, -0.42], [x * 1.06, e - 0.14]], SHINE, 0.011);
}

// ---------- the styles ----------
const STYLES = {
  bob: {
    back(c, g, p) {
      const path = blob([[-0.66, -0.4], [-0.35, -0.8], [0, -0.88], [0.35, -0.8], [0.66, -0.4], [0.74, 0.0], [0.72, 0.4], [0.6, 0.68],
        [0.42, 0.8], [0.15, 0.7], [-0.15, 0.7], [-0.42, 0.8], [-0.6, 0.68], [-0.72, 0.4], [-0.74, 0.0]]);
      paint(c, g, path, p, -0.9, 0.8);
      for (const sg of [-1, 1]) {
        strand(c, [[sg * 0.08, -0.84], [sg * 0.45, -0.7], [sg * 0.62, -0.45]], INK, 0.016);
        strand(c, [[sg * 0.2, -0.8], [sg * 0.5, -0.6]], SHINE, 0.014);
      }
    },
    front(c, g, p) {
      bangs(c, g, p);
      for (const sg of [-1, 1]) {
        strand(c, [[sg * 0.64, -0.25], [sg * 0.68, 0.2], [sg * 0.62, 0.6]], INK, 0.016);
        strand(c, [[sg * 0.69, -0.1], [sg * 0.71, 0.3], [sg * 0.66, 0.55]], SHINE, 0.012);
      }
    },
  },
  mohawk: {
    punch: false,
    back(c, g, p, t) {
      // the fin: a tall ridge of spikes fanning out along the centre line, swaying a little
      const sway = Math.sin(t * 1.5) * 0.04;
      const base = hairY(g) + 0.1;
      const pts = [[-0.34, base]];
      const tips = [[-0.42, -1.05], [-0.22, -1.3], [0, -1.45], [0.22, -1.3], [0.42, -1.05]];
      tips.forEach(([x, y], i) => {
        pts.push([x + sway, y]);
        if (i < tips.length - 1) pts.push([(x + tips[i + 1][0]) / 2 + sway * 0.5, -0.78 + Math.abs(x + 0.11) * 0.12]);
      });
      pts.push([0.34, base]);
      const path = jagged(pts);
      paint(c, g, path, p, -1.45, base, 0.022);
      tips.forEach(([x, y], i) => strand(c, [[x * 0.25, base - 0.1], [x * 0.6 + sway * 0.5, (y + base) / 2], [x * 0.92 + sway, y + 0.12]], i % 2 ? SHINE : INK, 0.016));
      // widow's peak onto the forehead
      poly(c, [[-0.3, base + 0.01], [0.3, base + 0.01], [0.05, base + 0.2]], p.base, p.line, 0.014);
      strand(c, [[-0.2, base + 0.02], [0, base + 0.1], [0.2, base + 0.02]], SHINE, 0.012);
    },
    front() {},
  },
  curls: {
    back(c, g, p) {
      const base = blob([[0, -0.95], [0.55, -0.8], [0.9, -0.4], [0.95, 0.1], [0.85, 0.6], [0.55, 0.85], [0, 0.9], [-0.55, 0.85], [-0.85, 0.6], [-0.95, 0.1], [-0.9, -0.4], [-0.55, -0.8]]);
      paint(c, g, base, p, -1.0, 0.9);
      const rnd = seeded(5);
      for (let i = 0; i < 22; i++) {
        const a = -Math.PI * 0.95 + (i / 21) * Math.PI * 1.9;
        const r = 0.13 + rnd() * 0.05;
        curl(c, p, Math.cos(a) * 0.8, -0.05 + Math.sin(a) * 0.78, r);
      }
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI * 0.9 + (i / 9) * Math.PI * 0.8;
        curl(c, p, Math.cos(a) * 0.5, -0.1 + Math.sin(a) * 0.55, 0.12 + rnd() * 0.04);
      }
    },
    front(c, g, p) {
      const h = hairY(g);
      for (const [x, y, r] of [[-0.5, h + 0.02, 0.14], [-0.28, h - 0.08, 0.13], [-0.05, h - 0.1, 0.14], [0.2, h - 0.09, 0.13], [0.44, h, 0.14],
        [-0.38, h - 0.3, 0.13], [-0.12, h - 0.34, 0.13], [0.14, h - 0.33, 0.13], [0.36, h - 0.3, 0.13],
        [-0.63, h + 0.3, 0.13], [0.63, h + 0.3, 0.13], [-0.66, 0.3, 0.12], [0.66, 0.3, 0.12], [-0.6, 0.6, 0.12], [0.6, 0.6, 0.12]]) {
        curl(c, p, x, y, r);
      }
    },
  },
  pigtails: {
    back(c, g, p, t) {
      const sway = Math.sin(t * 2.2) * 0.04;
      for (const sg of [-1, 1]) {
        const s = sg * 1, w = sway * sg;
        const tail = blob([[s * 0.6, -0.22], [s * 0.9, -0.26], [s * 0.96, 0.15], [s * (0.92 + w), 0.6], [s * (0.84 + w * 1.5), 1.0],
          [s * (0.7 + w * 1.5), 0.98], [s * (0.66 + w), 0.6], [s * 0.62, 0.2]]);
        paint(c, g, tail, p, -0.3, 1.0);
        strand(c, [[s * 0.8, -0.1], [s * (0.84 + w * 0.5), 0.4], [s * (0.76 + w * 1.4), 0.9]], INK, 0.016);
        strand(c, [[s * 0.72, 0.0], [s * (0.74 + w * 0.5), 0.4], [s * (0.72 + w * 1.4), 0.8]], SHINE, 0.012);
      }
      const cap = blob([[0, -0.9], [0.45, -0.82], [0.7, -0.5], [0.74, -0.1], [0.62, 0.15], [0, 0.2], [-0.62, 0.15], [-0.74, -0.1], [-0.7, -0.5], [-0.45, -0.82]]);
      paint(c, g, cap, p, -0.9, 0.2);
      for (const sg of [-1, 1]) {
        strand(c, [[sg * 0.03, -0.84], [sg * 0.4, -0.75], [sg * 0.68, -0.3]], INK, 0.016);
        strand(c, [[sg * 0.03, -0.7], [sg * 0.3, -0.6], [sg * 0.6, -0.1]], SHINE, 0.012);
      }
      // bobbles where the tails are tied
      for (const sg of [-1, 1]) {
        circle(c, sg * 0.74, -0.2, 0.085, p.accent, p.line, 0.012);
        circle(c, sg * 0.71, -0.23, 0.03, 'rgba(255,255,255,0.6)');
      }
    },
    front(c, g, p) { bangs(c, g, p); },
  },
  afro: {
    back(c, g, p) {
      const halo = new Path2D();
      halo.arc(0, -0.05, 1.0, 0, TAU);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        halo.moveTo(Math.cos(a) * 1.0 + 0.16, -0.05 + Math.sin(a) * 1.0);
        halo.arc(Math.cos(a) * 1.0, -0.05 + Math.sin(a) * 1.0, 0.16, 0, TAU);
      }
      paint(c, g, halo, p, -1.2, 1.0, 0.018);
      // a few soft inner bumps for volume
      const rnd = seeded(9);
      c.save();
      c.globalAlpha = 0.35;
      for (let i = 0; i < 14; i++) {
        const a = rnd() * TAU, r = 0.45 + rnd() * 0.45;
        circle(c, Math.cos(a) * r, -0.05 + Math.sin(a) * r, 0.12 + rnd() * 0.08, null, p.rainbow ? 'rgba(0,0,0,0.5)' : p.dark, 0.014);
      }
      c.restore();
    },
    front(c, g, p) {
      // hairline bumps over the forehead and down the sides
      const fringe = new Path2D();
      const h = hairY(g);
      for (const [x, y, r] of [[-0.55, h + 0.06, 0.18], [-0.3, h - 0.04, 0.17], [0, h - 0.07, 0.18], [0.3, h - 0.04, 0.17], [0.55, h + 0.06, 0.18],
        [-0.42, h - 0.3, 0.17], [-0.14, h - 0.34, 0.17], [0.14, h - 0.34, 0.17], [0.42, h - 0.3, 0.17],
        [-0.66, 0.05, 0.16], [0.66, 0.05, 0.16], [-0.7, 0.4, 0.15], [0.7, 0.4, 0.15], [-0.66, 0.72, 0.14], [0.66, 0.72, 0.14]]) {
        fringe.moveTo(x + r, y); fringe.arc(x, y, r, 0, TAU);
      }
      paint(c, g, fringe, p, -1.2, 1.0, 0.012);
    },
  },
  long: {
    back(c, g, p, t) {
      const w = Math.sin(t * 1.3) * 0.03;
      const path = blob([[0, -0.9], [0.45, -0.8], [0.72, -0.4], [0.8, 0.1], [0.82, 0.6], [0.88 + w, 1.1], [0.86 + w, 1.6], [0.64 + w, 1.7], [0.46 + w, 1.52], [0.5, 1.0], [0.5, 0.6],
        [-0.5, 0.6], [-0.5, 1.0], [-0.46 - w, 1.52], [-0.64 - w, 1.7], [-0.86 - w, 1.6], [-0.88 - w, 1.1], [-0.82, 0.6], [-0.8, 0.1], [-0.72, -0.4], [-0.45, -0.8]]);
      paint(c, g, path, p, -0.9, 1.7);
      for (const sg of [-1, 1]) {
        strand(c, [[sg * 0.05, -0.85], [sg * 0.5, -0.7], [sg * 0.7, -0.2], [sg * 0.72, 0.5], [sg * (0.78 + w), 1.1], [sg * (0.7 + w), 1.55]], INK, 0.018);
        strand(c, [[sg * 0.6, -0.1], [sg * 0.64, 0.5], [sg * (0.6 + w), 1.0], [sg * (0.56 + w), 1.45]], INK, 0.014);
        strand(c, [[sg * 0.2, -0.8], [sg * 0.55, -0.55], [sg * 0.66, 0.1], [sg * 0.68, 0.7], [sg * (0.72 + w), 1.3]], SHINE, 0.013);
        strand(c, [[sg * 0.55, 0.9], [sg * (0.58 + w), 1.25], [sg * (0.54 + w), 1.5]], SHINE, 0.011);
      }
    },
    front(c, g, p) { capFront(c, g, p, true); },
  },
  spiky: {
    back(c, g, p) {
      const pts = [];
      const cx = 0, cy = -0.15, n = 11;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI * (1.02 + (i / n) * 0.96);  // sweep over the top of the head
        const rOut = 1.0 + ((i * 7) % 3) * 0.08, rIn = 0.66;
        pts.push([cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut]);
        if (i < n) {
          const b = a + (Math.PI * 0.96) / n / 2;
          pts.push([cx + Math.cos(b) * rIn, cy + Math.sin(b) * rIn]);
        }
      }
      pts.push([0.62, 0.3], [0, 0.4], [-0.62, 0.3]);
      const path = jagged(pts);
      paint(c, g, path, p, -1.2, 0.4, 0.022);
      for (let i = 1; i < 11; i += 2) {
        const a = Math.PI * (1.02 + (i / 11) * 0.96);
        strand(c, [[Math.cos(a) * 0.5, -0.15 + Math.sin(a) * 0.5], [Math.cos(a) * 0.95, -0.15 + Math.sin(a) * 0.95]], INK, 0.016);
      }
      for (let i = 2; i < 11; i += 2) {
        const a = Math.PI * (1.02 + (i / 11) * 0.96) + 0.03;
        strand(c, [[Math.cos(a) * 0.5, -0.15 + Math.sin(a) * 0.5], [Math.cos(a) * 0.85, -0.15 + Math.sin(a) * 0.85]], SHINE, 0.012);
      }
    },
    front(c, g, p) {
      // spiky fringe: downward points over the forehead
      const vy = Math.min(hairY(g) + 0.06, -0.3), ty = Math.min(hairY(g) + 0.26, -0.1);
      const pts = [[-0.6, ty - 0.06], [-0.62, -0.5], [-0.3, -0.66], [0, -0.7], [0.3, -0.66], [0.62, -0.5], [0.6, ty - 0.06]];
      for (let i = 0; i < 11; i++) {
        const x = 0.5 - i * 0.1;
        pts.push([x, i % 2 ? vy : ty - Math.abs(x) * 0.1]);
      }
      paint(c, g, jagged(pts), p, -1.2, 0.4, 0.016, vy - 0.12);
      for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) strand(c, [[x * 0.8, -0.6], [x, vy + 0.08]], INK, 0.013);
    },
  },
  bun: {
    back(c, g, p) {
      const cap = blob([[0, -0.9], [0.45, -0.85], [0.7, -0.55], [0.76, -0.15], [0.62, 0.2], [0, 0.3], [-0.62, 0.2], [-0.76, -0.15], [-0.7, -0.55], [-0.45, -0.85]]);
      paint(c, g, cap, p, -0.9, 0.3);
      // slicked strands converging up toward the bun
      for (const x of [-0.6, -0.4, -0.2, 0.2, 0.4, 0.6]) strand(c, [[x, -0.1], [x * 0.7, -0.5], [x * 0.25, -0.82]], INK, 0.014);
      for (const x of [-0.5, -0.3, 0.3, 0.5]) strand(c, [[x, -0.2], [x * 0.6, -0.55], [x * 0.2, -0.8]], SHINE, 0.011);
      // the bun with a swirl
      const bunPath = new Path2D(); bunPath.arc(0, -1.02, 0.28, 0, TAU);
      paint(c, g, bunPath, p, -1.3, -0.75, 0.018);
      c.beginPath(); c.arc(0.02, -1.03, 0.18, 0.3, 4.9); c.strokeStyle = INK; c.lineWidth = 0.016; c.stroke();
      c.beginPath(); c.arc(-0.02, -1.0, 0.09, 1.5, 6.0); c.strokeStyle = INK; c.lineWidth = 0.014; c.stroke();
      c.beginPath(); c.arc(-0.04, -1.08, 0.2, 3.4, 4.6); c.strokeStyle = SHINE; c.lineWidth = 0.016; c.stroke();
      // scrunchie
      ellipse(c, 0, -0.78, 0.21, 0.07, 0, p.accent, p.line, 0.012);
      for (let i = -3; i <= 3; i++) circle(c, i * 0.06, -0.78 + (i % 2 ? 0.025 : -0.025), 0.035, p.accent, p.line, 0.01);
      // loose wisps at the temples
      for (const sg of [-1, 1]) {
        strand(c, [[sg * 0.6, -0.3], [sg * 0.7, 0.1], [sg * 0.62, 0.45]], p.base, 0.03);
        strand(c, [[sg * 0.6, -0.3], [sg * 0.7, 0.1], [sg * 0.62, 0.45]], INK, 0.012);
      }
    },
    front(c, g, p) { capFront(c, g, p, false); },
  },
};

// One curl: a shaded circle with a spiral hint and a highlight.
function curl(c, p, x, y, r) {
  const gr = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  if (p.rainbow) { gr.addColorStop(0, '#ffe03b'); gr.addColorStop(1, '#ff9f1c'); }
  else { gr.addColorStop(0, p.light); gr.addColorStop(1, p.dark); }
  circle(c, x, y, r, gr, p.line, 0.014);
  c.beginPath(); c.arc(x + r * 0.08, y + r * 0.08, r * 0.5, 0.6, 5.2); c.strokeStyle = INK; c.lineWidth = 0.012; c.stroke();
  circle(c, x - r * 0.35, y - r * 0.38, r * 0.18, 'rgba(255,255,255,0.55)');
}

const VARIANTS = [
  ['Pink Bob', 'bob', palette('#ff5fa8', '#ffe03b')],
  ['Blue Mohawk', 'mohawk', palette('#2f7bff', '#ffe03b')],
  ['Blonde Curls', 'curls', palette('#f2c744', '#ff5fa8')],
  ['Purple Pigtails', 'pigtails', palette('#8e44ff', '#ffe03b')],
  ['Rainbow Afro', 'afro', RAINBOW],
  ['Long Black', 'long', palette('#262638', '#ff5fa8')],
  ['Red Spiky', 'spiky', palette('#e8262b', '#ffe03b')],
  ['Green Bun', 'bun', palette('#2fbf5f', '#ff5fa8')],
];

export const WIGS = [
  {
    id: 'wigs', name: 'Wigs', icon: '💇',
    variants: VARIANTS.map((v) => v[0]),
    face(c, g, t, v) {
      const [, styleName, p] = VARIANTS[((v || 0) % VARIANTS.length + VARIANTS.length) % VARIANTS.length];
      const style = STYLES[styleName];
      const now = t || 0;
      c.save();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      style.back(c, g, p, now);
      if (style.punch !== false) punchFace(c, g);
      style.front(c, g, p, now);
      c.restore();
    },
  },
];
