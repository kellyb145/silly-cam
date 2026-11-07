// Silly Cam animal face covers: the whole head becomes the animal (fur, ears, muzzle, nose,
// markings) while the real eyes and mouth show through holes. Drawn in face units (see draw.js).
import { ellipse, circle, poly, line, curve, zoomPatch, furPattern, TAU } from './draw.js';

// ---------- shared building blocks ----------

const HEAD = { x: 0, y: 0.15, rx: 0.8, ry: 1.0 };

function headPath(c, rx = HEAD.rx, ry = HEAD.ry) {
  c.beginPath();
  c.ellipse(HEAD.x, HEAD.y, rx, ry, 0, 0, TAU);
}

// Fill the path built by `pathFn` with a gradient (light centre, darker rim), then multiply a
// cached fur texture over it. Every state change stays inside save/restore.
function furFill(c, g, pathFn, light, dark, furColour, seed, mode = 'multiply') {
  c.save();
  pathFn(c);
  const grad = c.createRadialGradient(0, 0.05, 0.12, 0, 0.25, 1.15);
  grad.addColorStop(0, light);
  grad.addColorStop(0.55, light);
  grad.addColorStop(1, dark);
  c.fillStyle = grad;
  c.fill();
  c.clip();
  c.globalCompositeOperation = mode;
  c.fillStyle = furPattern(c, g, furColour, seed);
  c.fillRect(-1.6, -1.6, 3.2, 3.4);
  c.restore();
}

function furHead(c, g, light, dark, furColour, seed, rx, ry) {
  furFill(c, g, (x) => headPath(x, rx, ry), light, dark, furColour, seed);
}

// Pointy ears (fox, cat). `layer` 'back' draws the outer ear (before the head so the head
// covers its base), 'front' draws the inner ear on top of the head.
function pointyEars(c, layer, outer, edge, inner, tip) {
  for (const sg of [-1, 1]) {
    if (layer === 'back') {
      poly(c, [[sg * 0.2, -0.66], [sg * 0.8, -0.34], [sg * 0.7, -1.22]], outer, edge, 0.025);
      if (tip) poly(c, [[sg * 0.6, -0.92], [sg * 0.76, -0.84], [sg * 0.7, -1.22]], tip);
    } else {
      poly(c, [[sg * 0.36, -0.64], [sg * 0.7, -0.46], [sg * 0.66, -1.05]], inner);
    }
  }
}

// Round ears (tiger, panda, lion). Same two layers as pointyEars.
function roundEars(c, layer, outer, edge, inner, x = 0.6, y = -0.66, r = 0.24) {
  for (const sg of [-1, 1]) {
    if (layer === 'back') circle(c, sg * x, y, r, outer, edge, 0.025);
    else circle(c, sg * x, y - 0.02, r * 0.5, inner);
  }
}

// Eye holes: the real eyes show through. Drawn in a counter-rotated frame so the rim matches
// the axis-aligned clip that zoomPatch uses.
function eyeHoles(c, g, rim = 'rgba(0,0,0,0.6)', rx = 0.145, ry = 0.095) {
  for (const e of [g.eyeA, g.eyeB]) {
    zoomPatch(c, g, e.x, e.y, rx, ry, 1, 'ellipse');
    c.save();
    c.translate(e.x, e.y);
    c.rotate(-g.angle);
    ellipse(c, 0, 0, rx, ry, 0, null, rim, 0.02);
    c.restore();
  }
}

function mouthRadii(g) {
  return [g.mouth.w / 2 + 0.05, 0.06 + g.mouth.open * 0.6];
}

// Mouth hole: follows the mouth opening.
function mouthHole(c, g, rim = 'rgba(0,0,0,0.6)') {
  const [rx, ry] = mouthRadii(g);
  zoomPatch(c, g, g.mouth.c.x, g.mouth.c.y, rx, ry, 1, 'ellipse');
  c.save();
  c.translate(g.mouth.c.x, g.mouth.c.y);
  c.rotate(-g.angle);
  ellipse(c, 0, 0, rx, ry, 0, null, rim, 0.02);
  c.restore();
}

