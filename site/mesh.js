// Textured face mesh for the photo animal faces (filters-photo.js).
//
// facemesh.json is MediaPipe's canonical face mesh (Apache-2.0): the texture coordinate of each of the
// 468 landmarks and the triangles between them, minus the ones filling the eyes and the inner mouth so
// the real eyes and mouth show through. drawMesh() places every landmark where the tracker sees it and
// lets WebGL stretch the picture over the triangles, so the animal's face follows the mouth and brows.
// An animal picture is fitted to the canonical layout once, with a thin-plate spline through nine
// hand-placed points (eyes, nose, mouth corners, chin, top of the head, sides of the face).
export const MESH = await (await fetch('./facemesh.json')).json();

const uvOf = (i) => [MESH.uv[2 * i], MESH.uv[2 * i + 1]];
const meanUv = (ids) => ids.reduce((a, i) => [a[0] + MESH.uv[2 * i] / ids.length, a[1] + MESH.uv[2 * i + 1] / ids.length], [0, 0]);
export const EYE_L = [33, 133, 159, 145];      // L and R are image-left and image-right (the picture is not mirrored)
export const EYE_R = [263, 362, 386, 374];
export const POINTS = ['eyeL', 'eyeR', 'nose', 'mouthL', 'mouthR', 'chin', 'top', 'sideL', 'sideR'];
export const CANON = {
  eyeL: meanUv(EYE_L), eyeR: meanUv(EYE_R), nose: uvOf(1), mouthL: uvOf(61), mouthR: uvOf(291),
  chin: uvOf(152), top: uvOf(10), sideL: uvOf(234), sideR: uvOf(454),
};
// How far the chin sits below the eye line, in eye distances, on the canonical face (about 1.86).
export const CANON_DROP = Math.hypot(CANON.chin[0] - (CANON.eyeL[0] + CANON.eyeR[0]) / 2, CANON.chin[1] - (CANON.eyeL[1] + CANON.eyeR[1]) / 2)
  / Math.hypot(CANON.eyeR[0] - CANON.eyeL[0], CANON.eyeR[1] - CANON.eyeL[1]);

// Thin-plate spline through the 2D control points src[i] -> dst[i]; returns f(x, y) -> [x', y'].
export function tps(src, dst) {
  const n = src.length, N = n + 3;
  const K = (ax, ay, bx, by) => { const r2 = (ax - bx) ** 2 + (ay - by) ** 2; return r2 > 0 ? r2 * Math.log(r2) : 0; };
  // [[K P] [Pᵀ 0]] · [w a] = [dst 0], solved for x and y at once by Gaussian elimination.
  const A = Array.from({ length: N }, () => new Float64Array(N + 2));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = K(src[i][0], src[i][1], src[j][0], src[j][1]);
    A[i][n] = 1; A[i][n + 1] = src[i][0]; A[i][n + 2] = src[i][1];
    A[n][i] = 1; A[n + 1][i] = src[i][0]; A[n + 2][i] = src[i][1];
    A[i][N] = dst[i][0]; A[i][N + 1] = dst[i][1];
  }
  for (let col = 0; col < N; col++) {
    let p = col;
    for (let r = col + 1; r < N; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    [A[col], A[p]] = [A[p], A[col]];
    const d = A[col][col] || 1e-12;
    for (let r = 0; r < N; r++) {
      if (r === col) continue;
      const f = A[r][col] / d;
      if (f) for (let c = col; c < N + 2; c++) A[r][c] -= f * A[col][c];
    }
  }
  const wx = new Float64Array(N), wy = new Float64Array(N);
  for (let i = 0; i < N; i++) { wx[i] = A[i][N] / A[i][i]; wy[i] = A[i][N + 1] / A[i][i]; }
  return (x, y) => {
    let px = wx[n] + wx[n + 1] * x + wx[n + 2] * y, py = wy[n] + wy[n + 1] * x + wy[n + 2] * y;
    for (let i = 0; i < n; i++) { const k = K(x, y, src[i][0], src[i][1]); px += wx[i] * k; py += wy[i] * k; }
    return [px, py];
  };
}

// Texture coordinates for every landmark, given where the nine points sit in the animal picture (0..1).
export function textureCoords(pts) {
  const f = tps(POINTS.map((k) => CANON[k]), POINTS.map((k) => pts[k]));
  const out = new Float32Array(936);
  for (let i = 0; i < 468; i++) { const [u, v] = f(MESH.uv[2 * i], MESH.uv[2 * i + 1]); out[2 * i] = u; out[2 * i + 1] = v; }
  return out;
}

const VS = `attribute vec2 a_pos; attribute vec2 a_uv; attribute float a_alpha; uniform vec2 u_size;
varying vec2 v_uv; varying float v_alpha;
void main() { vec2 c = a_pos / u_size * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); v_uv = a_uv; v_alpha = a_alpha; }`;
const FS = `precision mediump float; uniform sampler2D u_tex; varying vec2 v_uv; varying float v_alpha;
void main() { gl_FragColor = texture2D(u_tex, v_uv) * v_alpha; }`;

// WebGL renderer drawing the textured mesh for any number of faces, then copying it onto the 2D canvas.
// Returns null when WebGL is unavailable. Textures are cached per image.
export function createMeshRenderer() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return null;
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  const shader = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const aPos = gl.getAttribLocation(prog, 'a_pos'), aUv = gl.getAttribLocation(prog, 'a_uv'), aAlpha = gl.getAttribLocation(prog, 'a_alpha');
  const uSize = gl.getUniformLocation(prog, 'u_size');
  gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
  const posBuf = gl.createBuffer(), alphaBuf = gl.createBuffer(), idxBuf = gl.createBuffer();
  const alpha = new Float32Array(468).fill(1);
  for (const i of MESH.oval) alpha[i] = 0;              // the rim fades into whatever is drawn behind
  gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf); gl.bufferData(gl.ARRAY_BUFFER, alpha, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(MESH.tri), gl.STATIC_DRAW);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.clearColor(0, 0, 0, 0);
  const pos = new Float32Array(936);
  const skins = new Map();
  function skin(image, uvs) {
    let s = skins.get(image);
    if (s) return s;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    s = { tex, uvBuf };
    skins.set(image, s);
    return s;
  }
  // faces: landmark lists (normalised 0..1); image + uvs: the skin (see textureCoords); W, H: canvas size.
  function draw(ctx, faces, image, uvs, W, H) {
    if (lost || !faces.length) return;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); }
    const s = skin(image, uvs);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uSize, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.uvBuf); gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf); gl.enableVertexAttribArray(aAlpha); gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    for (const lm of faces) {
      for (let i = 0; i < 468; i++) { pos[2 * i] = lm[i].x * W; pos[2 * i + 1] = lm[i].y * H; }
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawElements(gl.TRIANGLES, MESH.tri.length, gl.UNSIGNED_SHORT, 0);
    }
    ctx.drawImage(canvas, 0, 0);
  }
  return { draw, get lost() { return lost; } };
}
