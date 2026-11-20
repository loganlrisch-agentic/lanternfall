// The player's commander: click-to-move, automatic attacks and one-tap spells that pick their own targets.
import * as THREE from 'three';
import { Unit } from './unit.js';
import { HEROES, ABILITIES } from './data/units.js';
import { TEAM, MAP } from './config.js';
import { clamp, angleLerp, rand } from '../core/util.js';

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
    this.cooldowns = {}; for (const a of base.abilities) this.cooldowns[a] = 0;
    this.talents = save.talents || {};
    this.combo = 0;
    this.attackLock = 0;
    this.atkTimer = 0;
    this.moveTo = null;
    this.range = base.melee ? base.reach : base.range;
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

  blockFactor() { return 1; }

  // Commander controls, Ink & Valor style: click the ground to walk there, click an
  // enemy to fight it, otherwise the hero fights whatever comes near on its own.
  control(dt, inp, cam) {
    if (!this.alive) return;
    const B = this.B;
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.atkTimer = (this.atkTimer || 0) - dt;
    this.attackLock -= dt;
    const stunned = this.disabled;

    // orders from the player
    if (inp.click) this.handleClick(inp.click, cam);
    const keyMove = inp.move.x || inp.move.y;
    if (keyMove) { this.moveTo = null; this.target = null; }

    // spells: one tap each, they find their own targets
    if (!stunned) {
      const keys = ['Q', 'E', 'F', 'R'];
      this.cls.abilities.forEach((ab, i) => { if (inp.ability[keys[i]]) this.tryCast(ab); });
    }

    // keep a sensible target
    const t0 = this.target;
    if (t0 && (!t0.alive || (t0.isStructure && t0.invulnerable) || t0.stealth)) this.target = null;
    if (!this.target && !this.moveTo && !keyMove && !this.dash && !this.leaping) this.target = this.findTarget();

    // decide where to go
    let mx = 0, mz = 0;
    if (keyMove) {
      // camera looks north from the south: screen right = +x, screen up = -z
      mx = inp.move.x; mz = -inp.move.y;
      const l = Math.hypot(mx, mz); mx /= l; mz /= l;
    } else if (this.moveTo) {
      const dx = this.moveTo.x - this.pos.x, dz = this.moveTo.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.5) { this.moveTo = null; this.clearMarker(); }
      else { mx = dx / d; mz = dz / d; }
    } else if (this.target) {
      const t = this.target, d = this.distTo(t);
      const reach = this.attackRange() + (t.isStructure ? 0.4 : (t.radius || 0.6) * 0.5);
      if (d > reach) {
        const gp = t.isStructure ? t.aimPoint(this.pos) : t.pos;
        const dx = gp.x - this.pos.x, dz = gp.z - this.pos.z, dl = Math.hypot(dx, dz) || 1;
        mx = dx / dl; mz = dz / dl;
      } else if (!stunned) {
        this.faceToward(t.isStructure ? t.aimPoint(this.pos) : t.pos, dt, 14);
        if (this.atkTimer <= 0 && !this.pendingHit) this.autoAttack(t);
      }
    }

    // velocity
    let speed = this.speed;
    if (this.attackLock > 0) speed *= 0.25;
    if (this.spin) speed *= 0.65;
    let vx = mx * speed, vz = mz * speed;
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
    const sp = Math.hypot(vx, vz);
    if (sp > 0.5 && !this.dash && this.attackLock <= 0) this.facing = angleLerp(this.facing, Math.atan2(vx, vz), Math.min(1, dt * 12));

    // locomotion animation
    const anim = this.animator;
    if (!anim.shot) {
      if (sp > 0.5) {
        anim.loop(this.cls.anim === 'bow' ? 'Running_HoldingBow' : 'Running_A', clamp(sp / 5.6, 0.7, 1.6));
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

  handleClick(c, cam) {
    const B = this.B;
    const picked = B.pickAt(c.x, c.y);
    if (picked && picked.team !== this.team) {
      this.target = picked; this.moveTo = null;
      B.markTarget(picked);
      B.sfx('ui', null, 0.25);
      return;
    }
    const p = cam.groundAt(c.x, c.y);
    p.x = clamp(p.x, MAP.xMin + 2, MAP.xMax - 2); p.z = clamp(p.z, -MAP.playZ, MAP.playZ);
    this.moveTo = p; this.target = null;
    B.markMove(p);
  }
  clearMarker() { this.B.markMove(null); }

  attackRange() { return this.cls.melee ? this.cls.reach : this.cls.range; }
  aggroRange() { return this.cls.melee ? 10 : this.cls.range + 2; }

  findTarget() {
    const B = this.B, r = this.aggroRange();
    let best = null, bd = Infinity;
    for (const u of B.query(this.pos.x, this.pos.z, r + 2)) {
      if (u.team === this.team || !u.alive || u.stealth) continue;
      const d = Math.hypot(u.pos.x - this.pos.x, u.pos.z - this.pos.z) - (u.target === this ? 2 : 0);
      if (d < bd && d < r) { bd = d; best = u; }
    }
    if (!best && B.rift && !B.rift.invulnerable && B.rift.distTo(this.pos) < r) best = B.rift;
    return best;
  }

  faceToward(p, dt, rate = 10) {
    this.facing = angleLerp(this.facing, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), Math.min(1, dt * rate));
  }

  autoAttack(t) {
    const cls = this.cls;
    const name = cls.combo[this.combo % cls.combo.length];
    this.combo++;
    const dur = this.animator.dur(name);
    const interval = cls.rate / (1 + this.buffs.atk) / (this.rageBuff ? 1.5 : 1);
    const ts = clamp(dur / (interval * (cls.release ? 0.55 : 0.9)), 1, 2.6);
    this.animator.play(name, { ts });
    this.atkTimer = interval;
    this.attackLock = Math.min(interval * 0.6, dur / ts * 0.7);
    const tp = t.isStructure ? t.aimPoint(this.pos) : t.pos;
    this.facing = Math.atan2(tp.x - this.pos.x, tp.z - this.pos.z);
    const hitT = (this.anims.hitT || 0.4) * dur / ts;
    if (cls.melee) {
      const strong = this.combo % cls.combo.length === 0;
      this.pendingHit = { t: hitT, fn: () => this.meleeSweep(this.dmg * (strong ? 1.3 : 1), cls.reach, cls.arc) };
      this.B.sfx('swing', this.pos, 0.6);
    } else {
      this.pendingHit = { t: cls.release ? dur / ts * 0.92 : hitT * 0.6, fn: () => {
        if (!t.alive && !t.isStructure) return;
        if (cls.release) this.animator.play(cls.release, { ts: 1.5 });
        let dmg = this.dmg;
        if (this.critNext) { dmg *= 2.5; this.critNext = false; }
        this.B.fireProjectile(this, t, cls.projectile, dmg, { aoe: this.classId === 'mage' ? 1.8 : 0, speedMul: 1.4 });
      } };
    }
  }

  after(t, fn) { (this.timers || (this.timers = [])).push({ t, fn }); }

  handPos() {
    const b = this.root.getObjectByName('handslotr') || this.root;
    return b.getWorldPosition(new THREE.Vector3());
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
      const knock = _v.set(dx, 0, dz).normalize().multiplyScalar(extra.knock || 1.6).clone();
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

  // ---------------- auto-targeting for spells ----------------
  enemiesWithin(x, z, r) {
    const out = [];
    for (const u of this.B.query(x, z, r + 1)) if (u.team !== this.team && u.alive && !u.stealth && Math.hypot(u.pos.x - x, u.pos.z - z) <= r) out.push(u);
    return out;
  }
  nearestEnemy(r) {
    const t = this.target;
    if (t && t.alive && !t.isStructure && this.distTo(t) <= r) return t;
    let best = null, bd = r;
    for (const u of this.enemiesWithin(this.pos.x, this.pos.z, r)) { const d = Math.hypot(u.pos.x - this.pos.x, u.pos.z - this.pos.z); if (d < bd) { bd = d; best = u; } }
    return best;
  }
  // centre of the thickest knot of enemies within range (the rift counts when it is open)
  bestCluster(range, radius) {
    const cands = this.enemiesWithin(this.pos.x, this.pos.z, range);
    let best = null, bestScore = 0;
    for (const c of cands) {
      const n = this.enemiesWithin(c.pos.x, c.pos.z, radius);
      let cx = 0, cz = 0; for (const u of n) { cx += u.pos.x; cz += u.pos.z; }
      cx /= n.length; cz /= n.length;
      const score = n.reduce((a, u) => a + (u.isLarge || u.isBoss ? 2.5 : 1), 0) - Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z) * 0.02;
      if (score > bestScore) { bestScore = score; best = new THREE.Vector3(cx, 0, cz); }
    }
    const rift = this.B.rift;
    if (!best && rift && !rift.invulnerable && rift.distTo(this.pos) < range) best = rift.aimPoint(this.pos).clone();
    if (best) best.y = this.B.h(best.x, best.z);
    return best;
  }

  tryCast(ab) {
    if (this.cooldowns[ab] > 0) { this.B.sfx('ui', null, 0.15); return false; }
    if (this.dash || this.leaping) return false;
    const ok = this.cast(ab);
    if (!ok) { this.B.hud.toast('No enemies in reach.', 1.0); this.B.sfx('ui', null, 0.2); }
    return ok;
  }

  // ---------------- abilities ----------------
  cast(ab) {
    const B = this.B;
    const P = this.abilityPower(ab);
    // work out where the spell goes before committing to it
    const AREA = { volley: [32, 6], snare: [24, 5], ravens: [30, 12], sunfall: [34, 9], leapSlam: [16, 4.6] };
    const AIMED = { shieldCharge: 14, lanternfire: 10 };
    let aim = null, yaw = this.facing;
    if (AREA[ab]) {
      aim = this.bestCluster(AREA[ab][0], AREA[ab][1]);
      if (!aim) return false;
      yaw = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
    } else if (AIMED[ab]) {
      const t = this.nearestEnemy(AIMED[ab]);
      if (!t) return false;
      aim = t.pos.clone();
      yaw = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
    } else if (ab === 'blink' || ab === 'shadowRoll') {
      // slip away from the nearest threat, back toward your own lines
      const t = this.nearestEnemy(14);
      let ax = -1, az = 0;
      if (t) { ax = this.pos.x - t.pos.x; az = this.pos.z - t.pos.z; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; ax = ax * 0.6 - 0.4; const l2 = Math.hypot(ax, az) || 1; ax /= l2; az /= l2; }
      const dist = ab === 'blink' ? 12 : 5;
      aim = new THREE.Vector3(clamp(this.pos.x + ax * dist, MAP.castleX + 4, MAP.xMax - 4), 0, clamp(this.pos.z + az * dist, -MAP.playZ, MAP.playZ));
      aim.y = B.h(aim.x, aim.z);
      yaw = t ? Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z) : Math.PI / 2;
    }
    if (!aim) aim = this.pos.clone();
    this.facing = yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const clampAim = (max) => { const d = Math.hypot(aim.x - this.pos.x, aim.z - this.pos.z); if (d > max) { aim.x = this.pos.x + (aim.x - this.pos.x) / d * max; aim.z = this.pos.z + (aim.z - this.pos.z) / d * max; } aim.y = B.h(aim.x, aim.z); return aim; };
    this.cooldowns[ab] = this.abilityCd(ab);
    this.moveTo = null;
    B.onAbility(this, ab);
    switch (ab) {
      case 'shieldCharge': {
        this.animator.play('Melee_1H_Attack_Stab', { ts: 1.1 });
        const hit = new Set();
        this.addStatus('invuln', 0.45);
        this.dash = { x: fx, z: fz, speed: 22, t: clamp(Math.hypot(aim.x - this.pos.x, aim.z - this.pos.z) / 22 + 0.08, 0.2, 0.55), onTick: () => {
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
        { const rx = aim.x - this.pos.x, rz = aim.z - this.pos.z, rl = Math.hypot(rx, rz) || 1; this.dash = { x: rx / rl, z: rz / rl, speed: 14, t: 0.35 }; }
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
    return true;
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
