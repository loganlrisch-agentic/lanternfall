// Owns the THREE.Scene, camera, sky, lights, FX, atmosphere and the current level.
import * as THREE from 'three';
import { Sky } from './sky.js';
import { FX } from './fx.js';
import { Level } from './level.js';
import { BIOMES } from './biomes.js';
import { FogBank, Crows, Lightning } from './atmos.js';
import { QUALITY } from '../core/renderer.js';
import { globalUniforms } from '../core/assets.js';
import { darkUniforms } from '../core/materials.js';

export class World {
  constructor(renderer) {
    this.R = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1400);
    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 260;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.fx = new FX(this.scene);
    this.fog = new FogBank(this.scene);
    this.crows = new Crows(this.scene);
    this.lightning = new Lightning(this);
    this.level = null;
    this.focus = new THREE.Vector3();
    this.time = 0;
    this.baseHemi = 0.4;
  }

  applyBiome(id) {
    const b = BIOMES[id];
    this.biome = b;
    this.biomeId = id;
    this.sky.apply(b.sky);
    this.scene.environment = this.sky.makeEnvironment(this.R.renderer);
    this.scene.environmentIntensity = 0.55;
    this.scene.fog = new THREE.FogExp2(b.fog.color, b.fog.density);
    darkUniforms.uFogFalloff.value = b.fog.falloff ?? 0.13;
    darkUniforms.uFogWall.value.set(5, 95, b.fog.wall ?? 1.4);
    darkUniforms.uGrimSat.value = b.grim?.sat ?? 0.5;
    darkUniforms.uGrimDark.value = b.grim?.dark ?? 0.8;
    this.hemi.color.set(b.light.hemiSky);
    this.hemi.groundColor.set(b.light.hemiGround);
    this.hemi.intensity = this.baseHemi = b.light.hemiIntensity;
    this.sun.color.set(b.light.sun);
    this.sun.intensity = b.light.sunIntensity;
    this.sunDir = new THREE.Vector3().fromArray(b.sky.sunDir).normalize();
    if (this.sunDir.y < 0.3) this.sunDir.y = 0.3;
    this.sunDir.normalize();
    this.R.renderer.toneMappingExposure = b.light.exposure;
    this.R.setShadowLight(this.sun);
    const gr = this.R.grade;
    if (gr) {
      gr.uniforms.uSat.value = b.grade.sat;
      gr.uniforms.uContrast.value = b.grade.contrast;
      gr.uniforms.uTint.value.set(b.grade.tint);
      gr.uniforms.uVignette.value = b.grade.vignette;
    }
    this.fog.configure(b.fogBank || { amount: 0 });
    this.crows.build(b.crows || 0);
    this.lightning.rate = b.lightning || 0;
  }

  loadLevel(chapter) {
    if (this.level) { this.level.dispose(); this.fx.clear(); }
    this.applyBiome(chapter.biome);
    const q = QUALITY[this.R.qualityName] || QUALITY.medium;
    this.level = new Level(this.scene, chapter, { quality: this.R.qualityName, grass: q.grass, fx: this.fx });
    this.fx.setWeather(BIOMES[chapter.biome].weather, this.camera);
    return this.level;
  }

  update(dt) {
    this.time += dt;
    globalUniforms.uTime.value = this.time;
    this.sky.update(this.camera);
    // shadow frustum follows the focus point, snapped to texels to avoid shimmering
    const size = 96, res = this.sun.shadow.mapSize.x;
    const texel = size / res;
    const f = this.focus;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.target.position.set(fx, f.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 120, f.y + this.sunDir.y * 120, fz + this.sunDir.z * 120);
    this.fx.update(dt, this.camera);
    this.fog.update(dt, this.camera);
    this.crows.update(dt);
    this.lightning.update(dt);
    this.hemi.intensity = this.baseHemi + this.lightning.flash * 1.6;
    if (this.level) this.level.update(dt, this.time, this.camera);
  }
}
