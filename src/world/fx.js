// Particle bursts, persistent emitters, ground rings, beams, flashing lights, ambient weather.
import * as THREE from 'three';
import { rand, clamp } from '../core/util.js';

const pVert = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vAlpha; varying vec3 vColor;
uniform float uScale;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dz = max(0.1, -mv.z);
  vAlpha = aAlpha * smoothstep(1.5, 6.0, dz);
  gl_PointSize = min(aSize * uScale / dz, 90.0);
  gl_Position = projectionMatrix * mv;
}`;
const pFrag = `
varying float vAlpha; varying vec3 vColor; uniform float uSoft;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, uSoft, r) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * (0.85 + (1.0 - r) * 0.35), a);
}`;

class ParticlePool {
  constructor(max, blending, soft = 0.0) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aColor', this.colAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 300 }, uSoft: { value: soft } };
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: pVert, fragmentShader: pFrag, transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 0, drag = 0, grow = 0, alpha = 1) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
    this.a0[i] = alpha; this.alpha[i] = alpha;
  }
  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[last * 3 + k]; this.vel[i * 3 + k] = this.vel[last * 3 + k]; this.col[i * 3 + k] = this.col[last * 3 + k];
          }
          this.size[i] = this.size[last]; this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last]; this.grav[i] = this.grav[last];
          this.drag[i] = this.drag[last]; this.grow[i] = this.grow[last]; this.a0[i] = this.a0[last]; this.alpha[i] = this.alpha[last];
        }
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8 + 0.2);
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.sizeAttr.needsUpdate = this.alphaAttr.needsUpdate = true;
  }
}

const _c = new THREE.Color();

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.add = new ParticlePool(9000, THREE.AdditiveBlending, 0.0);
    this.norm = new ParticlePool(3500, THREE.NormalBlending, 0.15);
    scene.add(this.add.points, this.norm.points);
    this.emitters = [];
    this.rings = [];
    this.beams = [];
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 14, 1.6);
      l.userData.t = 0;
      scene.add(l);
      this.lights.push(l);
    }
    this.ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(1, 40);
    this.discGeo.rotateX(-Math.PI / 2);
    this.weather = null;
  }

  setPixelScale(h) { this.add.uniforms.uScale.value = this.norm.uniforms.uScale.value = h * 0.55; }

  burst(pos, o = {}) {
    const n = o.count ?? 12;
    _c.set(o.color ?? 0xffcc66);
    const pool = o.normal ? this.norm : this.add;
    const sp = o.speed ?? 4, spread = o.spread ?? 1, up = o.up ?? 1.5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const vx = Math.cos(a) * r * sp, vz = Math.sin(a) * r * sp, vy = (Math.random() * 0.8 + 0.2) * up * sp * 0.5;
      const jitter = o.jitter ?? 0.15;
      const cv = 1 - Math.random() * jitter;
      pool.spawn(pos.x + (Math.random() - 0.5) * (o.radius ?? 0.2), pos.y + (Math.random() - 0.5) * (o.radius ?? 0.2), pos.z + (Math.random() - 0.5) * (o.radius ?? 0.2),
        vx, vy, vz, _c.r * cv, _c.g * cv, _c.b * cv, (o.size ?? 0.5) * rand(0.6, 1.3), (o.life ?? 0.6) * rand(0.6, 1.2), o.gravity ?? 4, o.drag ?? 1.5, o.grow ?? 0, o.alpha ?? 1);
    }
  }

  // persistent emitters: { pos (Vector3 or object with pos), rate, ...burst opts, active }
  emitter(o) { const e = { acc: 0, active: true, ...o }; this.emitters.push(e); return e; }
  removeEmitter(e) { const i = this.emitters.indexOf(e); if (i >= 0) this.emitters.splice(i, 1); }

  ring(pos, { color = 0xffd27a, radius = 4, life = 0.6, width = 0.18, opacity = 0.9, y = 0.15, filled = false } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const geo = filled ? this.discGeo : new THREE.RingGeometry(1 - width, 1, 48).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x, pos.y + y, pos.z);
    m.renderOrder = 4;
    this.scene.add(m);
    this.rings.push({ m, t: 0, life, radius, opacity, own: !filled });
    return m;
  }

  beam(from, to, { color = 0xffe6a0, life = 0.25, width = 0.25 } = {}) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(width, width, len, 6, 1, true);
    geo.translate(0, len / 2, 0);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from);
    m.lookAt(to);
    this.scene.add(m);
    this.beams.push({ m, t: 0, life });
  }

  flash(pos, color = 0xffaa55, intensity = 30, dist = 14, life = 0.35) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.userData.t <= 0) { best = l; break; } else if (l.userData.t < best.userData.t) best = l;
    best.color.set(color);
    best.position.set(pos.x, pos.y + 1.2, pos.z);
    best.distance = dist;
    best.userData = { t: life, life, i: intensity };
    best.intensity = intensity;
  }

  setWeather(kind, camera) {
    if (this.weather) { this.scene.remove(this.weather.points); this.weather = null; }
    if (!kind || kind === 'none') return;
    const N = kind === 'snow' ? 3200 : kind === 'rain' ? 3600 : kind === 'mist' ? 300 : kind === 'wisps' ? 260 : 900;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = rand(-60, 60); pos[i * 3 + 1] = rand(0, 30); pos[i * 3 + 2] = rand(-60, 60); seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const cfg = {
      snow: { color: '#ffffff', size: 0.16, fall: 1.6, sway: 0.8, add: false, alpha: 0.9 },
      pollen: { color: '#fff3b0', size: 0.09, fall: -0.05, sway: 0.6, add: true, alpha: 0.7 },
      fireflies: { color: '#c8ff7a', size: 0.16, fall: -0.02, sway: 1.2, add: true, alpha: 1.0, blink: 1 },
      wisps: { color: '#7affb4', size: 0.32, fall: -0.04, sway: 2.2, add: true, alpha: 0.9, blink: 1 },
      embers: { color: '#ff8a3a', size: 0.12, fall: -0.9, sway: 0.9, add: true, alpha: 0.95, blink: 1 },
      ash: { color: '#a89a98', size: 0.13, fall: 0.6, sway: 1.0, add: false, alpha: 0.75 },
      mist: { color: '#8a94a8', size: 0.06, fall: -0.03, sway: 0.9, add: true, alpha: 0.5 },
      rain: { color: '#8aa0b4', size: 0.08, fall: 24, sway: 0.15, add: false, alpha: 0.45 },
    }[kind];
    const uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(cfg.color) }, uSize: { value: cfg.size },
      uFall: { value: cfg.fall }, uSway: { value: cfg.sway }, uScale: this.add.uniforms.uScale, uAlpha: { value: cfg.alpha }, uBlink: { value: cfg.blink || 0 }, uLow: { value: cfg.low || 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, blending: cfg.add ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute float aSeed; uniform float uTime, uSize, uFall, uSway, uScale, uBlink, uLow; uniform vec3 uCam; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime * uFall * (0.7 + aSeed * 0.6), 30.0);
          if (uLow > 0.5) p.y = 0.5 + aSeed * 2.5;
          p.x += sin(uTime * 0.7 + aSeed * 30.0) * uSway; p.z += cos(uTime * 0.5 + aSeed * 20.0) * uSway;
          vec3 w = vec3(uCam.x + mod(p.x - uCam.x + 60.0, 120.0) - 60.0, p.y + (uLow > 0.5 ? 0.0 : uCam.y - 8.0), uCam.z + mod(p.z - uCam.z + 60.0, 120.0) - 60.0);
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_PointSize = uSize * uScale / max(0.1, -mv.z);
          vA = uBlink > 0.5 ? (0.5 + 0.5 * sin(uTime * 3.0 + aSeed * 50.0)) : 1.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vA;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r) * uAlpha * vA; if (a < 0.003) discard; gl_FragColor = vec4(uColor, a); }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    this.scene.add(pts);
    this.weather = { points: pts, uniforms };
  }

  update(dt, camera) {
    for (const e of this.emitters) {
      if (!e.active) continue;
      e.acc += dt * e.rate;
      const p = e.pos.isVector3 ? e.pos : e.pos.pos;
      while (e.acc >= 1) {
        e.acc -= 1;
        this.burst(p, { ...e, count: 1 });
      }
    }
    this.add.update(dt);
    this.norm.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      const s = r.radius * (0.25 + 0.75 * Math.sqrt(k));
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = r.opacity * (1 - k);
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); if (r.own) r.m.geometry.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      b.m.material.opacity = 1 - b.t / b.life;
      if (b.t >= b.life) { this.scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); this.beams.splice(i, 1); }
    }
    for (const l of this.lights) {
      if (l.userData.t > 0) {
        l.userData.t -= dt;
        l.intensity = Math.max(0, l.userData.i * (l.userData.t / l.userData.life));
      } else l.intensity = 0;
    }
    if (this.weather) {
      this.weather.uniforms.uTime.value += dt;
      this.weather.uniforms.uCam.value.copy(camera.position);
    }
  }

  clear() {
    this.add.count = 0; this.norm.count = 0;
    this.emitters.length = 0;
    for (const r of this.rings) this.scene.remove(r.m);
    for (const b of this.beams) this.scene.remove(b.m);
    this.rings.length = 0; this.beams.length = 0;
  }
}
