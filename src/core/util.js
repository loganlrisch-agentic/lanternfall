// Shared math helpers, noise, RNG and a spatial hash for unit queries.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}
export function angleDiff(a, b) { return ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; }
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

// Deterministic RNG (mulberry32)
export function rng(seed = 1) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  return f;
}
export const rand = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// 2D simplex noise (compact implementation)
const grad3 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
export function makeNoise2D(seed = 1) {
  const r = rng(seed);
  const p = new Uint8Array(512);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = grad3[p[ii + p[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = grad3[p[ii + i1 + p[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = grad3[p[ii + 1 + p[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  };
}
export function fbm(noise, x, y, oct = 4, lac = 2, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); n += a; a *= gain; f *= lac; }
  return s / n;
}

// Uniform-grid spatial hash for fast neighbour lookups on the XZ plane.
export class SpatialHash {
  constructor(cell = 6) { this.cell = cell; this.map = new Map(); }
  clear() { this.map.clear(); }
  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  insert(obj) {
    const ix = Math.floor(obj.pos.x / this.cell), iz = Math.floor(obj.pos.z / this.cell);
    const k = this.key(ix, iz);
    let b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(obj);
  }
  query(x, z, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    const r2 = r * r;
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const b = this.map.get(this.key(ix, iz));
      if (!b) continue;
      for (let i = 0; i < b.length; i++) {
        const o = b[i];
        const dx = o.pos.x - x, dz = o.pos.z - z;
        if (dx * dx + dz * dz <= r2 + o.radius * o.radius * 2) out.push(o);
      }
    }
    return out;
  }
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();
export function screenPos(vec3, camera, w, h, out = { x: 0, y: 0, vis: false }) {
  _v.copy(vec3).project(camera);
  out.x = (_v.x * 0.5 + 0.5) * w;
  out.y = (-_v.y * 0.5 + 0.5) * h;
  out.vis = _v.z < 1 && _v.z > -1;
  return out;
}

export function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
export function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
