// Tactical camera: an angled view that follows the commander, with the castle on
// the left and the fog on the right. No mouse-look. Also turns screen clicks into
// battlefield points, and plays cinematic moves for story beats and endings.
import * as THREE from 'three';
import { clamp, damp, easeInOutCubic } from '../core/util.js';
import { MAP } from './config.js';

const _p = new THREE.Vector3(), _l = new THREE.Vector3(), _d = new THREE.Vector3();
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();

export class CameraRig {
  constructor(camera, B) {
    this.cam = camera;
    this.B = B;
    this.pitch = 0.9;          // radians below horizontal
    this.dist = 27;
    this.targetDist = 27;
    this.minDist = 16;
    this.maxDist = 44;
    this.focus = new THREE.Vector3();
    this.shakeAmt = 0;
    this.mode = 'follow';
    this.cine = null;
    this.yaw = Math.PI / 2;    // kept for code that reads it; the view always faces the fog
  }

  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  cinematic(fromPos, fromLook, toPos, toLook, dur, ease = true) {
    this.mode = 'cine';
    this.cine = { fromPos: fromPos.clone(), fromLook: fromLook.clone(), toPos: toPos.clone(), toLook: toLook.clone(), t: 0, dur, ease };
  }
  hold(pos, look) { this.cinematic(pos, look, pos, look, 1e9); }
  follow() { this.mode = 'follow'; this.cine = null; }
  snapTo(p) { this.focus.set(p.x + 3, p.y, p.z); }

  update(dt, inp, hero) {
    const cam = this.cam;
    if (this.mode === 'cine' && this.cine) {
      const c = this.cine;
      c.t += dt;
      const k = c.ease ? easeInOutCubic(Math.min(1, c.t / c.dur)) : Math.min(1, c.t / c.dur);
      _p.lerpVectors(c.fromPos, c.toPos, k);
      _l.lerpVectors(c.fromLook, c.toLook, k);
      cam.position.copy(_p);
      cam.lookAt(_l);
      this.B.world.focus.copy(_l);
      this.applyShake(dt);
      return;
    }
    if (inp && inp.zoom) this.targetDist = clamp(this.targetDist + inp.zoom * 0.02, this.minDist, this.maxDist);
    this.dist = damp(this.dist, this.targetDist, 8, dt);
    // follow the commander, leaning a little toward the fog side so threats are visible
    const fx = clamp(hero.pos.x + 3, MAP.xMin + 14, MAP.xMax - 10);
    const fz = clamp(hero.pos.z, -20, 14);
    this.focus.x = damp(this.focus.x, fx, 5, dt);
    this.focus.y = damp(this.focus.y, hero.pos.y, 4, dt);
    this.focus.z = damp(this.focus.z, fz, 5, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    cam.position.set(this.focus.x, this.focus.y + sp * this.dist, this.focus.z + cp * this.dist);
    _l.copy(this.focus);
    cam.lookAt(_l);
    this.B.world.focus.set(this.focus.x, this.focus.y, this.focus.z - 2);
    this.applyShake(dt);
  }

  applyShake(dt) {
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * this.shakeAmt * 0.7;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.cam.position.z += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
  }

  // screen point (normalised device coords) -> point on the terrain
  groundAt(nx, ny, out = new THREE.Vector3()) {
    const cam = this.cam;
    cam.updateMatrixWorld();
    _ndc.set(nx, ny);
    _ray.setFromCamera(_ndc, cam);
    const o = _ray.ray.origin, d = _ray.ray.direction;
    let t = 1, prev = 1;
    for (let i = 0; i < 200; i++) {
      const py = o.y + d.y * t;
      if (py <= this.B.h(o.x + d.x * t, o.z + d.z * t)) {
        // refine between prev and t
        let a = prev, b = t;
        for (let k = 0; k < 8; k++) { const m = (a + b) / 2; if (o.y + d.y * m <= this.B.h(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        t = b; break;
      }
      prev = t;
      t += 0.5 + t * 0.015;
      if (t > 160) break;
    }
    out.set(o.x + d.x * t, 0, o.z + d.z * t);
    out.y = this.B.h(out.x, out.z);
    return out;
  }

  // project a world point to screen pixels
  toScreen(p, w, h) {
    _d.copy(p).project(this.cam);
    return { x: (_d.x * 0.5 + 0.5) * w, y: (-_d.y * 0.5 + 0.5) * h, behind: _d.z > 1 };
  }
}
