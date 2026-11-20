// The commander's army as one formation. Called-in units take a slot in ranks:
// shields and heavies in front, swords and spears behind them, archers and casters
// further back, healers and drummers in the middle of the rear, siege engines last.
// The formation marches as a block to its objective (the next shrine to rekindle,
// the front line, or the open rift), wheels to face the enemy, holds when it makes
// contact, and falls back to stay between the horde and the castle.
import * as THREE from 'three';
import { MAP, TEAM, roadZ } from './config.js';
import { clamp, angleLerp, damp } from '../core/util.js';

const ROLE_ORDER = ['front', 'melee', 'pike', 'ranged', 'support', 'siege'];
const GROUP = { front: 0, melee: 0, pike: 0, ranged: 1, support: 2, siege: 3 };

export class Army {
  constructor(B) {
    this.B = B;
    this.units = [];
    this.anchor = new THREE.Vector3(MAP.castleX + 14, 0, 0);
    this.facing = Math.PI / 2;          // toward the fog (+x)
    this.speed = 0;                     // current marching speed of the anchor
    this.dirty = true;
    this.depth = 0;
    this.engaged = false;
    this.focus = null;
    this.targetCount = new Map();
    this.objective = null;
    this.marker = null;
  }

  add(u) {
    if (!this.units.length) {
      // first unit: plant the standard just outside the gate
      this.anchor.set(MAP.castleX + 14, 0, 0);
      this.facing = Math.PI / 2;
    }
    this.units.push(u);
    u.army = this;
    this.dirty = true;
  }

  role(u) {
    const d = u.def;
    if (u.anims?.siege) return 'siege';
    if (d.anim === 'support' || d.special?.heal || d.special?.regrowth) return 'support';
    if (u.isRanged) return 'ranged';
    if (u.isLarge || d.anim === 'shield' || d.anim === 'largeShield' || d.anim === 'skelShield' || (d.armor || 0) >= 6) return 'front';
    if (d.anim === 'spear') return 'pike';
    return 'melee';
  }

  layout() {
    this.dirty = false;
    const live = this.units;
    const n = live.length;
    if (!n) { this.depth = 0; return; }
    const width = clamp(Math.round(Math.sqrt(n * 1.9)), 3, 8);
    // bucket by role, keep roles in order, then cut into ranks per group
    const byRole = {};
    for (const u of live) (byRole[this.role(u)] ||= []).push(u);
    const groups = [[], [], [], []];
    for (const r of ROLE_ORDER) if (byRole[r]) groups[GROUP[r]].push(...byRole[r]);
    let x = 0, rankIdx = 0;
    for (const g of groups) {
      for (let i = 0; i < g.length; i += width) {
        const rank = g.slice(i, i + width);
        const big = rank.some(u => u.isLarge);
        const lat = big ? 2.9 : 1.75;
        const dep = big ? 3.0 : 2.0;
        // put units in the slots nearest their current lateral position, so nobody crosses the block
        const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
        const lat0 = u => -fz * (u.pos.x - this.anchor.x) + fx * (u.pos.z - this.anchor.z);
        rank.sort((a, b) => lat0(a) - lat0(b));
        const stagger = (g === groups[1] && rankIdx % 2) ? lat * 0.5 : 0;
        rank.forEach((u, j) => { u.slotOff = { x: -x - (big ? 0.5 : 0), z: (j - (rank.length - 1) / 2) * lat + stagger }; u.role = this.role(u); });
        x += dep;
        rankIdx++;
      }
      if (g.length) x += 0.6;   // a little air between the melee block, the archers and the rear
    }
    this.depth = x;
  }

  slotPos(u, out) {
    const o = u.slotOff || { x: 0, z: 0 };
    // forward axis f = (fx, fz); lateral axis l = (-fz, fx), which is +z when facing +x
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    out.set(this.anchor.x + fx * o.x - fz * o.z, 0, this.anchor.z + fz * o.x + fx * o.z);
    out.y = this.B.h(out.x, out.z);
    return out;
  }

  nextShrine() {
    let best = null;
    for (const s of this.B.level.shrines) {
      if (s.owner === 0) continue;
      if (!best || s.pos.x < best.pos.x) best = s;
    }
    return best;
  }

