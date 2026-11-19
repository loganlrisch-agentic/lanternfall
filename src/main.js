// LANTERNFALL — boot, game loop and campaign flow.
import * as THREE from 'three';
import { installGlobalPatch, setRim } from './core/materials.js';
import { Renderer } from './core/renderer.js';
import { loadAssets, renderPortraits, getVariant, spawnCharacter, clip, A } from './core/assets.js';
import { World } from './world/world.js';
import { Input } from './core/input.js';
import { HUD } from './ui/hud.js';
import { Story } from './ui/story.js';
import { Screens } from './ui/screens.js';
import { Battle } from './game/battle.js';
import { HEROES, ALLIES, ENEMIES } from './game/data/units.js';
import { CHAPTERS, CAST } from './game/data/campaign.js';
import { newSave, loadSave, writeSave, loadSettings } from './game/save.js';
import { audio } from './core/audio.js';
import { TEAM } from './game/config.js';
import { rand, sleep } from './core/util.js';

installGlobalPatch();
const params = new URLSearchParams(location.search);

class Game {
  async boot() {
    this.settings = loadSettings();
    this.canvas = document.getElementById('c');
    this.R = new Renderer(this.canvas);
    this.R.setQuality(params.get('q') || this.settings.quality);
    this.world = new World(this.R);
    this.R.build(this.world.scene, this.world.camera);
    this.input = new Input(this.canvas);
    const ui = document.getElementById('ui');
    this.hud = new HUD(ui, this.input);
    this.story = new Story(ui, this);
    this.screens = new Screens(ui, this);
    const bar = document.querySelector('#loading .fill');
    const txt = document.querySelector('#loading .pct');
    const prog = p => { bar.style.width = (p * 100).toFixed(0) + '%'; txt.textContent = p < 1 ? `Kindling the lantern… ${(p * 100).toFixed(0)}%` : 'Ready'; };
    await loadAssets('./assets', p => prog(p * 0.9));
    await sleep(30);
    this.makePortraits();
    prog(1);
    this.world.lightning.onThunder = () => audio.play('thunder', null, 0.8);
    this.input.onLockChange = locked => {
      if (!locked && this.battle && this.battle.state === 'fight' && !this.paused && this.input.lockWanted && !this.input.lockFailed) this.pause();
    };
    window.addEventListener('pointerdown', () => audio.init());
    window.addEventListener('keydown', () => audio.init());
    this.applySettings();
    this.last = performance.now();
    requestAnimationFrame(() => this.loop());
    window.__game = this;
    if (params.get('test')) { await this.runTest(); }
    else { this.buildTitle(); this.toTitle(); }
    const ld = document.getElementById('loading');
    ld.classList.add('done');
    setTimeout(() => ld.remove(), 1200);
  }

  makePortraits() {
    const items = [];
    const inst = (model, opts = {}, weapons = [], scale = 0.88) => spawnCharacter(getVariant(model, opts), { weapons, scale, headScale: 0.68 });
    const stat = (model, scale) => { const g = new THREE.Group(); const m = A.scenes[model].clone(); m.scale.setScalar(scale); g.add(m); return { root: g, rig: 'static' }; };
    for (const hr of Object.values(HEROES)) items.push({ key: 'hero_' + hr.id, build: () => inst(hr.model, hr.opts, hr.weapons, 0.9), idle: hr.anim === 'bow' ? 'Ranged_Bow_Idle' : 'Idle_B' });
    for (const a of ALLIES) items.push({ key: 'ally_' + a.id, build: () => a.anim === 'siege' ? stat(a.model, a.scale) : inst(Array.isArray(a.model) ? a.model[0] : a.model, a.opts || {}, a.weapons || [], a.scale), idle: a.anim === 'bow' ? 'Ranged_Bow_Idle' : 'Idle_A' });
    for (const [id, c] of Object.entries(CAST)) if (c.model) items.push({ key: 'cast_' + id, build: () => inst(c.model, {}, c.weapons || [], c.scale || 0.88), idle: 'Idle_B' });
    for (const [k, e] of Object.entries(ENEMIES)) items.push({ key: 'enemy_' + k, build: () => { const o = { ...(e.opts || {}) }; if (e.tint) { o.tint = e.tint; o.tintMix = 0.75; } if (e.glow) o.glowColor = e.glow; const i = inst(e.model, o, e.weapons || [], e.scale); i.meshes.forEach(m => setRim(m.material, '#8a4aff', 0.6)); return i; } });
    renderPortraits(this.R.renderer, items, 160);
  }

