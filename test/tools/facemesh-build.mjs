// Turns MediaPipe's canonical_face_model.obj into site/facemesh.json:
//   uv  : 936 numbers, the texture coordinate of each of the 468 landmarks (u, v in 0..1, v down)
//   tri : landmark index triples for every triangle except the ones filling the eyes and the inner mouth,
//         so the real eyes and mouth show through the texture
//   oval: the face-oval contour landmarks (used to feather the edge)
import fs from 'node:fs';
const [,, objPath, outPath] = process.argv;
const txt = fs.readFileSync(objPath, 'utf8');
const vt = [], uvOf = new Map(), tris = [];
for (const line of txt.split(/\r?\n/)) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'vt') vt.push([Number(p[1]), 1 - Number(p[2])]);         // obj v is up; canvas/WebGL texture rows are down
  if (p[0] === 'f') {
    const corners = p.slice(1).map((c) => c.split('/').map((n) => Number(n) - 1));
    for (const [vi, ti] of corners) {
      const prev = uvOf.get(vi);
      if (prev !== undefined && prev !== ti) throw new Error(`vertex ${vi} has two UVs`);
      uvOf.set(vi, ti);
    }
    tris.push(corners.map((c) => c[0]));
  }
}
if (uvOf.size !== 468) throw new Error('expected 468 vertices with UVs, got ' + uvOf.size);
const uv = [];
for (let i = 0; i < 468; i++) { const [u, v] = vt[uvOf.get(i)]; uv.push(+u.toFixed(5), +v.toFixed(5)); }

const EYE_R = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const EYE_L = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const holes = [new Set(EYE_R), new Set(EYE_L), new Set(LIPS_IN)];
let dropped = 0;
const kept = tris.filter((t) => { const inHole = holes.some((h) => t.every((i) => h.has(i))); if (inHole) dropped++; return !inHole; });
console.log(`triangles ${tris.length}, dropped ${dropped} (eye + inner mouth), kept ${kept.length}`);
fs.writeFileSync(outPath, JSON.stringify({ uv, tri: kept.flat(), oval: OVAL }));
console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
