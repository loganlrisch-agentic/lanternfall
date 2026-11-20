// Assembles a battlefield: terrain, Dawnhold castle, the enemy stronghold, capture shrines and set dressing.
import * as THREE from 'three';
import { cloneScene, instanced, globalUniforms, A } from '../core/assets.js';
import { Terrain, applySnow, snowUniform } from './terrain.js';
import { BIOMES } from './biomes.js';
import { MAP, roadZ } from '../game/config.js';
import { rng } from '../core/util.js';

const riftShader = {
  uniforms: { uTime: globalUniforms.uTime, uColor: { value: new THREE.Color('#b05cff') }, uColor2: { value: new THREE.Color('#2a0a4a') }, uPower: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform float uTime, uPower; uniform vec3 uColor, uColor2; varying vec2 vUv;
    void main(){
      vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
      float sw = sin(a * 5.0 + r * 9.0 - uTime * 3.0) * 0.5 + 0.5;
      float sw2 = sin(a * 3.0 - r * 14.0 + uTime * 2.0) * 0.5 + 0.5;
      vec3 c = mix(uColor2, uColor, sw * 0.7 + sw2 * 0.3) * max(1.5 - r, 0.0) * 2.0 * uPower;
      float alpha = smoothstep(1.0, 0.75, r) * (0.65 + 0.35 * sw);
      // r passes 1.0 in the quad's corners; pow() of a negative base is NaN on real GPUs
      gl_FragColor = vec4(c + vec3(1.0) * pow(max(1.0 - r, 0.0), 6.0) * 2.0 * uPower, alpha);
    }`,
};

const shieldShader = {
  uniforms: { uTime: globalUniforms.uTime, uColor: { value: new THREE.Color('#9b6bff') }, uAlpha: { value: 0.6 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uTime, uAlpha; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){ float f = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 2.5); float hex = sin(vP.x * 2.0 + uTime) * sin(vP.y * 2.0 - uTime * 0.7) * sin(vP.z * 2.0);
      float a = (f * 0.75 + smoothstep(0.85, 1.0, hex) * 0.18 + 0.02) * uAlpha; gl_FragColor = vec4(uColor * 1.1, a); }`,
};

export class Level {
  constructor(scene, chapter, { quality = 'medium', grass = 1, fx }) {
    this.scene = scene;
    this.chapter = chapter;
    this.biome = BIOMES[chapter.biome];
    this.fx = fx;
    this.root = new THREE.Group();
    this.root.name = 'level';
    scene.add(this.root);
    snowUniform.value = this.biome.snowShader || 0;
    this.shrinePoints = chapter.shrines || [];
    this.terrain = new Terrain(this.biome, { seed: chapter.seed || 7, quality, shrines: this.shrinePoints });
    this.terrain.scatter(grass);
    this.root.add(this.terrain.group);
    this.colliders = this.terrain.colliders;
    this.r = rng((chapter.seed || 7) * 13);
    this.towers = [];
    this.shrines = [];
    this.animated = [];
    this.buildCastle();
    this.buildFortress(chapter.fortress || 'barrow');
    this.buildShrines();
    this.buildFieldDressing();
    applySnow(this.root);
  }

  h(x, z) { return this.terrain.heightAt(x, z); }

  place(id, x, z, { rot = 0, scale = 1, y = 0, parent = this.root, tint = null, emissive = null, collide = 0, noSnow = false } = {}) {
    const o = cloneScene(id);
    o.position.set(x, this.h(x, z) + y, z);
    o.rotation.y = rot;
    o.scale.setScalar(scale);
    if (tint || emissive) {
      o.traverse(m => {
        if (!m.isMesh) return;
        m.material = m.material.clone();
        if (tint) m.material.color = new THREE.Color(tint);
        if (emissive) { m.material.emissive = new THREE.Color(emissive); m.material.emissiveIntensity = 0.35; }
      });
    }
    if (noSnow) o.traverse(m => { m.userData.noSnow = true; });
    parent.add(o);
    if (collide) this.colliders.push({ x, z, r: collide });
    return o;
  }

  buildCastle() {
    const S = 6, X = MAP.castleX;
    const wallRot = Math.PI / 2;
    this.place('wall_straight_gate', X, 0, { rot: wallRot, scale: S });
    for (const z of [12, 24, -12, -24]) this.place('wall_straight', X, z, { rot: wallRot, scale: S });
    // side walls running back to the keep
    for (const x of [-77, -89, -101]) for (const z of [-31, 31]) this.place('wall_straight', x, z, { rot: 0, scale: S });
    // towers that defend the wall
    const towerZ = [-30, -6.6, 6.6, 30];
    for (const z of towerZ) {
      const id = Math.abs(z) > 20 ? 'tower_B_blue' : 'tower_A_blue';
      const t = this.place(id, X, z, { rot: Math.PI / 2, scale: S * (Math.abs(z) > 20 ? 1 : 0.95) });
      const top = this.h(X, z) + (Math.abs(z) > 20 ? 13.5 : 12.5);
      this.towers.push({ pos: new THREE.Vector3(X + 0.5, top, z), cd: Math.random(), obj: t });
    }
    this.place('tower_A_blue', -106, 31, { rot: 0, scale: S });
    this.place('tower_A_blue', -106, -31, { rot: 0, scale: S });
    // keep with the Last Lantern
    const kx = MAP.keepX;
    this.keep = this.place('castle_blue', kx, 0, { rot: -Math.PI / 2, scale: S * 1.15 });
    const beaconY = this.h(kx, 0) + 27.5;
    this.lanternPos = new THREE.Vector3(kx, beaconY, 0);
    const lan = this.place('hw_lantern_standing', kx, 0, { y: beaconY - this.h(kx, 0) - 1.6, scale: 3.2 });
    lan.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.emissive = new THREE.Color('#ffb347'); m.material.emissiveIntensity = 0.6; } });
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 2.6, 1.0), transparent: true, opacity: 0.95 });
    this.lanternFlame = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), flameMat);
    this.lanternFlame.position.copy(this.lanternPos).add(new THREE.Vector3(0, 0.6, 0));
    this.root.add(this.lanternFlame);
    this.lanternLight = new THREE.PointLight(0xffb060, 60, 70, 1.4);
    this.lanternLight.position.copy(this.lanternFlame.position);
    this.root.add(this.lanternLight);
    this.fx.emitter({ pos: this.lanternFlame.position.clone(), rate: 22, color: 0xffa040, size: 1.2, life: 1.0, speed: 0.8, up: 2.5, gravity: -1.5, spread: 0.6, radius: 0.6 });
    // courtyard life
    this.place('barracks_blue', -81, -18, { rot: Math.PI / 2, scale: 5.2 });
    this.place('blacksmith_blue', -82, 18, { rot: Math.PI / 2, scale: 5.2 });
    this.place('church_blue', -103, -16, { rot: Math.PI / 2, scale: 5.5 });
    this.place('archeryrange_blue', -103, 17, { rot: Math.PI / 2, scale: 5 });
    this.place('tent_blue', -76.5, 25, { rot: Math.PI / 2, scale: 3.6 });
    this.place('tent_blue', -76.5, -25.5, { rot: Math.PI / 2, scale: 3.6 });
    this.place('well_blue', -79, 8, { rot: 0, scale: 3.2 });
    this.place('stables_blue', -92, -25, { rot: 0, scale: 4.2 });
    for (const [id, x, z, s, r] of [['crate_A_big', -74.5, 9, 4, 0.3], ['barrel', -74.6, 11.2, 4, 0], ['haybale', -75, -9, 4, 0.8], ['weaponrack', -74.4, -12, 4, Math.PI / 2],
      ['cart', -77, -6, 3.5, 2.1], ['crate_long_A', -86, 9, 3.5, 1.2], ['sack', -85.5, 7.5, 4, 0], ['target', -100, 24, 4, Math.PI / 2], ['bucket_arrows', -75.5, 13, 4, 0]]) {
      this.place(id, x, z, { rot: r, scale: s });
    }
    // banners and torches on the wall face
    for (const z of [-24, -12, 12, 24]) {
      const b = this.place('banner_patternA_blue', X + 2.6, z, { rot: Math.PI / 2, scale: 1.5, y: 0.2 });
      b.position.y = this.h(X, z) + 0.4;
    }
    for (const z of [-4.6, 4.6]) {
      const t = this.place('torch_lit', X + 2.9, z, { scale: 1.5, y: 1.2 });
      const fp = new THREE.Vector3(X + 2.9, this.h(X, z) + 3.1, z);
      this.fx.emitter({ pos: fp, rate: 14, color: 0xff8a30, size: 0.55, life: 0.55, speed: 0.5, up: 2.2, gravity: -2, spread: 0.3, radius: 0.15 });
    }
    // flags on towers
    for (const tw of this.towers) {
      const f = cloneScene('flag_blue');
      f.scale.setScalar(9);
      f.position.copy(tw.pos).add(new THREE.Vector3(0, 0.6, 0));
      f.rotation.y = Math.PI / 2;
      this.root.add(f);
      this.animated.push({ obj: f, sway: Math.random() * 10 });
    }
    this.gatePos = new THREE.Vector3(X, this.h(X, 0), 0);
    this.heroSpawn = new THREE.Vector3(X - 7, this.h(X - 7, 0), 0);
    this.allySpawn = new THREE.Vector3(MAP.spawnX, this.h(MAP.spawnX, 0), 0);
  }

  buildFortress(kind) {
    const fx = MAP.fortressX;
    const g = new THREE.Group();
    this.root.add(g);
    const r = this.r;
    let riftColor = '#b05cff', riftDark = '#22083a', riftScale = 1;
    const ring = (n, rad, cx, cz, fn) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; fn(cx + Math.cos(a) * rad, cz + Math.sin(a) * rad, a); } };
    switch (kind) {
      case 'barrow': {
        this.place('hw_crypt', fx + 6, 0, { rot: -Math.PI / 2, scale: 1.7, parent: g, collide: 7 });
        this.place('hw_arch_gate', fx - 4, 0, { rot: Math.PI / 2, scale: 1.9, parent: g });
        ring(14, 15, fx + 2, 0, (x, z, a) => { if (Math.abs(z) < 6 && x < fx) return; this.place(r() < 0.5 ? 'hw_gravestone' : 'hw_grave_A', x, z, { rot: -a + Math.PI / 2, scale: r.range(1.1, 1.5), parent: g }); });
        for (let i = 0; i < 9; i++) this.place(r.pick(['hw_tree_dead_large', 'hw_tree_dead_medium']), fx + r.range(-6, 18), r.pick([-1, 1]) * r.range(10, 24), { rot: r() * 6, scale: r.range(1.2, 1.7), parent: g });
        for (let i = 0; i < 10; i++) this.place(r.pick(['hw_skull', 'hw_bone_A', 'hw_ribcage', 'hw_candle_triple']), fx + r.range(-14, 4), r.range(-12, 12), { rot: r() * 6, scale: 1.4, parent: g });
        for (const z of [-7, 7]) this.place('hw_post_lantern', fx - 7, z, { scale: 1.8, parent: g, emissive: '#7a3cff' });
        break;
      }
      case 'witchgrove': {
        riftColor = '#5cff9a'; riftDark = '#06301a';
        ring(9, 11, fx + 2, 0, (x, z, a) => this.place(r() < 0.6 ? 'pillar' : 'column', x, z, { rot: a, scale: r.range(1.1, 1.6), parent: g, tint: '#8a9a90', collide: 1.2 }));
        this.place('Cauldron', fx + 4, 0, { scale: 3.2, parent: g, collide: 2.5 });
        this.cauldronFx = this.fx.emitter({ pos: new THREE.Vector3(fx + 4, this.h(fx + 4, 0) + 2.4, 0), rate: 18, color: 0x66ff88, size: 1.2, life: 1.4, speed: 0.6, up: 2.2, gravity: -1.2, spread: 0.7, radius: 1 });
        for (let i = 0; i < 12; i++) this.place(r.pick(['Tree_6_A', 'Tree_7_A', 'Tree_3_A_c3']), fx + r.range(-4, 22), r.pick([-1, 1]) * r.range(13, 26), { rot: r() * 6, scale: r.range(2.2, 3), parent: g });
        this.place('hw_shrine_candles', fx + 12, 6, { scale: 1.6, parent: g });
        this.place('hw_shrine_candles', fx + 12, -6, { scale: 1.6, parent: g });
        for (let i = 0; i < 8; i++) this.place(r.pick(['hw_skull_candle', 'hw_candle_triple', 'hw_bone_B']), fx + r.range(-10, 8), r.range(-10, 10), { scale: 1.4, parent: g });
        break;
      }
      case 'frozenbreach': {
        riftColor = '#7ad8ff'; riftDark = '#06243a';
        this.place('castle_red', fx + 12, 0, { rot: -Math.PI / 2, scale: 6.2, parent: g, tint: '#b8c8e0', collide: 9 });
        for (const z of [-12, 12]) this.place('wall_straight', fx + 4, z, { rot: Math.PI / 2, scale: 6, parent: g, tint: '#c8d4e8' });
        for (const z of [-19, 19]) this.place('tower_B_red', fx + 4, z, { rot: -Math.PI / 2, scale: 6, parent: g, tint: '#c0cce0', collide: 3 });
        for (let i = 0; i < 16; i++) {
          const x = fx + r.range(-16, 4), z = r.range(-20, 20);
          if (Math.abs(z) < 5) continue;
          const crystal = this.place('Gem_Large', x, z, { rot: r() * 6, scale: r.range(3, 7), parent: g, noSnow: true });
          crystal.rotation.z = r.range(-0.4, 0.4);
          crystal.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color = new THREE.Color('#9fe6ff'); m.material.emissive = new THREE.Color('#3aa8ff'); m.material.emissiveIntensity = 0.8; m.material.roughness = 0.15; } });
        }
        break;
      }
      case 'warcamp': {
        riftColor = '#ff6a2a'; riftDark = '#3a0e04'; riftScale = 0;
        for (let i = 0; i < 26; i++) { const a = -Math.PI * 0.42 + (i / 25) * Math.PI * 0.84; const x = fx + 2 - Math.cos(a) * 20, z = Math.sin(a) * 24; if (Math.abs(z) < 5) continue; this.place('fence_wood_straight', x, z, { rot: a + Math.PI / 2, scale: 5, parent: g }); }
        for (const [x, z] of [[fx + 6, -12], [fx + 6, 12], [fx + 14, -4], [fx + 14, 6], [fx + 20, -14], [fx + 20, 14]]) this.place(r() < 0.5 ? 'tent_red' : 'tent_yellow', x, z, { rot: -Math.PI / 2 + r.range(-0.3, 0.3), scale: 4.2, parent: g, collide: 3 });
        this.totem = this.place('watchtower_red', fx + 2, 0, { rot: -Math.PI / 2, scale: 6, parent: g, collide: 4 });
        for (const z of [-5, 5]) {
          const b = this.place('Orc_Banner_Large', fx - 4, z, { scale: 1.6, parent: g });
        }
        const cf = this.place('Campfire_Logs', fx + 10, 0, { scale: 2.5, parent: g });
        this.fx.emitter({ pos: new THREE.Vector3(fx + 10, this.h(fx + 10, 0) + 0.8, 0), rate: 30, color: 0xff7a2a, size: 1.1, life: 0.9, speed: 0.9, up: 2.6, gravity: -2, spread: 0.6, radius: 0.8 });
        for (let i = 0; i < 10; i++) this.place(r.pick(['crate_A_big', 'barrel', 'sack', 'resource_lumber', 'weaponrack']), fx + r.range(-2, 22), r.range(-18, 18), { rot: r() * 6, scale: 3.5, parent: g });
        break;
      }
      case 'cathedral': {
        riftColor = '#5affd0'; riftDark = '#032a24';
        this.place('church_red', fx + 12, 0, { rot: -Math.PI / 2, scale: 8, parent: g, tint: '#7e8a88', collide: 8 });
        for (const z of [-14, 14]) this.place('building_destroyed', fx + 6, z, { rot: r() * 6, scale: 6, parent: g });
        ring(10, 13, fx + 4, 0, (x, z, a) => { if (x < fx - 2 && Math.abs(z) < 6) return; this.place(r() < 0.5 ? 'pillar' : 'column', x, z, { rot: a, scale: r.range(1.0, 1.4), parent: g, tint: '#6e7a76', collide: 1.1 }); });
        for (let i = 0; i < 14; i++) this.place(r.pick(['hw_gravestone', 'hw_grave_B', 'hw_gravemarker_A', 'hw_coffin']), fx + r.range(-12, 18), r.pick([-1, 1]) * r.range(7, 22), { rot: r() * 6, scale: 1.3, parent: g });
        break;
      }
      case 'citadel': {
        riftColor = '#ff3a5a'; riftDark = '#3a0410'; riftScale = 1.35;
        this.place('castle_red', fx + 14, 0, { rot: -Math.PI / 2, scale: 7.5, parent: g, tint: '#d8c8cc', collide: 10 });
        for (const z of [-12, 12, -24, 24]) this.place('wall_straight', fx + 4, z, { rot: Math.PI / 2, scale: 6, parent: g, tint: '#bfaeb2' });
        for (const z of [-30, -6.6, 6.6, 30]) this.place('tower_B_red', fx + 4, z, { rot: -Math.PI / 2, scale: 6.2, parent: g, tint: '#c8b8bc', collide: 3 });
        for (let i = 0; i < 10; i++) this.place(r.pick(['hw_tree_dead_large_decorated', 'hw_tree_dead_large']), fx + r.range(-14, 4), r.pick([-1, 1]) * r.range(10, 26), { rot: r() * 6, scale: r.range(1.3, 1.8), parent: g });
        for (const z of [-8, 8]) this.place('hw_post_skull', fx - 6, z, { scale: 2, parent: g });
        break;
      }
    }
    // the rift (enemy spawn + objective)
    const rx = fx - 8, ry = this.h(rx, 0);
    this.riftPos = new THREE.Vector3(rx, ry + 4.8 * Math.max(riftScale, 1), 0);
    this.enemySpawn = new THREE.Vector3(rx - 4, ry, 0);
    this.fortressCore = new THREE.Vector3(rx, ry, 0);
    const riftMat = new THREE.ShaderMaterial({ ...riftShader, uniforms: { ...riftShader.uniforms, uColor: { value: new THREE.Color(riftColor) }, uColor2: { value: new THREE.Color(riftDark) }, uPower: { value: 1 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    if (riftScale > 0) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(4.2 * riftScale, 48), riftMat);
      disc.position.copy(this.riftPos);
      disc.rotation.y = Math.PI / 2;
      g.add(disc);
      const torus = new THREE.Mesh(new THREE.TorusGeometry(4.4 * riftScale, 0.45 * riftScale, 10, 48), new THREE.MeshStandardMaterial({ color: '#1a1020', emissive: new THREE.Color(riftColor), emissiveIntensity: 2.2, roughness: 0.4 }));
      torus.position.copy(this.riftPos);
      torus.rotation.y = Math.PI / 2;
      g.add(torus);
      this.riftDisc = disc; this.riftTorus = torus;
      // standing stones around the rift
      for (const z of [-6.5, 6.5]) this.place('rocks_decorated', rx + 1, z, { scale: 1.6, parent: g, collide: 1.5 });
      this.riftFx = this.fx.emitter({ pos: this.riftPos.clone(), rate: 26, color: new THREE.Color(riftColor).getHex(), size: 0.9, life: 1.6, speed: 2.2, up: 0.4, gravity: -0.6, spread: 1, radius: 4.0 * riftScale });
    }
    this.riftMat = riftMat;
    this.riftLight = new THREE.PointLight(new THREE.Color(riftColor), 45, 40, 1.5);
    this.riftLight.position.copy(this.riftPos).add(new THREE.Vector3(-2, 0, 0));
    g.add(this.riftLight);
    const shield = new THREE.Mesh(new THREE.SphereGeometry(13, 40, 24), new THREE.ShaderMaterial({ ...shieldShader, uniforms: { ...shieldShader.uniforms, uColor: { value: new THREE.Color(riftColor) }, uAlpha: { value: 0.42 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    shield.position.set(rx + 2, ry, 0);
    g.add(shield);
    this.shield = shield;
    this.fortressGroup = g;
    this.riftColor = riftColor;
  }

  setShield(on) { this.shieldTarget = on ? 0.42 : 0; }

  buildShrines() {
    for (const [x, z] of this.shrinePoints) {
      const g = new THREE.Group();
      g.position.set(x, this.h(x, z), z);
      this.root.add(g);
      const base = cloneScene('shrine_blue'); base.scale.setScalar(3.4); base.rotation.y = Math.PI / 2;
      const baseRed = cloneScene('shrine_red'); baseRed.scale.setScalar(3.4); baseRed.rotation.y = Math.PI / 2;
      const neutral = cloneScene('shrine_blue'); neutral.scale.setScalar(3.4); neutral.rotation.y = Math.PI / 2;
      neutral.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color = new THREE.Color('#9a9a9a'); } });
      g.add(base, baseRed, neutral);
      const lantern = cloneScene('hw_post_lantern'); lantern.scale.setScalar(1.7); lantern.position.set(-3.2, 0, 2.4);
      g.add(lantern);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.6, 0.7) }));
      flame.position.set(-3.2, 3.55, 2.4 + 0.55);
      g.add(flame);
      const ringMat = new THREE.ShaderMaterial({
        uniforms: { uProg: { value: 0 }, uColor: { value: new THREE.Color('#ffd27a') }, uBase: { value: new THREE.Color('#aaaaaa') }, uTime: globalUniforms.uTime },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float uProg, uTime; uniform vec3 uColor, uBase; varying vec2 vUv;
          void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.x, -p.y) / 6.2831853 + 0.5;
            float band = smoothstep(0.9, 0.925, r) * smoothstep(0.98, 0.955, r);
            float dash = step(0.5, fract(a * 40.0 - uTime * 0.3));
            vec3 c = a < uProg ? uColor * 1.1 : uBase * (0.3 + 0.4 * dash);
            float alpha = band * (a < uProg ? 0.85 : 0.22) + smoothstep(0.9, 0.2, r) * 0.04 * (a < uProg ? 1.0 : 0.0);
            gl_FragColor = vec4(c, alpha); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const ringMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 0.2;
      g.add(ringMesh);
      const shrine = { pos: new THREE.Vector3(x, this.h(x, z), z), group: g, base, baseRed, neutral, flame, ringMat, owner: -1, progress: 0, radius: 7.5 };
      this.colliders.push({ x, z, r: 2.4 });
      this.setShrineOwner(shrine, -1);
      this.shrines.push(shrine);
    }
  }

  setShrineOwner(s, owner) {
    s.owner = owner;
    s.base.visible = owner === 0;
    s.baseRed.visible = owner === 1;
    s.neutral.visible = owner === -1;
    s.flame.material.color.set(owner === 0 ? new THREE.Color(4, 2.6, 1) : owner === 1 ? new THREE.Color(2.2, 0.8, 4) : new THREE.Color(0.5, 0.5, 0.6));
  }

  buildFieldDressing() {
    const r = this.r;
    const b = this.chapter.biome;
    // ruins / barricades along the road give the field some landmarks
    const props = b === 'highforge' ? ['resource_stone', 'crate_A_big', 'cart'] : b === 'drowned' || b === 'citadel' ? ['hw_gravestone', 'hw_fence_broken', 'rubble_large', 'hw_grave_A_destroyed'] : ['haybale', 'cart', 'fence_wood_straight', 'rubble_half', 'crate_B_big'];
    for (let i = 0; i < 16; i++) {
      const x = r.range(-55, 70), side = r.pick([-1, 1]), z = side * r.range(11, 27);
      if (Math.abs(z - roadZ(x)) < 6) continue;
      if (this.shrinePoints.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 10)) continue;
      const id = r.pick(props);
      this.place(id, x, z, { rot: r() * 6, scale: id.startsWith('hw_') || id.startsWith('rubble') ? 1.3 : 3.6, collide: 1.2 });
    }
    // fallen-soldier grave markers near the wall from older sieges
    for (let i = 0; i < 6; i++) this.place('sword_shield_broken' in A.scenes ? 'sword_shield' : 'sword_shield', MAP.castleX + r.range(8, 22), r.range(-26, 26), { rot: r() * 6, scale: 1.0 });
  }

  update(dt, t, camera) {
    for (const a of this.animated) a.obj.rotation.z = Math.sin(t * 2 + a.sway) * 0.06;
    if (this.lanternFlame) {
      const f = 1 + Math.sin(t * 9) * 0.06 + Math.sin(t * 23) * 0.04;
      this.lanternFlame.scale.setScalar(f);
      this.lanternLight.intensity = 55 * f;
    }
    if (this.shield) {
      const u = this.shield.material.uniforms.uAlpha;
      let target = this.shieldTarget ?? 0.42;
      if (camera) { const d = camera.position.distanceTo(this.shield.position); target *= Math.min(1, Math.max(0, (d - 13) / 8)); }
      u.value += (target - u.value) * Math.min(1, dt * 2);
      this.shield.visible = u.value > 0.01;
    }
    if (this.riftTorus) this.riftTorus.rotation.x += dt * 0.4;
    for (const s of this.shrines) s.ringMat.uniforms.uProg.value = s.progress;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && o.name === 'terrain') o.geometry.dispose();
    });
  }
}
