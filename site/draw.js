// Shared canvas drawing helpers for Silly Cam filters.
//
// Face props are drawn in "face units": origin between the eyes, +x toward image-right,
// +y downward, 1 unit = face width (cheek to cheek). By the time a face filter runs, the
// context is already translated to the face, rotated to the head tilt and scaled, so every
// size below is a fraction of the face width. Useful landmarks on `g` (all in face units):
//   g.eyeA (image-left eye centre), g.eyeB (image-right eye centre), g.nose (tip),
//   g.lipTop (inner upper lip), g.mouth.c (mouth centre), g.mouth.open (0 closed … ~0.3 wide open),
//   g.mouth.w (mouth width), g.hair (hairline top centre, ~y -0.4), g.chin (~y +0.85),
//   g.cheekL / g.cheekR (the two points that define face width, ~x ∓0.5).
// Also on g: g.s (face width in pixels), g.angle (tilt), g.mid (pixel centre between the eyes),
// g.local(pt)/g.global(x,y) converters, g.video (the live <video>), g.W/g.H (canvas size),
// g.fx.sparkleAt(px,py,color) and g.fx.confetti() for particles (pixel coordinates).

export const TAU = Math.PI * 2;

export function ellipse(c, x, y, rx, ry, rot, fill, stroke, lw) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 0.02; c.stroke(); }
}
export function circle(c, x, y, r, fill, stroke, lw) { ellipse(c, x, y, r, r, 0, fill, stroke, lw); }
export function poly(c, pts, fill, stroke, lw) {
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 0.02; c.stroke(); }
}
export function rrect(c, x, y, w, h, r, fill, stroke, lw) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 0.02; c.stroke(); }
}
export function line(c, x1, y1, x2, y2, stroke, lw) {
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
  c.strokeStyle = stroke; c.lineWidth = lw; c.stroke();
}
// A smooth curve through control points [[x,y],...] (quadratic midpoints), optionally closed.
export function curve(c, pts, fill, stroke, lw, closed) {
  if (pts.length < 2) return;
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  c.lineTo(last[0], last[1]);
  if (closed) c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 0.02; c.stroke(); }
}
// Emoji text inside the scaled face frame: undo the scale so font sizes stay sane.
export function emoji(c, g, txt, x, y, size) {
  c.save();
  c.translate(x, y);
  c.scale(1 / g.s, 1 / g.s);
  c.font = `${Math.round(size * g.s)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#000';
  c.fillText(txt, 0, 0);
  c.restore();
}
// Copy a region of the live video into the face frame, scaled by k around a local point.
// k = 1 "punches a hole" that shows the real face (eyes, mouth) through a mask; k > 1 zooms.
// The copy is axis-aligned in video space, so it is drawn in a counter-rotated frame.
export function zoomPatch(c, g, lx, ly, rx, ry, k, shape) {
  const video = g.video;
  const gp = g.global(lx, ly);
  const sw = (rx * g.s) / k, sh = (ry * g.s) / k;
  // Clamp the source rectangle to the frame (some browsers draw nothing for an out-of-bounds
  // source) and shrink the destination to match.
  const VW = video.videoWidth, VH = video.videoHeight;
  const sx0 = Math.max(0, gp.x - sw), sy0 = Math.max(0, gp.y - sh);
  const sx1 = Math.min(VW, gp.x + sw), sy1 = Math.min(VH, gp.y + sh);
  if (sx1 <= sx0 || sy1 <= sy0) return;
  const fx = rx / sw, fy = ry / sh;                       // destination units per source pixel
  const dx0 = -rx + (sx0 - (gp.x - sw)) * fx, dy0 = -ry + (sy0 - (gp.y - sh)) * fy;
  c.save();
  c.translate(lx, ly);
  c.rotate(-g.angle);
  c.beginPath();
  if (shape === 'circle') c.arc(0, 0, rx, 0, TAU); else c.ellipse(0, 0, rx, ry, 0, 0, TAU);
  c.clip();
  c.drawImage(video, sx0, sy0, sx1 - sx0, sy1 - sy0, dx0, dy0, (sx1 - sx0) * fx, (sy1 - sy0) * fy);
  c.restore();
}
export function star(c, x, y, r, rot, color, alpha) {
  c.save();
  c.translate(x, y); c.rotate(rot);
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 ? r * 0.38 : r;
    const a = (i / 8) * TAU;
    const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
    if (i) c.lineTo(px, py); else c.moveTo(px, py);
  }
  c.closePath(); c.fill();
  c.restore();
}
// A seeded pseudo-random generator for textures that must look the same every frame.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
// A fur texture (short strokes) rendered once into an offscreen canvas and returned as a
// CanvasPattern in face units. Draw it over a fill with c.globalCompositeOperation = 'multiply'
// or 'soft-light' for a furry look. `size` is the pattern tile in pixels.
const patternCache = new Map();
export function furPattern(c, g, color, seed = 7, size = 128) {
  const key = color + ':' + seed + ':' + size;
  let tile = patternCache.get(key);
  if (!tile) {
    tile = document.createElement('canvas');
    tile.width = tile.height = size;
    const x = tile.getContext('2d');
    const rnd = seeded(seed);
    x.strokeStyle = color; x.lineCap = 'round'; x.lineWidth = 1.2;
    for (let i = 0; i < size * 6; i++) {
      const px = rnd() * size, py = rnd() * size, len = 3 + rnd() * 6, a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
      x.globalAlpha = 0.25 + rnd() * 0.5;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
    }
    patternCache.set(key, tile);
  }
  const p = c.createPattern(tile, 'repeat');
  // The pattern repeats in pixels; scale it to face units so the strokes stay ~the same size on screen.
  if (p && p.setTransform) { const m = new DOMMatrix(); m.a = 1 / g.s; m.d = 1 / g.s; p.setTransform(m); }
  return p;
}
