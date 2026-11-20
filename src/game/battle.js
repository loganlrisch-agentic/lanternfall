// Battle orchestration: structures, waves out of the fog, calling in support with coin, the army formation, shrines, towers, bosses.
import * as THREE from 'three';
import { Unit } from './unit.js';
import { Hero } from './hero.js';
import { Projectiles } from './projectiles.js';
import { CameraRig } from './camera.js';
import { Army } from './army.js';
import { ALLIES, ENEMIES, allyById, RISEN } from './data/units.js';
import { BARKS } from './data/campaign.js';
import { MAP, roadZ, TEAM } from './config.js';
import { SpatialHash, clamp, rand, pick, dist2 } from '../core/util.js';
import { audio } from '../core/audio.js';
import { darkUniforms } from '../core/materials.js';

const _v = new THREE.Vector3();
export const DIFFICULTY = {
  story: { label: 'Story', enemyHp: 0.7, enemyDmg: 0.65, castle: 1.4, cp: 1.25 },
  normal: { label: 'Warden', enemyHp: 1, enemyDmg: 1, castle: 1, cp: 1 },
  hard: { label: 'Nightmare', enemyHp: 1.3, enemyDmg: 1.3, castle: 0.85, cp: 0.9 },
};

class Castle {
  constructor(B, hp) {
    this.B = B; this.isStructure = true; this.team = TEAM.PLAYER; this.alive = true; this.radius = 3;
    this.pos = B.level.gatePos.clone();
    this.maxHp = hp; this.hp = hp;
    this.def = { name: 'Dawnhold' };
    this.hitT = 0;
  }
  distTo(p) { if (Math.abs(p.z) > MAP.wallHalf + 1.5) return 99; return Math.max(0, p.x - (MAP.castleX + 2.6)); }
  aimPoint(p) { return _v.set(MAP.castleX + 2.7, 0, clamp(p.z, -27, 27)); }
  takeDamage(a, src) {
    if (!this.alive || this.B.state !== 'fight') return 0;
    a *= this.B.castleDmgMul;
    this.hp -= a;
    this.hitT = 0.3;
    if (Math.random() < 0.3) this.B.sfx('gate', src ? src.pos : this.pos, 0.6);
    if (src) this.B.fx.burst(this.aimPoint(src.pos).clone().setY(this.pos.y + rand(1, 4)), { count: 4, color: 0x8a8070, normal: true, size: 0.7, speed: 2, life: 0.7, gravity: 4 });
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.B.defeat(); }
    return a;
  }
}

// A chapter is a night to survive. The chapter's waves, plus reinforcement waves
// woven in (copies of earlier waves, half again as strong), so the defense lasts.
const REINFORCE_MSG = ['The fog thickens. They are not done with you.', 'More of them. Hold the line.', 'The dead keep coming. Steady.'];
function nightWaves(chapter) {
  const src = chapter.waves, out = [];
  src.forEach((w, i) => {
    out.push(w);
    if (i === 1 || i === 3) out.push({ msg: REINFORCE_MSG[out.length % REINFORCE_MSG.length], spawn: w.spawn.map(([t, n]) => [t, Math.ceil(n * 1.5)]) });
  });
  return out;
}

class Rift {
  constructor(B, hp) {
    this.B = B; this.isStructure = true; this.team = TEAM.ENEMY; this.alive = true; this.radius = 4.5;
    this.pos = B.level.fortressCore.clone();
    this.maxHp = hp; this.hp = hp; this.invulnerable = true;
    this.def = { name: B.chapter.rift };
  }
  distTo(p) { return Math.max(0, Math.sqrt(dist2(p.x, p.z, this.pos.x, this.pos.z)) - this.radius); }
  aimPoint(p) { const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz) || 1; return _v.set(this.pos.x + dx / d * this.radius, 0, this.pos.z + dz / d * this.radius); }
  takeDamage(a, src) {
    if (!this.alive) return 0;
    if (this.invulnerable) {
      if (src && src.isHero && Math.random() < 0.3) this.B.hud.toast('Nothing harms the rift. Hold the fort; its master will come to you.', 1.8);
      return 0;
    }
    this.hp -= a;
    this.B.hud.damageNumber(this.pos.clone().setY(this.pos.y + 5), a, '#d8b4ff');
    if (Math.random() < 0.2) this.B.fx.burst(this.B.level.riftPos, { count: 8, color: new THREE.Color(this.B.level.riftColor).getHex(), speed: 4, life: 0.7, size: 0.6 });
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.B.victory(); }
    return a;
  }
}

export class Battle {
  constructor(game, chapter, save) {
    this.game = game;
    this.world = game.world;
    this.scene = this.world.scene;
    this.fx = this.world.fx;
    this.hud = game.hud;
    this.chapter = chapter;
    this.save = save;
    this.flags = save.flags || {};
    this.diff = DIFFICULTY[save.difficulty || 'normal'];
    this.level = this.world.loadLevel(chapter);
    this.h = (x, z) => this.level.h(x, z);
    this.units = [];
    this.hash = new SpatialHash(6);
    this.proj = new Projectiles(this);
    this.fields = [];
    this.timers = [];
    const up = save.upgrades || {};
    this.enemyMul = { hp: (1 + 0.1 * (chapter.n - 1)) * this.diff.enemyHp, dmg: (1 + 0.08 * (chapter.n - 1)) * this.diff.enemyDmg };
    this.castleDmgMul = 1;
    this.castle = new Castle(this, Math.round(2600 * (1 + 0.2 * (up.walls || 0)) * this.diff.castle));
    this.rift = new Rift(this, Math.round(chapter.fortressHP * this.diff.enemyHp));
    this.towerRank = up.towers || 0;
    // the war chest: coin trickles in, kills pay a bounty, support costs coin
    // tuned so a full army is something you build toward and lose, not a given:
    // roughly a third of the old income, with kills and shrines topping it up
    this.coinMax = 24 + 6 * (up.horn || 0);
    this.coins = 10 + 2 * (up.horn || 0);
    // grows a little each chapter, alongside the enemy's strength
    this.coinBase = 0.16 * (1 + 0.16 * (chapter.n - 1)) * (1 + 0.15 * (up.lantern || 0)) * this.diff.cp;
    this.popCap = 22 + 4 * (up.barracks || 0);
    this.relicBonus = this.flags.restAldous ? 1.15 : 1;
    this.enemyRim = { dawnhold: '#8a5cff', thornwood: '#5aff9a', highforge: '#7ad8ff', redmaw: '#ff6a3a', drowned: '#5affd0', citadel: '#ff3a5a' }[chapter.biome] || '#8a5cff';
    this.army = new Army(this);
    this.cards = (save.loadout || []).map(id => allyById(id)).filter(Boolean).map(def => ({ def, cd: 0 }));
    this.hero = new Hero(this, save.hero, save);
    this.hero.place(this.level.heroSpawn.x, this.level.heroSpawn.z, Math.PI / 2);
    this.units.push(this.hero);
    this.heroLight = new THREE.PointLight(0xffb36b, 22, 17, 1.4);
    this.scene.add(this.heroLight);
    this.cam = new CameraRig(this.world.camera, this);
    this.cam.snapTo(this.hero.pos);
    this.buildMarkers();
    this._ears = new THREE.Vector3();
    this.waves = nightWaves(chapter);
    this.waveIdx = -1;
    this.waveTimer = 16;
    this.waveSize = 0;
    this.spawnQueue = [];
    this.bossSpawned = false;
    this.boss = null;
    this.frontLine = MAP.castleX + 22;   // where free-roaming allies gather: the field before the gate
    this.stats = { kills: 0, gold: 0, lost: 0, summoned: 0, time: 0, xp: 0 };
    this.state = 'intro';
    this.respawnT = 0;
    this.trickleT = 0;
    this.castleBarkT = 0;
    this.slowmo = 1;
    this.shakeAmt = 0;
    audio.startAmbience(chapter.biome);
  }