// The line from the nose down to the mouth hole, plus a small "w" curl at the top of the hole.
function philtrum(c, g, colour, lw = 0.022) {
  const top = g.mouth.c.y - mouthRadii(g)[1] - 0.005;
  c.save();
  c.lineCap = 'round';
  line(c, g.nose.x, g.nose.y + 0.05, g.mouth.c.x, top, colour, lw);
  for (const sg of [-1, 1]) {
    curve(c, [[g.mouth.c.x, top], [g.mouth.c.x + sg * 0.08, top - 0.02], [g.mouth.c.x + sg * 0.15, top + 0.01]], null, colour, lw);
  }
  c.restore();
}

// Cat-style nose: a rounded triangle on the nose tip with a highlight.
function triNose(c, g, fill, edge) {
  const n = g.nose;
  c.save();
  c.lineJoin = 'round';
  poly(c, [[n.x - 0.085, n.y - 0.035], [n.x + 0.085, n.y - 0.035], [n.x, n.y + 0.065]], fill, edge, 0.025);
  ellipse(c, n.x - 0.03, n.y - 0.015, 0.02, 0.011, -0.3, 'rgba(255,255,255,0.6)');
  c.restore();
}

// Dog/bear-style nose: a big oval with a highlight.
function ovalNose(c, g, fill, rx = 0.13, ry = 0.09) {
  const n = g.nose;
  ellipse(c, n.x, n.y + 0.01, rx, ry, 0, fill);
  ellipse(c, n.x - rx * 0.35, n.y - ry * 0.3, rx * 0.26, ry * 0.2, -0.3, 'rgba(255,255,255,0.7)');
}

// Whiskers from the muzzle outward: a faint dark shadow line under each light line.
function whiskers(c, g, colour = '#ffffff', shadow = 'rgba(0,0,0,0.35)') {
  const y0 = g.nose.y + 0.06;
  c.save();
  c.lineCap = 'round';
  for (const sg of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      const x1 = sg * 0.16, y1 = y0 + k * 0.035;
      const x2 = sg * 0.82, y2 = g.nose.y - 0.03 + k * 0.14;
      line(c, x1, y1 + 0.012, x2, y2 + 0.012, shadow, 0.03);
      line(c, x1, y1, x2, y2, colour, 0.014);
    }
  }
  c.restore();
}

// A thick, round-capped stroke along control points (stripes, hair tufts).
function stroke(c, pts, colour, lw) {
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  curve(c, pts, null, colour, lw);
  c.restore();
}

// ---------- the animals ----------

