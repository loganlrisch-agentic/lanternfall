// Arrows, bolts, orbs, boulders and cannonballs.
import * as THREE from 'three';
import { cloneScene } from '../core/assets.js';

export const PTYPES = {
  arrow: { mesh: 'arrow_bow', scale: 1.1, speed: 36, arc: 0.1, sfx: 'bow', impact: 'arrow' },
  bolt: { mesh: 'arrow_crossbow', scale: 1.2, speed: 46, arc: 0.03, sfx: 'crossbow', impact: 'arrow' },
  darkbolt: { mesh: 'Skeleton_Arrow', scale: 1.1, speed: 34, arc: 0.06, trail: 0x9a5aff, sfx: 'crossbow', impact: 'arrow' },
  turretBolt: { mesh: 'arrow_crossbow', scale: 1.6, speed: 52, arc: 0.02, sfx: 'crossbow', impact: 'arrow' },
  towerArrow: { mesh: 'arrow_bow', scale: 1.4, speed: 40, arc: 0.12, sfx: 'bow', impact: 'arrow' },
  fireArrow: { mesh: 'arrow_bow', scale: 1.4, speed: 40, arc: 0.12, trail: 0xff7a2a, sfx: 'bow', impact: 'fire', burn: 8 },
  ember: { orb: [4, 1.6, 0.4], size: 0.3, speed: 26, trail: 0xff7a2a, homing: true, sfx: 'cast', impact: 'fire' },
  fireball: { orb: [5, 2, 0.4], size: 0.65, speed: 22, trail: 0xff5a1a, homing: true, sfx: 'fire', impact: 'boom', burn: 10 },
  holy: { orb: [3.5, 3, 1.8], size: 0.26, speed: 24, trail: 0xffd88a, homing: true, sfx: 'cast', impact: 'holy' },
  hex: { orb: [1.8, 0.6, 4], size: 0.32, speed: 19, trail: 0x8a3aff, homing: true, sfx: 'hex', impact: 'hex' },
  thorn: { orb: [1, 3, 1.2], size: 0.24, speed: 26, trail: 0x5acc6a, homing: true, sfx: 'cast', impact: 'thorn' },
  arcane: { orb: [1.2, 2.2, 4], size: 0.26, speed: 26, trail: 0x6aa0ff, homing: true, sfx: 'cast', impact: 'arcane' },
  blood: { orb: [4, 0.3, 0.5], size: 0.38, speed: 21, trail: 0xc01a2a, homing: true, sfx: 'hex', impact: 'blood' },
  shot: { orb: [4, 3.4, 2], size: 0.1, speed: 95, trail: 0xffd0a0, sfx: 'gun', impact: 'arrow' },
  boulder: { mesh: 'projectile_catapult', scale: 3.4, speed: 24, arc: 0.42, sfx: 'catapult', impact: 'boom' },
  cannonball: { mesh: 'projectile_cannonball', scale: 3.2, speed: 42, arc: 0.04, sfx: 'cannon', impact: 'boom', trail: 0x5a5a5a },
  bomb: { mesh: 'smokebomb', scale: 1.4, speed: 18, arc: 0.35, trail: 0xff8a3a, sfx: 'throw', impact: 'fire', burn: 8 },
};

const orbGeo = new THREE.IcosahedronGeometry(1, 1);
const _v = new THREE.Vector3(), _q = new THREE.Vector3();

export class Projectiles {
  constructor(B) {
    this.B = B;
    this.list = [];
    this.pools = {};
  }

