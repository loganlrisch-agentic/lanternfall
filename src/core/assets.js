// Asset loading + character factory (merged skinned meshes, shared clip library, weapon sockets, portraits).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globalPatch } from './materials.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export const LARGE_RIG = new Set(['Barbarian_Large', 'Skeleton_Golem', 'Monstrosity', 'OrcBrute', 'BlackKnight', 'FrostGolem']);
export const CHAR_FILES = [
  'Knight', 'Barbarian', 'Barbarian_Large', 'Druid', 'Engineer', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded',
  'Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage', 'Necromancer', 'Skeleton_Golem',
  'OrcRaider', 'OrcBrute', 'Paladin', 'Paladin_with_Helmet', 'Werewolf_Man', 'Werewolf_Wolf', 'Ninja',
  'BlackKnight', 'Vampire', 'Witch', 'FrostGolem', 'Caveman', 'Tiefling', 'Lorekeeper', 'Marksman',
  'Farmer_A', 'Farmer_B', 'Cleric', 'Monstrosity', 'PlantWarrior', 'ToySoldier', 'Hoarder', 'AvianSwordsman',
];
const SCENE_PACKS = ['props', 'env_hex', 'env_forest', 'env_dungeon', 'env_halloween'];
const SFX = ['belt', 'bookopen', 'chop', 'clang1', 'clang2', 'clang3', 'cloth1', 'cloth2', 'coins', 'coins2', 'creak', 'draw1', 'draw2',
  'latch', 'page1', 'page2', 'slash1', 'slash2', 'step0', 'step1', 'step2', 'step3', 'step4', 'sting_big', 'sting_hit', 'sting_levelup',
  'sting_unlock', 'ui_click', 'ui_hover', 'ui_switch'];

export const A = {
  chars: {},            // name -> gltf scene
  clips: { medium: {}, large: {} },
  scenes: {},           // prop/env id -> Group
  sfx: {},              // name -> ArrayBuffer (decoded later by audio)
  variants: new Map(),  // key -> prototype
  portraits: {},        // key -> dataURL
};

import { globalUniforms } from './uniforms.js';
export { globalUniforms };

// Two ways to get the asset bytes:
// - normal (Vercel, local dev): fetch the .glb / .mp3 files.
// - packed (the claude.ai artifact viewer): tools/build-artifact.mjs turns every file
//   into small script files holding base64, and index.html sets window.LF_PACKED and
//   window.LF_PACK_INDEX. Scripts load under the same rules as game.js itself, so this
//   works in viewers (like the phone apps) that block fetch() for the page's own files.
// Either way downloads run a few at a time and retry, which phones on mobile data need.
const PACKED = typeof window !== 'undefined' && !!window.LF_PACKED;
const PACK_INDEX = (typeof window !== 'undefined' && window.LF_PACK_INDEX) || {};
if (PACKED) {
  // decode embedded textures through <img> so strict CSPs that block fetch(blob:) still work
  loader.register(parser => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    return { name: 'lf_img_textures' };
  });
}
function b64ToBuffer(txt) {
  const bin = atob(txt);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
// at most `n` downloads in flight
function limiter(n) {
  let active = 0; const queue = [];
  const next = () => { if (active >= n || !queue.length) return; active++; const { fn, res, rej } = queue.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return fn => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}
const slot = limiter(PACKED ? 4 : 6);
async function retry(fn, label, tries = 3) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries - 1) throw new Error(`${label} (${e && e.message ? e.message : e})`);
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.onload = () => { el.remove(); res(); };
    el.onerror = () => { el.remove(); rej(new Error('script did not load')); };
    document.head.appendChild(el);
  });
}
let ASSET_BASE = './assets';
// bytes of one packed asset, e.g. key 'chars/Knight.glb'
async function packedBytes(key) {
  const parts = PACK_INDEX.files?.[key];
  if (!parts) throw new Error('not in the pack');
  for (let i = 0; i < parts; i++) await slot(() => retry(() => loadScript(`${ASSET_BASE}/${key}.${i}.js`), `${key} part ${i + 1}`));
  const store = window.__LFP || {};
  const b64 = (store[key] || []).join('');
  delete store[key];
  if (!b64) throw new Error('empty pack');
  return b64ToBuffer(b64);
}
const fetchBytes = url => fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
const parseGLB = buf => new Promise((res, rej) => loader.parse(buf, '', res, rej));
const loadGLB = url => {
  const key = url.slice(ASSET_BASE.length + 1);
  return PACKED
    ? retry(() => packedBytes(key), key, 2).then(parseGLB)
    : slot(() => retry(() => fetchBytes(url), key)).then(parseGLB);
};

