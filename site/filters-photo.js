// Photo animal faces: a real animal picture stretched over the tracked face mesh (mesh.js), with the rest
// of the animal's head drawn flat behind it, lined up on the eyes. The eyes and the inside of the mouth
// are holes in the mesh, so the child's own eyes and mouth show through the animal's face.
//
// The pictures were generated with Canva (2026-11-08) and keyed to a transparent background with the
// chest faded out (test tooling, see CLAUDE.md). `pts` says where the nine alignment points sit in each
// picture, as fractions of its width and height (L = image-left), read off a labelled grid by hand.
import { EYE_L, EYE_R, CANON_DROP, textureCoords, createMeshRenderer } from './mesh.js';

const DEFS = [
  { id: 'photo-fox', name: 'Real Fox', icon: '🦊', src: './animals/fox.webp',
    pts: { eyeL: [0.36, 0.555], eyeR: [0.635, 0.555], nose: [0.5, 0.76], mouthL: [0.42, 0.82], mouthR: [0.58, 0.82], chin: [0.5, 0.9], top: [0.5, 0.26], sideL: [0.17, 0.62], sideR: [0.83, 0.62] } },
  { id: 'photo-chihuahua', name: 'Real Puppy', icon: '🐕', src: './animals/chihuahua.webp', scale: 1.2,   // narrow head: draw it bigger so it covers the hair
    pts: { eyeL: [0.345, 0.555], eyeR: [0.665, 0.555], nose: [0.5, 0.745], mouthL: [0.41, 0.83], mouthR: [0.59, 0.83], chin: [0.5, 0.89], top: [0.5, 0.3], sideL: [0.195, 0.62], sideR: [0.805, 0.62] } },
  { id: 'photo-cat', name: 'Real Cat', icon: '🐈', src: './animals/cat.webp',
    pts: { eyeL: [0.355, 0.535], eyeR: [0.645, 0.535], nose: [0.5, 0.73], mouthL: [0.43, 0.79], mouthR: [0.57, 0.79], chin: [0.5, 0.86], top: [0.5, 0.24], sideL: [0.14, 0.6], sideR: [0.86, 0.6] } },
  { id: 'photo-tiger', name: 'Real Tiger', icon: '🐅', src: './animals/tiger.webp',
    pts: { eyeL: [0.37, 0.405], eyeR: [0.635, 0.405], nose: [0.5, 0.65], mouthL: [0.4, 0.72], mouthR: [0.6, 0.72], chin: [0.5, 0.84], top: [0.5, 0.14], sideL: [0.13, 0.5], sideR: [0.87, 0.5] } },
];

let renderer = null, rendererFailed = false;
function ensureRenderer() {
  if (rendererFailed) return null;
  if (!renderer || renderer.lost) {
    try { renderer = createMeshRenderer(); } catch (e) { console.warn('mesh renderer unavailable', e); renderer = null; }
    if (!renderer) rendererFailed = true;
  }
  return renderer;
}
function load(def) {
  if (def.image) return;
  const img = new Image();
  def.image = img;
  img.decoding = 'async';
  img.onload = () => { def.uvs = textureCoords(def.pts); def.ready = true; };
  img.onerror = () => { def.failed = true; console.warn('animal picture missing', def.src); };
  img.src = def.src;
}
const centre = (lm, ids, W, H) => {
  let x = 0, y = 0;
  for (const i of ids) { x += lm[i].x; y += lm[i].y; }
  return { x: (x / ids.length) * W, y: (y / ids.length) * H };
};

function makeFilter(def) {
  return {
    id: def.id, name: def.name, icon: def.icon,
    reset() { load(def); },
    scene(c, geoms, t, dt, W, H, v, env) {
      load(def);
      if (def.failed) { env.hud('That animal is not available right now.'); return; }
      if (!def.ready) { env.hud('Fetching the animal…'); return; }
      const r = ensureRenderer();
      if (!r) { env.hud('This device cannot show photo animals.'); return; }
      env.hud(geoms.length ? '' : 'Come closer so I can see your face');
      const img = def.image, iw = img.naturalWidth, ih = img.naturalHeight;
      const eL = def.pts.eyeL, eR = def.pts.eyeR;
      const imgMid = { x: ((eL[0] + eR[0]) / 2) * iw, y: ((eL[1] + eR[1]) / 2) * ih };
      const imgEye = Math.hypot((eR[0] - eL[0]) * iw, (eR[1] - eL[1]) * ih);
      const imgTilt = Math.atan2((eR[1] - eL[1]) * ih, (eR[0] - eL[0]) * iw);
      for (const g of geoms) {
        // The whole head, flat, behind the face: placed on the eye line. A turned head narrows the eye
        // distance, so the eye-line-to-chin drop (which does not narrow) also votes on the size.
        const a = centre(g.lm, EYE_L, W, H), b = centre(g.lm, EYE_R, W, H);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const chin = { x: g.lm[152].x * W, y: g.lm[152].y * H };
        const eye = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(chin.x - mid.x, chin.y - mid.y) / CANON_DROP);
        const k = (eye / imgEye) * (def.scale || 1);
        c.save();
        c.translate(mid.x, mid.y);
        c.rotate(Math.atan2(b.y - a.y, b.x - a.x) - imgTilt);
        c.scale(k, k);
        c.translate(-imgMid.x, -imgMid.y);
        c.drawImage(img, 0, 0);
        c.restore();
      }
      r.draw(c, geoms.map((g) => g.lm), img, def.uvs, W, H);   // the face itself, stretched over the mesh
    },
  };
}
export const PHOTO = DEFS.map(makeFilter);
DEFS.forEach(load);   // start fetching the pictures now so the first tap does not wait
