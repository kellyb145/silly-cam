// Silly Cam games. Each game is a "scene" filter: scene(c, geoms, t, dt, W, H, v, env) runs once per
// frame after the camera picture is drawn, with every tracked face in `geoms` (see draw.js for the
// face geometry fields). Coordinates here are canvas pixels. Text goes through env.hud (score strip)
// and env.say (big label) because the canvas is mirrored for the front camera.
import { TAU, star } from './draw.js';

const ROUND_SECONDS = 30;
const READY_SECONDS = 3.2;
const OVER_SECONDS = 4;

// Shared round timing: ready countdown -> play -> over -> ready again.
function makeRound(key) {
  const r = { key, phase: 'ready', at: 0, score: 0, best: 0, items: [], lastSpawn: 0, lastCount: -1, lives: 3 };
  r.reset = (now) => { r.phase = 'ready'; r.at = now; r.score = 0; r.items.length = 0; r.lastSpawn = 0; r.lastCount = -1; r.lives = 3; };
  return r;
}
function tick(r, now, env, onStart) {
  if (r.at === 0) r.reset(now);
  if (r.phase === 'ready') {
    const left = READY_SECONDS - (now - r.at);
    const n = Math.ceil(left);
    if (n !== r.lastCount) { r.lastCount = n; env.say(n > 0 ? String(n) : 'Go!'); }
    env.hud('Get ready…');
    if (left <= 0) { r.phase = 'play'; r.at = now; r.lastSpawn = now; if (onStart) onStart(); }
    return false;
  }
  if (r.phase === 'over') {
    if (now - r.at > OVER_SECONDS) r.reset(now);
    return false;
  }
  return true;   // playing
}
function endRound(r, now, env, label) {
  r.phase = 'over'; r.at = now;
  r.best = env.best(r.key, r.score);
  env.say(label || "Time's up!");
  env.hud(`⭐ ${r.score}   Best ${r.best}`);
}
function timeLeft(r, now) { return Math.max(0, ROUND_SECONDS - (now - r.at)); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function pxFont(c, size) { c.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; }

// ---------------------------------------------------------------- Ring Nose: catch falling rings on your nose
const rings = makeRound('rings');
function drawRing(c, x, y, r, spin) {
  c.save();
  c.translate(x, y); c.rotate(spin);
  c.lineWidth = r * 0.42;
  c.strokeStyle = '#8d5a1e'; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
  c.lineWidth = r * 0.3;
  c.strokeStyle = '#ffb300'; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
  c.lineWidth = r * 0.1;
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.arc(0, 0, r * 1.05, Math.PI * 1.1, Math.PI * 1.6); c.stroke();
  c.restore();
}
const RING_GAME = {
  id: 'game-rings', name: 'Ring Nose', icon: '🍩',
  reset() { rings.at = 0; },
  scene(c, geoms, t, dt, W, H, v, env) {
    const r = rings;
    const R = W * 0.085;
    if (!tick(r, t, env)) { for (const it of r.items) drawRing(c, it.x, it.y, R, it.spin); return; }
    const elapsed = t - r.at;
    if (elapsed >= ROUND_SECONDS) { endRound(r, t, env); return; }
    const gap = Math.max(0.55, 1.3 - elapsed * 0.02);
    if (t - r.lastSpawn > gap) { r.lastSpawn = t; r.items.push({ x: rnd(W * 0.12, W * 0.88), y: -R, vy: H * (0.22 + elapsed * 0.006), spin: rnd(0, TAU), vs: rnd(-2, 2) }); }
    const noses = geoms.map((g) => g.global(g.nose.x, g.nose.y));
    for (let i = r.items.length - 1; i >= 0; i--) {
      const it = r.items[i];
      it.y += it.vy * dt; it.spin += it.vs * dt;
      const hit = noses.find((n) => dist(n.x, n.y, it.x, it.y) < R * 0.55);
      if (hit) {
        r.score++;
        for (let k = 0; k < 6; k++) env.fx.sparkleAt(it.x, it.y, '#ffd23f');
        r.items.splice(i, 1);
        continue;
      }
      if (it.y > H + R) { r.items.splice(i, 1); continue; }
      drawRing(c, it.x, it.y, R, it.spin);
    }
    env.hud(geoms.length ? `⏱ ${Math.ceil(timeLeft(r, t))}   ⭐ ${r.score}` : 'Show me your face!');
  },
};

// ---------------------------------------------------------------- Snack Catch: open your mouth to catch snacks
const snacks = makeRound('snacks');
const YUM = ['🍕', '🍪', '🍓', '🍩', '🍦', '🍉', '🍔', '🧁'];
const YUCK = ['🧦', '🪨', '🧽'];
const SNACK_GAME = {
  id: 'game-snacks', name: 'Snack Catch', icon: '🍕',
  reset() { snacks.at = 0; },
  scene(c, geoms, t, dt, W, H, v, env) {
    const r = snacks;
    const R = W * 0.07;
    pxFont(c, R * 2.2);
    if (!tick(r, t, env)) { for (const it of r.items) c.fillText(it.e, it.x, it.y); return; }
    const elapsed = t - r.at;
    if (elapsed >= ROUND_SECONDS) { endRound(r, t, env); return; }
    const gap = Math.max(0.6, 1.4 - elapsed * 0.02);
    if (t - r.lastSpawn > gap) {
      r.lastSpawn = t;
      const bad = Math.random() < 0.22;
      r.items.push({ e: bad ? YUCK[(Math.random() * YUCK.length) | 0] : YUM[(Math.random() * YUM.length) | 0], bad, x: rnd(W * 0.12, W * 0.88), y: -R, vy: H * (0.2 + elapsed * 0.006), wob: rnd(0, TAU) });
    }
    const mouths = geoms.filter((g) => g.mouth.open > 0.08).map((g) => ({ p: g.global(g.mouth.c.x, g.mouth.c.y + 0.03), r: g.s * 0.22 }));
    for (let i = r.items.length - 1; i >= 0; i--) {
      const it = r.items[i];
      it.y += it.vy * dt; it.x += Math.sin(t * 2 + it.wob) * W * 0.08 * dt;
      const m = mouths.find((mm) => dist(mm.p.x, mm.p.y, it.x, it.y) < mm.r + R * 0.4);
      if (m) {
        if (it.bad) { r.score = Math.max(0, r.score - 1); env.say('Yuck!'); for (let k = 0; k < 4; k++) env.fx.sparkleAt(it.x, it.y, '#7cb342'); }
        else { r.score++; for (let k = 0; k < 6; k++) env.fx.sparkleAt(it.x, it.y, '#ff5c8a'); }
        r.items.splice(i, 1);
        continue;
      }
      if (it.y > H + R) { r.items.splice(i, 1); continue; }
      c.fillText(it.e, it.x, it.y);
    }
    env.hud(geoms.length ? `⏱ ${Math.ceil(timeLeft(r, t))}   ⭐ ${r.score}   ${mouths.length ? '😮' : 'open wide!'}` : 'Show me your face!');
  },
};

// ---------------------------------------------------------------- Dodge: move your head so the rocks miss you
const dodge = makeRound('dodge');
const DODGE_GAME = {
  id: 'game-dodge', name: 'Dodge', icon: '🪨',
  reset() { dodge.at = 0; },
  scene(c, geoms, t, dt, W, H, v, env) {
    const r = dodge;
    const R = W * 0.075;
    pxFont(c, R * 2.3);
    if (!tick(r, t, env)) { for (const it of r.items) c.fillText('🪨', it.x, it.y); return; }
    const elapsed = t - r.at;
    if (elapsed >= ROUND_SECONDS) { endRound(r, t, env, 'You made it!'); return; }
    const gap = Math.max(0.45, 1.1 - elapsed * 0.02);
    if (t - r.lastSpawn > gap) {
      r.lastSpawn = t;
      // aim some rocks at a face so standing still does not work
      const g = geoms[(Math.random() * geoms.length) | 0];
      const aim = g && Math.random() < 0.5 ? g.mid.x + rnd(-W * 0.1, W * 0.1) : rnd(W * 0.1, W * 0.9);
      r.items.push({ x: aim, y: -R, vy: H * (0.3 + elapsed * 0.008) });
    }
    const heads = geoms.map((g) => ({ p: g.global(0, 0.2), r: g.s * 0.75 }));
    let hitNow = false;
    for (let i = r.items.length - 1; i >= 0; i--) {
      const it = r.items[i];
      it.y += it.vy * dt;
      const h = heads.find((hh) => dist(hh.p.x, hh.p.y, it.x, it.y) < hh.r + R * 0.5);
      if (h) {
        r.lives--; hitNow = true;
        for (let k = 0; k < 8; k++) env.fx.sparkleAt(it.x, it.y, '#9e9e9e');
        r.items.splice(i, 1);
        if (r.lives <= 0) { endRound(r, t, env, 'Bonk! Game over'); return; }
        env.say('Bonk!');
        continue;
      }
      if (it.y > H + R) { r.score++; r.items.splice(i, 1); continue; }
      c.fillText('🪨', it.x, it.y);
    }
    if (hitNow) { c.fillStyle = 'rgba(255,0,0,0.25)'; c.fillRect(0, 0, W, H); }
    env.hud(geoms.length ? `⏱ ${Math.ceil(timeLeft(r, t))}   ⭐ ${r.score}   ${'❤️'.repeat(r.lives)}` : 'Show me your face!');
  },
};

export const GAMES = [RING_GAME, SNACK_GAME, DODGE_GAME];