function tuneMaterial(m, env = false) {
  if (!m || m.userData.tuned) return;
  m.userData.tuned = true;
  if (m.isMeshStandardMaterial) {
    const metallic = /metal/i.test(m.name);
    m.metalness = metallic ? 0.55 : 0.0;
    m.roughness = metallic ? 0.45 : (env ? 0.9 : 0.78);
    m.envMapIntensity = env ? 0.55 : 0.75;
    if (/glow/i.test(m.name)) {
      m.emissive = new THREE.Color(0.55, 0.85, 1.0);
      m.emissiveIntensity = 2.2;
      if (m.map) m.emissiveMap = m.map;
    }
    if (/glass/i.test(m.name)) { m.transparent = true; m.opacity = 0.55; m.roughness = 0.1; }
  }
  if (m.map) m.map.anisotropy = 4;
}

export async function loadAssets(base, onProgress = () => {}) {
  ASSET_BASE = base;
  let done = 0;
  const total = CHAR_FILES.length + 2 + SCENE_PACKS.length + 1;
  const tick = () => onProgress(++done / total);
  const jobs = [];
  for (const n of CHAR_FILES) {
    jobs.push(loadGLB(`${base}/chars/${n}.glb`).then(g => {
      g.scene.traverse(o => { if (o.isMesh) tuneMaterial(o.material); });
      A.chars[n] = g.scene; tick();
    }));
  }
  for (const rig of ['medium', 'large']) {
    jobs.push(loadGLB(`${base}/anims/anim_${rig}.glb`).then(g => {
      for (const c of g.animations) A.clips[rig][c.name] = c;
      tick();
    }));
  }
  for (const p of SCENE_PACKS) {
    jobs.push(loadGLB(`${base}/${p}.glb`).then(g => {
      for (const s of g.scenes) {
        s.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; tuneMaterial(o.material, p !== 'props'); } });
        s.updateMatrixWorld(true);
        A.scenes[s.name] = s;
      }
      tick();
    }));
  }
  // sound effects are optional: a missing one just stays silent
  if (PACKED) {
    jobs.push((async () => {
      for (let i = 0; i < (PACK_INDEX.sfx || 0); i++) {
        try { await slot(() => retry(() => loadScript(`${base}/sfx-pack.${i}.js`), 'sounds')); } catch (e) { console.warn(e); }
      }
      const store = window.__LFP || {};
      for (const n of SFX) { const k = `sfx/${n}.mp3`; if (store[k]) { A.sfx[n] = b64ToBuffer(store[k].join('')); delete store[k]; } }
    })().then(tick));
  } else {
    jobs.push(Promise.all(SFX.map(n => slot(() => retry(() => fetchBytes(`${base}/sfx/${n}.mp3`), n, 2)).then(b => { A.sfx[n] = b; }).catch(() => {}))).then(tick));
  }
  await Promise.all(jobs);
}

// ---------- character variants ----------
function getComp(a, i, k) { return k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i); }
function toFloatGeometry(g) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const n = a.count, s = a.itemSize;
    const arr = name === 'skinIndex' ? new Uint16Array(n * s) : new Float32Array(n * s);
    for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) arr[i * s + k] = getComp(a, i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  if (g.index) out.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
  return out;
}

/**
 * Build (or fetch cached) a prototype for a character variant.
 * opts: { hide: [substr], tint: hex, tintMix: 0..1, emissive: hex, emissiveIntensity, headScale }
 */
