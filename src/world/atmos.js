// Atmosphere: rolling fog banks, circling crows and lightning.
import * as THREE from 'three';
import { makeNoise2D, fbm, rand, clamp } from '../core/util.js';
import { globalUniforms } from '../core/assets.js';
import { darkUniforms } from '../core/materials.js';

function cloudTexture() {
  const s = 256;
  const c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const n = makeNoise2D(1234);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s - 0.5, v = y / s - 0.5;
    const r = Math.sqrt(u * u + v * v) * 2;
    const f = fbm(n, x * 0.018, y * 0.018, 5) * 0.5 + 0.5;
    const a = clamp((f - 0.28) * 1.7, 0, 1) * clamp(1 - r, 0, 1) ** 1.4;
    const i = (y * s + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FogBank {
  constructor(scene) {
    this.scene = scene;
    this.tex = cloudTexture();
    this.uniforms = {
      uTex: { value: this.tex }, uTime: globalUniforms.uTime, uColor: { value: new THREE.Color('#40465a') },
      uAmount: { value: 1 }, uSurge: { value: 0 }, uCam: { value: new THREE.Vector3() }, uLight: { value: 0.0 },
      uNear: { value: new THREE.Vector2(3, 14) },   // fade sprites close to the camera
    };
    this.flat = this.make(170, true);
    this.tall = this.make(70, false);
    scene.add(this.flat, this.tall);
  }

  make(N, flat) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const off = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N), speed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // biased toward the enemy side, where the fog is born
      const t = Math.pow(Math.random(), 0.7);
      off[i * 3] = flat ? -75 + t * 190 : 25 + Math.random() * 95;
      off[i * 3 + 1] = flat ? rand(0.35, 3.2) : rand(2, 7);
      off[i * 3 + 2] = flat ? rand(-40, 40) : rand(-34, 34);
      size[i] = flat ? rand(14, 32) : rand(18, 34);
      seed[i] = Math.random();
      speed[i] = rand(0.4, 1.3);
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speed, 1));
    g.instanceCount = N;
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: flat ? { FLAT: 1 } : {},
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        attribute vec3 aOff; attribute float aSize, aSeed, aSpeed;
        uniform float uTime, uSurge; uniform vec3 uCam; uniform vec2 uNear;
        varying vec2 vUv; varying float vSeed, vFade, vX;
        void main(){
          vec3 o = aOff;
          float drift = uTime * aSpeed * (0.35 + uSurge * 1.6);
          o.x = mod(o.x + 80.0 - drift, 200.0) - 80.0;
          o.z += sin(uTime * 0.05 + aSeed * 20.0) * 3.0;
          vec3 p;
          #ifdef FLAT
            float a = aSeed * 6.283 + uTime * 0.01 * (aSeed - 0.5);
            vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
            p = o + vec3(q.x, 0.0, q.y) * aSize;
          #else
            vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
            p = o + right * position.x * aSize + vec3(0.0, position.y * aSize * 0.45, 0.0);
          #endif
          vUv = uv; vSeed = aSeed; vX = o.x;
          float d = distance(p, uCam);
          vFade = smoothstep(uNear.x, uNear.y, d) * (1.0 - smoothstep(170.0, 240.0, d)) * smoothstep(0.0, 6.0, 80.0 - abs(o.x - 20.0) + 40.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uTex; uniform vec3 uColor; uniform float uAmount, uSurge, uTime, uLight;
        varying vec2 vUv; varying float vSeed, vFade, vX;
        void main(){
          vec2 uv = vUv;
          float a = texture2D(uTex, uv).a;
          float side = mix(0.3, 1.0, smoothstep(-55.0, 70.0, vX));
          #ifdef FLAT
            float k = 0.34;
          #else
            float k = 0.26;
          #endif
          float alpha = a * k * uAmount * side * vFade * (1.0 + uSurge * 0.8);
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uColor * (1.0 + uLight), alpha);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return mesh;
  }

  setNearFade(a, b) { this.uniforms.uNear.value.set(a, b); }
  configure({ color = '#40465a', amount = 1 } = {}) {
    this.uniforms.uColor.value.set(color);
    this.uniforms.uAmount.value = amount;
    this.flat.visible = this.tall.visible = amount > 0;
  }

  update(dt, camera) {
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uSurge.value = Math.max(0, this.uniforms.uSurge.value - dt * 0.08);
  }
  surge(k = 1) { this.uniforms.uSurge.value = Math.min(1.2, this.uniforms.uSurge.value + k); }
}

