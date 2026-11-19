// Heightfield terrain with painted vertex colours, wind-blown grass, scattered forests, rocks and distant mountains.
import * as THREE from 'three';
import { makeNoise2D, fbm, smoothstep, lerp, rng, clamp } from '../core/util.js';
import { MAP, roadZ } from '../game/config.js';
import { instanced, A, globalUniforms } from '../core/assets.js';
import { globalPatch } from '../core/materials.js';

const SIZE_X = 420, SIZE_Z = 320;

export const snowUniform = { value: 0 };
const snowCache = new Map();
export function snowMaterial(base) {
  if (base.userData.isSnow) return base;
  if (snowCache.has(base.uuid)) return snowCache.get(base.uuid);
  const m = base.clone();
  m.userData.isSnow = true;
  const prev = base.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    sh.uniforms.uSnow = snowUniform;
    sh.vertexShader = 'varying vec3 vSnowN;\n' + sh.vertexShader.replace('#include <defaultnormal_vertex>', `
      #include <defaultnormal_vertex>
      #ifdef USE_INSTANCING
        vSnowN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vSnowN = normalize(mat3(modelMatrix) * objectNormal);
      #endif`);
    sh.fragmentShader = 'uniform float uSnow;\nvarying vec3 vSnowN;\n' + sh.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float snowAmt = smoothstep(0.42, 0.78, vSnowN.y) * uSnow;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), snowAmt);`);
  };
  m.customProgramCacheKey = () => (base.customProgramCacheKey ? base.customProgramCacheKey() : '') + 'snow';
  snowCache.set(base.uuid, m);
  return m;
}
export function applySnow(obj) {
  if (snowUniform.value <= 0) return;
  obj.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && o.material && !o.userData.noSnow) o.material = snowMaterial(o.material); });
}

function detailTexture() {
  const s = 256;
  const c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const n = makeNoise2D(99);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    // tileable by sampling a torus
    const ax = x / s * Math.PI * 2, ay = y / s * Math.PI * 2;
    const v = 0.5 * n(Math.cos(ax) * 3, Math.sin(ax) * 3 + Math.cos(ay) * 3) + 0.35 * n(Math.cos(ax) * 9 + 5, Math.sin(ay) * 9) + 0.15 * n(Math.sin(ax) * 22, Math.cos(ay) * 22);
    const g = clamp(Math.round(222 + v * 34), 0, 255);
    const i = (y * s + x) * 4;
    img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(SIZE_X / 6, SIZE_Z / 6);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Terrain {
  constructor(biome, { seed = 7, quality = 'medium', shrines = [] } = {}) {
    this.biome = biome;
    this.seed = seed;
    this.quality = quality;
    this.shrines = shrines;
    this.noise = makeNoise2D(seed);
    this.step = quality === 'low' ? 2 : 1.25;
    this.nx = Math.round(SIZE_X / this.step);
    this.nz = Math.round(SIZE_Z / this.step);
    this.colliders = [];
    this.group = new THREE.Group();
    this.buildHeights();
    this.buildMesh();
  }

  rawHeight(x, z) {
    const n = this.noise;
    const az = Math.abs(z);
    let h = fbm(n, x * 0.018, z * 0.018, 3) * 0.9;
    const bank = smoothstep(27, 46, az);
    h += bank * (5 + (fbm(n, x * 0.03 + 40, z * 0.03, 4) * 0.5 + 0.5) * 9) + smoothstep(46, 110, az) * 20;
    h += smoothstep(-96, -135, x) * 12 + smoothstep(104, 140, x) * 16;
    // castle plateau behind the walls
    h += smoothstep(-74, -84, x) * (1 - smoothstep(26, 34, az)) * 1.4;
    // flatten wall line and fortress yard
    const wallFlat = (1 - smoothstep(3, 12, Math.abs(x - MAP.castleX))) * (1 - bank);
    h = lerp(h, 0.05, wallFlat);
    const fd = Math.hypot(x - MAP.fortressX, z);
    h = lerp(h, 0.25, 1 - smoothstep(12, 28, fd));
    for (const s of this.shrines) {
      const d = Math.hypot(x - s[0], z - s[1]);
      h = lerp(h, 0.1, 1 - smoothstep(5, 9, d));
    }
    // road
    const inPlay = 1 - bank;
    const rd = Math.abs(z - roadZ(x));
    if (x > MAP.castleX - 2 && x < MAP.fortressX) h -= (1 - smoothstep(1.8, 4.4, rd)) * 0.12 * inPlay;
    // ponds for wet biomes
    if (this.biome.water) {
      const p = fbm(n, x * 0.035 + 100, z * 0.035 - 50, 3);
      const away = smoothstep(6, 16, rd) * (1 - smoothstep(10, 20, Math.abs(x - MAP.castleX))) * 0 + smoothstep(6, 16, rd);
      h -= smoothstep(0.15, 0.45, p) * 1.4 * away * (1 - smoothstep(12, 28, fd < 30 ? 30 - fd : 0));
    }
    return h;
  }

  buildHeights() {
    const { nx, nz, step } = this;
    this.H = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = -SIZE_X / 2 + i * step, z = -SIZE_Z / 2 + j * step;
      this.H[j * (nx + 1) + i] = this.rawHeight(x, z);
    }
  }

  heightAt(x, z) {
    const { nx, nz, step } = this;
    const fx = (x + SIZE_X / 2) / step, fz = (z + SIZE_Z / 2) / step;
    const i = clamp(Math.floor(fx), 0, nx - 1), j = clamp(Math.floor(fz), 0, nz - 1);
    const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
    const w = nx + 1, H = this.H;
    const a = H[j * w + i], b = H[j * w + i + 1], c = H[(j + 1) * w + i], d = H[(j + 1) * w + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.8;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  buildMesh() {
    const { nx, nz, step, biome } = this;
    const g = biome.ground;
    const cA = new THREE.Color(g.grassA), cB = new THREE.Color(g.grassB), cD = new THREE.Color(g.dirt), cR = new THREE.Color(g.rock), cP = new THREE.Color(g.path);
    const cS = new THREE.Color('#eef3fa');
    const count = (nx + 1) * (nz + 1);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    const n = this.noise;
    const c = new THREE.Color(), tmp = new THREE.Color();
    const nrm = new THREE.Vector3();
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      const x = -SIZE_X / 2 + i * step, z = -SIZE_Z / 2 + j * step;
      const y = this.H[k];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = i / nx; uv[k * 2 + 1] = j / nz;
      const patch = fbm(n, x * 0.05 + 7, z * 0.05 - 3, 3) * 0.5 + 0.5;
      c.copy(cA).lerp(cB, smoothstep(0.3, 0.75, patch));
      const fine = n(x * 0.4, z * 0.4) * 0.5 + 0.5;
      c.multiplyScalar(0.92 + fine * 0.14);
      // worn dirt near the walls, shrines and the fortress
      let worn = smoothstep(0.62, 0.82, fbm(n, x * 0.07 - 20, z * 0.07 + 11, 2) * 0.5 + 0.5) * 0.7;
      worn = Math.max(worn, (1 - smoothstep(4, 16, Math.abs(x - MAP.castleX + 4))) * (1 - smoothstep(20, 30, Math.abs(z))) * 0.65);
      worn = Math.max(worn, 1 - smoothstep(10, 24, Math.hypot(x - MAP.fortressX, z)));
      for (const s of this.shrines) worn = Math.max(worn, (1 - smoothstep(3, 8, Math.hypot(x - s[0], z - s[1]))) * 0.8);
      c.lerp(tmp.copy(cD).multiplyScalar(0.9 + fine * 0.2), worn);
      // road
      if (x > MAP.castleX - 3 && x < MAP.fortressX) {
        const rd = Math.abs(z - roadZ(x)) + n(x * 0.3, z * 0.3) * 0.6;
        c.lerp(tmp.copy(cP).multiplyScalar(0.9 + fine * 0.15), (1 - smoothstep(1.6, 3.6, rd)) * (1 - smoothstep(26, 34, Math.abs(z))));
      }
      // slopes become rock
      this.normalAt(x, z, nrm);
      const rock = smoothstep(0.86, 0.7, nrm.y);
      c.lerp(tmp.copy(cR).multiplyScalar(0.85 + fine * 0.3), rock);
      // snow
      if (g.snow > 0) {
        const snow = clamp(g.snow * (0.55 + smoothstep(0.5, 6, y) * 0.6 + n(x * 0.1, z * 0.1) * 0.3) - rock * 0.25, 0, 1);
        const roadSnow = (x > MAP.castleX - 3 && x < MAP.fortressX) ? (1 - smoothstep(1.5, 3.5, Math.abs(z - roadZ(x)))) * 0.6 : 0;
        c.lerp(cS, clamp(snow - roadSnow, 0, 0.95));
      }
      // wet edges near water
      if (biome.water && y < biome.water.level + 0.3) c.multiplyScalar(0.65);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    const idx = new Uint32Array(nx * nz * 6);
    let p = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, d = cc + 1;
      idx[p++] = a; idx[p++] = cc; idx[p++] = b; idx[p++] = b; idx[p++] = cc; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, map: detailTexture() });
    mat.map.repeat.set(SIZE_X / 5, SIZE_Z / 5);
    mat.userData.noGrim = true;
    mat.customProgramCacheKey = () => 'terrain';
    mat.onBeforeCompile = function (sh) {
      globalPatch.call(this, sh);
      // detail texture tiles over the painted vertex colours
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 texelColor = texture2D( map, vMapUv );
          diffuseColor.rgb *= mix(vec3(1.0), texelColor.rgb * 1.12, 0.85);
        #endif`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.mesh = mesh;
    this.group.add(mesh);
    if (biome.water) {
      const wm = new THREE.MeshStandardMaterial({ color: biome.water.color, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.9, envMapIntensity: 1.6 });
      wm.userData.noGrim = true;
      const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE_X, SIZE_Z, 1, 1), wm);
      water.rotation.x = -Math.PI / 2;
      water.position.y = biome.water.level;
      water.receiveShadow = true;
      this.water = water;
      this.group.add(water);
    }
  }

  // ---------------- scatter ----------------
  scatter(qualityGrass = 1) {
    const b = this.biome;
    const r = rng(this.seed * 31 + 5);
    const M = () => new THREE.Matrix4();
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const compose = (x, z, scale, rotY = r() * Math.PI * 2, sink = 0, tilt = 0) => {
      const y = this.heightAt(x, z) - sink;
      q.setFromAxisAngle(up, rotY);
      if (tilt) { const t = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize(), tilt); q.premultiply(t); }
      return M().compose(p.set(x, y, z), q, s.set(scale, scale, scale));
    };
    const inCastle = (x, z) => x < MAP.castleX + 6 && x > -120 && Math.abs(z) < 38;
    const nearFort = (x, z) => Math.hypot(x - MAP.fortressX, z) < 30;
    const onRoad = (x, z) => x > MAP.castleX - 4 && x < MAP.fortressX && Math.abs(z - roadZ(x)) < 4.5;
    const nearShrine = (x, z) => this.shrines.some(sh => Math.hypot(x - sh[0], z - sh[1]) < 9);
    const water = b.water ? b.water.level : -99;

    // forests on the banks and behind both strongholds
    const treeMats = {}, farTreeMats = {};
    const tCount = Math.round(520 * (b.treeDensity || 1) * (0.55 + 0.45 * Math.min(1, qualityGrass)));
    for (let i = 0; i < tCount; i++) {
      const x = r.range(-200, 200), z = r.range(-150, 150);
      const az = Math.abs(z);
      const behind = x < -104 || x > 112;
      if (!(az > 34 || behind)) continue;
      if (inCastle(x, z) && az < 42) continue;
      if (nearFort(x, z) && az < 40) continue;
      if (this.heightAt(x, z) < water + 0.2) continue;
      const id = r.pick(b.trees);
      const scale = (id.startsWith('hw_') ? 1.3 : id.startsWith('trees_') ? 6.5 : 2.3) * r.range(0.8, 1.35) * (az > 70 ? 1.3 : 1);
      const near = az < 48 && x > -112 && x < 118;
      const bucket = near ? treeMats : farTreeMats;
      (bucket[id] = bucket[id] || []).push(compose(x, z, scale, undefined, 0.2));
    }
    // a few groves inside the field for character (block movement)
    const groves = [[-30, 24], [12, -25], [44, 23], [-6, 26], [62, -24]];
    for (const [gx, gz] of groves) {
      for (let k = 0; k < 4; k++) {
        const x = gx + r.range(-5, 5), z = gz + r.range(-3, 3) + Math.sign(gz) * 2;
        if (onRoad(x, z) || nearShrine(x, z)) continue;
        const id = r.pick(b.trees);
        const scale = (id.startsWith('hw_') ? 1.2 : id.startsWith('trees_') ? 5 : 2.0) * r.range(0.85, 1.2);
        (treeMats[id] = treeMats[id] || []).push(compose(x, z, scale, undefined, 0.2));
        this.colliders.push({ x, z, r: 1.1 });
      }
    }
    for (const [id, mats] of Object.entries(treeMats)) {
      if (!A.scenes[id]) continue;
      this.group.add(instanced(id, mats, { shadow: true, wind: id.startsWith('hw_') ? 0 : 0.4 }));
    }
    for (const [id, mats] of Object.entries(farTreeMats)) {
      if (!A.scenes[id]) continue;
      this.group.add(instanced(id, mats, { shadow: false, wind: id.startsWith('hw_') ? 0 : 0.4 }));
    }

    // rocks: big ones on the banks, scattered boulders in the field
    const rockMats = {};
    for (let i = 0; i < 260; i++) {
      const x = r.range(-190, 190), z = r.range(-140, 140);
      const az = Math.abs(z);
      if (az < 31 && !(x < -104 || x > 112)) continue;
      if (inCastle(x, z) && az < 40) continue;
      const id = r.pick(b.rocks);
      const sc = r.range(2.5, 7) * (az > 50 ? 1.6 : 1);
      (rockMats[(az > 50 ? 'far:' : '') + id] = rockMats[(az > 50 ? 'far:' : '') + id] || []).push(compose(x, z, sc, undefined, sc * 0.15, 0.2));
    }
    const fieldRocks = [[-38, -22], [-14, 18], [8, 20], [26, -14], [52, 16], [70, -18], [-48, 20], [34, 26], [-24, -27]];
    for (const [fx, fz] of fieldRocks) {
      const x = fx + r.range(-3, 3), z = fz + r.range(-2, 2);
      if (onRoad(x, z) || nearShrine(x, z)) continue;
      const id = r.pick(b.rocks);
      const sc = r.range(2.6, 4.2);
      (rockMats[id] = rockMats[id] || []).push(compose(x, z, sc, undefined, sc * 0.1, 0.15));
      this.colliders.push({ x, z, r: sc * 0.32 });
    }
    for (const [key, mats] of Object.entries(rockMats)) { const far = key.startsWith('far:'); this.group.add(instanced(far ? key.slice(4) : key, mats, { shadow: !far })); }

    // bushes
    const bushMats = {};
    for (let i = 0; i < 420; i++) {
      const x = r.range(-150, 150), z = r.range(-90, 90);
      const az = Math.abs(z);
      if (az < 24 && r() < 0.85) continue;
      if (inCastle(x, z) || nearFort(x, z) || onRoad(x, z) || nearShrine(x, z)) continue;
      if (this.heightAt(x, z) < water + 0.1) continue;
      const id = r.pick(b.bushes);
      (bushMats[id] = bushMats[id] || []).push(compose(x, z, r.range(2.2, 3.8), undefined, 0.05));
    }
    for (const [id, mats] of Object.entries(bushMats)) if (A.scenes[id]) this.group.add(instanced(id, mats, { shadow: false, wind: 0.6 }));

    // grass tufts
    const gCount = Math.round(16000 * qualityGrass);
    const grassMats = [];
    for (let i = 0; i < gCount; i++) {
      const x = r.range(-125, 125), z = r.range(-70, 70);
      const az = Math.abs(z);
      const keep = az > 22 ? 1 : 0.35;
      if (r() > keep) continue;
      if (onRoad(x, z) || nearShrine(x, z) || (inCastle(x, z) && x > -96)) continue;
      if (Math.abs(x - MAP.castleX) < 6 && az < 34) continue;
      if (nearFort(x, z)) continue;
      if (this.heightAt(x, z) < water + 0.05) continue;
      grassMats.push(compose(x, z, r.range(0.75, 1.15), undefined, 0.02));
    }
    if (A.scenes[b.grass]) this.group.add(instanced(b.grass, grassMats, { shadow: false, wind: 2.2, receive: true }));

    // distant mountains and clouds
    const mtn = b.snowShader || b.ground.snow ? ['mountain_A', 'mountain_B', 'mountain_C'] : ['mountain_A_grass', 'mountain_B_grass_trees', 'mountain_C_grass', 'mountain_A', 'mountain_B'];
    const mtnMats = {};
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + r.range(-0.05, 0.05);
      const rad = r.range(215, 270);
      const x = Math.cos(a) * rad * 1.15, z = Math.sin(a) * rad * 0.85;
      const id = r.pick(mtn);
      const sc = r.range(26, 44);
      const m = M().compose(p.set(x, -4, z), q.setFromAxisAngle(up, r() * 6.28), s.set(sc, sc * r.range(0.8, 1.3), sc));
      (mtnMats[id] = mtnMats[id] || []).push(m);
    }
    for (const [id, mats] of Object.entries(mtnMats)) this.group.add(instanced(id, mats, { shadow: false, receive: false }));
    const cloudMats = [];
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2, rad = r.range(140, 260);
      const sc = r.range(7, 13);
      cloudMats.push(M().compose(p.set(Math.cos(a) * rad, r.range(55, 85), Math.sin(a) * rad), q.setFromAxisAngle(up, r() * 6.28), s.set(sc, sc * 0.7, sc)));
    }
    if (b.cloudModels) {
      const cg = instanced('cloud_big', cloudMats, { shadow: false, receive: false });
      cg.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color(b.sky.cloudColor); o.material.emissive = new THREE.Color(b.sky.cloudColor).multiplyScalar(0.35); o.material.fog = false; } });
      this.clouds = cg;
      this.group.add(cg);
    }
    applySnow(this.group);
  }
}