export function getVariant(charName, opts = {}) {
  const key = charName + '|' + JSON.stringify(opts);
  if (A.variants.has(key)) return A.variants.get(key);
  const src = A.chars[charName];
  if (!src) throw new Error('No character ' + charName);
  const root = skeletonClone(src);
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse(o => { if (o.isSkinnedMesh) parts.push(o); });
  const hide = opts.hide || [];
  const keep = parts.filter(p => !hide.some(h => p.name.toLowerCase().includes(h.toLowerCase())));
  const skeleton = keep[0].skeleton;
  const bindMatrix = keep[0].bindMatrix.clone();
  const parent = keep[0].parent;
  const groups = new Map();
  for (const p of keep) {
    if (!groups.has(p.material)) groups.set(p.material, []);
    groups.get(p.material).push(p);
  }
  for (const p of parts) p.removeFromParent();
  const meshes = [];
  for (const [mat, list] of groups) {
    const geo = mergeGeometries(list.map(p => toFloatGeometry(p.geometry)), false);
    const m = mat.clone();
    m.userData = { ...mat.userData };
    if (opts.tint !== undefined) {
      const c = new THREE.Color(opts.tint);
      m.color = new THREE.Color(1, 1, 1).lerp(c, opts.tintMix ?? 0.6);
    }
    if (opts.emissive !== undefined && !/glow/i.test(mat.name)) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity ?? 0.25;
    }
    if (opts.glowColor !== undefined && /glow/i.test(mat.name)) {
      m.emissive = new THREE.Color(opts.glowColor);
    }
    const sm = new THREE.SkinnedMesh(geo, m);
    sm.name = charName + '_body';
    sm.castShadow = true;
    sm.receiveShadow = true;
    parent.add(sm);
    sm.bind(skeleton, bindMatrix);
    meshes.push(sm);
  }
  root.updateMatrixWorld(true);
  for (const sm of meshes) {
    sm.computeBoundingSphere();
    sm.boundingSphere.radius *= 1.35;
  }
  const proto = { key, charName, root, rig: LARGE_RIG.has(charName) ? 'large' : 'medium', opts };
  A.variants.set(key, proto);
  return proto;
}

/** Instantiate a character from a variant prototype. Returns { root, mixer, bones, meshes } */
export function spawnCharacter(proto, { weapons = [], scale = 1, headScale = 0.74, uniqueMaterials = true } = {}) {
  const root = skeletonClone(proto.root);
  const meshes = [];
  root.traverse(o => {
    if (o.isSkinnedMesh) {
      if (uniqueMaterials) { o.material = o.material.clone(); }
      meshes.push(o);
    }
  });
  const head = root.getObjectByName('head');
  if (head) head.scale.setScalar(headScale);
  for (const w of weapons) attachProp(root, w);
  root.scale.setScalar(scale);
  const mixer = new THREE.AnimationMixer(root);
  return { root, mixer, meshes, head, rig: proto.rig };
}

const SOCKETS = { r: 'handslotr', l: 'handslotl', head: 'head', back: 'chest', hips: 'hips' };
export function attachProp(root, w) {
  const id = typeof w === 'string' ? w : w.id;
  const src = A.scenes[id];
  if (!src) { console.warn('missing prop', id); return null; }
  const bone = root.getObjectByName(SOCKETS[w.hand || 'r'] || w.hand);
  if (!bone) return null;
  const obj = src.clone();
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  if (w.pos) obj.position.fromArray(w.pos);
  if (w.rot) obj.rotation.set(w.rot[0], w.rot[1], w.rot[2]);
  if (w.scale) obj.scale.setScalar(w.scale);
  obj.name = 'prop_' + id;
  bone.add(obj);
  return obj;
}

export function clip(rig, name) {
  return A.clips[rig][name] || A.clips.medium[name] || null;
}

// ---------- static scene helpers ----------
export function cloneScene(id) {
  const s = A.scenes[id];
  if (!s) { console.warn('missing scene', id); return new THREE.Group(); }
  return s.clone();
}

