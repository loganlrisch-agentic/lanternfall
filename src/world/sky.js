// Procedural sky dome (gradient, sun/moon, stars, drifting clouds) + matching image-based lighting.
import * as THREE from 'three';
import { globalUniforms } from '../core/assets.js';

const vert = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // keep at far plane
}`;

const frag = `
uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor, uCloudColor, uMoonColor;
uniform float uSunSize, uStars, uClouds, uTime, uMoon, uGlow, uAurora, uFlash;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash2(i), hash2(i+vec2(1,0)), f.x), mix(hash2(i+vec2(0,1)), hash2(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<5;i++){ s += a*noise(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, pow(clamp(-h * 3.0, 0.0, 1.0), 0.6));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  // broad glow around sun / moon
  col += uSunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 48.0) * 0.6) * uGlow;
  // disc
  float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, sd);
  vec3 discCol = mix(uSunColor * 12.0, uMoonColor * 4.0, uMoon);
  if (uMoon > 0.5) {
    // crescent shading for the moon
    vec3 off = normalize(uSunDir + vec3(0.012, 0.006, 0.0));
    float sd2 = max(dot(d, off), 0.0);
    disc *= 1.0 - 0.85 * smoothstep(1.0 - uSunSize * 0.9, 1.0 - uSunSize * 0.5, sd2);
  }
  col += discCol * disc * step(0.0, h + 0.02);
  // stars
  if (uStars > 0.0 && h > 0.0) {
    vec3 sp = d * 420.0;
    float s = hash(floor(sp));
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + s * 80.0);
    float star = step(0.9965, s) * tw * smoothstep(0.0, 0.25, h);
    col += vec3(0.9, 0.95, 1.0) * star * uStars * 2.2;
  }
  // aurora-like veil (used for the citadel)
  if (uAurora > 0.0 && h > 0.0) {
    float a = fbm(vec2(d.x * 3.0 + uTime * 0.02, d.z * 3.0)) ;
    col += vec3(0.6, 0.1, 0.25) * smoothstep(0.45, 0.8, a) * smoothstep(0.05, 0.45, h) * uAurora;
  }
  // clouds
  if (uClouds > 0.0 && h > -0.02) {
    vec2 uv = d.xz / (h + 0.18) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
    float c = fbm(uv);
    float cov = smoothstep(1.0 - uClouds, 1.05 - uClouds * 0.35, c);
    float lit = pow(sd, 3.0);
    vec3 cc = mix(uCloudColor, uCloudColor * 1.25 + uSunColor * 0.35, lit);
    col = mix(col, cc, cov * smoothstep(-0.02, 0.18, h) * 0.85);
  }
  col += vec3(0.5, 0.56, 0.75) * uFlash * (0.35 + 0.65 * clamp(h * 2.0, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor() {
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uMoonColor: { value: new THREE.Color(0.85, 0.9, 1.0) },
      uCloudColor: { value: new THREE.Color() }, uSunSize: { value: 0.02 }, uStars: { value: 0 }, uClouds: { value: 0.4 },
      uTime: globalUniforms.uTime, uMoon: { value: 0 }, uGlow: { value: 1 }, uAurora: { value: 0 }, uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.envScene = new THREE.Scene();
    this.envMesh = new THREE.Mesh(this.mesh.geometry, mat);
    this.envScene.add(this.envMesh);
    this.envTarget = null;
  }

  apply(s) {
    const u = this.uniforms;
    u.uTop.value.set(s.top); u.uHorizon.value.set(s.horizon); u.uBottom.value.set(s.bottom);
    u.uSunDir.value.fromArray(s.sunDir).normalize();
    u.uSunColor.value.set(s.sunColor);
    u.uCloudColor.value.set(s.cloudColor || '#ffffff');
    u.uSunSize.value = s.sunSize ?? 0.02;
    u.uStars.value = s.stars ?? 0;
    u.uClouds.value = s.clouds ?? 0.4;
    u.uMoon.value = s.moon ? 1 : 0;
    u.uGlow.value = s.glow ?? 1;
    u.uAurora.value = s.aurora ?? 0;
  }

  makeEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const prevStars = this.uniforms.uStars.value;
    this.uniforms.uStars.value = 0;
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = pmrem.fromScene(this.envScene, 0.02);
    this.uniforms.uStars.value = prevStars;
    pmrem.dispose();
    return this.envTarget.texture;
  }

  update(camera) { this.mesh.position.copy(camera.position); }
}