export class Crows {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
  }
  build(count) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (!count) return;
    const pos = new Float32Array([
      // body
      0, 0, 0.45, -0.07, 0, -0.1, 0.07, 0, -0.1,
      0, 0, -0.1, -0.06, 0, -0.45, 0.06, 0, -0.45,
      // left wing
      -0.05, 0, 0.12, -0.05, 0, -0.12, -0.75, 0, -0.08,
      // right wing
      0.05, 0, 0.12, 0.75, 0, -0.08, 0.05, 0, -0.12,
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) phase[i] = Math.random() * 10;
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const m = new THREE.MeshBasicMaterial({ color: '#050405', side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = globalUniforms.uTime;
      sh.vertexShader = 'uniform float uTime;\nattribute float aPhase;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float flap = sin(uTime * 11.0 + aPhase * 3.0) * step(0.5, fract(uTime * 0.07 + aPhase * 0.13) * 1.6);
        transformed.y += flap * abs(position.x) * 0.9;`);
    };
    m.customProgramCacheKey = () => 'crow';
    this.mesh = new THREE.InstancedMesh(g, m, count);
    this.mesh.frustumCulled = false;
    this.birds = [];
    for (let i = 0; i < count; i++) {
      const flock = i % 4;
      this.birds.push({
        cx: [-20, 40, 70, -50][flock] + rand(-10, 10), cz: [0, 18, -14, -20][flock] + rand(-8, 8),
        r: rand(10, 28), y: rand(18, 34), w: rand(0.18, 0.4) * (Math.random() < 0.5 ? -1 : 1), a: Math.random() * 6.28, s: rand(1.1, 1.8),
      });
    }
    this.scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  update(dt) {
    if (!this.mesh) return;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.a += b.w * dt;
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
      const y = b.y + Math.sin(b.a * 3 + i) * 1.5;
      const heading = Math.atan2(-Math.sin(b.a) * Math.sign(b.w), Math.cos(b.a) * Math.sign(b.w));
      this._q.setFromAxisAngle(up, heading + Math.PI / 2);
      const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.sign(b.w) * 0.35);
      this._q.multiply(bank);
      this._m.compose(this._p.set(x, y, z), this._q, this._s.set(b.s, b.s, b.s));
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Lightning {
  constructor(world) {
    this.world = world;
    this.rate = 0;
    this.t = rand(6, 14);
    this.seq = [];
    this.onThunder = null;
    this.flash = 0;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 4), transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.bolt.frustumCulled = false;
    world.scene.add(this.bolt);
  }
  makeBolt() {
    const pts = [];
    const a = Math.random() * Math.PI * 2, r = rand(140, 220);
    let x = Math.cos(a) * r * 1.2 + 20, z = Math.sin(a) * r * 0.8, y = 120;
    const verts = [];
    while (y > 0) {
      const nx = x + rand(-6, 6), nz = z + rand(-6, 6), ny = y - rand(6, 14);
      const w = 0.6;
      verts.push(x - w, y, z, x + w, y, z, nx + w, ny, nz, x - w, y, z, nx + w, ny, nz, nx - w, ny, nz);
      x = nx; y = ny; z = nz;
    }
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.BufferGeometry();
    this.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  }
  strike() {
    this.makeBolt();
    this.seq = [0.0, 0.08, 0.16, 0.32].map((d, i) => ({ d, k: i % 2 === 0 ? 1 : 0.35 }));
    this.seqT = 0;
    if (this.onThunder) setTimeout(() => this.onThunder(), rand(400, 1600));
  }
  update(dt) {
    if (this.rate > 0) {
      this.t -= dt * this.rate;
      if (this.t <= 0) { this.t = rand(7, 18); this.strike(); }
    }
    let target = 0;
    if (this.seq.length) {
      this.seqT += dt;
      for (const s of this.seq) if (this.seqT >= s.d && this.seqT < s.d + 0.07) target = s.k;
      if (this.seqT > 0.6) this.seq.length = 0;
    }
    this.flash = Math.max(target, this.flash - dt * 6);
    darkUniforms.uFlash.value = this.flash * 0.6;
    this.bolt.material.opacity = target > 0.5 ? 1 : 0;
    const sky = this.world.sky.uniforms;
    if (sky.uFlash) sky.uFlash.value = this.flash;
  }
}
