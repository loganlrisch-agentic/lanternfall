// Units: animation state machine, AI, combat, status effects. Heroes extend this.
import * as THREE from 'three';
import { getVariant, spawnCharacter, clip, cloneScene } from '../core/assets.js';
import { setRim } from '../core/materials.js';
import { ANIMS } from './data/units.js';
import { MAP, roadZ, TEAM } from './config.js';
import { clamp, angleLerp, rand, pick, dist2 } from '../core/util.js';

const _v = new THREE.Vector3();
let UID = 1;

class Animator {
  constructor(mixer, rig) {
    this.mixer = mixer; this.rig = rig;
    this.actions = new Map();
    this.base = null; this.baseName = '';
    this.shot = null; this.shotT = 0;
  }
  get(name) {
    if (!name) return null;
    let a = this.actions.get(name);
    if (a === undefined) {
      const c = clip(this.rig, name);
      a = c ? this.mixer.clipAction(c) : null;
      this.actions.set(name, a);
    }
    return a;
  }
  dur(name) { const a = this.get(name); return a ? a.getClip().duration : 1; }
  loop(name, ts = 1, fade = 0.2) {
    const a = this.get(name);
    if (!a) return;
    a.timeScale = ts;
    if (this.baseName === name) return;
    this.switches = (this.switches || 0) + 1;   // counted for the smoothness test
    a.reset().setLoop(THREE.LoopRepeat, Infinity);
    a.enabled = true;
    if (this.base && !this.shot) { this.base.fadeOut(fade); a.fadeIn(fade); } else if (!this.shot) a.fadeIn(fade);
    else a.setEffectiveWeight(0);
    a.play();
    if (this.base && this.base !== a && this.shot) this.base.stop();
    this.base = a; this.baseName = name;
  }
  // one-shot over the locomotion layer; returns playback duration
  play(name, { ts = 1, fade = 0.12, hold = false } = {}) {
    const a = this.get(name);
    if (!a) return 0;
    if (this.shot && this.shot !== a) this.shot.fadeOut(fade);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = ts;
    a.enabled = true;
    a.fadeIn(fade).play();
    if (this.base && this.base !== a) this.base.fadeOut(fade);
    this.shot = a;
    this.hold = hold;
    const d = a.getClip().duration / ts;
    this.shotT = d;
    return d;
  }
  cancelShot(fade = 0.15) {
    if (!this.shot) return;
    this.shot.fadeOut(fade);
    this.shot = null;
    if (this.base) { this.base.reset().fadeIn(fade).play(); }
  }
  update(dt) {
    if (this.shot && !this.hold) {
      this.shotT -= dt;
      if (this.shotT <= 0.12) this.cancelShot(0.15);
    }
    this.mixer.update(dt);
  }
}

export class Unit {
  constructor(B, def, team, opts = {}) {
    this.B = B;
    this.id = UID++;
    this.def = def;
    this.team = team;
    this.level = opts.level || 1;
    const lv = 1 + (this.level - 1) * 0.2;
    const mul = opts.mul || { hp: 1, dmg: 1 };
    this.maxHp = Math.round(def.hp * lv * mul.hp);
    this.hp = this.maxHp;
    this.armor = def.armor || 0;
    this.dmg = def.dmg * lv * mul.dmg;
    this.range = def.range || 2;
    this.rate = def.rate || 1.2;
    this.baseSpeed = def.speed || 4;
    this.radius = (def.radius || 0.6) * ((def.scale || 0.85) / 0.85 > 1.2 ? 1.3 : 1);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = team === TEAM.PLAYER ? Math.PI / 2 : -Math.PI / 2;
    this.alive = true;
    this.state = 'spawn';
    this.stateT = 0.6;
    this.target = null;
    this.retarget = Math.random() * 0.3;
    this.atkCd = Math.random() * 0.6;
    this.status = {};       // name -> { t, v }
    this.buffs = { dmg: 0, atk: 0, spd: 0 };
    this.specT = {};
    this.pendingHit = null;
    this.flash = 0;
    this.deathT = 0;
    this.isLarge = !!(def.large || def.boss || (def.anim && def.anim.startsWith('large')));
    this.isBoss = !!def.boss;
    this.isRanged = !!(ANIMS[def.anim] && ANIMS[def.anim].ranged);
    this.order = opts.order || 'charge';
    this.holdPoint = null;
    this.pop = def.pop || 1;
    this.anims = ANIMS[def.anim] || ANIMS.sword;
    this.xp = def.xp || 0;
    this.gold = def.gold || 0;
    this.build(opts);
  }

