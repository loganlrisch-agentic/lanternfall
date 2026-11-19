// Dialogue scenes staged in the 3D world, with portraits, typewriter text and branching choices.
import * as THREE from 'three';
import { CAST } from '../game/data/campaign.js';
import { A, getVariant, spawnCharacter, clip } from '../core/assets.js';
import { setRim } from '../core/materials.js';
import { audio } from '../core/audio.js';

const $ = (s, r = document) => r.querySelector(s);

export class Story {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'story';
    this.el.innerHTML = `
      <div class="letterbox top"></div><div class="letterbox bot"></div>
      <div class="dlg">
        <div class="dlg-portrait"><img alt=""></div>
        <div class="dlg-body"><div class="dlg-name"></div><div class="dlg-text"></div><div class="dlg-choices"></div><div class="dlg-hint">Click or press Space</div></div>
      </div>
      <button class="dlg-skip">Skip scene ⟫</button>
      <div class="narr"><p></p></div>`;
    root.appendChild(this.el);
    this.actors = [];
    this.active = false;
    const adv = () => this.advance();
    this.el.addEventListener('click', e => { if (e.target.closest('.dlg-choices') || e.target.closest('.dlg-skip')) return; adv(); });
    $('.dlg-skip', this.el).addEventListener('click', () => { this.skip = true; this.advance(true); });
    window.addEventListener('keydown', e => { if (!this.active) return; if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); adv(); } if (e.code === 'Escape') { this.skip = true; this.advance(true); } });
  }

  stageActors(battle, lines, where) {
    this.clearActors();
    const ids = [...new Set(lines.filter(l => Array.isArray(l)).map(l => l[0]).filter(id => CAST[id] && CAST[id].model))];
    const lvl = battle.level;
    const base = where === 'field' ? new THREE.Vector3(-34, 0, 2) : new THREE.Vector3(-58, 0, -1.5);
    const hero = battle.hero;
    hero.place(base.x + 2.2, base.z + 0.4, -Math.PI / 2 - 0.4);
    hero.animator.cancelShot(0.01);
    hero.animator.loop(hero.anims.idle, 1, 0.01);
    ids.forEach((id, i) => {
      const c = CAST[id];
      const angle = -0.9 + i * (1.8 / Math.max(1, ids.length - 1 || 1));
      const r = 3.6;
      const x = base.x - Math.cos(angle) * r * 0.6 - 1.2, z = base.z + Math.sin(angle) * r;
      const proto = getVariant(c.model, {});
      const inst = spawnCharacter(proto, { weapons: c.weapons || [], scale: (c.scale || 0.88), headScale: 0.68 });
      inst.root.position.set(x, lvl.h(x, z), z);
      const face = Math.atan2(hero.pos.x - x, hero.pos.z - z);
      inst.root.rotation.y = face;
      inst.meshes.forEach(m => setRim(m.material, id === 'regent' || id === 'aldous' ? '#c060ff' : '#ffcf8a', id === 'regent' || id === 'aldous' ? 0.9 : 0.12));
      const idle = clip(inst.rig, inst.rig === 'large' ? 'Idle_A' : 'Idle_B');
      if (idle) inst.mixer.clipAction(idle).play();
      inst.mixer.update(Math.random());
      battle.scene.add(inst.root);
      this.actors.push({ id, inst, root: inst.root });
    });
    this.base = base;
  }

  clearActors() {
    for (const a of this.actors) { a.root.parent && a.root.parent.remove(a.root); a.inst.mixer.stopAllAction(); }
    this.actors.length = 0;
  }

  shotFor(id, battle) {
    const a = this.actors.find(x => x.id === id);
    const cam = battle.cam;
    const from = battle.world.camera.position.clone();
    const fromLook = this.lookNow ? this.lookNow.clone() : battle.hero.pos.clone();
    if (a) {
      const head = a.inst.head.getWorldPosition(new THREE.Vector3());
      const yaw = a.root.rotation.y;
      const big = a.inst.rig === 'large';
      const d = big ? 6.2 : 3.6;
      const pos = new THREE.Vector3(head.x + Math.sin(yaw + 0.5) * d, head.y + (big ? 0.6 : 0.35), head.z + Math.cos(yaw + 0.5) * d);
      const look = head.clone().add(new THREE.Vector3(0, -0.15, 0));
      cam.cinematic(from, fromLook, pos, look, 0.9);
      this.lookNow = look;
      // a small gesture
      if (Math.random() < 0.45 && a.inst.rig !== 'large') {
        const g = clip('medium', Math.random() < 0.5 ? 'Interact' : 'Use_Item');
        if (g) { const act = a.inst.mixer.clipAction(g); act.reset().setLoop(THREE.LoopOnce, 1); act.fadeIn(0.2).play(); setTimeout(() => act.fadeOut(0.4), 900); }
      }
    } else {
      // narrator / voice: look out into the fog
      const pos = this.base.clone().add(new THREE.Vector3(-4, 4.5, id === 'voice' ? 3 : -3));
      pos.y += battle.level.h(pos.x, pos.z);
      const look = new THREE.Vector3(40, 3, 0);
      cam.cinematic(from, fromLook, pos, look, 1.6);
      this.lookNow = look;
    }
  }

  run(battle, lines, { where = 'walls', onChoice } = {}) {
    return new Promise(resolve => {
      this.battle = battle;
      this.lines = lines.slice();
      this.idx = -1;
      this.resolve = resolve;
      this.onChoice = onChoice;
      this.skip = false;
      this.active = true;
      this.el.classList.add('on');
      this.game.hud.show(false);
      this.stageActors(battle, lines, where);
      this.advance();
    });
  }

  advance(force = false) {
    if (!this.active) return;
    if (this.typing && !force) { this.finishTyping(); return; }
    if (this.choosing) { if (force) this.pickChoice(0); return; }
    if (force && this.skip) {
      // run remaining choices with the first option if the player skips
      for (let i = this.idx + 1; i < this.lines.length; i++) {
        const l = this.lines[i];
        if (l.choice) { this.idx = i - 1; this.skip = false; this.next(); return; }
      }
      this.end(); return;
    }
    this.next();
  }

  next() {
    this.idx++;
    if (this.idx >= this.lines.length) { this.end(); return; }
    const l = this.lines[this.idx];
    if (l.choice) { this.showChoice(l.choice); return; }
    const [who, text] = l;
    const c = CAST[who] || CAST.narrator;
    const dlg = $('.dlg', this.el);
    const narr = who === 'narrator';
    $('.narr', this.el).classList.toggle('on', narr);
    dlg.classList.toggle('hide', narr);
    if (narr) {
      $('.narr p', this.el).textContent = text;
      this.typing = false;
      this.shotFor(who, this.battle);
      audio.play('page', null, 0.6);
      return;
    }
    $('.dlg-name', this.el).textContent = c.name;
    $('.dlg-name', this.el).style.color = c.color;
    const img = $('.dlg-portrait img', this.el);
    const por = A.portraits['cast_' + who];
    img.src = por || '';
    $('.dlg-portrait', this.el).classList.toggle('none', !por);
    $('.dlg-text', this.el).classList.toggle('italic', !!c.italic);
    $('.dlg-choices', this.el).innerHTML = '';
    $('.dlg-hint', this.el).style.visibility = 'visible';
    this.type(text);
    this.shotFor(who, this.battle);
    if (who === 'voice' || who === 'regent') audio.play('shriek', null, 0.12);
    else audio.play('page', null, 0.35);
  }

  type(text) {
    const el = $('.dlg-text', this.el);
    el.textContent = '';
    this.fullText = text;
    this.typing = true;
    let i = 0;
    clearInterval(this.typer);
    this.typer = setInterval(() => {
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) this.finishTyping();
    }, 22);
  }
  finishTyping() { clearInterval(this.typer); this.typing = false; $('.dlg-text', this.el).textContent = this.fullText; }

  showChoice(opts) {
    this.choosing = true;
    $('.narr', this.el).classList.remove('on');
    $('.dlg', this.el).classList.remove('hide');
    $('.dlg-name', this.el).textContent = 'Your choice';
    $('.dlg-name', this.el).style.color = '#e6c27a';
    $('.dlg-portrait img', this.el).src = A.portraits['hero_' + this.battle.hero.classId] || '';
    $('.dlg-portrait', this.el).classList.remove('none');
    $('.dlg-text', this.el).textContent = '';
    $('.dlg-hint', this.el).style.visibility = 'hidden';
    const box = $('.dlg-choices', this.el);
    box.innerHTML = '';
    opts.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.innerHTML = `<span class="t">${o.text}</span><span class="n">${o.note || ''}</span>`;
      b.addEventListener('click', e => { e.stopPropagation(); this.pickChoice(i); });
      box.appendChild(b);
    });
    this.choiceOpts = opts;
    audio.play('bell', null, 0.25);
  }

  pickChoice(i) {
    const o = this.choiceOpts[i];
    this.choosing = false;
    $('.dlg-choices', this.el).innerHTML = '';
    if (this.onChoice) this.onChoice(o);
    audio.play('ui', null, 0.6);
    if (o.reply) this.lines.splice(this.idx + 1, 0, o.reply);
    this.next();
  }

  end() {
    this.active = false;
    clearInterval(this.typer);
    this.el.classList.remove('on');
    $('.narr', this.el).classList.remove('on');
    this.clearActors();
    const r = this.resolve; this.resolve = null;
    r && r();
  }
}
