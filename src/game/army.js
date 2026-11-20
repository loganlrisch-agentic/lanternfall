// The commander's army as one formation. Called-in units take a slot in ranks:
// shields and heavies in front, swords and spears behind them, archers and casters
// further back, healers and drummers in the middle of the rear, siege engines last.
// The formation holds the field before the gate, steps out to meet attackers, wheels
// to face them, holds when it makes contact, falls back to stay between the horde and
// the castle, and rekindles nearby shrines when the field is quiet.
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
    // role order decides which ranks exist; heavies (large units) get their own key so they keep the wide slots
    const key = u => this.role(u) + (u.isLarge ? ':L' : '');
    const byRole = {};
    for (const u of live) (byRole[this.role(u)] ||= []).push(u);
    for (const r in byRole) byRole[r].sort((a, b) => (b.isLarge ? 1 : 0) - (a.isLarge ? 1 : 0));
    const groups = [[], [], [], []];
    for (const r of ROLE_ORDER) if (byRole[r]) groups[GROUP[r]].push(...byRole[r]);
    // 1) lay out the slots, remembering which kind of soldier each slot is for
    const slots = [];   // { x, z, key }
    let x = 0, rankIdx = 0;
    for (const g of groups) {
      for (let i = 0; i < g.length; i += width) {
        const rank = g.slice(i, i + width);
        const big = rank.some(u => u.isLarge);
        const lat = big ? 3.2 : 2.1;
        const dep = big ? 3.4 : 2.4;
        const stagger = (g === groups[1] && rankIdx % 2) ? lat * 0.5 : 0;
        rank.forEach((u, j) => slots.push({ x: -x - (big ? 0.6 : 0), z: (j - (rank.length - 1) / 2) * lat + stagger, key: key(u) }));
        x += dep;
        rankIdx++;
      }
      if (g.length) x += 0.8;   // a little air between the melee block, the archers and the rear
    }
    this.depth = x;
    // 2) give every soldier the free slot of his kind nearest to where he stands now,
    //    so a death or a new arrival only nudges the block instead of reshuffling it
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const local = u => { const dx = u.pos.x - this.anchor.x, dz = u.pos.z - this.anchor.z; return { x: dx * fx + dz * fz, z: -dx * fz + dz * fx }; };
    const pairs = [];
    const lu = live.map(local);
    live.forEach((u, i) => slots.forEach((sl, j) => { if (sl.key === key(u)) pairs.push([(lu[i].x - sl.x) ** 2 + (lu[i].z - sl.z) ** 2, i, j]); }));
    pairs.sort((a, b) => a[0] - b[0]);
    const doneU = new Set(), doneS = new Set();
    for (const [, i, j] of pairs) {
      if (doneU.has(i) || doneS.has(j)) continue;
      doneU.add(i); doneS.add(j);
      const u = live[i];
      u.slotOff = { x: slots[j].x, z: slots[j].z };
      u.role = this.role(u);
      // a small personal offset so the ranks look like soldiers, not a grid
      if (!u.jit) u.jit = { x: (Math.random() - 0.5) * 0.7, z: (Math.random() - 0.5) * 0.6 };
    }
  }

  slotPos(u, out) {
    const so = u.slotOff || { x: 0, z: 0 }, j = u.jit || { x: 0, z: 0 };
    const o = { x: so.x + j.x, z: so.z + j.z };
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

    // where should the standard be? This is a defense: the army holds the field before
    // the gate, steps out to meet attackers close to the walls, and only when the field
    // is quiet goes to rekindle a shrine nearby. It never marches on the rift.
    const minX = MAP.castleX + 6 + this.depth;          // rear rank stays clear of the wall
    const homeX = minX + 8, maxX = minX + 30;           // the line, and how far it will step out
    let wantX = homeX, wantZ = roadZ(homeX) * 0.5, label = 'hold';
    const shrine = this.nextShrine();
    const threat = lead && lead.pos.x < maxX + 22;     // something is coming within reach of the walls
    const boss = B.bossUnit && B.bossUnit.alive ? B.bossUnit : null;
    // war machines and gatebreakers can't be left alone: the army goes out after them
    // unless the horde is already at the walls
    let breaker = null;
    if (!boss) for (const u of B.units) if (u.alive && u.team !== TEAM.PLAYER && u.def && (u.def.special?.gatebreaker || u.anims?.siege) && u.pos.x < maxX + 24 && (!breaker || u.pos.x < breaker.pos.x)) breaker = u;
    const wallsPressed = lead && lead.pos.x < minX + 12;
    if (boss && boss.pos.x < maxX + 30) {
      // the night's master is here: the whole army goes to meet it
      wantX = clamp(boss.pos.x - 8, minX, maxX + 10); wantZ = boss.pos.z; label = 'boss';
      this.focus = boss;
    } else if (breaker && !wallsPressed) {
      wantX = clamp(breaker.pos.x - 7, minX, maxX + 14); wantZ = breaker.pos.z; label = 'siege';
      this.focus = breaker;
    } else if (threat) {
      // meet the horde before it reaches the walls, and never leave it behind us
      wantX = clamp(lead.pos.x - 9, minX, maxX);
      wantZ = nNear ? cz / nNear : lead.pos.z;
      label = 'meet';
    } else if (shrine && shrine.pos.x < maxX + 6) {
      wantX = clamp(shrine.pos.x + this.depth * 0.5, minX, maxX + 6); wantZ = shrine.pos.z; label = 'shrine';
    }
    wantX = clamp(wantX, minX, maxX + (label === 'siege' ? 14 : 10));
    wantZ = clamp(wantZ, -MAP.playZ + 8, MAP.playZ - 8);
    this.objective = label;

    const slowest = this.units.reduce((m, u) => Math.min(m, u.speed || 4), 6);
    const behind = lead && lead.pos.x < this.anchor.x - 6;   // enemies slipped past toward the castle
    // the target point drifts smoothly instead of jumping with every enemy step
    this.wantX = this.wantX == null ? wantX : damp(this.wantX, wantX, 1.2, dt);
    this.wantZ = this.wantZ == null ? wantZ : damp(this.wantZ, wantZ, 0.8, dt);
    const dx = this.wantX - this.anchor.x, dz = this.wantZ - this.anchor.z, d = Math.hypot(dx, dz);
    let pace = slowest * 0.75;
    if (this.engaged && !behind) pace = 0;                     // hold the line while fighting
    if (err > 3.4 && !behind) pace *= 0.45;                    // ease off so stragglers catch up
    if (d < 1.5) pace *= d / 1.5;                              // arrive gently
    this.speed = damp(this.speed, pace, 2.2, dt);              // no sudden starts or stops
    const step = Math.min(d, this.speed * dt);
    if (d > 0.05 && step > 0) { this.anchor.x += dx / d * step; this.anchor.z += dz / d * step; }
    this.anchor.y = B.h(this.anchor.x, this.anchor.z);

    // wheel to face the threat; face the fog when the field is quiet
    let wantYaw = Math.PI / 2;
    if (nNear) {
      const tx = cx / nNear - this.anchor.x, tz = cz / nNear - this.anchor.z;
      if (Math.hypot(tx, tz) > 3) wantYaw = Math.atan2(tx, tz);
      if (!behind) wantYaw = clamp(wantYaw, Math.PI / 2 - 0.55, Math.PI / 2 + 0.55);
    } else if (d > 2) wantYaw = clamp(Math.atan2(dx, dz), Math.PI / 2 - 0.45, Math.PI / 2 + 0.45);
    this.facing = angleLerp(this.facing, wantYaw, Math.min(1, dt * 0.5));
  }
}
