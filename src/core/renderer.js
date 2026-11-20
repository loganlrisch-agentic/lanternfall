// Renderer + post-processing stack with quality presets and dynamic resolution.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { N8AOPass } from 'n8ao';

export const QUALITY = {
  low: { pr: 1.0, shadow: 1024, soft: false, bloom: false, ao: false, msaa: 0, grass: 0.35, label: 'Low' },
  medium: { pr: 1.25, shadow: 2048, soft: true, bloom: true, ao: false, msaa: 4, grass: 0.7, label: 'Medium' },
  high: { pr: 1.5, shadow: 2048, soft: true, bloom: true, ao: true, msaa: 4, grass: 1.0, label: 'High' },
  ultra: { pr: 2.0, shadow: 4096, soft: true, bloom: true, ao: true, msaa: 4, grass: 1.3, label: 'Ultra' },
};

// Replaces NaN/Inf/negative pixels before bloom. One bad pixel would otherwise get
// blurred across the whole screen by UnrealBloomPass and show up as black flashes.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 rgb = clamp(c.rgb, 0.0, 64.0);   // also caps +Inf from overflowing half floats
      if (isnan(c.r) || isnan(c.g) || isnan(c.b)) rgb = vec3(0.0);
      gl_FragColor = vec4(rgb, isnan(c.a) ? 1.0 : clamp(c.a, 0.0, 1.0));
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uHurt: { value: 0 },
    uSat: { value: 1.08 },
    uContrast: { value: 1.04 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uFade: { value: 0 },
    uDesat: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette, uHurt, uSat, uContrast, uFade, uDesat, uTime; uniform vec3 uTint;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299,0.587,0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat * (1.0 - uDesat));
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      c.rgb *= uTint;
      vec2 d = vUv - 0.5;
      float r = dot(d, d);
      float vig = smoothstep(0.75, 0.15, r * (1.0 + uVignette));
      c.rgb *= mix(1.0, vig, uVignette * 1.6);
      float hurt = uHurt * smoothstep(0.08, 0.5, r) * (0.8 + 0.2 * sin(uTime * 9.0));
      c.rgb = mix(c.rgb, vec3(0.55, 0.02, 0.02), clamp(hurt, 0.0, 0.75));
      c.rgb = mix(c.rgb, vec3(0.0), uFade);
      gl_FragColor = c;
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    const r = this.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.dynScale = 1;
    this.frameTimes = [];
    // phones and tablets: cap the render resolution and use FXAA instead of MSAA
    this.mobile = matchMedia('(pointer: coarse)').matches;
    this.qualityName = 'medium';
    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.grade = null;
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(name) {
    this.qualityName = QUALITY[name] ? name : 'medium';
    this.q = QUALITY[this.qualityName];
    this.renderer.shadowMap.type = this.q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.dynScale = 1;
    if (this.scene && this.camera) this.build(this.scene, this.camera);
  }

  build(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    const q = this.q || QUALITY.medium;
    const size = this.size();
    const msaa = this.mobile && this.qualityName !== 'ultra' ? 0 : q.msaa;
    const rt = new THREE.WebGLRenderTarget(size.w, size.h, { type: THREE.HalfFloatType, samples: msaa });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(this.pixelRatio());
    composer.setSize(size.w, size.h);
    if (q.ao) {
      const ao = new N8AOPass(scene, camera, size.w, size.h);
      ao.configuration.aoRadius = 2.2;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = this.qualityName !== 'ultra';
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode(this.qualityName === 'ultra' ? 'High' : 'Medium');
      composer.addPass(ao);
      this.ao = ao;
    } else {
      composer.addPass(new RenderPass(scene, camera));
      this.ao = null;
    }
    composer.addPass(new ShaderPass(SanitizeShader));
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.w / 2, size.h / 2), 0.55, 0.55, 0.92);
      composer.addPass(this.bloom);
    } else this.bloom = null;
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    if (!msaa) composer.addPass(new FXAAPass());
    this.composer = composer;
    this.resize();
  }

  pixelRatio() {
    const q = this.q || QUALITY.medium;
    const cap = this.mobile ? Math.min(q.pr, this.qualityName === 'ultra' ? 1.5 : 1.0) : q.pr;
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap) * this.dynScale);
  }
  size() { return { w: Math.max(1, this.canvas.clientWidth || window.innerWidth), h: Math.max(1, this.canvas.clientHeight || window.innerHeight) }; }

  resize() {
    const { w, h } = this.size();
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    if (this.ao) this.ao.setSize(w * pr, h * pr);
    if (this.camera) {
      const c = this.camera;
      if (c.userData.baseFov == null) c.userData.baseFov = c.fov;
      c.aspect = w / h;
      // tall screens get a wider lens so story shots and the battlefield don't feel like a keyhole
      c.fov = c.aspect < 0.9 ? Math.min(72, c.userData.baseFov * 1.3) : c.userData.baseFov;
      c.updateProjectionMatrix();
    }
  }

  setShadowLight(light) {
    const q = this.q || QUALITY.medium;
    const sz = this.mobile ? Math.min(q.shadow, 2048) : q.shadow;
    light.shadow.mapSize.set(sz, sz);
    if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
  }

  render(dt) {
    if (!this.composer) return;
    if (this.pendingResize) { this.pendingResize = false; this.resize(); }
    if (this.grade) this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
    // dynamic resolution: keep the frame rate playable on weaker machines
    this.frameTimes.push(dt);
    if (this.frameTimes.length >= 90) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      let next = this.dynScale;
      if (avg > 1 / 38 && this.dynScale > 0.6) next = Math.max(0.6, this.dynScale - 0.1);
      else if (avg < 1 / 57 && this.dynScale < 1) next = Math.min(1, this.dynScale + 0.05);
      if (next !== this.dynScale) { this.dynScale = next; this.pendingResize = true; }
    }
  }
}