  // ---------------- queries ----------------
  query(x, z, r) { return this.hash.query(x, z, r, []); }
  mostWounded(src, range) {
    let best = null, bp = 0.97;
    for (const u of this.query(src.pos.x, src.pos.z, range)) {
      if (u.team !== src.team || !u.alive || u.anims?.siege) continue;
      if (u.hpPct < bp) { bp = u.hpPct; best = u; }
    }
    return best;
  }

  collide(u) {
    const p = u.pos;
    p.z = clamp(p.z, -33, 33);
    p.x = clamp(p.x, -104, 100);
    const wx = MAP.castleX, half = 2.7 + u.radius;
    if (Math.abs(p.z) < MAP.wallHalf + 1) {
      const inGate = u.team === TEAM.PLAYER && Math.abs(p.z) < 3.0;
      if (!inGate && Math.abs(p.x - wx) < half) {
        if (u.team === TEAM.ENEMY) p.x = wx + half;
        else p.x = (u.prevX ?? p.x) >= wx ? wx + half : wx - half;
      }
    }
    if (u.team === TEAM.ENEMY && p.x < wx + half) p.x = wx + half;
    if (p.x < wx - 1 && Math.abs(p.z) > 28.5) p.z = Math.sign(p.z) * 28.5;
    for (const c of this.level.colliders) {
      const dx = p.x - c.x, dz = p.z - c.z, r = c.r + u.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6) { const d = Math.sqrt(d2); p.x = c.x + dx / d * r; p.z = c.z + dz / d * r; }
    }
    const rd = this.rift;
    if (rd.alive && rd.invulnerable && u.team === TEAM.PLAYER) {
      // the ward keeps the living out until its last wave breaks
      const sh = this.level.shield.position;
      const dx = p.x - sh.x, dz = p.z - sh.z, r = 13 + u.radius, d2 = dx * dx + dz * dz;
      if (d2 < r * r) { const d = Math.sqrt(d2) || 1; p.x = sh.x + dx / d * r; p.z = sh.z + dz / d * r; }
    }
    if (rd.alive) {
      const dx = p.x - rd.pos.x, dz = p.z - rd.pos.z, r = 3.4 + u.radius, d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6) { const d = Math.sqrt(d2); p.x = rd.pos.x + dx / d * r; p.z = rd.pos.z + dz / d * r; }
    }
    u.prevX = p.x;
  }

  // ---------------- events ----------------
  onDamage(u, a, src, o) {
    if (u.isHero) {
      this.hud.damageNumber(u.pos.clone().setY(u.pos.y + 2.4), a, '#ff5a4a');
      this.hud.hurt(Math.min(1, a / u.maxHp * 6));
    } else if (src && src.isHero) {
      this.hud.damageNumber(u.pos.clone().setY(u.pos.y + (u.isLarge ? 4 : 2.3)), a, o.color || (a > src.dmg * 1.8 ? '#ffd27a' : '#f2e8d8'), a > src.dmg * 1.8);
    } else if (u.isBoss && Math.random() < 0.4) {
      this.hud.damageNumber(u.pos.clone().setY(u.pos.y + 4.5), a, '#c8c0b0');
    }
  }
  onHeal(u, a) { if (u.isHero || a > 25) this.hud.damageNumber(u.pos.clone().setY(u.pos.y + 2.2), a, '#8aff9a'); }

  onDeath(u, killer) {
    if (u.team === TEAM.ENEMY) {
      this.stats.kills++;
      let g = u.gold || 0;
      if (killer && killer.def?.special?.gold) g *= 1 + killer.def.special.gold;
      this.stats.gold += g;
      const share = killer && (killer.isHero || killer.pos.distanceTo(this.hero.pos) < 26);
      if (share) this.hero.gainXp && this.hero.gainXp(u.xp);
      this.stats.xp += u.xp;
      if (u === this.bossUnit && this.state === 'fight') { this.hud.banner('DAWN', 'The rift collapses behind its master.', 3); this.after(1.2, () => this.victory()); }
      // bounty follows how dangerous the kill was (a thrall pays little, an abomination a lot)
      if (this.state === 'fight') this.coins = Math.min(this.coinMax, this.coins + (u.isBoss ? 5 : Math.min(2, (u.def.gold || 2) * 0.06)));
      const undead = u.def.undead;
      this.fx.burst(u.pos.clone().setY(u.pos.y + 1), { count: u.isLarge ? 34 : 14, color: undead ? 0x1a1420 : 0x2a1010, normal: true, size: u.isLarge ? 2.4 : 1.4, speed: 1.6, spread: 1, up: 1.2, gravity: -0.6, life: 1.6, grow: 1.2, alpha: 0.75 });
      this.fx.burst(u.pos.clone().setY(u.pos.y + 1.2), { count: 8, color: new THREE.Color(this.enemyRim).getHex(), speed: 2.5, up: 2, gravity: -1, life: 0.9, size: 0.4 });
      this.sfx(undead ? 'death' : u.def.beast ? 'scream' : 'manDeath', u.pos, u.isLarge ? 1 : 0.6);
      if (u.isBoss) {
        this.hud.banner(u.def.name.toUpperCase(), 'has fallen', 3.2);
        this.boss = null;
        this.hud.bossBar(null);
        audio.setMood('battle', this.chapter.biome);
        this.shake(0.8, u.pos);
        this.slowmo = 0.3; this.after(1.2, () => { this.slowmo = 1; });
        this.after(2.5, () => this.hud.voice(pick(BARKS.bossDead)));
      }
    } else if (u.isHero) {
      this.respawnT = 10;
      this.hud.voice(pick(BARKS.heroDown));
      this.sfx('manDeath', u.pos, 1);
      this.hud.toast('You have fallen. Returning to the keep...', 3);
    } else {
      this.stats.lost++;
      if (this.game.testMode && killer && killer.def) { const d = window.__deaths || (window.__deaths = {}); d[killer.def.name] = (d[killer.def.name] || 0) + 1; }
      this.sfx(u.def.anim === 'siege' ? 'boom' : 'manDeath', u.pos, 0.4);
    }
  }

  onAbility(hero, ab) { this.hud.flashAbility(ab); }

  // ---------------- combat helpers ----------------
  cleave(src, center, radius, dmg, o = {}) {
    const team = o.team ?? src.team;
    let n = 0;
    for (const u of this.query(center.x, center.z, radius + 1.5)) {
      if (u.team === team || !u.alive) continue;
      const d = Math.sqrt(dist2(u.pos.x, u.pos.z, center.x, center.z)) - u.radius * 0.5;
      if (d > radius) continue;
      const fall = o.falloff ? 1 - 0.5 * clamp(d / radius, 0, 1) : 1;
      const dir = _v.set(u.pos.x - center.x, 0, u.pos.z - center.z).normalize();
      const knock = o.knockOut ? dir.clone().multiplyScalar(o.knockOut) : (src && src.isLarge ? dir.clone().multiplyScalar(3) : null);
      const mult = src && src.damageMult ? src.damageMult(u) : 1;
      u.takeDamage(dmg * fall * mult, src, { melee: o.melee, knock, dir: dir.clone(), noReact: n > 3 });
      if (o.stun) u.addStatus('stun', o.stun);
      if (o.burn) { u.addStatus('burn', 3, o.burn); if (u.status.burn) u.status.burn.src = src; }
      if (src?.def?.special?.chill) u.addStatus('chill', 2, src.def.special.chill);
      n++;
    }
    // structures
    if (team === TEAM.PLAYER && this.rift.alive && !this.rift.invulnerable && this.rift.distTo(center) < radius) this.rift.takeDamage(dmg * (o.vsStructure || src?.def?.vsStructure || 1), src);
    if (team === TEAM.ENEMY && this.castle.alive && this.castle.distTo(center) < radius) this.castle.takeDamage(dmg * (o.vsStructure || src?.def?.vsStructure || 1) * 0.6, src);
    return n;
  }

  explode(pos, dmg, radius, src, color = 0xffa040, holy = false) {
    this.cleave(src, pos, radius, dmg, { falloff: true, team: src.team });
    this.fx.burst(pos.clone().setY(pos.y + 0.8), { count: 16, color, speed: 6, spread: 1, up: 1.2, gravity: 2, life: 0.6, size: 0.45 });
    this.fx.ring(pos, { color, radius: radius * 1.1, life: 0.5, opacity: 0.6 });
    this.fx.flash(pos, color, 30, radius * 4, 0.35);
    this.sfx(holy ? 'holy' : 'boom', pos, holy ? 0.6 : 0.8);
    if (!holy) this.shake(0.3, pos);
  }

  hitSpark(t, src) {
    const p = t.pos.clone().setY(t.pos.y + (t.isLarge ? 2.2 : 1.1));
    const undead = t.def && t.def.undead;
    this.fx.burst(p, { count: 5, color: undead ? 0xd8d0c0 : t.team === TEAM.ENEMY ? 0x7a1a1a : 0x8a1515, speed: 3, life: 0.35, size: 0.18, gravity: 8, normal: !undead });
    this.fx.burst(p, { count: 3, color: 0xffe6b0, speed: 4, life: 0.18, size: 0.12, gravity: 0 });
    if (src && (src.isHero || Math.random() < 0.25)) this.sfx(t.armor > 4 ? 'clang' : 'hit', p, src.isHero ? 0.9 : 0.35);
  }

  impact(p, at, big) {
    const k = p.def.impact;
    if (k === 'fire' || k === 'boom') {
      this.fx.burst(at, { count: big ? 30 : 12, color: 0xff8a3a, speed: big ? 6 : 3, life: 0.6, size: big ? 0.8 : 0.5, gravity: 1 });
      this.fx.burst(at, { count: big ? 14 : 5, color: 0x2a2220, normal: true, speed: 2, life: 1.2, size: 1.6, grow: 1.5, gravity: -0.5, alpha: 0.6 });
      this.fx.flash(at, 0xff8a3a, big ? 60 : 25, big ? 18 : 10, 0.4);
      if (big) { this.fx.ring(at, { color: 0xff8a3a, radius: p.aoe || 3, life: 0.4 }); this.sfx('boom', at, 0.6); this.shake(0.2, at); }
    } else if (k === 'hex' || k === 'blood' || k === 'holy' || k === 'thorn' || k === 'arcane') {
      const c = { hex: 0xa04aff, blood: 0xff2a3a, holy: 0xffe6a0, thorn: 0x7aff8a, arcane: 0x7ab8ff }[k];
      this.fx.burst(at, { count: big ? 22 : 8, color: c, speed: big ? 5 : 2.5, life: 0.5, size: 0.4, gravity: 0 });
      if (big) this.fx.ring(at, { color: c, radius: p.aoe || 2, life: 0.4 });
    } else {
      this.fx.burst(at, { count: 3, color: 0xcfc4b0, speed: 2, life: 0.3, size: 0.15, gravity: 6 });
      this.sfx('arrow', at, 0.3);
    }
  }

  fireProjectile(src, target, type, dmg, o = {}) { return this.proj.fire(src, target, type, dmg, o); }

  addField(pos, radius, dur, o) {
    const ring = this.fx.ring(pos, { color: o.color || 0x7ab8ff, radius, life: dur + 0.01, opacity: 0.55, width: 0.12 });
    const f = { pos: pos.clone(), radius, t: dur, ...o, tick: 0 };
    this.fields.push(f);
    if (o.root) for (const u of this.query(pos.x, pos.z, radius)) if (u.team !== o.team && u.alive) u.addStatus('root', o.root);
    return f;
  }

  updateFields(dt) {
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      f.t -= dt; f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.3;
        for (const u of this.query(f.pos.x, f.pos.z, f.radius)) {
          if (!u.alive) continue;
          if (f.slow && u.team !== f.team) u.addStatus('slow', 0.5, f.slow);
          if (f.heal && u.team === f.team) u.heal(f.heal * 0.3, true);
          if (f.dmg && u.team !== f.team) { u.takeDamage(f.dmg, f.src, { noReact: true }); if (f.fear) u.addStatus('slow', 0.6, 0.5); }
        }
        if (f.heal) this.fx.burst(f.pos.clone().add(new THREE.Vector3(rand(-f.radius, f.radius) * 0.6, 0.3, rand(-f.radius, f.radius) * 0.6)), { count: 2, color: 0x7aff9a, speed: 0.5, up: 3, gravity: -1.5, life: 1, size: 0.35 });
        if (f.ravens) {
          for (let k = 0; k < 10; k++) {
            const a = Math.random() * 6.28, r = Math.random() * f.radius;
            this.fx.norm.spawn(f.pos.x + Math.cos(a) * r, f.pos.y + rand(0.5, 3), f.pos.z + Math.sin(a) * r, Math.cos(a + 1.6) * 8, rand(-1, 2), Math.sin(a + 1.6) * 8, 0.02, 0.02, 0.03, rand(0.4, 0.7), 0.5, 0, 0.5, 0, 0.95);
          }
        }
      }
      if (f.t <= 0) this.fields.splice(i, 1);
    }
  }

  ravenStorm(src, pos, radius, dur, tickDmg) {
    this.addField(pos, radius, dur, { dmg: tickDmg, src, team: src.team, ravens: true, fear: true, color: 0x6a2a4a });
    this.sfx('shriek', pos, 1); this.after(0.5, () => this.sfx('shriek', pos, 0.7));
  }

  meteor(src, pos, radius, dmg) {
    this.fx.ring(pos, { color: 0xff6a2a, radius, life: 1.3, opacity: 0.8, width: 0.08 });
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2, 0.4) }));
    const from = pos.clone().add(new THREE.Vector3(-18, 45, 6));
    rock.position.copy(from);
    this.scene.add(rock);
    let t = 0;
    const tick = (dt) => {
      t += dt;
      const k = Math.min(1, t / 1.2);
      rock.position.lerpVectors(from, pos, k * k);
      this.fx.burst(rock.position, { count: 4, color: 0xff7a2a, speed: 1, life: 0.6, size: 1.2, gravity: -1 });
      if (k >= 1) {
        this.scene.remove(rock); rock.geometry.dispose();
        this.cleave(src, pos, radius, dmg, { falloff: true, burn: 16, knockOut: 8 });
        this.fx.burst(pos.clone().setY(pos.y + 1), { count: 70, color: 0xff7a2a, speed: 10, life: 1.0, size: 1.0, gravity: 2 });
        this.fx.burst(pos.clone().setY(pos.y + 1), { count: 30, color: 0x221a18, normal: true, speed: 4, life: 2.2, size: 3, grow: 2, gravity: -0.6, alpha: 0.7 });
        this.fx.ring(pos, { color: 0xffa040, radius: radius * 1.2, life: 0.8, width: 0.3 });
        this.fx.flash(pos, 0xff7a2a, 160, 50, 1.0);
        this.screenFlash('#ffb070', 0.35);
        this.shake(1.0, pos); this.sfx('boom', pos, 1);
        return true;
      }
      return false;
    };
    this.timers.push({ tick });
  }

  buildTurret(eng) {
    const def = { name: 'Bolt Turret', model: 'crossbow_2handed', anim: 'siege', hp: 200, armor: 4, dmg: 15, range: 26, rate: 0.9, speed: 0, radius: 0.9, scale: 3, projectile: 'turretBolt' };
    const t = new Unit(this, def, TEAM.PLAYER, { level: eng.level });
    const x = eng.pos.x + Math.sin(eng.facing) * 1.6, z = eng.pos.z + Math.cos(eng.facing) * 1.6;
    t.place(x, z, eng.facing);
    t.body.rotation.y = 0;
    t.body.position.y = 1.2;
    const crate = this.level.place('crate_A_big', 0, 0, { scale: 3, parent: t.root });
    crate.position.set(0, 0, 0);
    t.lifetime = eng.def.special.turret.dur;
    t.muzzle = new THREE.Vector3();
    this.units.push(t);
    this.fx.burst(t.pos.clone().setY(t.pos.y + 1), { count: 12, color: 0xffc870, speed: 2, life: 0.6, size: 0.4 });
    this.sfx('latch', t.pos, 0.8);
    if (eng.animator) eng.animator.play('Hammering', { ts: 2 });
    // engineers also patch the gate when standing near it
    if (eng.pos.x < MAP.castleX + 12) this.castle.hp = Math.min(this.castle.maxHp, this.castle.hp + 80);
  }

  assassinate(u) {
    let best = null, bd = 28 * 28;
    for (const o of this.units) {
      if (o.team === u.team || !o.alive || !o.isRanged || o.isBoss) continue;
      const d = dist2(o.pos.x, o.pos.z, u.pos.x, u.pos.z);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return;
    this.fx.burst(u.pos.clone().setY(u.pos.y + 1), { count: 16, color: 0x15151a, normal: true, size: 1.2, speed: 2, life: 0.8, grow: 1, alpha: 0.7 });
    u.place(best.pos.x - Math.sin(best.facing) * 1.4, best.pos.z - Math.cos(best.facing) * 1.4);
    u.target = best; u.atkCd = 0;
    this.fx.burst(u.pos.clone().setY(u.pos.y + 1), { count: 16, color: 0x15151a, normal: true, size: 1.2, speed: 2, life: 0.8, grow: 1, alpha: 0.7 });
    this.sfx('whoosh', u.pos, 0.5);
  }

  raiseDead(caster, count) {
    if (caster.animator) caster.animator.play(caster.anims.raise || 'Ranged_Magic_Raise', { ts: 1.4 });
    this.fx.ring(caster.pos, { color: 0x8a5cff, radius: 5, life: 0.9 });
    for (let i = 0; i < count; i++) {
      const a = rand(0, 6.28), r = rand(2, 5);
      const x = caster.pos.x + Math.cos(a) * r, z = caster.pos.z + Math.sin(a) * r;
      if (caster.team === TEAM.PLAYER) this.spawnAllyMinion(RISEN, x, z, 28, caster.level);
      else { const e = this.spawnEnemy('thrall', x, z, true); if (e) e.gold = 0; }
    }
    this.sfx('rise', caster.pos, 0.8);
  }

  summonMinions(caster, type, count) {
    if (caster.animator) caster.animator.play(caster.anims.cast || 'Ranged_Magic_Spellcasting', { ts: 1.2 });
    for (let i = 0; i < count; i++) {
      const a = rand(0, 6.28), r = rand(3, 6);
      const x = caster.pos.x + Math.cos(a) * r, z = caster.pos.z + Math.sin(a) * r;
      if (caster.team === TEAM.PLAYER) { const d = allyById(type); if (d) this.spawnAllyMinion(d, x, z, 30, caster.level); }
      else this.spawnEnemy(type, x, z, true);
    }
    this.fx.ring(caster.pos, { color: new THREE.Color(this.enemyRim).getHex(), radius: 7, life: 1 });
    this.sfx('shriek', caster.pos, 0.7);
  }

  telegraphNova(caster, dmg, radius) {
    const ring = this.fx.ring(caster.pos, { color: 0xff2a2a, radius, life: 1.1, opacity: 0.7, width: 0.06, filled: false });
    if (caster.animator) caster.animator.play(caster.anims.raise || caster.anims.cast || 'Melee_2H_Slam', { ts: 1.1 });
    this.sfx('shriek', caster.pos, 0.6);
    this.after(1.0, () => {
      if (!caster.alive) return;
      this.cleave(caster, caster.pos, radius, dmg, { falloff: true, knockOut: 6 });
      this.fx.burst(caster.pos.clone().setY(caster.pos.y + 1), { count: 40, color: new THREE.Color(this.enemyRim).getHex(), speed: 8, life: 0.7, size: 0.7, gravity: 0 });
      this.fx.ring(caster.pos, { color: new THREE.Color(this.enemyRim).getHex(), radius: radius * 1.1, life: 0.6, width: 0.3 });
      this.fx.flash(caster.pos, new THREE.Color(this.enemyRim).getHex(), 80, radius * 3, 0.6);
      this.shake(0.5, caster.pos); this.sfx('boom', caster.pos, 0.7);
    });
  }

  // a temporary ally (raised dead, summoned beasts): fights freely, not part of the formation or the army count
  spawnAllyMinion(def, x, z, lifetime, level = 1) {
    const u = new Unit(this, def, TEAM.PLAYER, { level });
    u.place(clamp(x, MAP.castleX + 4, MAP.xMax - 4), clamp(z, -MAP.playZ, MAP.playZ), Math.PI / 2);
    u.lifetime = lifetime;
    if (u.animator) { const dur = u.animator.play('Spawn_Ground', { ts: 1.6 }); u.state = 'spawn'; u.stateT = dur * 0.6; }
    this.units.push(u);
    this.fx.burst(u.pos.clone().setY(u.pos.y + 0.4), { count: 10, color: 0xa8e0c0, speed: 2, up: 1.5, life: 0.8, size: 0.4 });
    return u;
  }

  warcry(u) {
    for (const o of this.units) if (o.team === u.team && o.alive && o.pos.distanceTo(u.pos) < 26) o.rallyBuff = { t: 8, dmg: 0.3, spd: 0.15 };
    if (u.animator) u.animator.play('Flexing', { ts: 2.5 });
    this.fx.ring(u.pos, { color: 0xff5a2a, radius: 26, life: 1.2 });
    this.sfx('roar', u.pos, 1); this.sfx('warhorn', u.pos, 0.5);
  }

  bossCharge(u, target) {
    const dx = target.pos.x - u.pos.x, dz = target.pos.z - u.pos.z, d = Math.hypot(dx, dz) || 1;
    const hit = new Set();
    this.fx.ring(u.pos, { color: 0xff2a2a, radius: 3, life: 0.5 });
    this.sfx('growl', u.pos, 1);
    let t = 0;
    this.timers.push({ tick: (dt) => {
      t += dt;
      if (!u.alive) return true;
      if (t < 0.5) return false;
      u.pos.x += dx / d * 20 * dt; u.pos.z += dz / d * 20 * dt;
      this.collide(u);
      u.facing = Math.atan2(dx, dz);
      for (const o of this.query(u.pos.x, u.pos.z, 3)) {
        if (o.team === u.team || !o.alive || hit.has(o)) continue;
        hit.add(o);
        o.takeDamage(u.dmg * 1.4, u, { knock: new THREE.Vector3(dx / d * 10, 0, dz / d * 10) });
        o.addStatus('stun', 1);
      }
      if (Math.random() < 0.6) this.fx.burst(u.pos, { count: 2, color: 0x4a3a3a, normal: true, size: 1.4, speed: 1.5, life: 0.7 });
      return t > 1.3;
    } });
  }

  bossBlink(u) {
    const h = this.hero.alive ? this.hero : null;
    if (!h) return;
    this.fx.burst(u.pos.clone().setY(u.pos.y + 2), { count: 30, color: 0x2a0a12, normal: true, size: 2, speed: 3, life: 1.2, grow: 1.5, alpha: 0.8 });
    const a = rand(0, 6.28);
    u.place(clamp(h.pos.x + Math.cos(a) * 9, MAP.castleX + 6, 85), clamp(h.pos.z + Math.sin(a) * 9, -28, 28));
    this.fx.burst(u.pos.clone().setY(u.pos.y + 2), { count: 30, color: 0x8a1a2a, size: 1, speed: 4, life: 0.8 });
    this.sfx('shriek', u.pos, 0.8);
  }

  after(t, fn) { this.timers.push({ t, fn }); }
  shake(a, pos) {
    const d = pos ? pos.distanceTo(this.cam.mode === 'follow' ? this.cam.focus : this.world.camera.position) : 0;
    this.cam.shake(a * clamp(1.4 - d / 50, 0.1, 1));
  }
  screenFlash(color, a) { this.hud.screenFlash(color, a); }
  sfx(name, pos, vol = 1) { audio.play(name, pos, vol); }

  // ---------------- spawning ----------------
  spawnEnemy(type, x, z, rising = false) {
    const def = ENEMIES[type];
    if (!def) return null;
    // bosses come to the walls now, so they carry a little over half the health they had when you stormed their rifts
    const mul = def.boss ? { hp: this.enemyMul.hp * 0.55, dmg: this.enemyMul.dmg } : this.enemyMul;
    const u = new Unit(this, def, TEAM.ENEMY, { mul });
    u.place(clamp(x, MAP.castleX + 8, 96), clamp(z, -30, 30), -Math.PI / 2);
    this.units.push(u);
    const isSkel = def.anim && def.anim.startsWith('skel');
    if (isSkel && u.animator && (rising || Math.random() < 0.5)) {
      const dur = u.animator.play('Skeletons_Awaken_Floor', { ts: 1.4 });
      u.state = 'spawn'; u.stateT = dur * 0.9;
      this.fx.burst(u.pos.clone().setY(u.pos.y + 0.3), { count: 8, color: 0x3a3028, normal: true, size: 1.2, speed: 1.5, life: 1.2, grow: 1, alpha: 0.7 });
      if (Math.random() < 0.4) this.sfx('rise', u.pos, 0.5);
    } else { u.state = 'spawn'; u.stateT = 0.2; }
    if (def.boss) {
      this.boss = u;
      this.hud.bossBar(u);
    }
    return u;
  }

  startWave(i) {
    const w = this.waves[i];
    this.waveIdx = i;
    this.hud.banner(`WAVE ${i + 1} / ${this.waves.length}`, w.msg, 3);
    this.sfx('warhorn', this.level.enemySpawn, 1);
    this.after(0.6, () => this.sfx('bell', null, 0.6));
    this.world.fog.surge(1);
    let t = 0.5, n = 0;
    for (const [type, count] of w.spawn) {
      for (let k = 0; k < count; k++) { this.spawnQueue.push({ type, t }); t += ENEMIES[type].boss ? 1.5 : ENEMIES[type].large ? 1.2 : 0.55; n++; }
      t += 1.5;
    }
    this.waveSize = n;
    this.waveTimer = 62;
    this.waveAge = 0;
  }

  updateWaves(dt) {
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const s = this.spawnQueue[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.spawnQueue.splice(i, 1);
        const base = this.level.enemySpawn;
        const fromFog = !ENEMIES[s.type].anim?.startsWith('skel') || Math.random() < 0.5;
        const x = fromFog ? base.x + rand(2, 12) : base.x - rand(0, 18);
        const z = base.z + rand(-16, 16);
        this.spawnEnemy(s.type, x, z);
      }
    }
    const waves = this.waves;
    const alive = this.enemyCount;
    this.waveTimer -= dt;
    this.waveAge = (this.waveAge || 0) + dt;
    if (this.waveIdx < waves.length - 1) {
      const cleared = this.waveIdx >= 0 && this.spawnQueue.length === 0 && alive <= Math.max(2, Math.floor(this.waveSize * 0.2));
      // a breather after each wave so the player can regroup and summon
      if (cleared && this.waveAge > 20 && this.waveTimer > 9) { this.waveTimer = 9; this.hud.toast('The fog stirs again. Regroup.', 2.5); }
      if (this.waveTimer <= 0) this.startWave(this.waveIdx + 1);
    } else if (!this.bossSpawned && this.spawnQueue.length === 0 && (alive <= 3 || this.waveTimer <= 0)) {
      // the night's master comes for the fort; its death closes the rift
      this.bossSpawned = true;
      const b = this.chapter.boss;
      this.hud.banner(ENEMIES[b.type].name.toUpperCase(), b.msg, 4);
      this.hud.objective(`${ENEMIES[b.type].name} is coming for the walls. Kill it and the rift dies with it.`);
      audio.setMood('boss', this.chapter.biome);
      this.sfx('warhorn', this.level.enemySpawn, 1);
      this.after(1.2, () => { this.bossUnit = this.spawnEnemy(b.type, this.level.enemySpawn.x - 4, 0, true); this.sfx('shriek', this.level.enemySpawn, 1); this.world.fog.surge(1.2); });
      this.world.lightning.strike();
    } else if (this.bossSpawned) {
      this.trickleT -= dt;
      if (this.trickleT <= 0) {
        this.trickleT = 14;
        const pool = this.waves[this.waves.length - 1].spawn.map(s => s[0]).filter(t => !ENEMIES[t].boss && !ENEMIES[t].large);
        for (let k = 0; k < 3 + Math.floor(this.chapter.n / 2); k++) this.spawnQueue.push({ type: pick(pool), t: k * 0.6 });
      }
    }
  }

  summon(i) {
    const c = this.cards[i];
    if (!c || this.state !== 'fight') return false;
    const d = c.def;
    if (c.cd > 0) return false;
    if (this.coins < d.cost) { this.hud.toast('Not enough coin in the war chest.', 1.2); this.sfx('ui', null, 0.4); return false; }
    if (this.pop + d.pop * d.count > this.popCap) { this.hud.toast('Your army is at full strength.', 1.4); return false; }
    const alive = this.units.filter(u => u.alive && u.def === d).length;
    if (alive >= d.limit) { this.hud.toast(`Only ${d.limit} ${d.name} at a time.`, 1.4); return false; }
    this.coins -= d.cost;
    if (this.popStats) this.popStats.spent += d.cost;
    c.cd = d.cd;
    const lvl = (this.save.unitLevels || {})[d.id] || 1;
    const sp = this.level.allySpawn;
    for (let k = 0; k < d.count; k++) {
      const u = new Unit(this, d, TEAM.PLAYER, { level: lvl });
      u.place(sp.x + rand(-1, 3), sp.z + rand(-6, 6), Math.PI / 2);
      if (u.animator) { const dur = u.animator.play('Spawn_Ground', { ts: 1.6 }); u.state = 'spawn'; u.stateT = dur * 0.6; }
      this.units.push(u);
      if (!d.special?.turret) this.army.add(u);
      this.fx.burst(u.pos.clone().setY(u.pos.y + 0.6), { count: 12, color: 0xffc070, speed: 2, up: 2, gravity: -1, life: 0.8, size: 0.4 });
    }
    this.fx.flash(sp, 0xffb060, 30, 14, 0.5);
    this.stats.summoned += d.count;
    this.sfx('summon', sp, 0.7);
    return true;
  }

  // ---------------- economy, auras, shrines, towers ----------------
  updateBuffs() {
    for (const u of this.units) {
      u.buffs.dmg = 0; u.buffs.atk = 0; u.buffs.spd = 0; u.buffs.armor = 0;
      if (u.rallyBuff) { u.buffs.dmg += u.rallyBuff.dmg; u.buffs.spd += u.rallyBuff.spd; }
      if (u.rageBuff) u.buffs.atk += 0.5;
    }
    for (const a of this.units) {
      const au = a.alive && a.def.special?.aura;
      if (!au) continue;
      for (const u of this.query(a.pos.x, a.pos.z, au.radius)) {
        if (u.team !== a.team || !u.alive) continue;
        u.buffs.dmg = Math.max(u.buffs.dmg, (u.rallyBuff?.dmg || 0) + (au.dmg || 0));
        if (au.atk) u.buffs.atk = Math.max(u.buffs.atk, au.atk + (u.rageBuff ? 0.5 : 0));
        if (au.spd) u.buffs.spd = Math.max(u.buffs.spd, au.spd);
        if (au.armor) u.buffs.armor = Math.max(u.buffs.armor, au.armor);
      }
    }
  }

  updateShrines(dt) {
    let owned = 0, far = -38;
    for (const s of this.level.shrines) {
      let a = 0, e = 0;
      for (const u of this.query(s.pos.x, s.pos.z, s.radius)) { if (!u.alive || u.anims?.siege) continue; if (u.team === TEAM.PLAYER) a += u.isHero ? 2 : 1; else e += u.isLarge ? 2 : 1; }
      s.cap = s.cap ?? 0;
      const rate = 0.16;
      if (a > 0 && e === 0) s.cap = Math.min(1, s.cap + rate * dt * Math.min(3, a));
      else if (e > 0 && a === 0) s.cap = Math.max(-1, s.cap - rate * dt * Math.min(3, e));
      const newOwner = s.cap >= 1 ? 0 : s.cap <= -1 ? 1 : (s.owner === 0 && s.cap > 0) ? 0 : (s.owner === 1 && s.cap < 0) ? 1 : -1;
      if (newOwner !== s.owner) {
        const prev = s.owner;
        this.level.setShrineOwner(s, newOwner);
        if (newOwner === 0) { this.hud.toast('A Lantern Shrine is rekindled. Coin flows faster.', 2.2); this.sfx('holy', s.pos, 0.8); this.fx.burst(s.pos.clone().setY(s.pos.y + 3), { count: 30, color: 0xffc870, speed: 3, up: 2, life: 1.2, size: 0.5 }); }
        else if (newOwner === 1 && prev === 0) { this.hud.toast('The fog has swallowed a shrine.', 2.2); this.sfx('hex', s.pos, 0.8); }
      }
      s.progress = Math.abs(s.cap);
      s.ringMat.uniforms.uColor.value.set(s.cap >= 0 ? '#ffc870' : '#a04aff');
      if (s.owner === 0) { owned++; far = Math.max(far, s.pos.x + 8); }
    }
    this.shrinesOwned = owned;
  }

  updateTowers(dt) {
    const rank = this.towerRank;
    for (const t of this.level.towers) {
      t.cd -= dt;
      if (t.cd > 0) continue;
      let best = null, bd = 36 * 36;
      for (const u of this.query(t.pos.x + 20, t.pos.z, 40)) {
        if (u.team !== TEAM.ENEMY || !u.alive) continue;
        const d = dist2(u.pos.x, u.pos.z, t.pos.x, t.pos.z);
        if (d < bd) { bd = d; best = u; }
      }
      if (!best) { t.cd = 0.3; continue; }
      t.cd = 1.6 / (1 + 0.2 * rank);
      const src = { pos: t.pos, team: TEAM.PLAYER, facing: Math.PI / 2, isLarge: false, def: {}, alive: true, muzzle: t.pos, damageMult: () => 1 };
      const type = rank >= 3 ? 'fireArrow' : 'towerArrow';
      this.proj.fire(src, best, type, 13 * (1 + 0.25 * rank), { pierce: rank >= 5 ? 3 : 0 });
    }
  }

  // ---------------- clicking on the battlefield ----------------
  buildMarkers() {
    const ring = (color, inner, outer, opacity) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 4; m.visible = false; m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.markers = {
      hero: ring(0xffc870, 0.95, 1.12, 0.55),
      target: ring(0xff4a2a, 0.9, 1.15, 0.9),
      hover: ring(0xffe0b0, 0.9, 1.05, 0.45),
      move: ring(0xffc870, 0.55, 0.8, 0.9),
      army: ring(0xffc870, 0.25, 0.42, 0.0),
    };
    this.moveMarkT = 0;
    this.hovered = null;
  }
  markTarget(u) { this.markPulse = 0.35; this.hero.target = u; }
  markMove(p) {
    if (!p) { this.markers.move.visible = false; return; }
    this.markers.move.position.set(p.x, p.y + 0.08, p.z);
    this.markers.move.visible = true;
    this.moveMarkT = 1;
    this.fx.ring(p, { color: 0xffc870, radius: 1.4, life: 0.45, width: 0.06 });
  }
  // the enemy (or rift) under a screen point, judged on screen so small or distant foes are easy to click
  pickAt(nx, ny) {
    const R = this.game.R, w = R.canvas.clientWidth || window.innerWidth, h = R.canvas.clientHeight || window.innerHeight;
    const px = (nx * 0.5 + 0.5) * w, py = (-ny * 0.5 + 0.5) * h;
    let best = null, bd = Infinity;
    const p = new THREE.Vector3();
    for (const u of this.units) {
      if (u.team !== TEAM.ENEMY || !u.alive) continue;
      const tall = u.isLarge ? 2.6 : 1.2;
      p.set(u.pos.x, u.pos.y + tall, u.pos.z);
      const s = this.cam.toScreen(p, w, h);
      if (s.behind) continue;
      const lim = (u.isLarge ? 70 : 42) * (30 / this.cam.dist);
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < lim && d < bd) { bd = d; best = u; }
    }
    if (!best && this.rift && !this.rift.invulnerable) {
      const g = this.cam.groundAt(nx, ny);
      if (this.rift.distTo(g) < 2) best = this.rift;
    }
    return best;
  }
  updateMarkers(dt, inp) {
    const M = this.markers, hero = this.hero, fight = this.state === 'fight';
    M.hero.visible = fight && hero.alive;
    M.hero.position.set(hero.pos.x, hero.pos.y + 0.06, hero.pos.z);
    const t = hero.target;
    M.target.visible = fight && !!t && t.alive && !t.isStructure;
    if (M.target.visible) {
      this.markPulse = Math.max(0, (this.markPulse || 0) - dt);
      const sc = (t.isLarge ? 2.2 : 1.0) * (1 + this.markPulse * 1.2);
      M.target.position.set(t.pos.x, t.pos.y + 0.07, t.pos.z); M.target.scale.setScalar(sc);
    }
    if (M.move.visible) {
      this.moveMarkT = Math.max(0, this.moveMarkT - dt * 0.8);
      M.move.material.opacity = 0.25 + 0.65 * this.moveMarkT;
      M.move.scale.setScalar(1 + (1 - this.moveMarkT) * 0.4);
      if (!hero.moveTo) M.move.visible = false;
    }
    // hover: show what a click would pick
    let hv = null;
    const ptr = this.game.input.pointer;
    if (fight && ptr.inside && !this.game.input.isTouch) hv = this.pickAt(ptr.x, ptr.y);
    this.hovered = hv;
    M.hover.visible = !!hv && !hv.isStructure && hv !== t;
    if (M.hover.visible) { M.hover.position.set(hv.pos.x, hv.pos.y + 0.07, hv.pos.z); M.hover.scale.setScalar(hv.isLarge ? 2.2 : 1); }
    this.game.R.canvas.style.cursor = fight ? (hv ? 'crosshair' : 'pointer') : '';
  }

  // how far through the night we are, 0..1 (the boss is the last step)
  get nightProgress() {
    const n = this.waves.length + 1;
    let done = Math.max(0, this.waveIdx);
    if (this.bossSpawned) done = this.waves.length + (this.bossUnit && !this.bossUnit.alive ? 1 : 0.5);
    return Math.min(1, done / n);
  }

  get enemyCount() { let n = 0; for (const u of this.units) if (u.team === TEAM.ENEMY && u.alive) n++; return n; }

  // ---------------- state changes ----------------
  begin() {
    this.state = 'fight';
    this.hero.place(MAP.castleX + 8, 0, Math.PI / 2);
    this.cam.follow();
    this.cam.snapTo(this.hero.pos);
    // tactical view: keep the air clear around the battle, let the distance drown in fog
    darkUniforms.uFogStart.value = 24;
    this._fogWall = darkUniforms.uFogWall.value.z;
    darkUniforms.uFogWall.value.z = this._fogWall * 0.55;
    this.world.fog.setNearFade(26, 56);
    this.hud.show(true);
    this.hud.objective(this.chapter.objective);
    audio.setMood('battle', this.chapter.biome);
  }

  victory() {
    if (this.state !== 'fight') return;
    this.state = 'victory';
    this.stats.time = Math.round(this.stats.time);
    const rp = this.level.riftPos.clone();
    this.fx.burst(rp, { count: 160, color: new THREE.Color(this.level.riftColor).getHex(), speed: 12, life: 1.6, size: 1, gravity: 0 });
    this.fx.burst(rp, { count: 60, color: 0x1a1420, normal: true, speed: 5, life: 3, size: 4, grow: 2, gravity: -0.4, alpha: 0.8 });
    this.fx.flash(rp, 0xffffff, 200, 80, 1.5);
    if (this.level.riftDisc) this.level.riftDisc.visible = false;
    if (this.level.riftTorus) this.level.riftTorus.visible = false;
    if (this.level.riftFx) this.level.riftFx.active = false;
    this.level.riftLight.intensity = 0;
    this.world.fog.configure({ color: this.world.biome.fogBank.color, amount: 0.35 });
    for (const u of this.units) if (u.team === TEAM.ENEMY && u.alive) this.after(rand(0.2, 2.5), () => u.alive && u.die(null));
    this.shake(1.2, rp);
    this.sfx('boom', rp, 1);
    this.slowmo = 0.35;
    this.game.input.releaseLock();
    this.cam.cinematic(this.world.camera.position.clone(), rp.clone().setY(rp.y - 2), rp.clone().add(new THREE.Vector3(-28, 12, 18)), rp.clone(), 4);
    this.after(1.5, () => { this.slowmo = 1; audio.setMood('victory', this.chapter.biome); });
    this.after(5, () => this.game.onBattleEnd(true, this));
  }

  defeat() {
    if (this.state !== 'fight') return;
    this.state = 'defeat';
    this.game.input.releaseLock();
    audio.setMood('defeat', this.chapter.biome);
    audio.heartbeat = false;
    const lp = this.level.lanternPos.clone();
    this.cam.cinematic(this.world.camera.position.clone(), this.castle.pos.clone(), new THREE.Vector3(-52, 16, 22), lp, 4);
    let k = 1;
    this.timers.push({ tick: (dt) => { k = Math.max(0, k - dt * 0.35); this.level.lanternLight.intensity = 60 * k * (0.6 + Math.random() * 0.4); this.level.lanternFlame.scale.setScalar(Math.max(0.01, k)); return k <= 0; } });
    this.hud.banner('THE LANTERN GOES DARK', 'Dawnhold has fallen to the fog.', 5);
    this.world.fog.configure({ color: this.world.biome.fogBank.color, amount: 1.8 });
    this.after(6, () => this.game.onBattleEnd(false, this));
  }

  // ---------------- main update ----------------
  update(rawDt, inp) {
    const dt = rawDt * this.slowmo;
    if (this.state === 'fight') this.stats.time += dt;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (t.tick) { if (t.tick(dt)) this.timers.splice(i, 1); }
      else { t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); } }
    }
    // spatial hash
    this.hash.clear();
    let pop = 0;
    for (const u of this.units) {
      if (u.alive) this.hash.insert(u);
      if (u.alive && u.team === TEAM.PLAYER && !u.isHero && !u.lifetime) pop += u.pop;
      if (u.rallyBuff) { u.rallyBuff.t -= dt; if (u.rallyBuff.t <= 0) u.rallyBuff = null; }
    }
    this.pop = pop;
    // how full the army stays (shown in tests; tunes the economy)
    if (this.state === 'fight') {
      const ps = this.popStats || (this.popStats = { t: 0, fill: 0, full: 0, spent: 0 });
      ps.t += dt; ps.fill += Math.min(1, pop / this.popCap) * dt; if (pop + 1 > this.popCap) ps.full += dt;
    }
    this.updateBuffs();
    if (this.state === 'fight') {
      // economy
      let banner = 0;
      for (const u of this.units) if (u.alive && u.def.special?.cp) banner += u.def.special.cp;
      this.coinRate = this.coinBase + Math.min(0.12, banner * 0.2) + (this.shrinesOwned || 0) * 0.075;
      this.coins = Math.min(this.coinMax, this.coins + this.coinRate * dt);
      for (const c of this.cards) c.cd = Math.max(0, c.cd - dt);
      if (inp) {
        if (inp.summon >= 0) this.summon(inp.summon);
      }
      this.updateWaves(dt);
      this.updateShrines(dt);
      this.updateTowers(dt);
    }
    // hero
    const hero = this.hero;
    if (this.state === 'fight' && hero.alive) hero.control(dt, inp || this.game.input.empty, this.cam);
    if (!hero.alive && this.state === 'fight') {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        hero.alive = true; hero.hp = hero.maxHp; hero.state = 'idle'; hero.remove = false; hero.deathT = 0; hero.status = {};
        hero.place(this.level.heroSpawn.x, this.level.heroSpawn.z, Math.PI / 2);
        hero.addStatus('invuln', 3);
        hero.animator.cancelShot(0.01);
        hero.animator.loop(hero.anims.idle, 1, 0.01);
        this.fx.burst(hero.pos.clone().setY(hero.pos.y + 1), { count: 40, color: 0xffc070, speed: 3, up: 2, life: 1.2, size: 0.5 });
        this.sfx('holy', hero.pos, 1);
      }
    }
    // army formation, then units
    this.army.update(dt);
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.lifetime !== undefined && u.alive) { u.lifetime -= dt; if (u.lifetime <= 0) u.die(null); }
      u.update(dt);
      if (u.remove && !u.isHero) { u.dispose(); this.units.splice(i, 1); }
    }
    this.proj.update(dt);
    this.updateFields(dt);
    // castle warnings
    if (this.state === 'fight') {
      const cp = this.castle.hp / this.castle.maxHp;
      audio.heartbeat = cp < 0.3;
      this.castleBarkT -= dt;
      if (cp < 0.5 && this.castleBarkT <= 0) { this.castleBarkT = 40; this.hud.voice(pick(BARKS.castleLow)); }
      audio.intensity = clamp(this.enemyCount / 28, 0.15, 1);
    }
    // camera + light
    const camSubject = this.game.camOnArmy && this.army.units.length ? { pos: this.army.anchor } : hero;
    if (this.cam.mode === 'follow') this.cam.update(rawDt, inp, camSubject);
    else this.cam.update(rawDt, null, hero);
    this.updateMarkers(rawDt, inp);
    this.heroLight.position.set(hero.pos.x, hero.pos.y + 3.2, hero.pos.z);
    this.heroLight.intensity = hero.alive ? 22 : 0;
    // tactical view: listen from just above the battle, not from the camera high overhead
    audio.setListener(this.world.camera, this.cam.mode === 'follow' ? this._ears.set(this.cam.focus.x, this.cam.focus.y + 5, this.cam.focus.z + 4) : null);
    this.hud.update(rawDt, this);
  }

  dispose() {
    for (const u of this.units) u.dispose();
    this.units.length = 0;
    this.proj.clear();
    this.scene.remove(this.heroLight);
    darkUniforms.uFogStart.value = 0;
    if (this._fogWall != null) darkUniforms.uFogWall.value.z = this._fogWall;
    this.world.fog.setNearFade(3, 14);
    for (const m of Object.values(this.markers || {})) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.game.R.canvas.style.cursor = '';
    audio.heartbeat = false;
  }
}