  applySettings(rebuild = false) {
    const s = this.settings;
    audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    if (this.battle) { this.battle.cam.sens = 0.0024 * s.sens; this.battle.cam.invertY = s.invertY; }
    document.body.classList.toggle('no-help', !s.help);
    if (rebuild && s.quality !== this.R.qualityName) {
      this.R.setQuality(s.quality);
      if (this.world.biomeId) this.world.applyBiome(this.world.biomeId);
    }
  }

  // ---------------- title scene ----------------
  buildTitle() {
    this.disposeBattle();
    this.world.loadLevel({ biome: 'title', fortress: 'barrow', seed: 5, shrines: [[-24, -15], [16, 14]] });
    this.disposeTitle();
    this.titleDead = [];
    const lvl = this.world.level;
    for (let i = 0; i < 11; i++) {
      const model = i % 3 === 0 ? 'Skeleton_Warrior' : i % 4 === 1 ? 'Skeleton_Rogue' : 'Skeleton_Minion';
      const weapons = model === 'Skeleton_Warrior' ? [{ id: 'Skeleton_Axe', hand: 'r' }, { id: 'Skeleton_Shield_Small_A', hand: 'l' }] : model === 'Skeleton_Rogue' ? [{ id: 'Skeleton_Crossbow', hand: 'r' }] : [{ id: 'Skeleton_Blade', hand: 'r' }];
      const c = spawnCharacter(getVariant(model, { glowColor: '#9a6cff' }), { weapons, scale: 0.85, headScale: 0.68 });
      c.meshes.forEach(m => setRim(m.material, '#8a4aff', 0.85));
      const a = c.mixer.clipAction(clip('medium', 'Skeletons_Walking')); a.play(); a.time = Math.random() * 2;
      const d = { c, x: rand(-48, 40), z: rand(-16, 18), sp: rand(0.8, 1.25) };
      c.root.position.set(d.x, lvl.h(d.x, d.z), d.z);
      c.root.rotation.y = -Math.PI / 2 + rand(-0.15, 0.15);
      this.world.scene.add(c.root);
      this.titleDead.push(d);
    }
    this.titleT = 0;
    this.world.camera.fov = 50; this.world.camera.updateProjectionMatrix();
  }
  disposeTitle() {
    if (!this.titleDead) return;
    for (const d of this.titleDead) { this.world.scene.remove(d.c.root); d.c.mixer.stopAllAction(); }
    this.titleDead = null;
  }
  updateTitle(dt) {
    if (!this.titleDead) return;
    this.titleT += dt;
    const lvl = this.world.level;
    for (const d of this.titleDead) {
      d.x -= d.sp * dt;
      if (d.x < -60) { d.x = rand(15, 45); d.z = rand(-18, 18); }
      d.c.root.position.set(d.x, lvl.h(d.x, d.z), d.z);
      d.c.mixer.update(dt);
    }
    const t = this.titleT * 0.035;
    const cam = this.world.camera;
    cam.position.set(-22 + Math.sin(t) * 6, 6.5 + Math.sin(t * 0.7) * 0.8, 24 + Math.cos(t) * 4);
    cam.lookAt(-74, 10, -4);
    this.world.focus.set(-50, 0, 0);
  }

  toTitle() {
    this.disposeBattle();
    if (!this.titleDead) this.buildTitle();
    this.paused = false;
    this.hud.show(false);
    this.input.enabled = false;
    this.input.releaseLock();
    audio.setMood('menu', 'title');
    audio.startAmbience('title');
    this.screens.title(loadSave());
  }

  // ---------------- campaign ----------------
  async newCampaign(hero, diff) {
    this.save = newSave(hero, diff);
    writeSave(this.save);
    audio.setMood('story', 'title');
    this.screens.hide();
    await this.screens.prologue();
    this.startChapter(1);
  }

  continueCampaign() {
    this.save = loadSave();
    if (!this.save) return this.toTitle();
    if (this.save.chapter > 6) return this.toTitle();
    if (this.save.chapter === 1 && !this.save.stats.battles) return this.startChapter(1);
    audio.setMood('camp', 'title');
    this.screens.camp(this.save);
  }

