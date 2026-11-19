// The player's hero: third-person control, combos, heavy attacks, blocking, dodging, stamina and abilities.
import * as THREE from 'three';
import { Unit } from './unit.js';
import { HEROES, ABILITIES } from './data/units.js';
import { TEAM } from './config.js';
import { clamp, angleLerp, angleDiff, rand } from '../core/util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Hero extends Unit {
  constructor(B, classId, save) {
    const base = HEROES[classId];
    const lvl = save.level || 1;
    const armory = save.upgrades?.armory || 0, plate = save.upgrades?.plate || 0;
    const def = { ...base, hp: Math.round(base.hp * (1 + 0.06 * (lvl - 1)) * (1 + 0.12 * plate)), dmg: base.dmg * (1 + 0.06 * (lvl - 1)) * (1 + 0.12 * armory), armor: base.armor + plate, radius: 0.7, scale: 0.9 };
    super(B, def, TEAM.PLAYER, { headScale: 0.66 });
    this.isHero = true;
    this.level = lvl;
    this.xpPool = save.xp || 0;
    this.cls = base;
    this.classId = classId;
    this.stamina = 100; this.maxStamina = 100; this.stamDelay = 0;
    this.cooldowns = {}; for (const a of base.abilities) this.cooldowns[a] = 0;
    this.talents = save.talents || {};
    this.combo = 0; this.comboWindow = 0;
    this.attackLock = 0;
    this.charge = 0; this.charging = false;
    this.dodge = null;
    this.blocking = false;
    this.aimYaw = this.facing;
    this.moveDir = new THREE.Vector3();
    this.lifesteal = 0;
    this.critNext = false;
    this.spin = null;
    this.rimBase = 0.28;
    for (const m of this.meshes) m.material.__rimU && m.material.__rimU.value.set('#ffcf8a').multiplyScalar(0.28);
    this.rimColor = new THREE.Color('#ffcf8a');
    this.animator.loop(this.anims.idle, 1, 0);
  }

  xpToNext() { return Math.round(140 + 110 * Math.pow(this.level - 1, 1.35)); }
  gainXp(x) {
    this.xpPool = (this.xpPool || 0) + x;
    while (this.xpPool >= this.xpToNext()) {
      this.xpPool -= this.xpToNext();
      this.level++;
      this.levelsGained = (this.levelsGained || 0) + 1;
      const k = 1.06;
      this.maxHp = Math.round(this.maxHp * k); this.dmg *= k;
      this.heal(this.maxHp * 0.3, true);
      this.B.hud.banner('LEVEL ' + this.level, 'Your hero grows stronger. Spend Valor at the war camp.', 2.6);
      this.B.fx.burst(this.pos.clone().setY(this.pos.y + 1), { count: 50, color: 0xffd27a, speed: 3, up: 3, gravity: -1, life: 1.4, size: 0.5 });
      this.B.fx.ring(this.pos, { color: 0xffd27a, radius: 5, life: 0.8 });
      this.B.sfx('levelup', this.pos, 1);
    }
  }

  rank(ab) { return this.talents[ab] || 0; }
  abilityPower(ab) { return 1 + 0.25 * this.rank(ab); }
  abilityCd(ab) { return ABILITIES[ab].cd * (1 - 0.1 * this.rank(ab)); }

  blockFactor(dir) {
    if (!this.blocking) return 1;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const dot = -(dir.x * fx + dir.z * fz);
    if (dot > 0.2) { this.spendStamina(6); this.B.sfx('clang', this.pos, 0.5); return 0.25; }
    return 1;
  }

  spendStamina(a) { this.stamina = Math.max(0, this.stamina - a); this.stamDelay = 0.75; }

  // called by Battle every frame with the input snapshot
  control(dt, inp, cam) {
    if (!this.alive) return;
    const B = this.B;
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.stamDelay -= dt;
    if (this.stamDelay <= 0) this.stamina = Math.min(this.maxStamina, this.stamina + dt * (this.blocking ? 8 : 26));
    this.comboWindow -= dt;
    this.attackLock -= dt;
    this.aimYaw = cam.yaw;
    const stunned = this.disabled;

    // movement intent in camera space
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    const rx = -fz, rz = fx;
    let mx = inp.move.x * rx + inp.move.y * fx, mz = inp.move.x * rz + inp.move.y * fz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    this.moveDir.set(mx, 0, mz);

    // dodge
    if (inp.dodge && !this.dodge && !stunned && this.stamina >= 20) {
      const dx = ml > 0.1 ? mx / ml : Math.sin(this.facing), dz = ml > 0.1 ? mz / ml : Math.cos(this.facing);
      this.dodge = { x: dx, z: dz, t: 0.42 };
      this.spendStamina(22);
      this.addStatus('invuln', 0.32);
      const rel = angleDiff(this.facing, Math.atan2(dx, dz));
      const anim = Math.abs(rel) < 0.8 ? 'Dodge_Forward' : Math.abs(rel) > 2.3 ? 'Dodge_Backward' : rel > 0 ? 'Dodge_Left' : 'Dodge_Right';
      this.animator.play(anim, { ts: 1.0 });
      this.pendingHit = null; this.charging = false; this.spin = null;
      B.sfx('cloth', this.pos, 0.6);
    }

    // block (melee classes)
    const canBlock = this.cls.block && !this.dodge && !stunned && this.attackLock <= 0;
    const wantBlock = canBlock && inp.block && this.stamina > 2;
    if (wantBlock !== this.blocking) {
      this.blocking = wantBlock;
      if (wantBlock) this.animator.play(this.cls.block, { ts: 1, hold: true });
      else this.animator.cancelShot();
    }

    // attacks
    if (!stunned && !this.dodge && !this.blocking) {
      if (inp.attackDown) { this.charging = true; this.charge = 0; }
      if (this.charging && inp.attackHeld) {
        this.charge += dt;
        if (this.charge > 0.32 && !this.chargeFx) { this.chargeFx = true; B.sfx('charge', this.pos, 0.5); }
        if (this.charge > 0.32 && Math.random() < dt * 30) B.fx.burst(this.handPos(), { count: 1, color: this.classId === 'mage' ? 0xff9a3a : 0xffe6b0, size: 0.35, speed: 0.6, life: 0.4, gravity: -1 });
      }
      if (this.charging && inp.attackUp) {
        this.charging = false; this.chargeFx = false;
        if (this.charge > 0.32 && this.stamina >= 22) this.heavyAttack(cam);
        else this.basicAttack(cam);
      }
      if (!inp.attackHeld && this.charging && !inp.attackUp) this.charging = false;
    }
    // abilities
    if (!stunned && !this.dodge) {
      const keys = ['Q', 'E', 'F', 'R'];
      this.cls.abilities.forEach((ab, i) => { if (inp.ability[keys[i]] && this.cooldowns[ab] <= 0) this.cast(ab, cam); });
    }

    // velocity
    let speed = this.speed;
    if (inp.sprint && ml > 0.1 && !this.blocking && this.stamina > 1 && !this.charging) { speed *= 1.45; this.stamina = Math.max(0, this.stamina - dt * 14); this.stamDelay = 0.4; }
    if (this.blocking) speed *= 0.42;
    if (this.charging && this.charge > 0.32) speed *= 0.5;
    if (this.attackLock > 0 && this.cls.melee) speed *= 0.3;
    if (this.spin) speed *= 0.65;
    let vx = mx * speed, vz = mz * speed;
    if (this.dodge) {
      this.dodge.t -= dt;
      vx = this.dodge.x * 13; vz = this.dodge.z * 13;
      if (this.dodge.t <= 0) this.dodge = null;
    }
    if (this.dash) {
      this.dash.t -= dt;
      vx = this.dash.x * this.dash.speed; vz = this.dash.z * this.dash.speed;
      this.dash.onTick && this.dash.onTick();
      if (this.dash.t <= 0) { this.dash.onEnd && this.dash.onEnd(); this.dash = null; }
    }
    if (stunned || this.leaping) { vx = 0; vz = 0; }
    vx += this.vel.x; vz += this.vel.z;
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
    this.pos.x += vx * dt; this.pos.z += vz * dt;
    B.collide(this);
    if (!this.leaping) this.pos.y = B.h(this.pos.x, this.pos.z);

    // facing
    const combatFacing = this.charging || this.blocking || this.attackLock > 0 || this.spin || inp.aim;
    if (combatFacing || (!this.cls.melee && inp.attackHeld)) this.facing = angleLerp(this.facing, cam.yaw, Math.min(1, dt * 16));
    else if (ml > 0.1 && !this.dodge) this.facing = angleLerp(this.facing, Math.atan2(mx, mz), Math.min(1, dt * 12));

    // locomotion animation
    const anim = this.animator;
    if (!anim.shot) {
      const sp = Math.hypot(vx, vz);
      if (sp > 0.5) {
        if (combatFacing) {
          const rel = angleDiff(this.facing, Math.atan2(vx, vz));
          if (Math.abs(rel) < 0.8) anim.loop(this.cls.anim === 'bow' ? 'Running_HoldingBow' : 'Running_A', clamp(sp / 5.5, 0.7, 1.5));
          else if (Math.abs(rel) > 2.3) anim.loop('Walking_Backwards', clamp(sp / 3, 0.7, 1.5));
          else anim.loop(rel > 0 ? 'Running_Strafe_Left' : 'Running_Strafe_Right', clamp(sp / 5, 0.7, 1.4));
        } else anim.loop(this.cls.anim === 'bow' ? 'Running_HoldingBow' : 'Running_A', clamp(sp / 5.6, 0.7, 1.6));
        this.stepT = (this.stepT || 0) - dt * sp;
        if (this.stepT <= 0) { this.stepT = 2.6; B.sfx('step', this.pos, 0.25); }
      } else anim.loop(this.anims.idle, 1);
    }
    if (this.pendingHit) {
      this.pendingHit.t -= dt;
      if (this.pendingHit.t <= 0) { const p = this.pendingHit; this.pendingHit = null; p.fn(); }
    }
    if (this.spin) this.updateSpin(dt);
    if (this.timers) for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); } }
  }

  after(t, fn) { (this.timers || (this.timers = [])).push({ t, fn }); }

  handPos() {
    const b = this.root.getObjectByName('handslotr') || this.root;
    return b.getWorldPosition(new THREE.Vector3());
  }

  aimTarget(cam, maxRange = 40) {
    // enemy nearest to the camera's aim point, with generous assist
    const B = this.B;
    const ap = cam.aimPoint;
    let best = null, bestD = 4.5 * 4.5;
    for (const u of B.query(ap.x, ap.z, 6)) {
      if (u.team === this.team || !u.alive) continue;
      const d = (u.pos.x - ap.x) ** 2 + (u.pos.z - ap.z) ** 2;
      if (d < bestD) { bestD = d; best = u; }
    }
    if (!best) {
      // fallback: nearest enemy roughly in front
      const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
      let bs = Infinity;
      for (const u of B.query(this.pos.x, this.pos.z, maxRange)) {
        if (u.team === this.team || !u.alive) continue;
        const dx = u.pos.x - this.pos.x, dz = u.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const dot = (dx * fx + dz * fz) / (d || 1);
        if (dot < 0.86) continue;
        const s = d * (2 - dot);
        if (s < bs) { bs = s; best = u; }
      }
    }
    if (!best && B.rift && !B.rift.invulnerable && B.rift.distTo(ap) < 8) best = B.rift;
    return best;
  }

  basicAttack(cam) {
    if (this.attackLock > 0.1 || this.pendingHit) return;
    const cls = this.cls;
    const cost = cls.melee ? 6 : 3;
    if (this.stamina < cost * 0.5) return;
    this.spendStamina(cost);
    this.facing = cam.yaw;
    if (this.comboWindow <= 0) this.combo = 0;
    const name = cls.combo[this.combo % cls.combo.length];
    this.combo++;
    const dur = this.animator.dur(name);
    const atkMul = 1 + this.buffs.atk;
    const ts = (cls.melee ? 1.45 : 1.6) * atkMul;
    this.animator.play(name, { ts });
    this.attackLock = dur / ts * 0.75;
    this.comboWindow = dur / ts + 0.45;
    const hitT = (this.anims.hitT || 0.4) * dur / ts;
    if (cls.melee) {
      this.pendingHit = { t: hitT, fn: () => this.meleeSweep(this.dmg * (this.combo % cls.combo.length === 0 ? 1.35 : 1), cls.reach, cls.arc) };
      this.B.sfx('swing', this.pos, 0.6);
    } else {
      const target = this.aimTarget(cam);
      const aim = cam.aimPoint.clone();
      this.pendingHit = { t: hitT * 0.6, fn: () => {
        let dmg = this.dmg;
        if (this.critNext) { dmg *= 2.5; this.critNext = false; }
        this.B.fireProjectile(this, target, cls.projectile, dmg, { point: target ? null : aim, aoe: this.classId === 'mage' ? 1.8 : 0, speedMul: 1.4 });
      } };
    }
  }

  heavyAttack(cam) {
    const h = this.cls.heavy;
    this.spendStamina(24);
    this.facing = cam.yaw;
    const dur = this.animator.dur(h.anim);
    const ts = 1.25;
    this.animator.play(h.anim, { ts });
    this.attackLock = dur / ts * 0.8;
    const hitT = (this.anims.hitT || 0.42) * dur / ts;
    const B = this.B;
    if (h.kind === 'bash') {
      this.pendingHit = { t: hitT, fn: () => { this.meleeSweep(this.dmg * h.mult, 3.2, 1.8, { stun: h.stun, knock: 6 }); B.shake(0.2, this.pos); B.sfx('clang', this.pos, 0.9); } };
    } else if (h.kind === 'slam') {
      this.pendingHit = { t: hitT, fn: () => {
        const p = this.pos.clone().add(_v.set(Math.sin(this.facing) * 2, 0, Math.cos(this.facing) * 2));
        B.cleave(this, p, 3.6, this.dmg * h.mult, { stun: h.stun, melee: true });
        B.fx.ring(p, { color: 0xc8a070, radius: 4, life: 0.5 });
        B.fx.burst(p, { count: 18, color: 0x6a5a48, normal: true, size: 1.2, speed: 4, life: 0.9, gravity: 3 });
        B.shake(0.35, this.pos); B.sfx('thud', p, 1);
      } };
    } else if (h.kind === 'pierce') {
      const target = this.aimTarget(cam);
      const aim = cam.aimPoint.clone();
      this.pendingHit = { t: hitT * 0.5, fn: () => B.fireProjectile(this, target, 'arrow', this.dmg * h.mult, { point: target ? null : aim, pierce: 99, line: true, speedMul: 2.2, glow: true }) };
    } else if (h.kind === 'fireball') {
      const target = this.aimTarget(cam);
      const aim = cam.aimPoint.clone();
      this.pendingHit = { t: hitT, fn: () => B.fireProjectile(this, target, 'fireball', this.dmg * h.mult, { point: target ? null : aim, aoe: 3.8 }) };
    }
  }

  meleeSweep(dmg, reach, arc, extra = {}) {
    const B = this.B;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    let hits = 0;
    for (const u of B.query(this.pos.x, this.pos.z, reach + 2)) {
      if (u.team === this.team || !u.alive) continue;
      const dx = u.pos.x - this.pos.x, dz = u.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) - u.radius;
      if (d > reach) continue;
      const dot = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
      if (dot < Math.cos(arc / 2) && d > 0.6) continue;
      const knock = extra.knock ? _v.set(dx, 0, dz).normalize().multiplyScalar(extra.knock).clone() : _v.set(dx, 0, dz).normalize().multiplyScalar(1.6).clone();
      u.takeDamage(dmg * this.damageMult(u), this, { melee: true, knock, dir: _w.set(dx, 0, dz).normalize().clone() });
      if (extra.stun) u.addStatus('stun', extra.stun);
      B.hitSpark(u, this);
      hits++;
    }
    if (B.rift && !B.rift.invulnerable && B.rift.distTo(this.pos) < reach + 0.5) { B.rift.takeDamage(dmg, this); hits++; }
    if (hits) { B.sfx('hit', this.pos, 0.8); if (hits > 2) B.shake(0.12, this.pos); }
    return hits;
  }

  updateSpin(dt) {
    const s = this.spin;
    s.t -= dt; s.tick -= dt;
    if (s.tick <= 0) {
      s.tick = s.every;
      this.B.cleave(this, this.pos, s.radius, s.dmg, { melee: true, knockOut: 2 });
      this.B.sfx('swing', this.pos, 0.6);
      this.B.fx.ring(this.pos, { color: 0xd8c8a0, radius: s.radius, life: 0.3, width: 0.08 });
      if (s.anim) this.animator.play(s.anim, { ts: s.ts || 1.6 });
    }
    if (s.t <= 0) { this.spin = null; this.animator.cancelShot(); }
  }

  // ---------------- abilities ----------------
  cast(ab, cam) {
    const B = this.B;
    const P = this.abilityPower(ab);
    const aim = cam.aimPoint.clone();
    const yaw = cam.yaw;
    this.facing = yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const clampAim = (max) => { const d = Math.hypot(aim.x - this.pos.x, aim.z - this.pos.z); if (d > max) { aim.x = this.pos.x + (aim.x - this.pos.x) / d * max; aim.z = this.pos.z + (aim.z - this.pos.z) / d * max; } aim.y = B.h(aim.x, aim.z); return aim; };
    this.cooldowns[ab] = this.abilityCd(ab);
    B.onAbility(this, ab);
    switch (ab) {
      case 'shieldCharge': {
        this.animator.play('Melee_1H_Attack_Stab', { ts: 1.1 });
        const hit = new Set();
        this.addStatus('invuln', 0.45);
        this.dash = { x: fx, z: fz, speed: 22, t: 0.45, onTick: () => {
          for (const u of B.query(this.pos.x, this.pos.z, 2.4)) {
            if (u.team === this.team || !u.alive || hit.has(u)) continue;
            hit.add(u);
            u.takeDamage(this.dmg * 1.3 * P, this, { knock: _v.set(fx * 9, 0, fz * 9).clone(), melee: true });
            u.addStatus('stun', 1.3);
            B.hitSpark(u, this);
          }
          if (Math.random() < 0.5) B.fx.burst(this.pos, { count: 2, color: 0x7a6a5a, normal: true, size: 0.9, speed: 1.5, life: 0.6 });
        }, onEnd: () => { B.shake(0.2, this.pos); } };
        B.sfx('charge', this.pos, 1); B.sfx('clang', this.pos, 0.7);
        break;
      }
      case 'rally': {
        this.animator.play('Cheering', { ts: 1.6 });
        for (const u of B.units) if (u.team === this.team && u.alive && u.pos.distanceTo(this.pos) < 20) {
          u.rallyBuff = { t: 8, dmg: 0.25 * P, spd: 0.2 };
          u.heal(u.maxHp * 0.15 * P);
          B.fx.burst(u.pos.clone().setY(u.pos.y + 1.4), { count: 6, color: 0xffd27a, speed: 1, up: 2, gravity: -1, life: 1, size: 0.35 });
        }
        B.fx.ring(this.pos, { color: 0xffc860, radius: 20, life: 1.0 });
        B.fx.flash(this.pos, 0xffc060, 40, 24, 0.8);
        B.sfx('horn', this.pos, 1);
        break;
      }
      case 'whirlwind': {
        this.spin = { t: 1.5, tick: 0, every: 0.36, radius: 3.8, dmg: this.dmg * 0.95 * P, anim: 'Melee_2H_Attack_Spinning', ts: 1.2 };
        break;
      }
      case 'lastLight': {
        this.animator.play('Ranged_Magic_Raise', { ts: 1.3 });
        this.addStatus('invuln', 3);
        this.after(0.55, () => {
          for (const u of B.units) {
            if (!u.alive) continue;
            const d = u.pos.distanceTo(this.pos);
            if (d > 22) continue;
            if (u.team !== this.team) { u.takeDamage((180 + this.dmg * 2) * P * (u.def.undead ? 1.5 : 1), this, { color: '#ffe6a0' }); u.addStatus('stun', 1.5); }
            else u.heal(u.maxHp * 0.4);
          }
          B.fx.ring(this.pos, { color: 0xffe0a0, radius: 22, life: 1.2, width: 0.3 });
          B.fx.ring(this.pos, { color: 0xffffff, radius: 6, life: 0.6, filled: true, opacity: 0.6 });
          B.fx.burst(this.pos.clone().setY(this.pos.y + 1.5), { count: 80, color: 0xffd890, speed: 9, spread: 1, up: 1, gravity: 0, life: 1.1, size: 0.6 });
          B.fx.flash(this.pos, 0xffd890, 120, 40, 1.2);
          B.screenFlash('#ffe6b0', 0.6);
          B.shake(0.5, this.pos); B.sfx('nova', this.pos, 1);
        });
        break;
      }
      case 'volley': {
        clampAim(32);
        this.animator.play('Ranged_Bow_Release_Up', { ts: 1.5 });
        B.fx.ring(aim, { color: 0xffe0a0, radius: 6, life: 1.3, opacity: 0.5 });
        for (let i = 0; i < 16; i++) this.after(0.25 + i * 0.07, () => {
          const p = aim.clone().add(_v.set(rand(-5, 5), 0, rand(-5, 5)));
          B.fireProjectile(this, null, 'arrow', this.dmg * 0.75 * P, { point: p, from: p.clone().add(_w.set(-fx * 6, 22, -fz * 6)), aoe: 1.4, speedMul: 1.6 });
        });
        break;
      }
      case 'shadowRoll': {
        this.animator.play('Dodge_Backward', { ts: 1 });
        this.dash = { x: -fx, z: -fz, speed: 14, t: 0.35 };
        this.stealth = true; this.critNext = true;
        this.addStatus('invuln', 0.4);
        B.fx.burst(this.pos.clone().setY(this.pos.y + 0.8), { count: 30, color: 0x2a2a30, normal: true, size: 2.2, speed: 2, spread: 1, up: 0.6, gravity: -0.3, life: 1.6, grow: 1.2, alpha: 0.7 });
        for (const u of B.units) if (u.target === this) u.target = null;
        this.after(2.5, () => { this.stealth = false; });
        B.sfx('whoosh', this.pos, 0.8);
        break;
      }
      case 'snare': {
        clampAim(24);
        this.animator.play('Throw', { ts: 1.6 });
        this.after(0.35, () => { B.addField(aim.clone(), 5 + this.rank(ab), 0.6, { root: 4 * P, team: this.team, color: 0xa08a5a }); B.fx.burst(aim, { count: 14, color: 0x8a7a5a, normal: true, size: 0.6, speed: 3 }); B.sfx('latch', aim, 0.8); });
        break;
      }
      case 'ravens': {
        clampAim(30);
        this.animator.play('Ranged_Bow_Release_Up', { ts: 1.2 });
        B.ravenStorm(this, aim.clone(), 12, 4, 26 * P);
        break;
      }
      case 'lanternfire': {
        this.animator.play('Ranged_Magic_Spellcasting', { ts: 1.4 });
        this.after(0.15, () => {
          for (let k = 0; k < 4; k++) this.after(k * 0.12, () => {
            for (const u of B.query(this.pos.x, this.pos.z, 10)) {
              if (u.team === this.team || !u.alive) continue;
              const dx = u.pos.x - this.pos.x, dz = u.pos.z - this.pos.z;
              const d = Math.hypot(dx, dz);
              if (d > 9) continue;
              if ((dx * fx + dz * fz) / (d || 1) < 0.7) continue;
              u.takeDamage(this.dmg * 0.55 * P * (u.def.undead ? 1.25 : 1), this, { noReact: k > 0, color: '#ffae5a' });
              u.addStatus('burn', 4, 12 * P); u.status.burn && (u.status.burn.src = this);
            }
            const hp = this.handPos();
            for (let i = 0; i < 18; i++) {
              const a = yaw + rand(-0.5, 0.5), sp = rand(8, 14);
              B.fx.add.spawn(hp.x, hp.y, hp.z, Math.sin(a) * sp, rand(-0.5, 1.5), Math.cos(a) * sp, 1, rand(0.4, 0.7), 0.15, rand(0.6, 1.2), rand(0.4, 0.6), -1, 1.8, 1.5);
            }
          });
          B.fx.flash(this.pos, 0xff8a3a, 40, 16, 0.6);
          B.sfx('fire', this.pos, 1);
        });
        break;
      }
      case 'blink': {
        clampAim(13);
        B.fx.burst(this.pos.clone().setY(this.pos.y + 1), { count: 30, color: 0xff9a4a, speed: 3, life: 0.6, size: 0.5 });
        this.pos.set(aim.x, B.h(aim.x, aim.z), aim.z);
        B.collide(this);
        B.fx.burst(this.pos.clone().setY(this.pos.y + 1), { count: 30, color: 0xffc070, speed: 3, life: 0.6, size: 0.5 });
        B.fx.flash(this.pos, 0xff9a4a, 30, 12, 0.4);
        this.addStatus('invuln', 0.3);
        B.sfx('whoosh', this.pos, 0.9);
        break;
      }
      case 'graveChill': {
        this.animator.play('Ranged_Magic_Raise', { ts: 1.6 });
        const r = 7.5 + this.rank(ab);
        for (const u of B.query(this.pos.x, this.pos.z, r)) {
          if (u.team === this.team || !u.alive) continue;
          u.takeDamage(this.dmg * 0.8 * P, this, { noReact: true, color: '#9fe0ff' });
          u.addStatus('freeze', 2.5 * P);
          B.fx.burst(u.pos.clone().setY(u.pos.y + 1), { count: 6, color: 0x9fe0ff, speed: 1.5, life: 0.8, size: 0.5 });
        }
        B.fx.ring(this.pos, { color: 0x9fe0ff, radius: r, life: 0.9, width: 0.25 });
        B.fx.flash(this.pos, 0x7ac8ff, 50, 18, 0.7);
        B.sfx('ice', this.pos, 1);
        break;
      }
      case 'sunfall': {
        clampAim(34);
        this.animator.play('Ranged_Magic_Summon', { ts: 2.2 });
        B.meteor(this, aim.clone(), 9, (420 + this.dmg * 3) * P);
        break;
      }
      case 'leapSlam': {
        clampAim(14);
        this.animator.play('Melee_1H_Attack_Jump_Chop', { ts: 1.1 });
        const from = this.pos.clone(), to = aim.clone();
        this.leaping = { from, to, t: 0, dur: 0.6 };
        this.addStatus('invuln', 0.6);
        this.after(0.6, () => {
          this.leaping = null;
          this.pos.copy(to); this.pos.y = B.h(to.x, to.z);
          B.cleave(this, this.pos, 4.6, this.dmg * 1.8 * P, { stun: 1.1, knockOut: 7, melee: true });
          B.fx.ring(this.pos, { color: 0xd0a070, radius: 5, life: 0.5 });
          B.fx.burst(this.pos, { count: 26, color: 0x6a5846, normal: true, size: 1.4, speed: 5, life: 1, gravity: 4 });
          B.shake(0.45, this.pos); B.sfx('thud', this.pos, 1);
        });
        break;
      }
      case 'bloodrage': {
        this.animator.play('Cheering', { ts: 1.8 });
        this.rageBuff = { t: 8 * P };
        B.fx.flash(this.pos, 0xff3a2a, 40, 14, 0.8);
        B.sfx('roar', this.pos, 1);
        break;
      }
      case 'whirlingAxe': {
        this.spin = { t: 2.5, tick: 0, every: 0.32, radius: 3.6, dmg: this.dmg * 0.62 * P, anim: 'Melee_2H_Attack_Spinning', ts: 1.1 };
        break;
      }
      case 'ragnarok': {
        this.addStatus('invuln', 1.6);
        [0, 0.6, 1.2].forEach((t, i) => this.after(t, () => {
          this.animator.play('Melee_2H_Attack_Chop', { ts: 2 });
          this.after(0.25, () => {
            const r = 6 + i * 2.2;
            B.cleave(this, this.pos, r, (150 + this.dmg) * P * (1 - i * 0.15), { stun: 0.8, knockOut: 9, melee: true });
            B.fx.ring(this.pos, { color: 0xff7a3a, radius: r, life: 0.7, width: 0.2 });
            B.fx.burst(this.pos, { count: 30, color: 0x5a4a3a, normal: true, size: 1.6, speed: 7, life: 1.1, gravity: 4 });
            B.fx.flash(this.pos, 0xff6a2a, 60, 20, 0.5);
            B.shake(0.6, this.pos); B.sfx('thud', this.pos, 1);
          });
        }));
        break;
      }
    }
  }

  update(dt) {
    // buffs from abilities
    if (this.rageBuff) {
      this.rageBuff.t -= dt;
      this.lifesteal = 0.25;
      if (Math.random() < dt * 12) this.B.fx.burst(this.pos.clone().setY(this.pos.y + 1), { count: 1, color: 0xff3a2a, size: 0.4, speed: 1, life: 0.5, gravity: -2 });
      if (this.rageBuff.t <= 0) { this.rageBuff = null; this.lifesteal = 0; }
    }
    if (this.leaping) {
      const L = this.leaping; L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      this.pos.lerpVectors(L.from, L.to, k);
      this.pos.y = this.B.h(this.pos.x, this.pos.z) + Math.sin(k * Math.PI) * 4;
    }
    super.update(dt);
  }
}