  build(opts) {
    const d = this.def;
    if (this.anims.siege) {
      this.root = new THREE.Group();
      const m = cloneScene(d.model);
      m.scale.setScalar(d.scale || 4);
      m.rotation.y = Math.PI;
      this.body = m;
      this.root.add(m);
      this.meshes = [];
      m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); this.meshes.push(o); } });
      this.animator = null;
    } else {
      const model = Array.isArray(d.model) ? pick(d.model) : d.model;
      const vopts = { ...(d.opts || {}) };
      if (d.tint) { vopts.tint = d.tint; vopts.tintMix = 0.75; }
      if (d.glow) vopts.glowColor = d.glow;
      const proto = getVariant(model, vopts);
      const inst = spawnCharacter(proto, { weapons: d.weapons || [], scale: d.scale || 0.85, headScale: opts.headScale ?? 0.68 });
      this.hasBow = (d.weapons || []).some(w => w.bow);
      this.root = inst.root;
      this.meshes = inst.meshes;
      this.rig = inst.rig;
      this.animator = new Animator(inst.mixer, inst.rig);
      this.animator.loop(this.anims.idle || 'Idle_A', 1, 0);
      inst.mixer.update(Math.random() * 2);
    }
    const rim = this.team === TEAM.ENEMY ? (this.def.rim || this.B.enemyRim || '#7a3cff') : '#ffb26a';
    this.rimColor = new THREE.Color(rim);
    this.rimBase = this.team === TEAM.ENEMY ? (this.isBoss ? 1.3 : 0.8) : 0.16;
    for (const m of this.meshes) setRim(m.material, this.rimColor, this.rimBase);
    this.B.scene.add(this.root);
  }

  place(x, z, facing) {
    this.pos.set(x, this.B.h(x, z), z);
    if (facing !== undefined) this.facing = facing;
    this.syncTransform();
  }

  syncTransform() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
  }

  get hpPct() { return this.hp / this.maxHp; }
  get speed() {
    let s = this.baseSpeed * (1 + this.buffs.spd);
    if (this.status.slow) s *= 1 - this.status.slow.v;
    if (this.status.chill) s *= 1 - this.status.chill.v;
    return s;
  }
  get disabled() { return !!(this.status.stun || this.status.freeze); }
  get rooted() { return !!(this.status.root || this.status.freeze || this.status.stun); }

  addStatus(name, t, v = 1) {
    if (this.def.special?.immune && ['slow', 'chill', 'root', 'curse', 'stun', 'freeze'].includes(name)) return;
    if (this.isBoss && (name === 'stun' || name === 'freeze' || name === 'root')) t *= 0.35;
    const s = this.status[name];
    if (s) { s.t = Math.max(s.t, t); s.v = Math.max(s.v, v); } else this.status[name] = { t, v };
    if ((name === 'stun' || name === 'freeze') && this.animator && !this.isBoss) {
      this.animator.play(this.anims.hit || 'Hit_A', { ts: 0.7 });
      this.pendingHit = null;
    }
  }

  // ---------------- combat ----------------
  damageMult(target) {
    let m = 1 + this.buffs.dmg;
    const sp = this.def.special || {};
    if (sp.antiLarge && target.isLarge) m *= sp.antiLarge;
    if (sp.vsUndead && target.def && target.def.undead) m *= sp.vsUndead;
    if (sp.rage) m *= 1 + (1 - this.hpPct) * 0.9;
    if (this.B.relicBonus && this.isHero) m *= this.B.relicBonus;
    return m;
  }

  takeDamage(amount, src, o = {}) {
    if (!this.alive) return 0;
    if (this.status.invuln) return 0;
    let a = amount;
    const armor = Math.max(0, (this.armor + (this.buffs.armor || 0)) * (1 - (o.pierceArmor || 0)));
    a *= 20 / (20 + armor);
    if (this.status.curse) a *= 1 + this.status.curse.v;
    if (this.blockFactor && o.dir) a *= this.blockFactor(o.dir);
    a = Math.max(1, a);
    this.hp -= a;
    this.flash = 1;
    if (src && src.alive && src.def?.special?.lifesteal) src.heal(a * src.def.special.lifesteal, true);
    if (src && src.isHero && src.lifesteal) src.heal(a * src.lifesteal, true);
    this.B.onDamage(this, a, src, o);
    if (this.hp <= 0) { this.die(src); return a; }
    if (!o.noReact && this.animator && !this.isLarge && !this.pendingHit && !this.isHero && Math.random() < 0.18 && this.state !== 'spawn') {
      this.animator.play(this.anims.hit || 'Hit_A', { ts: 1.3 });
    }
    if (o.knock && !this.isLarge && !this.isBoss) {
      this.vel.x += o.knock.x; this.vel.z += o.knock.z;
    }
    return a;
  }

  heal(a, silent = false) {
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + a);
    if (!silent && this.hp - before > 1) this.B.onHeal(this, this.hp - before);
  }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.state = 'dead';
    this.deathT = 0;
    this.pendingHit = null;
    if (this.animator) {
      this.animator.cancelShot(0.05);
      this.animator.play(this.anims.death || 'Death_A', { ts: 1, hold: true, fade: 0.1 });
    }
    if (this.def.special?.deathBlast) this.B.explode(this.pos, this.def.special.deathBlast, 4, this, 0xffb050);
    this.B.onDeath(this, killer);
  }

  // ---------------- per-frame ----------------
  update(dt) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      const k = this.rimBase + this.flash * 3;
      for (const m of this.meshes) setRim(m.material, this.flash > 0.05 ? '#ffffff' : this.rimColor, this.flash > 0.05 ? this.flash * 2.2 : k);
    }
    // status timers
    for (const k in this.status) {
      const s = this.status[k];
      s.t -= dt;
      if (k === 'burn' || k === 'bleed' || k === 'poison') {
        s.acc = (s.acc || 0) + dt;
        if (s.acc >= 0.5) { s.acc -= 0.5; this.takeDamage(s.v * 0.5, s.src, { noReact: true, dot: true, color: k === 'burn' ? '#ff9a4a' : '#c43030' }); }
      }
      if (s.t <= 0) delete this.status[k];
    }
    if (!this.alive) { this.updateDead(dt); return; }
    if (this.def.special?.regen) this.heal(this.def.special.regen * dt, true);
    if (this.state === 'spawn') {
      this.stateT -= dt;
      if (this.stateT <= 0) this.state = 'idle';
    } else if (!this.isHero) {
      if (this.army) this.thinkArmy(dt); else this.think(dt);
    }
    this.updatePhysics(dt);
    if (this.animator) {
      if (this.status.freeze) { /* frozen in place: skip anim */ } else this.animator.update(dt * (this.status.chill ? 0.7 : 1));
    }
    this.syncTransform();
  }

  updateDead(dt) {
    this.deathT += dt;
    if (this.animator && this.deathT < 2.5) this.animator.update(dt);
    if (this.deathT > 2.2) {
      this.pos.y -= dt * (this.isLarge ? 0.9 : 0.6);
      this.syncTransform();
    }
    if (this.deathT > 4.2) this.remove = true;
  }

  // where a shot leaves from: the bow hand for archers, otherwise null (projectiles pick a default)
  shotOrigin() {
    if (!this.hasBow) return null;
    const bone = this._bowBone || (this._bowBone = this.root.getObjectByName('handslotl'));
    if (!bone) return null;
    const p = bone.getWorldPosition(new THREE.Vector3());
    p.x += Math.sin(this.facing) * 0.25; p.z += Math.cos(this.facing) * 0.25;
    return p;
  }

  // ---------------- AI ----------------
  aggroRange() {
    // a boss marches on the walls: it only stops for whatever stands in its way
    if (this.isBoss && this.team === TEAM.ENEMY) return 8;
    return this.isRanged ? this.range + 5 : (this.isBoss ? 18 : 12);
  }

  think(dt) {
    const B = this.B;
    this.retarget -= dt;
    if (this.target && (!this.target.alive || (this.target.isStructure && this.target.invulnerable))) this.target = null;
    if (this.retarget <= 0) { this.retarget = 0.3 + Math.random() * 0.2; this.acquire(); }
    this.specials(dt);
    if (this.pendingHit) {
      this.pendingHit.t -= dt;
      if (this.pendingHit.t <= 0) { const p = this.pendingHit; this.pendingHit = null; this.resolveAttack(p.target, p.idx); }
    }
    this.atkCd -= dt * (1 + this.buffs.atk + (this.def.special?.frenzy ? (1 - this.hpPct) * 0.9 : 0)) * (this.status.chill ? 0.7 : 1);
    if (this.disabled) { this.vel.multiplyScalar(0.8); return; }
    let goal = null;
    const t = this.target;
    if (t) {
      const d = this.distTo(t);
      const reach = this.range + (t.radius || 0.6) + this.radius * 0.5;
      if (d <= reach && !(this.def.minRange && d < this.def.minRange)) {
        this.face(t.pos, dt);
        this.desired = 0;
        if (this.atkCd <= 0 && !this.pendingHit) this.startAttack(t);
      } else {
        goal = t.isStructure ? t.aimPoint(this.pos) : t.pos;
        if (this.def.special?.leap && d > 5 && d < this.def.special.leap && (this.specT.leap || 0) <= 0) { this.leap(t); return; }
      }
    } else {
      goal = this.idleGoal();
    }
    if (goal && !this.pendingHit) this.moveToward(goal, dt);
    else this.desired = 0;
  }

  // ---- formation soldiers: hold the slot, break off to fight nearby foes, then re-form ----
  thinkArmy(dt) {
    const B = this.B, A = this.army;
    this.retarget -= dt;
    const slot = A.slotPos(this, this._slot || (this._slot = new THREE.Vector3()));
    if (this.target && (!this.target.alive || (this.target.isStructure && this.target.invulnerable))) this.target = null;
    // melee won't chase far from the line
    if (this.target && !this.target.isStructure && !this.isRanged) {
      const tl = Math.hypot(this.target.pos.x - slot.x, this.target.pos.z - slot.z);
      const hunting = this.target.isBoss || (this.target.target && this.target.target.army === A);
      if (tl > (hunting ? 24 : this.role === 'front' ? 15 : 17)) this.target = null;
    }
    if (this.retarget <= 0) { this.retarget = 0.22 + Math.random() * 0.16; this.acquireArmy(slot); }
    this.specials(dt);
    if (this.pendingHit) {
      this.pendingHit.t -= dt;
      if (this.pendingHit.t <= 0) { const p = this.pendingHit; this.pendingHit = null; this.resolveAttack(p.target, p.idx); }
    }
    this.atkCd -= dt * (1 + this.buffs.atk + (this.def.special?.frenzy ? (1 - this.hpPct) * 0.9 : 0)) * (this.status.chill ? 0.7 : 1);
    if (this.disabled) { this.vel.multiplyScalar(0.8); return; }
    const t = this.target;
    let goal = null, inSlot = false;
    if (t) this.regroupT = 1.0 + Math.random() * 0.6; else this.regroupT = Math.max(0, (this.regroupT || 0) - dt);
    // after a fight, catch a breath where you stand before walking back to the line
    if (!t && this.regroupT > 0 && A.speed < 0.5) { this.desired = 0; return; }
    if (t) {
      const d = this.distTo(t);
      const reach = this.range + (t.radius || 0.6) + this.radius * 0.5;
      if (d <= reach && !(this.def.minRange && d < this.def.minRange)) {
        this.face(t.isStructure ? t.aimPoint(this.pos) : t.pos, dt);
        this.desired = 0;
        if (this.atkCd <= 0 && !this.pendingHit) this.startAttack(t);
        return;
      }
      const tp = t.isStructure ? t.aimPoint(this.pos) : t.pos;
      if (this.isRanged || this.anims.siege) {
        // shoot from the line; only step up as far as needed to get in range
        const sd = Math.hypot(tp.x - slot.x, tp.z - slot.z);
        const need = sd - this.range * 0.92;
        if (need <= 0) { goal = slot; inSlot = true; }
        else { const k = Math.min(need, 5) / (sd || 1); goal = _v.set(slot.x + (tp.x - slot.x) * k, 0, slot.z + (tp.z - slot.z) * k).clone(); }
      } else {
        goal = tp;
        if (this.def.special?.leap && d > 5 && d < this.def.special.leap && (this.specT.leap || 0) <= 0) { this.leap(t); return; }
      }
    } else { goal = slot; inSlot = true; }
    if (goal && !this.pendingHit) this.moveFormation(goal, dt, inSlot);
    else this.desired = 0;
  }

  acquireArmy(slot) {
    const B = this.B, A = this.army;
    const sp = this.def.special || {};
    const ranged = this.isRanged || this.anims.siege;
    const engage = ranged ? this.range + 1.5 : (this.role === 'front' ? 10 : 9);
    const ox = ranged ? this.pos.x : slot.x, oz = ranged ? this.pos.z : slot.z;
    let best = null, bestScore = Infinity;
    for (const o of B.query(ox, oz, Math.max(engage, ranged ? 0 : 22) + 6)) {
      if (o.team === this.team || !o.alive || o.stealth || o.isStructure) continue;
      // distance from the slot, or from where the soldier actually stands (whichever is nearer)
      const d = Math.min(Math.hypot(o.pos.x - ox, o.pos.z - oz), Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) + 1);
      // break ranks for the boss, or for anyone shooting at the formation from out of reach
      const shooter = o.isRanged && o.target && o.target.army === A;
      const reach = ranged ? engage : (o.isBoss ? 22 : shooter ? 20 : engage);
      if (d > reach) continue;
      let score = d;
      if (o.target === this) score -= 3;                               // answer whoever is hitting me
      else if (o.target && o.target.army === A) score -= 1.5;          // protect a comrade
      else if (o.target && o.target.isHero) score -= 2;                // protect the commander
      score += (A.targetCount.get(o) || 0) * (ranged ? 0.25 : 1.4);   // melee spread out, archers can stack
      if (ranged && o === A.focus) score -= 2.5;                       // volley fire on the closest threat
      if (o.isBoss) score -= ranged ? 6 : 4;                            // everyone turns on the boss
      if (!ranged && shooter && d > engage) score += 3;                 // but deal with what's close first
      if (sp.hunter && o.isRanged) score -= 10;
      if (o.def?.special?.taunt && d < o.def.special.taunt) score -= 8;
      if (this.target === o) score -= 1.5;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (B.rift && !B.rift.invulnerable) {
      const d = B.rift.distTo(this.pos);
      const prefer = this.def.vsStructure ? 30 : 0;
      if (d < this.range + 4 + prefer && (!best || d - prefer < bestScore)) best = B.rift;
    }
    if (best !== this.target) this.target = best;
  }

  moveFormation(goal, dt, inSlot) {
    const A = this.army;
    const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (inSlot) {
      const marching = A.speed > 0.4;
      // settled soldiers stay put until their slot has really moved away (no twitching)
      if (!marching && this.settled && d < 1.5) { this.desired = 0; this.faceFormation(dt); return; }
      if (!marching && d < 0.5) { this.settled = true; this.desired = 0; this.faceFormation(dt); return; }
      this.settled = false;
      // keep pace with the block, a little faster when behind
      this.desired = Math.min(this.speed, A.speed + d * 1.4);
      if (this.desired < 0.5) { this.desired = 0; this.faceFormation(dt); return; }
      this.desired = Math.max(this.desired, Math.min(this.speed, 1.1));   // never glide in an idle pose
    } else {
      this.settled = false;
      this.desired = this.speed;
    }
    this.dirX = dx / d; this.dirZ = dz / d;
    this.facing = angleLerp(this.facing, Math.atan2(dx, dz), Math.min(1, dt * 6));
  }

  faceFormation(dt) {
    const want = this.army.facing;
    let diff = want - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) > 0.3) this.facing = angleLerp(this.facing, want, Math.min(1, dt * 3));
  }

  idleGoal() {
    const B = this.B;
    if (this.team === TEAM.ENEMY) {
      const lane = this.lane ?? (this.lane = rand(-14, 14));
      const x = this.pos.x - 10;
      if (this.pos.x < MAP.castleX + 12) return _v.set(MAP.castleX + 3, 0, clamp(this.pos.z, -26, 26)).clone();
      return new THREE.Vector3(x, 0, roadZ(x) + lane * clamp((this.pos.x - MAP.castleX) / 60, 0.2, 1));
    }
    if (this.order === 'hold') {
      if (!this.holdPoint) this.holdPoint = new THREE.Vector3(MAP.castleX + rand(8, 14), 0, rand(-18, 18));
      if (dist2(this.pos.x, this.pos.z, this.holdPoint.x, this.holdPoint.z) < 2) return null;
      return this.holdPoint;
    }
    if (this.order === 'rally' && B.hero && B.hero.alive) {
      const h = B.hero.pos;
      if (!this.rallyOff) this.rallyOff = new THREE.Vector3(rand(-5, 5), 0, rand(-5, 5));
      const gx = h.x - 2.5 + this.rallyOff.x, gz = h.z + this.rallyOff.z;
      if (dist2(this.pos.x, this.pos.z, gx, gz) < 6) return null;
      return new THREE.Vector3(gx, 0, gz);
    }
    // charge: push to the enemy stronghold; while it is shielded, gather near the forward shrines
    const rift = B.rift;
    if (rift && !rift.invulnerable) return rift.aimPoint(this.pos);
    if (!this.holdPoint || this.holdPointCharge !== B.frontLine) {
      this.holdPointCharge = B.frontLine;
      this.holdPoint = new THREE.Vector3(B.frontLine + rand(-6, 4), 0, rand(-20, 20));
    }
    if (dist2(this.pos.x, this.pos.z, this.holdPoint.x, this.holdPoint.z) < 3) return null;
    return this.holdPoint;
  }

  distTo(t) {
    if (t.isStructure) return t.distTo(this.pos);
    return Math.max(0, Math.sqrt(dist2(this.pos.x, this.pos.z, t.pos.x, t.pos.z)) - t.radius * 0.5);
  }

  acquire() {
    const B = this.B;
    const sp = this.def.special || {};
    const range = this.order === 'hold' && this.team === TEAM.PLAYER ? 11 : this.aggroRange();
    const near = B.query(this.pos.x, this.pos.z, range + 4);
    let best = null, bestScore = Infinity;
    for (const o of near) {
      if (o.team === this.team || !o.alive || o.stealth) continue;
      let d = Math.sqrt(dist2(this.pos.x, this.pos.z, o.pos.x, o.pos.z));
      if (d > range + 3) continue;
      let score = d;
      if (o.def?.special?.taunt && d < o.def.special.taunt) score -= 8;
      if (sp.hunter && o.isRanged) score -= 10;
      if (o.isHero) score -= 1.5;
      if (this.target === o) score -= 2;  // stickiness
      if (this.order === 'rally' && B.hero && this.team === TEAM.PLAYER) {
        if (Math.sqrt(dist2(o.pos.x, o.pos.z, B.hero.pos.x, B.hero.pos.z)) > 14) continue;
      }
      if (score < bestScore) { bestScore = score; best = o; }
    }
    // structures
    if (this.team === TEAM.ENEMY && B.castle) {
      const d = B.castle.distTo(this.pos);
      const prefer = this.def.vsStructure ? 6 : 0;
      if (d < 3 + this.range && (!best || d - prefer < bestScore)) best = B.castle;
    }
    if (this.team === TEAM.PLAYER && B.rift && !B.rift.invulnerable) {
      const d = B.rift.distTo(this.pos);
      const prefer = this.def.vsStructure ? 30 : 0;
      if (d < this.range + 4 + prefer && (!best || d - prefer < bestScore)) best = B.rift;
    }
    if (best !== this.target) this.target = best;
  }

  face(p, dt, rate = 10) {
    const a = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.facing = angleLerp(this.facing, a, Math.min(1, dt * rate));
  }

  moveToward(goal, dt) {
    const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.2) { this.desired = 0; return; }
    const sp = this.speed;
    this.desired = sp;
    this.dirX = dx / d; this.dirZ = dz / d;
    this.facing = angleLerp(this.facing, Math.atan2(dx, dz), Math.min(1, dt * 8));
  }

  startAttack(t) {
    const anims = this.anims;
    if (anims.siege) {
      this.atkCd = this.rate;
      this.recoil = 1;
      this.resolveAttack(t, 0);
      return;
    }
    const idx = Math.floor(Math.random() * anims.attacks.length);
    const name = anims.attacks[idx];
    const dur = this.animator.dur(name);
    const effRate = this.rate / (1 + this.buffs.atk);
    // bows draw for about half the cycle, loose, then hold the follow-through
    const ts = anims.release ? clamp(dur / (effRate * 0.55), 1, 2.6) : clamp(dur / Math.max(0.45, effRate * 0.92), 1, 2.6);
    this.animator.play(name, { ts });
    this.pendingHit = { t: (anims.hitT || 0.42) * dur / ts, target: t, idx };
    this.atkCd = effRate;
    if (!this.isRanged && Math.random() < 0.5) this.B.sfx('swing', this.pos, 0.35);
  }

  resolveAttack(t, idx) {
    if (!this.alive) return;
    const B = this.B;
    if (!t || !t.alive) return;
    const d = this.def;
    let dmg = this.dmg * this.damageMult(t);
    if (d.crit && Math.random() < d.crit) dmg *= 2;
    if (this.isRanged) {
      if (this.anims.release && this.animator) this.animator.play(this.anims.release, { ts: 1.5 });
      B.fireProjectile(this, t, d.projectile || 'arrow', dmg, { aoe: d.aoe, pierce: d.pierce, pierceArmor: d.pierceArmor });
      return;
    }
    if (this.distTo(t) > this.range + (t.radius || 0.6) + 1.6) return;
    const sp = d.special || {};
    const dir = _v.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize();
    const opts = { pierceArmor: d.pierceArmor, dir: dir.clone(), melee: true };
    if (d.aoe) {
      B.cleave(this, t.pos, d.aoe, dmg, opts);
      if (this.isLarge) { B.shake(0.25, this.pos); B.fx.burst(t.pos, { count: 14, color: 0x8a7a6a, normal: true, size: 1.2, speed: 3, life: 0.8, gravity: 2 }); B.sfx('thud', t.pos, 0.6); }
    } else {
      t.takeDamage(dmg * (t.isStructure && d.vsStructure ? d.vsStructure : 1), this, opts);
    }
    if (sp.chill && t.addStatus) t.addStatus('chill', 2, sp.chill);
    if (sp.bleed && t.addStatus) t.addStatus('bleed', 3, sp.bleed), (t.status.bleed && (t.status.bleed.src = this));
    B.hitSpark(t, this);
  }

  specials(dt) {
    const sp = this.def.special;
    if (!sp) return;
    const B = this.B;
    for (const k in this.specT) this.specT[k] -= dt;
    const ready = (k, every) => { if ((this.specT[k] ?? (this.specT[k] = every * Math.random())) <= 0) { this.specT[k] = every; return true; } return false; };
    if (sp.heal && ready('heal', sp.heal.every)) {
      const ally = B.mostWounded(this, sp.heal.range);
      if (ally) { ally.heal(sp.heal.amount * (B.flags?.spareCursed ? 0.85 : 1)); B.fx.beam(this.pos.clone().setY(this.pos.y + 1.6), ally.pos.clone().setY(ally.pos.y + 1.2), { color: 0xffe2a0, life: 0.35, width: 0.08 }); B.fx.burst(ally.pos.clone().setY(ally.pos.y + 1), { count: 5, color: 0xd8b060, speed: 1, up: 2, gravity: -1, life: 0.8, size: 0.28 }); }
    }
    const enemyNear = this.target && this.target.alive && this.distTo(this.target) < 16;
    if (sp.smite && enemyNear && this.distTo(this.target) < 6 && ready('smite', sp.smite.every)) {
      B.explode(this.pos, sp.smite.dmg * (this.level > 1 ? 1.2 : 1), sp.smite.radius, this, 0xffd27a, true);
    }
    if (sp.slowField && enemyNear && ready('slow', sp.slowField.every)) B.addField(this.target.pos.clone(), sp.slowField.radius, sp.slowField.dur, { slow: sp.slowField.slow, team: this.team, color: 0x7ab8ff });
    if (sp.regrowth && ready('regrow', sp.regrowth.every)) B.addField(this.pos.clone(), sp.regrowth.radius, sp.regrowth.dur, { heal: sp.regrowth.heal, team: this.team, color: 0x7aff9a });
    if (sp.entangle && enemyNear && ready('entangle', sp.entangle.every)) B.addField(this.target.pos.clone(), sp.entangle.radius, 0.6, { root: sp.entangle.dur, team: this.team, color: 0x5acc6a });
    if (sp.curse && enemyNear && ready('curse', sp.curse.every)) {
      for (const o of B.query(this.target.pos.x, this.target.pos.z, sp.curse.radius)) if (o.team !== this.team && o.alive && o.addStatus) o.addStatus('curse', sp.curse.dur, sp.curse.amp);
      B.fx.ring(this.target.pos, { color: 0xa04aff, radius: sp.curse.radius, life: 0.8 });
    }
    if (sp.turret && ready('turret', sp.turret.every) && this.team === TEAM.PLAYER) B.buildTurret(this);
    if (sp.assassin && ready('assassin', 8)) B.assassinate(this);
    if (sp.raise && ready('raise', sp.raise.every)) B.raiseDead(this, sp.raise.count);
    if (sp.summon && ready('summon', sp.summon.every)) B.summonMinions(this, sp.summon.type, sp.summon.count);
    if (sp.nova && enemyNear && ready('nova', sp.nova.every)) B.telegraphNova(this, sp.nova.dmg, sp.nova.radius);
    if (sp.warcry && ready('warcry', sp.warcry.every)) B.warcry(this);
    if (sp.charge && this.target && this.distTo(this.target) > 6 && ready('charge', sp.charge.every)) B.bossCharge(this, this.target);
    if (sp.blink && ready('blink', sp.blink.every)) B.bossBlink(this);
    if (sp.leap) this.specT.leap = (this.specT.leap ?? 0);
  }

  leap(t) {
    this.specT.leap = 7;
    const B = this.B;
    const from = this.pos.clone();
    const to = t.pos.clone().add(new THREE.Vector3(Math.sign(from.x - t.pos.x) * 1.2, 0, 0));
    this.leaping = { from, to, t: 0, dur: 0.6 };
    if (this.animator) this.animator.play('Melee_1H_Attack_Jump_Chop', { ts: 1.4 });
    B.sfx('growl', this.pos, 0.6);
  }

  updatePhysics(dt) {
    const B = this.B;
    if (this.isHero) return; // hero integrates its own motion
    if (this.leaping) {
      const L = this.leaping;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      this.pos.lerpVectors(L.from, L.to, k);
      this.pos.y = B.h(this.pos.x, this.pos.z) + Math.sin(k * Math.PI) * 3;
      if (k >= 1) {
        this.leaping = null;
        B.cleave(this, this.pos, 2.5, this.dmg * 1.3, { melee: true });
        B.fx.burst(this.pos, { count: 12, color: 0x6a5a4a, normal: true, size: 1, speed: 3 });
      }
      return;
    }
    const want = this.rooted || this.pendingHit ? 0 : (this.desired || 0);
    let vx = (this.dirX || 0) * want, vz = (this.dirZ || 0) * want;
    // separation from neighbours
    const near = B.query(this.pos.x, this.pos.z, 2.6);
    let sx = 0, sz = 0;
    for (const o of near) {
      if (o === this || !o.alive || o.isStructure) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const r = this.radius + o.radius;
      if (d2 < r * r && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        const push = (r - d) / r * (o.isLarge && !this.isLarge ? 2.4 : (this.army && o.army === this.army ? 0.8 : 1.2));
        sx += dx / d * push; sz += dz / d * push;
      }
    }
    vx += sx * 3.2; vz += sz * 3.2;
    // knockback impulse decays
    vx += this.vel.x; vz += this.vel.z;
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
    this.pos.x += vx * dt; this.pos.z += vz * dt;
    B.collide(this);
    this.pos.y = B.h(this.pos.x, this.pos.z);
    // locomotion animation
    if (this.animator && !this.animator.shot) {
      const sp = Math.sqrt(vx * vx + vz * vz);
      // hysteresis: start moving above 0.9, stop below 0.35, so a soldier settling into place doesn't flicker
      this._mv = want > 0 && (this._mv ? sp > 0.35 : sp > 0.9);
      if (this._mv) {
        // walk when slow (marching in step), run when fast; again with a band so it doesn't flip
        if (this._walk ? sp > 3.6 : sp < 2.9) this._walk = !this._walk;
        const walk = this.anims.walk && (this.baseSpeed < 3.0 || (this.army && this._walk) || (this.def.undead && this.team === TEAM.ENEMY && this.def.anim?.startsWith('skel') && !this.target));
        if (walk) this.animator.loop(this.anims.walk, clamp(sp / 2.2, 0.6, 1.5));
        else this.animator.loop(this.anims.move || 'Running_A', clamp(sp / (this.isLarge ? 3.8 : 5.2), 0.6, 1.6));
      } else this.animator.loop(this.anims.idle || 'Idle_A', 1);
    }
    if (this.anims.siege) {
      const sp = Math.sqrt(vx * vx + vz * vz);
      this.body.position.y = sp > 0.3 ? Math.abs(Math.sin(performance.now() * 0.012)) * 0.08 : 0;
      if (this.recoil) { this.recoil = Math.max(0, this.recoil - dt * 2.5); this.body.rotation.x = -this.recoil * 0.25; }
    }
  }

  dispose() {
    this.B.scene.remove(this.root);
    if (this.animator) this.animator.mixer.stopAllAction();
    for (const m of this.meshes) m.material.dispose();
  }
}