  async startChapter(n) {
    this.screens.hide();
    this.paused = false;
    const ch = CHAPTERS[n - 1];
    this.input.enabled = false;
    const card = this.screens.chapterCard(ch);
    await sleep(150);
    this.disposeBattle();
    this.disposeTitle();
    this.battle = new Battle(this, ch, this.save);
    this.hud.setup(this.battle);
    this.applySettings();
    this.world.camera.fov = 55; this.world.camera.updateProjectionMatrix();
    this.R.resize();
    this.world.fx.setPixelScale(window.innerHeight);
    audio.setMood('story', ch.biome);
    const lp = this.battle.level.lanternPos;
    this.battle.cam.cinematic(new THREE.Vector3(10, 18, 30), new THREE.Vector3(60, 4, 0), new THREE.Vector3(-40, 9, 16), lp.clone().setY(lp.y - 10), 6);
    await card;
    await this.story.run(this.battle, ch.intro, { where: 'walls', onChoice: o => this.applyChoice(o) });
    this.input.enabled = true;
    this.battle.begin();
  }

  applyChoice(o) {
    if (o.flag) this.save.flags[o.flag] = true;
    if (o.gold) this.save.gold = Math.max(0, this.save.gold + o.gold);
    writeSave(this.save);
  }

  async onBattleEnd(win, b) {
    const s = this.save, st = b.stats, hero = b.hero;
    const levels = hero.levelsGained || 0;
    const gold = Math.round(st.gold + (win ? b.chapter.reward : 0));
    s.gold += gold;
    s.level = hero.level;
    s.xp = Math.round(hero.xpPool || 0);
    s.valor += levels;
    s.stats.kills += st.kills; s.stats.lost += st.lost;
    if (win) s.stats.battles++;
    const unlocks = win ? ALLIES.filter(a => a.unlock === b.chapter.n) : [];
    writeSave(s);
    this.input.enabled = false;
    this.hud.show(false);
    if (this.testMode) { window.__result = { win, stats: st, gold, levels }; return; }
    const action = await this.screens.results(win, { chapter: b.chapter, kills: st.kills, summoned: st.summoned, lost: st.lost, time: st.time, gold, levels, unlocks });
    if (!win) {
      if (action === 'retry') return this.startChapter(b.chapter.n);
      this.disposeBattle(); this.buildTitle(); audio.setMood('camp', 'title'); return this.screens.camp(s);
    }
    audio.setMood('story', b.chapter.biome);
    if (b.chapter.outro) await this.story.run(b, b.chapter.outro, { where: 'field', onChoice: o => this.applyChoice(o) });
    if (b.chapter.n === 6) {
      const flag = s.flags.sever ? 'sever' : 'relight';
      await this.story.run(b, b.chapter.endings[flag], { where: 'field' });
      s.chapter = 7; writeSave(s);
      this.disposeBattle(); this.buildTitle();
      await this.screens.ending(flag);
      return this.toTitle();
    }
    s.chapter = b.chapter.n + 1;
    writeSave(s);
    this.disposeBattle();
    this.buildTitle();
    audio.setMood('camp', 'title');
    audio.play('unlock', null, 0.6);
    this.screens.camp(s);
  }

  pause() {
    if (!this.battle || this.paused) return;
    this.paused = true;
    this.input.enabled = false;
    this.input.releaseLock();
    this.screens.pause(() => this.resume(), a => {
      this.paused = false;
      const n = this.battle.chapter.n;
      if (a === 'restart') this.startChapter(n);
      if (a === 'camp') { this.disposeBattle(); this.buildTitle(); this.hud.show(false); audio.setMood('camp', 'title'); this.screens.camp(this.save); }
      if (a === 'title') this.toTitle();
    });
  }
  resume() {
    this.paused = false;
    this.input.enabled = true;
    this.input.requestLock();
  }

  disposeBattle() {
    if (!this.battle) return;
    this.story.clearActors();
    this.battle.dispose();
    this.battle = null;
    this.hud.show(false);
  }