  getMesh(type) {
    const pool = this.pools[type] || (this.pools[type] = []);
    if (pool.length) { const m = pool.pop(); m.visible = true; return m; }
    const def = PTYPES[type];
    let m;
    if (def.mesh) {
      const inner = cloneScene(def.mesh);
      inner.scale.setScalar(def.scale || 1);
      // KayKit arrows point along +Y; align them with +Z for lookAt
      if (type !== 'boulder' && type !== 'cannonball' && type !== 'bomb') inner.rotation.x = Math.PI / 2;
      inner.traverse(o => { if (o.isMesh) o.castShadow = false; });
      m = new THREE.Group(); m.add(inner);
    } else {
      m = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...def.orb), toneMapped: true }));
      m.scale.setScalar(def.size);
    }
    this.B.scene.add(m);
    return m;
  }
  release(type, m) { m.visible = false; (this.pools[type] || (this.pools[type] = [])).push(m); }

  fire(src, target, type, dmg, o = {}) {
    const def = PTYPES[type] || PTYPES.arrow;
    const start = o.from ? o.from.clone() : src.pos.clone().add(new THREE.Vector3(Math.sin(src.facing) * 0.6, src.isLarge ? 3 : (src.anims?.siege ? 1.8 : 1.5), Math.cos(src.facing) * 0.6));
    if (src.muzzle) start.copy(src.muzzle);
    let end;
    if (target && target.alive) end = this.aimAt(target); else end = (o.point ? o.point.clone() : start.clone().add(new THREE.Vector3(Math.sin(src.facing) * 20, -1, Math.cos(src.facing) * 20)));
    if (o.point && !target) end.y += 0.4;
    const dist = start.distanceTo(end);
    const speed = def.speed * (o.speedMul || 1);
    const p = {
      type, def, src, team: src.team, target: target && target.alive ? target : null, start, end, pos: start.clone(), prev: start.clone(),
      dist, dur: Math.max(0.08, dist / speed), t: 0, dmg, aoe: o.aoe || 0, pierce: o.pierce || 0, pierceArmor: o.pierceArmor || 0,
      line: !!(o.line || (o.pierce && o.pierce > 0)), hit: new Set(), mesh: this.getMesh(type), glow: o.glow, burn: def.burn || 0,
    };
    if (p.line) {
      p.dir = new THREE.Vector3().subVectors(end, start).normalize();
      p.speed = speed;
      p.range = Math.max(dist + 6, o.range || 42);
    }
    p.mesh.position.copy(start);
    this.list.push(p);
    if (def.sfx) this.B.sfx(def.sfx, start, src.isHero ? 0.7 : 0.35);
    return p;
  }

  aimAt(t) {
    if (t.isStructure) return t.aimPoint(t.pos).clone().setY(t.pos.y + 2.5);
    return t.pos.clone().setY(t.pos.y + (t.isLarge ? 2.4 : 1.2));
  }

  update(dt) {
    const B = this.B;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.prev.copy(p.pos);
      let done = false;
      if (p.line) {
        p.pos.addScaledVector(p.dir, p.speed * dt);
        p.t += p.speed * dt;
        for (const u of B.query(p.pos.x, p.pos.z, 1.8)) {
          if (u.team === p.team || !u.alive || p.hit.has(u)) continue;
          if (Math.abs(u.pos.y + 1.2 - p.pos.y) > 3.2) continue;
          p.hit.add(u);
          u.takeDamage(p.dmg, p.src, { pierceArmor: p.pierceArmor, color: p.glow ? '#ffe6b0' : undefined });
          B.impact(p, u.pos.clone().setY(u.pos.y + 1));
          if (p.hit.size > p.pierce) { done = true; break; }
        }
        if (B.rift && p.team === 0 && !B.rift.invulnerable && !p.hit.has(B.rift) && B.rift.distTo(p.pos) < 1) { p.hit.add(B.rift); B.rift.takeDamage(p.dmg, p.src); done = true; }
        if (p.t > p.range || p.pos.y < B.h(p.pos.x, p.pos.z) - 0.5) done = true;
        p.mesh.position.copy(p.pos);
        _v.copy(p.pos).add(p.dir);
        p.mesh.lookAt(_v);
      } else {
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        if (p.target && p.target.alive && (p.def.homing || k < 0.85)) p.end.copy(this.aimAt(p.target));
        p.pos.lerpVectors(p.start, p.end, k);
        p.pos.y += Math.sin(k * Math.PI) * (p.def.arc || 0) * p.dist;
        p.mesh.position.copy(p.pos);
        if (p.def.mesh) {
          _v.copy(p.pos).sub(p.prev);
          if (_v.lengthSq() > 1e-6) { _q.copy(p.pos).add(_v); p.mesh.lookAt(_q); }
          if (p.type === 'boulder' || p.type === 'bomb') p.mesh.rotation.x += dt * 8;
        }
        if (k >= 1) { done = true; this.land(p); }
      }
      if (p.def.trail || p.glow) {
        const c = new THREE.Color(p.def.trail || 0xffe6b0);
        const n = p.def.orb ? 2 : 1;
        for (let j = 0; j < n; j++) B.fx.add.spawn(p.pos.x, p.pos.y, p.pos.z, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, c.r, c.g, c.b, (p.def.size || 0.2) * 1.6 + 0.15, 0.35, 0, 1, -0.4, 0.9);
      }
      if (done) { this.release(p.type, p.mesh); this.list.splice(i, 1); }
    }
  }

  land(p) {
    const B = this.B;
    const at = p.pos.clone();
    if (p.aoe > 0) {
      B.cleave(p.src, at, p.aoe, p.dmg, { team: p.team, burn: p.burn, falloff: true, vsStructure: p.src.def?.vsStructure });
      B.impact(p, at, true);
      return;
    }
    const t = p.target;
    if (t && t.alive) {
      const mult = t.isStructure && p.src.def?.vsStructure ? p.src.def.vsStructure : 1;
      t.takeDamage(p.dmg * mult, p.src, { pierceArmor: p.pierceArmor, ranged: true });
      if (p.burn && t.addStatus) { t.addStatus('burn', 3, p.burn); if (t.status.burn) t.status.burn.src = p.src; }
      if (p.type === 'blood' && p.src.alive) p.src.heal(p.dmg * 0.4, true);
    } else {
      // free shot: hit whoever is standing at the landing point
      let best = null, bd = 1.6 * 1.6;
      for (const u of B.query(at.x, at.z, 2)) {
        if (u.team === p.team || !u.alive) continue;
        const d = (u.pos.x - at.x) ** 2 + (u.pos.z - at.z) ** 2;
        if (d < bd) { bd = d; best = u; }
      }
      if (best) best.takeDamage(p.dmg, p.src, { ranged: true });
    }
    B.impact(p, at, false);
  }

  clear() { for (const p of this.list) this.release(p.type, p.mesh); this.list.length = 0; }
}