  update(dt) {
    const B = this.B;
    const before = this.units.length;
    this.units = this.units.filter(u => u.alive && !u.remove);
    if (this.units.length !== before) this.dirty = true;
    if (this.dirty) this.layout();
    this.targetCount.clear();
    for (const u of this.units) if (u.target) this.targetCount.set(u.target, (this.targetCount.get(u.target) || 0) + 1);
    if (!this.units.length) { this.speed = 0; return; }

    // read the battlefield
    let lead = null, cx = 0, cz = 0, nNear = 0, nearest = null, nd = Infinity;
    for (const u of B.units) {
      if (u.team !== TEAM.ENEMY || !u.alive || u.isStructure) continue;
      if (!lead || u.pos.x < lead.pos.x) lead = u;
      const d = Math.hypot(u.pos.x - this.anchor.x, u.pos.z - this.anchor.z);
      if (d < 30) { cx += u.pos.x; cz += u.pos.z; nNear++; }
      if (d < nd) { nd = d; nearest = u; }
    }
    this.focus = nd < 24 ? nearest : null;
    let fighting = 0, strays = 0, err = 0;
    const tmp = new THREE.Vector3();
    for (const u of this.units) {
      if (u.target && !u.target.isStructure && u.distTo(u.target) < (u.range || 2) + 3) fighting++;
      else { const s = this.slotPos(u, tmp); const e = Math.hypot(u.pos.x - s.x, u.pos.z - s.z); err += e; strays++; }
    }
    err = strays ? err / strays : 0;
    this.engaged = fighting >= Math.max(1, this.units.length * 0.3);

    // where should the standard be?
    const minX = MAP.castleX + 6 + this.depth;
    const rift = B.rift;
    let objX, objZ, label;
    const shrine = this.nextShrine();
    if (rift && !rift.invulnerable) { objX = B.level.riftPos.x - 10; objZ = B.level.riftPos.z; label = 'rift'; }
    else if (shrine && shrine.pos.x < B.level.riftPos.x - 24) { objX = shrine.pos.x + this.depth * 0.5; objZ = shrine.pos.z; label = 'shrine'; }
    else { objX = Math.max(B.frontLine, minX); objZ = roadZ(objX); label = 'front'; }
    let wantX = objX, wantZ = objZ;
    // meet the horde before it reaches the walls, and never leave it behind us
    if (lead && lead.pos.x - 9 < wantX) {
      wantX = lead.pos.x - 9;
      wantZ = nNear ? cz / nNear : lead.pos.z;
      label = 'meet';
    }
    wantX = clamp(wantX, minX, MAP.xMax - 20);
    wantZ = clamp(wantZ, -MAP.playZ + 8, MAP.playZ - 8);
    this.objective = label;

    const slowest = this.units.reduce((m, u) => Math.min(m, u.speed || 4), 6);
    const behind = lead && lead.pos.x < this.anchor.x - 6;   // enemies slipped past toward the castle
    let pace = slowest * 0.78;
    if (this.engaged && !behind) pace = 0;                     // hold the line while fighting
    if (err > 3.2 && !behind) pace *= 0.25;                    // let stragglers catch up
    const dx = wantX - this.anchor.x, dz = wantZ - this.anchor.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, pace * dt);
    if (d > 0.3 && step > 0) { this.anchor.x += dx / d * step; this.anchor.z += dz / d * step; this.speed = damp(this.speed, pace, 4, dt); }
    else this.speed = damp(this.speed, 0, 6, dt);
    this.anchor.y = B.h(this.anchor.x, this.anchor.z);

    // wheel to face the threat; face the fog when the field is quiet
    let wantYaw = Math.PI / 2;
    if (nNear) {
      const tx = cx / nNear - this.anchor.x, tz = cz / nNear - this.anchor.z;
      if (Math.hypot(tx, tz) > 3) wantYaw = Math.atan2(tx, tz);
      if (!behind) wantYaw = clamp(wantYaw, Math.PI / 2 - 0.7, Math.PI / 2 + 0.7);
    } else if (d > 2) wantYaw = clamp(Math.atan2(dx, dz), Math.PI / 2 - 0.6, Math.PI / 2 + 0.6);
    this.facing = angleLerp(this.facing, wantYaw, Math.min(1, dt * 0.9));
  }
}
