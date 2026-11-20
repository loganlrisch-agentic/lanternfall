// Global shader patch applied to every built-in material: grim albedo grading, height/wall fog, and rim light.
import * as THREE from 'three';
import { globalUniforms } from './uniforms.js';

export const darkUniforms = {
  uGrimSat: { value: 0.5 },
  uGrimDark: { value: 0.8 },
  uFogBase: { value: 0.0 },
  uFogFalloff: { value: 0.14 },
  uFogWall: { value: new THREE.Vector3(5, 95, 1.4) }, // x start, x end, extra density toward the enemy
  uFogTime: globalUniforms.uTime,
  uFlash: { value: 0 },                               // lightning
};

export function globalPatch(shader) {
  const fs = shader.fragmentShader;
  if (fs.includes('#include <fog_fragment>') && shader.vertexShader.includes('#include <fog_vertex>')) {
    Object.assign(shader.uniforms, { uFogBase: darkUniforms.uFogBase, uFogFalloff: darkUniforms.uFogFalloff, uFogWall: darkUniforms.uFogWall, uFogTime: darkUniforms.uFogTime });
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\n#ifdef USE_FOG\nvarying vec3 vFogWorld;\n#endif')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
      #ifdef USE_FOG
        vec4 fogWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogWP = instanceMatrix * fogWP;
        #endif
        vFogWorld = (modelMatrix * fogWP).xyz;
      #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>
      #ifdef USE_FOG
        varying vec3 vFogWorld; uniform float uFogBase, uFogFalloff, uFogTime; uniform vec3 uFogWall;
      #endif`)
      .replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        float fogH = exp(-max(vFogWorld.y - uFogBase, 0.0) * uFogFalloff);
        float fogWallK = 1.0 + smoothstep(uFogWall.x, uFogWall.y, vFogWorld.x) * uFogWall.z;
        float fogN = 1.0 + 0.28 * sin(vFogWorld.x * 0.061 + uFogTime * 0.17) * sin(vFogWorld.z * 0.083 - uFogTime * 0.12);
        #ifdef FOG_EXP2
          float fogDens = fogDensity * (0.4 + 1.5 * fogH) * fogWallK * fogN;
          float fogFactor = 1.0 - exp(-fogDens * fogDens * vFogDepth * vFogDepth);
        #else
          float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(fogFactor, 0.0, 1.0));
      #endif`);
  }
  const lit = fs.includes('#include <lights_fragment_begin>');
  if (lit) {
    if (!this.__rimU) this.__rimU = { value: new THREE.Color(0, 0, 0) };
    shader.uniforms.uRim = this.__rimU;
    shader.uniforms.uGrimSat = darkUniforms.uGrimSat;
    shader.uniforms.uGrimDark = darkUniforms.uGrimDark;
    shader.uniforms.uGrimOn = { value: this.userData && this.userData.noGrim ? 0 : 1 };
    shader.uniforms.uFlash = darkUniforms.uFlash;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uGrimSat, uGrimDark, uGrimOn, uFlash;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float grimL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(grimL), diffuseColor.rgb, uGrimSat) * uGrimDark, uGrimOn);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition + vec3(0.0, 0.0, 1e-5))), 0.0, 1.0), 2.4);
        totalEmissiveRadiance += uRim * rimF;
        totalEmissiveRadiance += diffuseColor.rgb * uFlash * 0.6 * max(normal.y, 0.2);`);
  }
}

let installed = false;
export function installGlobalPatch() {
  if (installed) return;
  installed = true;
  THREE.Material.prototype.onBeforeCompile = globalPatch;
  // every patched material shares the same program key unless it adds its own patch
  THREE.Material.prototype.customProgramCacheKey = function () { return 'lf-global'; };
}

export function setRim(material, color, intensity = 1) {
  if (!material.__rimU) material.__rimU = { value: new THREE.Color(0, 0, 0) };
  material.__rimU.value.set(color).multiplyScalar(intensity);
}
