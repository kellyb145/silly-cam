// Silly Cam age looks: Grandpa, Grandma and Baby. Drawn props and wrinkles in face units (see draw.js).
// These are costume-style looks, not a transformed face.
import { ellipse, circle, poly, line, curve, zoomPatch } from './draw.js';

function wrinkles(c, g) {
  c.save();
  c.strokeStyle = 'rgba(70,35,20,0.32)';
  c.lineWidth = 0.012;
  // forehead lines
  for (const y of [-0.26, -0.32, -0.38]) curve(c, [[-0.28, y + 0.02], [-0.14, y - 0.01], [0, y - 0.02], [0.14, y - 0.01], [0.28, y + 0.02]], null, 'rgba(70,35,20,0.32)', 0.012);
  // crow's feet at the outer eye corners
  for (const [e, sg] of [[g.eyeA, -1], [g.eyeB, 1]]) {
    for (const k of [-1, 0, 1]) line(c, e.x + sg * 0.17, e.y + k * 0.03, e.x + sg * 0.3, e.y + k * 0.07, 'rgba(70,35,20,0.3)', 0.011);
    // bags under the eyes
    curve(c, [[e.x - 0.1, e.y + 0.1], [e.x, e.y + 0.14], [e.x + 0.1, e.y + 0.1]], null, 'rgba(70,35,20,0.22)', 0.012);
  }
  // smile lines from the nose to the mouth corners
  for (const sg of [-1, 1]) curve(c, [[g.nose.x + sg * 0.12, g.nose.y - 0.02], [g.nose.x + sg * 0.2, g.nose.y + 0.14], [g.mouth.c.x + sg * (g.mouth.w / 2 + 0.06), g.mouth.c.y + 0.06]], null, 'rgba(70,35,20,0.3)', 0.013);
  c.restore();
}
function oldSkin(c) {
  // a faint grey wash, fading to nothing at the edge, dulls the skin a little
  const grad = c.createRadialGradient(0, 0.28, 0.1, 0, 0.28, 0.7);
  grad.addColorStop(0, 'rgba(165,160,155,0.14)');
  grad.addColorStop(1, 'rgba(165,160,155,0)');
  ellipse(c, 0, 0.28, 0.7, 0.9, 0, grad);
}
function greyBrows(c, g) {
  for (const e of [g.eyeA, g.eyeB]) {
    curve(c, [[e.x - 0.16, e.y - 0.12], [e.x, e.y - 0.17], [e.x + 0.16, e.y - 0.12]], null, '#cfcfcf', 0.06);
    for (let i = -3; i <= 3; i++) line(c, e.x + i * 0.045, e.y - 0.13, e.x + i * 0.045 + 0.02, e.y - 0.2, '#e8e8e8', 0.014);
  }
}