const _m = new THREE.Matrix4();
const windMats = new Map();
export function windMaterial(base, strength = 1) {
  const key = base.uuid + strength;
  if (windMats.has(key)) return windMats.get(key);
  const m = base.clone();
  m.onBeforeCompile = function (sh) {
    globalPatch.call(this, sh);
    sh.uniforms.uTime = globalUniforms.uTime;
    sh.uniforms.uWind = globalUniforms.uWind;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 wpos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vec3 wpos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif
      float hgt = max(transformed.y, 0.0);
      float sway = sin(uTime * 1.7 + wpos.x * 0.35 + wpos.z * 0.22) + 0.45 * sin(uTime * 3.1 + wpos.z * 0.6);
      transformed.x += sway * ${(0.045 * strength).toFixed(4)} * hgt * uWind;
      transformed.z += cos(uTime * 1.3 + wpos.x * 0.27) * ${(0.03 * strength).toFixed(4)} * hgt * uWind;
    `);
  };
  m.customProgramCacheKey = () => 'wind' + strength;
  windMats.set(key, m);
  return m;
}

/** Make InstancedMeshes for every mesh inside a scene id. matrices: Matrix4[] */
export function instanced(id, matrices, { shadow = true, wind = 0, receive = true } = {}) {
  const src = A.scenes[id];
  const group = new THREE.Group();
  if (!src || !matrices.length) return group;
  src.updateMatrixWorld(true);
  src.traverse(o => {
    if (!o.isMesh) return;
    const mat = wind ? windMaterial(o.material, wind) : o.material;
    const im = new THREE.InstancedMesh(o.geometry, mat, matrices.length);
    for (let i = 0; i < matrices.length; i++) { _m.multiplyMatrices(matrices[i], o.matrixWorld); im.setMatrixAt(i, _m); }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadow;
    im.receiveShadow = receive;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

// ---------- portraits ----------
export function renderPortraits(renderer, items, size = 160) {
  const rt = new THREE.WebGLRenderTarget(size * 2, size * 2, { depthBuffer: true });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = null;
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a2a20, 1.4);
  const key = new THREE.DirectionalLight(0xfff0d8, 2.6); key.position.set(1.5, 2.5, 3);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 2.0); rim.position.set(-2.5, 2, -2.5);
  scene.add(hemi, key, rim);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.05, 100);
  const buf = new Uint8Array(size * 4 * size * 4);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size * 2;
  const ctx = canvas.getContext('2d');
  const out = document.createElement('canvas'); out.width = out.height = size;
  const octx = out.getContext('2d');
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  const v = new THREE.Vector3();
  for (const it of items) {
    try {
      const inst = it.build();
      scene.add(inst.root);
      if (inst.rig !== 'static') {
        const idle = clip(inst.rig, inst.rig === 'large' ? 'Idle_A' : (it.idle || 'Idle_A'));
        if (idle) { inst.mixer.clipAction(idle).play(); inst.mixer.update(0.4); }
      }
      inst.root.updateMatrixWorld(true);
      if (inst.rig === 'static') {
        const box = new THREE.Box3().setFromObject(inst.root);
        const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
        const d = Math.max(sz.x, sz.y, sz.z) * 1.9;
        cam.position.set(c.x + d * 0.55, c.y + d * 0.35, c.z + d * 0.8);
        cam.lookAt(c);
      } else {
        const head = inst.head || inst.root.getObjectByName('head');
        head.getWorldPosition(v);
        const s = inst.root.scale.x * (inst.rig === 'large' ? 2.1 : 1) * (it.zoom || 1);
        cam.position.set(v.x + 0.55 * s, v.y + 0.25 * s, v.z + 2.4 * s);
        cam.lookAt(v.x, v.y + 0.05 * s, v.z);
      }
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, size * 2, size * 2, buf);
      const img = ctx.createImageData(size * 2, size * 2);
      const w = size * 2;
      for (let y = 0; y < w; y++) img.data.set(buf.subarray((w - 1 - y) * w * 4, (w - y) * w * 4), y * w * 4);
      ctx.putImageData(img, 0, 0);
      octx.clearRect(0, 0, size, size);
      octx.filter = it.filter || 'saturate(0.62) contrast(1.12) brightness(0.88) sepia(0.12)';
      octx.drawImage(canvas, 0, 0, size, size);
      octx.filter = 'none';
      A.portraits[it.key] = out.toDataURL('image/png');
      scene.remove(inst.root);
      if (inst.mixer) inst.mixer.stopAllAction();
    } catch (e) { console.warn('portrait failed', it.key, e); }
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(0x000000, prevClear);
  rt.dispose();
}