  // ---------------- loop ----------------
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    if (this.testMode && this.testStep) { this.testStep(); return; }
    const inp = this.input.frame();
    if (this.battle) {
      if (inp.pause && this.battle.state === 'fight' && !this.paused) this.pause();
      if (!this.paused) this.battle.update(dt, this.auto ? this.autoInput(inp) : inp);
    } else this.updateTitle(dt);
    if (!this.paused) this.world.update(dt);
    this.R.render(dt);
  }

  // ---------------- automated playtest hooks (?test=battle) ----------------
  autoInput(inp) {
    const b = this.battle, h = b.hero;
    const f = { ...this.input.empty, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, ability: {} };
    if (!h.alive || b.state !== 'fight') return f;
    let best = null, bd = 1e9;
    for (const u of b.units) if (u.team === TEAM.ENEMY && u.alive) { const d = u.pos.distanceTo(h.pos); if (d < bd) { bd = d; best = u; } }
    const tgt = best ? best.pos : (b.rift.invulnerable ? null : b.rift.pos);
    if (tgt) {
      const want = Math.atan2(tgt.x - h.pos.x, tgt.z - h.pos.z);
      b.cam.yaw = want;
      const dist = Math.hypot(tgt.x - h.pos.x, tgt.z - h.pos.z);
      const range = h.cls.melee ? 2.2 : 16;
      if (dist > range) f.move.y = 1;
      this.autoT = (this.autoT || 0) + 1;
      if (dist < range + 2) { if (this.autoT % 3 === 0) f.attackDown = true; if (this.autoT % 3 === 1) f.attackUp = true; f.attackHeld = this.autoT % 3 === 0; }
      if (this.autoT % 90 === 0) f.ability.Q = true;
      if (this.autoT % 150 === 0) f.ability.F = true;
      if (this.autoT % 400 === 0) f.ability.E = true;
      if (this.autoT % 900 === 0) f.ability.R = true;
    }
    for (let i = 0; i < b.cards.length; i++) if (b.cp >= b.cards[i].def.cost && b.cards[i].cd <= 0 && Math.random() < 0.02) { f.summon = i; break; }
    return f;
  }

  async runTest() {
    this.testMode = true;
    const ch = +(params.get('ch') || 1);
    this.save = newSave(params.get('hero') || 'knight', params.get('diff') || 'normal');
    this.save.chapter = ch;
    this.save.loadout = (params.get('loadout') || 'militia,footman,archer,bannerman,shieldbearer,cleric,adept,paladin').split(',');
    for (const k of ['spareCursed', 'orcs', 'redeemAldous']) this.save.flags[k] = true;
    this.battle = new Battle(this, CHAPTERS[ch - 1], this.save);
    this.hud.setup(this.battle);
    this.world.fx.setPixelScale(window.innerHeight);
    this.input.enabled = true;
    this.auto = params.get('auto') === '1';
    if (params.get('story')) {
      this.testMode = false;
      this.story.run(this.battle, CHAPTERS[ch - 1].intro, { where: 'walls' });
      setTimeout(() => { this.story.advance(); this.story.advance(); }, 300);
      window.__ready = true;
      return;
    }
    this.battle.begin();
    const simSeconds = +(params.get('sim') || 0);
    const speed = +(params.get('speed') || 1);
    let simulated = 0;
    const frames = +(params.get('frames') || 6);
    let rendered = 0;
    this.testStep = () => {
      const t0 = performance.now();
      // fast-forward the simulation without rendering, then render a few frames for screenshots
      while (simulated < simSeconds && performance.now() - t0 < 800) {
        const dt = 1 / 30;
        const inp = this.input.frame();
        if (this.battle) this.battle.update(dt, this.auto ? this.autoInput(inp) : inp);
        this.world.update(dt);
        simulated += dt;
        if (window.__result) break;
      }
      window.__progress = { simulated: Math.round(simulated), units: this.battle?.units.length, wave: this.battle?.waveIdx, castle: Math.round(this.battle?.castle.hp || 0), rift: Math.round(this.battle?.rift.hp || 0), boss: !!this.battle?.boss, state: this.battle?.state, kills: this.battle?.stats.kills, hero: this.battle && { hp: Math.round(this.battle.hero.hp), lvl: this.battle.hero.level, x: Math.round(this.battle.hero.pos.x) } };
      if (simulated >= simSeconds || window.__result) {
        const dt = 1 / 30 * speed;
        if (this.battle) this.battle.update(dt, this.auto ? this.autoInput(this.input.frame()) : this.input.frame());
        this.world.update(dt);
        this.R.renderer.info.autoReset = false; this.R.renderer.info.reset();
        this.R.render(dt);
        window.__calls = { calls: this.R.renderer.info.render.calls, tris: this.R.renderer.info.render.triangles };
        rendered++;
        if (rendered >= frames) {
          window.__info = { ...window.__progress, result: window.__result || null, ...window.__calls };
          window.__ready = true;
          this.testStep = () => {};
        }
      }
    };
  }
}

new Game().boot().catch(e => {
  console.error(e);
  const l = document.querySelector('#loading .pct');
  if (l) l.textContent = 'The lantern failed to light: ' + (e && e.message ? e.message : e);
});