export const AGE = [
  {
    id: 'grandpa', name: 'Grandpa', icon: '👴',
    face(c, g) {
      oldSkin(c);
      // side tufts and a few wisps on top
      for (const sg of [-1, 1]) ellipse(c, sg * 0.5, -0.18, 0.14, 0.3, sg * 0.15, '#d9d9d9', '#bdbdbd', 0.015);
      for (const x of [-0.18, -0.06, 0.08, 0.2]) curve(c, [[x, -0.42], [x + 0.04, -0.56], [x - 0.03, -0.7]], null, '#d9d9d9', 0.02);
      wrinkles(c, g);
      greyBrows(c, g);
      // beard with the real mouth showing through
      ellipse(c, 0, 0.72, 0.44, 0.34, 0, '#d6d6d6', '#bdbdbd', 0.015);
      zoomPatch(c, g, g.mouth.c.x, g.mouth.c.y, g.mouth.w / 2 + 0.06, 0.07 + g.mouth.open * 0.6, 1, 'ellipse');
      // moustache
      const y = g.nose.y + 0.09;
      c.fillStyle = '#d0d0d0';
      for (const sg of [-1, 1]) {
        c.beginPath();
        c.moveTo(0, y);
        c.bezierCurveTo(sg * 0.12, y - 0.08, sg * 0.26, y - 0.08, sg * 0.32, y - 0.12);
        c.bezierCurveTo(sg * 0.28, y + 0.03, sg * 0.14, y + 0.07, 0, y + 0.03);
        c.closePath(); c.fill();
      }
      // round glasses
      for (const e of [g.eyeA, g.eyeB]) circle(c, e.x, e.y, 0.14, 'rgba(255,255,255,0.08)', '#4a4a4a', 0.025);
      line(c, g.eyeA.x + 0.14, g.eyeA.y, g.eyeB.x - 0.14, g.eyeB.y, '#4a4a4a', 0.025);
      line(c, g.eyeA.x - 0.14, g.eyeA.y, -0.62, g.eyeA.y - 0.04, '#4a4a4a', 0.025);
      line(c, g.eyeB.x + 0.14, g.eyeB.y, 0.62, g.eyeB.y - 0.04, '#4a4a4a', 0.025);
    },
  },
  {
    id: 'grandma', name: 'Grandma', icon: '👵',
    face(c, g) {
      oldSkin(c);
      // grey hair cap and a bun on top
      ellipse(c, 0, -0.5, 0.58, 0.2, 0, '#e3e3e3', '#c4c4c4', 0.015);
      circle(c, 0, -0.78, 0.22, '#e6e6e6', '#c4c4c4', 0.015);
      for (let i = 0; i < 5; i++) { const a = -0.5 + i * 0.45; curve(c, [[-0.2 + i * 0.1, -0.6], [-0.17 + i * 0.1 + Math.sin(a) * 0.05, -0.75], [-0.14 + i * 0.1, -0.9]], null, '#f1f1f1', 0.015); }
      wrinkles(c, g);
      // cat-eye glasses
      for (const [e, sg] of [[g.eyeA, -1], [g.eyeB, 1]]) {
        ellipse(c, e.x, e.y, 0.16, 0.1, 0, 'rgba(255,255,255,0.08)', '#7b1fa2', 0.03);
        poly(c, [[e.x + sg * 0.12, e.y - 0.07], [e.x + sg * 0.22, e.y - 0.14], [e.x + sg * 0.16, e.y - 0.02]], '#7b1fa2');
      }
      line(c, g.eyeA.x + 0.16, g.eyeA.y, g.eyeB.x - 0.16, g.eyeB.y, '#7b1fa2', 0.025);
      line(c, g.eyeA.x - 0.2, g.eyeA.y - 0.1, -0.62, g.eyeA.y - 0.06, '#7b1fa2', 0.025);
      line(c, g.eyeB.x + 0.2, g.eyeB.y - 0.1, 0.62, g.eyeB.y - 0.06, '#7b1fa2', 0.025);
      // lipstick
      ellipse(c, g.mouth.c.x, g.mouth.c.y, g.mouth.w / 2 + 0.02, 0.05 + g.mouth.open * 0.5, 0, 'rgba(198,40,40,0.38)');
      // pearls under the chin
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * (0.18 + 0.064 * i);
        circle(c, Math.cos(a) * 0.5, 0.72 + Math.sin(a) * 0.3, 0.035, '#fdfdfd', '#bdbdbd', 0.008);
      }
    },
  },
  {
    id: 'baby', name: 'Baby', icon: '👶',
    face(c, g, t) {
      // big shiny eyes
      for (const e of [g.eyeA, g.eyeB]) {
        zoomPatch(c, g, e.x, e.y, 0.15, 0.15, 1.5, 'circle');
        ellipse(c, e.x - 0.05, e.y - 0.06, 0.03, 0.02, 0, 'rgba(255,255,255,0.75)');
      }
      // rosy cheeks
      for (const sg of [-1, 1]) ellipse(c, sg * 0.33, 0.3, 0.12, 0.08, 0, 'rgba(255,110,140,0.32)');
      // bonnet band with a bow and one curl of hair
      ellipse(c, 0, -0.5, 0.64, 0.19, 0, '#ffffff', '#f8bbd0', 0.02);
      for (const sg of [-1, 1]) ellipse(c, 0.52 + sg * 0.08, -0.62, 0.09, 0.06, sg * 0.6, '#f48fb1', '#ec407a', 0.012);
      circle(c, 0.52, -0.62, 0.035, '#ec407a');
      curve(c, [[0, -0.62], [0.08, -0.78], [-0.02, -0.9], [-0.1, -0.8]], null, '#f9c74f', 0.035);
      // pacifier until the mouth opens
      if (g.mouth.open < 0.06) {
        circle(c, g.mouth.c.x, g.mouth.c.y, 0.13, 'rgba(255,255,255,0.7)', '#42a5f5', 0.04);
        circle(c, g.mouth.c.x, g.mouth.c.y, 0.055, '#1e88e5', '#1565c0', 0.01);
      } else if (Math.random() < 0.06) {
        const p = g.global(g.mouth.c.x + (Math.random() - 0.5) * 0.4, g.mouth.c.y + 0.15);
        g.fx.sparkleAt(p.x, p.y, '#ffd23f');
      }
    },
  },
];
