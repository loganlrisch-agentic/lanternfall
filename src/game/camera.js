// Third-person orbit camera with shoulder offset, terrain collision, aim ray, shake and cinematic moves.
import * as THREE from 'three';
import { clamp, damp, lerp, easeInOutCubic } from '../core/util.js';

const _f = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3();

export class CameraRig {
  constructor(camera, B) {
    this.cam = camera;
    this.B = B;
    this.yaw = Math.PI / 2;
    this.pitch = 0.3;
    this.dist = 9.5;
    this.targetDist = 9.5;
    this.focus = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this.shakeAmt = 0;
    this.mode = 'follow';
    this.cine = null;
    this.sens = 0.0024;
    this.invertY = false;
  }

  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  cinematic(fromPos, fromLook, toPos, toLook, dur, ease = true) {
    this.mode = 'cine';
    this.cine = { fromPos: fromPos.clone(), fromLook: fromLook.clone(), toPos: toPos.clone(), toLook: toLook.clone(), t: 0, dur, ease };
  }
  hold(pos, look) { this.cinematic(pos, look, pos, look, 1e9); }
  follow() { this.mode = 'follow'; this.cine = null; }

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
    if (inp) {
      this.yaw -= inp.look.x * this.sens;
      this.pitch = clamp(this.pitch + inp.look.y * this.sens * (this.invertY ? -1 : 1), -0.15, 1.15);
      this.targetDist = clamp(this.targetDist + inp.zoom * 0.012, 4.5, 20);
    }
    this.dist = damp(this.dist, this.targetDist, 10, dt);
    const h = hero;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    const shoulder = clamp(this.dist * 0.09, 0.5, 1.2);
    const want = _p.set(h.pos.x + rx * shoulder, h.pos.y + 2.1, h.pos.z + rz * shoulder);
    this.focus.x = damp(this.focus.x, want.x, 18, dt);
    this.focus.y = damp(this.focus.y, want.y, 10, dt);
    this.focus.z = damp(this.focus.z, want.z, 18, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    let x = this.focus.x - fx * cp * this.dist, y = this.focus.y + sp * this.dist, z = this.focus.z - fz * cp * this.dist;
    const ground = this.B.h(x, z) + 0.9;
    if (y < ground) y = ground;
    cam.position.set(x, y, z);
    _l.set(this.focus.x + fx * 4, this.focus.y - 0.4 + sp * 0.5, this.focus.z + fz * 4);
    cam.lookAt(_l);
    this.B.world.focus.set(h.pos.x + fx * 14, h.pos.y, h.pos.z + fz * 14);
    this.applyShake(dt);
    this.computeAim();
  }

  applyShake(dt) {
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * this.shakeAmt * 0.6;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.cam.position.z += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
  }

  computeAim() {
    // march the view ray against the heightfield
    const cam = this.cam;
    cam.getWorldDirection(_f);
    const o = cam.position;
    let t = 2, hit = false;
    for (let i = 0; i < 120; i++) {
      const px = o.x + _f.x * t, py = o.y + _f.y * t, pz = o.z + _f.z * t;
      if (py <= this.B.h(px, pz)) { hit = true; break; }
      t += 0.6 + t * 0.02;
      if (t > 90) break;
    }
    if (!hit) t = Math.min(t, 60);
    this.aimPoint.set(o.x + _f.x * t, 0, o.z + _f.z * t);
    this.aimPoint.y = this.B.h(this.aimPoint.x, this.aimPoint.z);
  }
}