export const ANIMALS = [
  {
    id: 'fox', name: 'Fox', icon: '🦊',
    face(c, g) {
      pointyEars(c, 'back', '#e0661f', '#7a3310', null, '#2a1a12');
      furHead(c, g, '#f7a052', '#cf5c1c', '#c0601f', 11);
      pointyEars(c, 'front', null, null, '#fbe9dc');
      // white cheeks and chin
      const my = g.mouth.c.y;
      for (const sg of [-1, 1]) ellipse(c, sg * 0.24, my - 0.03, 0.3, 0.23, sg * 0.25, '#fff7ee');
      ellipse(c, 0, my + 0.18, 0.26, 0.2, 0, '#fff7ee');
      // white inner brows
      for (const e of [g.eyeA, g.eyeB]) ellipse(c, e.x, e.y - 0.14, 0.1, 0.04, 0, 'rgba(255,247,238,0.7)');
      // dark tear marks running from the eyes down the muzzle
      for (const [e, sg] of [[g.eyeA, -1], [g.eyeB, 1]]) {
        ellipse(c, e.x - sg * 0.05, e.y + 0.18, 0.03, 0.1, -sg * 0.3, 'rgba(60,30,15,0.75)');
      }
      // nose and mouth line
      triNose(c, g, '#1a1a1a', '#000');
      philtrum(c, g, '#2b1a12');
      whiskers(c, g);
      // holes last
      eyeHoles(c, g, 'rgba(40,20,10,0.7)');
      mouthHole(c, g, 'rgba(40,20,10,0.7)');
    },
  },
  {
    id: 'catface', name: 'Cat Face', icon: '🐱',
    face(c, g) {
      pointyEars(c, 'back', '#a3a3a3', '#555', null, null);
      furHead(c, g, '#c7c7c7', '#8a8a8a', '#6e6e6e', 23);
      pointyEars(c, 'front', null, null, '#f7b7c3');
      // tabby "M" on the forehead and cheek stripes
      const S = '#4f4f4f';
      stroke(c, [[0, -0.34], [0.01, -0.55], [0, -0.78]], S, 0.045);
      for (const sg of [-1, 1]) {
        stroke(c, [[sg * 0.2, -0.3], [sg * 0.24, -0.5], [sg * 0.3, -0.72]], S, 0.045);
        stroke(c, [[sg * 0.38, -0.36], [sg * 0.44, -0.52], [sg * 0.52, -0.62]], S, 0.04);
        for (let k = 0; k < 3; k++) {
          const y = 0.05 + k * 0.17;
          stroke(c, [[sg * 0.78, y], [sg * 0.64, y + 0.05], [sg * 0.54, y + 0.1]], S, 0.04);
        }
      }
      // light muzzle lobes and chin
      const ny = g.nose.y;
      for (const sg of [-1, 1]) circle(c, sg * 0.15, ny + 0.12, 0.19, '#efefef');
      ellipse(c, 0, g.mouth.c.y + 0.15, 0.2, 0.13, 0, '#efefef');
      // nose, mouth line, whiskers
      triNose(c, g, '#f48aa0', '#b85c72');
      philtrum(c, g, '#3a3a3a');
      whiskers(c, g);
      eyeHoles(c, g, 'rgba(30,30,30,0.7)');
      mouthHole(c, g, 'rgba(30,30,30,0.7)');
    },
  },
  {
    id: 'tiger', name: 'Tiger', icon: '🐯',
    face(c, g) {
      roundEars(c, 'back', '#e8841f', '#5a2a08', null, 0.6, -0.64, 0.24);
      furHead(c, g, '#f9a63c', '#d9731c', '#b8581a', 31);
      roundEars(c, 'front', null, null, '#fbe3c6', 0.6, -0.64, 0.24);
      // white cheek ruffs, brow spots and muzzle
      for (const sg of [-1, 1]) ellipse(c, sg * 0.64, 0.42, 0.2, 0.34, sg * 0.15, '#fff5e6');
      for (const e of [g.eyeA, g.eyeB]) ellipse(c, e.x, e.y - 0.17, 0.11, 0.05, 0, '#fff5e6');
      const ny = g.nose.y;
      ellipse(c, 0, ny + 0.17, 0.38, 0.3, 0, '#fff5e6');
      // black stripes: centre line, forehead chevrons, cheek stripes, eye flicks
      const S = '#1b1b1b';
      stroke(c, [[0, -0.3], [0.01, -0.55], [0, -0.82]], S, 0.05);
      for (const y of [-0.36, -0.52, -0.68]) {
        stroke(c, [[-0.3, y + 0.08], [-0.15, y + 0.02], [-0.05, y - 0.04]], S, 0.045);
        stroke(c, [[0.3, y + 0.08], [0.15, y + 0.02], [0.05, y - 0.04]], S, 0.045);
      }
      for (const sg of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const y = 0.08 + k * 0.17;
          stroke(c, [[sg * 0.8, y - 0.04], [sg * 0.66, y + 0.02], [sg * 0.52, y + 0.1]], S, 0.045);
        }
        stroke(c, [[sg * 0.74, 0.62], [sg * 0.64, 0.72], [sg * 0.5, 0.82]], S, 0.04);
      }
      for (const [e, sg] of [[g.eyeA, -1], [g.eyeB, 1]]) {
        stroke(c, [[e.x + sg * 0.16, e.y + 0.02], [e.x + sg * 0.26, e.y + 0.06], [e.x + sg * 0.34, e.y + 0.14]], S, 0.035);
      }
      // nose, mouth line, whiskers
      triNose(c, g, '#c9655a', '#5a2a22');
      philtrum(c, g, '#2b1a12');
      whiskers(c, g);
      eyeHoles(c, g, 'rgba(20,20,20,0.75)');
      mouthHole(c, g, 'rgba(20,20,20,0.75)');
    },
  },
  {
    id: 'panda', name: 'Panda', icon: '🐼',
    face(c, g) {
      roundEars(c, 'back', '#1a1a1a', '#000', null, 0.6, -0.66, 0.26);
      furHead(c, g, '#ffffff', '#e4e4e4', '#c8c8c8', 41);
      roundEars(c, 'front', null, null, '#333', 0.6, -0.66, 0.26);
      // black eye patches tilted outward
      for (const [e, sg] of [[g.eyeA, -1], [g.eyeB, 1]]) {
        ellipse(c, e.x + sg * 0.03, e.y + 0.03, 0.21, 0.165, sg * 0.55, '#1a1a1a');
      }
      // rosy cheeks
      for (const sg of [-1, 1]) ellipse(c, sg * 0.4, g.nose.y + 0.12, 0.12, 0.08, 0, 'rgba(255,120,150,0.3)');
      // nose and mouth line
      ovalNose(c, g, '#1a1a1a', 0.12, 0.085);
      philtrum(c, g, '#1a1a1a');
      eyeHoles(c, g, 'rgba(0,0,0,0.8)');
      mouthHole(c, g, 'rgba(60,60,60,0.7)');
    },
  },
  {
    id: 'lion', name: 'Lion', icon: '🦁',
    face(c, g, t) {
      // the mane: a wavy disc behind the head
      const mane = (x) => {
        x.beginPath();
        const N = 22;
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * TAU;
          const r = 1.22 + (i % 2 ? 0.16 : 0) + 0.02 * Math.sin(t * 2 + i);
          const px = Math.cos(a) * r, py = 0.25 + Math.sin(a) * r * 1.05;
          if (i) x.lineTo(px, py); else x.moveTo(px, py);
        }
        x.closePath();
      };
      furFill(c, g, mane, '#b5641c', '#6e3a0f', '#5a2e0c', 59);
      roundEars(c, 'back', '#d49a40', '#6e3a0f', null, 0.62, -0.6, 0.22);
      furHead(c, g, '#eab85f', '#c98a35', '#a87530', 53, 0.76, 0.96);
      roundEars(c, 'front', null, null, '#7a4a1e', 0.62, -0.6, 0.22);
      // forehead tuft
      for (const x of [-0.14, -0.04, 0.08, 0.18]) stroke(c, [[x, -0.5], [x - 0.06, -0.68], [x + 0.02, -0.86]], '#7a4a1e', 0.045);
      // lighter muzzle and chin, with whisker freckles
      const ny = g.nose.y;
      ellipse(c, 0, ny + 0.18, 0.4, 0.32, 0, '#f5dcb0');
      for (const sg of [-1, 1]) for (let k = 0; k < 3; k++) circle(c, sg * (0.12 + k * 0.08), ny + 0.1 + (k % 2) * 0.04, 0.012, '#6b4a2a');
      // nose, mouth line, whiskers
      c.save();
      c.lineJoin = 'round';
      poly(c, [[g.nose.x - 0.11, g.nose.y - 0.04], [g.nose.x + 0.11, g.nose.y - 0.04], [g.nose.x, g.nose.y + 0.08]], '#3a2416', '#241610', 0.03);
      c.restore();
      ellipse(c, g.nose.x - 0.04, g.nose.y - 0.02, 0.022, 0.012, -0.3, 'rgba(255,255,255,0.5)');
      philtrum(c, g, '#3a2416');
      whiskers(c, g, '#fff3dd');
      eyeHoles(c, g, 'rgba(50,30,10,0.75)');
      mouthHole(c, g, 'rgba(50,30,10,0.75)');
    },
  },
  {
    id: 'dogface', name: 'Dog Face', icon: '🐕',
    face(c, g) {
      furHead(c, g, '#f6ead8', '#d9c3a3', '#b89a74', 67, 0.78, 0.96);
      // brown patch over the image-right eye
      ellipse(c, g.eyeB.x + 0.03, g.eyeB.y - 0.03, 0.25, 0.2, 0.3, '#7a4a21');
      // floppy ears hanging in front of the head sides
      for (const sg of [-1, 1]) {
        ellipse(c, sg * 0.74, 0.12, 0.21, 0.5, sg * 0.22, '#7a4a21', '#4e2d12', 0.025);
        ellipse(c, sg * 0.75, 0.18, 0.11, 0.36, sg * 0.22, '#9a6436');
      }
      // white muzzle with freckles
      const ny = g.nose.y;
      ellipse(c, 0, ny + 0.17, 0.36, 0.3, 0, '#ffffff');
      for (const sg of [-1, 1]) for (let k = 0; k < 3; k++) circle(c, sg * (0.1 + k * 0.08), ny + 0.12 + (k % 2) * 0.04, 0.012, '#5a3a22');
      // nose and mouth line
      ovalNose(c, g, '#1a1a1a', 0.14, 0.1);
      philtrum(c, g, '#2b1a12');
      eyeHoles(c, g, 'rgba(30,20,10,0.7)');
      mouthHole(c, g, 'rgba(30,20,10,0.7)');
    },
  },
];
