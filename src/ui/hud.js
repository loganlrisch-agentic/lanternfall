// In-battle HUD: hero frame, wave/objective, castle & rift bars, minimap, summon cards, abilities, floating text.
import * as THREE from 'three';
import { A } from '../core/assets.js';
import { ABILITIES } from '../game/data/units.js';
import { MAP, roadZ, TEAM } from '../game/config.js';
import { icon } from './icons.js';
import { clamp } from '../core/util.js';
import { audio } from '../core/audio.js';

const $ = (s, r = document) => r.querySelector(s);
const _p = new THREE.Vector3();

export class HUD {
  constructor(root, input) {
    this.root = root;
    this.input = input;
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="hud-hero">
        <div class="hud-portrait"><img alt=""></div>
        <div class="hud-bars">
          <div class="hud-name"><span class="n"></span><span class="lvl"></span></div>
          <div class="bar hp"><i></i><b></b></div>
          <div class="bar xp"><i></i></div>
        </div>
      </div>
      <div class="hud-top">
        <div class="hud-wave"><span class="w"></span><span class="o"></span></div>
        <div class="hud-struct">
          <div class="sbar castle"><label>Dawnhold</label><div class="bar"><i></i></div></div>
          <div class="sbar rift"><label></label><div class="bar"><i></i></div><span class="shield" title="Shielded until the last wave breaks">${icon('shield', 16)}</span></div>
        </div>
        <div class="hud-boss"><label></label><div class="bar"><i></i><b></b></div></div>
      </div>
      <canvas class="hud-map" width="260" height="104"></canvas>
      <div class="hud-bottom">
        <div class="hud-cp"><div class="cp-orb" title="War chest: coin builds up over time and from kills"><span class="v">0</span><small>COIN</small></div><div class="cp-meta"><span class="rate"></span><span class="pop"></span></div></div>
        <div class="hud-cards"></div>
      </div>
      <div class="hud-abil"></div>
      <div class="hud-toast"></div>
      <div class="hud-banner"><h1></h1><p></p></div>
      <div class="hud-voice"></div>
      <div class="hud-respawn"></div>
      <div class="hud-flash"></div>
      <div class="hud-help">Click the ground to move · click an enemy to attack · Q E F R spells · 1–8 call support · wheel to zoom · Esc pause</div>
    `;
    root.appendChild(this.el);
    this.overlay = document.createElement('canvas');
    this.overlay.id = 'overlay';
    root.appendChild(this.overlay);
    this.ctx = this.overlay.getContext('2d');
    this.mapCtx = $('.hud-map', this.el).getContext('2d');
    this.floats = [];
    this.toastT = 0; this.bannerT = 0; this.voiceT = 0; this.flashT = 0;
    this.boss = null;
    this.hurtV = 0;
    this.setupTouch();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.show(false);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(window.innerWidth * dpr);
    this.overlay.height = Math.round(window.innerHeight * dpr);
    this.overlay.style.width = window.innerWidth + 'px';
    this.overlay.style.height = window.innerHeight + 'px';
    this.dpr = dpr;
  }

  setupTouch() {
    // taps on the battlefield arrive as clicks through Input; buttons and cards handle themselves
    if (this.input.isTouch) this.el.classList.add('touch');
  }

  setup(B) {
    this.B = B;
    const hero = B.hero;
    $('.hud-portrait img', this.el).src = A.portraits['hero_' + hero.classId] || '';
    $('.hud-name .n', this.el).textContent = hero.cls.name;
    $('.sbar.rift label', this.el).textContent = B.chapter.rift.replace(/^the /, 'The ');
    // cards
    const cards = $('.hud-cards', this.el);
    cards.innerHTML = '';
    B.cards.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'hud-card';
      d.innerHTML = `<img src="${A.portraits['ally_' + c.def.id] || ''}" alt=""><span class="cost">${c.def.cost}</span><kbd>${i + 1}</kbd><div class="cd"></div><div class="nm">${c.def.name}</div>${c.def.count > 1 ? `<span class="cnt">×${c.def.count}</span>` : ''}`;
      d.title = `${c.def.name} — ${c.def.desc}`;
      const fire = e => { e.preventDefault(); this.input.edge('TouchCard' + i); };
      d.addEventListener('mousedown', fire);
      d.addEventListener('touchstart', fire, { passive: false });
      cards.appendChild(d);
      c.el = d;
    });
    // abilities
    const ab = $('.hud-abil', this.el);
    ab.innerHTML = '';
    hero.cls.abilities.forEach((id, i) => {
      const a = ABILITIES[id];
      const key = ['Q', 'E', 'F', 'R'][i];
      const d = document.createElement('div');
      d.className = 'hud-ab' + (i === 3 ? ' ult' : '');
      d.innerHTML = `${icon(a.icon, i === 3 ? 34 : 28)}<kbd>${key}</kbd><div class="sweep"></div><span class="t"></span>`;
      d.title = `${a.name} — ${a.desc}`;
      const fire = e => { e.preventDefault(); this.input.edge('Touch' + key); };
      d.addEventListener('mousedown', fire);
      d.addEventListener('touchstart', fire, { passive: false });
      ab.appendChild(d);
      d.dataset.ab = id;
    });
    this.abEls = [...ab.children];
    this.boss = null;
    $('.hud-boss', this.el).classList.remove('on');
    this.floats.length = 0;
  }

  show(on) { this.el.classList.toggle('on', on); this.overlay.style.display = on ? 'block' : 'none'; }
  toast(msg, t = 2) { const e = $('.hud-toast', this.el); e.textContent = msg; e.classList.add('on'); this.toastT = t; }
  banner(title, sub = '', t = 3) { const e = $('.hud-banner', this.el); $('h1', e).textContent = title; $('p', e).textContent = sub; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); this.bannerT = t; }
  voice(text) { const e = $('.hud-voice', this.el); e.innerHTML = `<b>A Voice in the Fog</b> ${text}`; e.classList.add('on'); this.voiceT = 4.5; audio.play('shriek', null, 0.15); }
  objective(text) { $('.hud-wave .o', this.el).textContent = text; }
  bossBar(u) { this.boss = u; const e = $('.hud-boss', this.el); e.classList.toggle('on', !!u); if (u) $('label', e).textContent = u.def.name; }
  hurt(a) { this.hurtV = Math.min(1, this.hurtV + a); }
  screenFlash(color, a) { const e = $('.hud-flash', this.el); e.style.background = color; e.style.opacity = a; this.flashT = 0.5; }
  flashAbility(id) { const e = this.abEls?.find(x => x.dataset.ab === id); if (e) { e.classList.remove('fire'); void e.offsetWidth; e.classList.add('fire'); } }
  damageNumber(pos, amount, color = '#fff', big = false) {
    if (this.floats.length > 60) this.floats.shift();
    this.floats.push({ pos: pos.clone(), text: Math.round(amount).toString(), color, t: 0, life: big ? 1.2 : 0.9, big, dx: (Math.random() - 0.5) * 30 });
  }

  update(dt, B) {
    const hero = B.hero;
    // hero frame
    $('.hud-name .lvl', this.el).textContent = 'Lv ' + hero.level;
    $('.bar.hp i', this.el).style.width = (hero.hp / hero.maxHp * 100) + '%';
    $('.bar.hp b', this.el).textContent = `${Math.ceil(hero.hp)} / ${hero.maxHp}`;
    $('.bar.xp i', this.el).style.width = ((hero.xpPool || 0) / hero.xpToNext() * 100) + '%';
    // wave
    const w = B.waveIdx;
    $('.hud-wave .w', this.el).textContent = B.bossSpawned ? 'The stronghold is exposed' : w < 0 ? `The fog gathers… ${Math.ceil(B.waveTimer)}s` : `Wave ${w + 1} / ${B.chapter.waves.length}`;
    $('.sbar.castle i', this.el).style.width = (B.castle.hp / B.castle.maxHp * 100) + '%';
    $('.sbar.castle', this.el).classList.toggle('low', B.castle.hp / B.castle.maxHp < 0.3);
    $('.sbar.rift i', this.el).style.width = (B.rift.hp / B.rift.maxHp * 100) + '%';
    $('.sbar.rift', this.el).classList.toggle('shielded', B.rift.invulnerable);
    if (this.boss) {
      const b = $('.hud-boss', this.el);
      $('i', b).style.width = (Math.max(0, this.boss.hp) / this.boss.maxHp * 100) + '%';
      $('b', b).textContent = Math.max(0, Math.ceil(this.boss.hp)).toLocaleString();
      if (!this.boss.alive) this.bossBar(null);
    }
    // cp & cards
    $('.cp-orb .v', this.el).textContent = Math.floor(B.coins);
    $('.cp-orb', this.el).style.setProperty('--fill', (B.coins / B.coinMax * 100) + '%');
    $('.cp-meta .rate', this.el).textContent = `+${(B.coinRate || 0).toFixed(1)}/s`;
    $('.cp-meta .pop', this.el).textContent = `Army ${B.pop}/${B.popCap}`;
    for (const c of B.cards) {
      if (!c.el) continue;
      const can = B.coins >= c.def.cost && c.cd <= 0;
      c.el.classList.toggle('ready', can);
      c.el.classList.toggle('poor', B.coins < c.def.cost);
      const cd = c.el.querySelector('.cd');
      cd.style.height = c.cd > 0 ? (c.cd / c.def.cd * 100) + '%' : '0%';
    }
    // abilities
    hero.cls.abilities.forEach((id, i) => {
      const e = this.abEls[i];
      const cd = hero.cooldowns[id], max = hero.abilityCd(id);
      e.querySelector('.sweep').style.background = cd > 0 ? `conic-gradient(rgba(5,4,8,0.78) ${cd / max * 360}deg, transparent 0)` : 'none';
      e.querySelector('.t').textContent = cd > 0 ? Math.ceil(cd) : '';
      e.classList.toggle('ready', cd <= 0);
    });
    // timers
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('.hud-toast', this.el).classList.remove('on'); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) $('.hud-banner', this.el).classList.remove('on'); }
    if (this.voiceT > 0) { this.voiceT -= dt; if (this.voiceT <= 0) $('.hud-voice', this.el).classList.remove('on'); }
    if (this.flashT > 0) { this.flashT -= dt; const f = $('.hud-flash', this.el); f.style.opacity = Math.max(0, parseFloat(f.style.opacity) - dt * 2); }
    const resp = $('.hud-respawn', this.el);
    if (!hero.alive && B.state === 'fight') { resp.classList.add('on'); resp.textContent = `Returning to the keep in ${Math.ceil(B.respawnT)}…`; } else resp.classList.remove('on');
    // hurt vignette
    this.hurtV = Math.max(0, this.hurtV - dt * 1.2);
    const lowHp = hero.alive ? clamp(1 - hero.hp / hero.maxHp / 0.35, 0, 1) * 0.5 : 0.6;
    if (B.game.R.grade) B.game.R.grade.uniforms.uHurt.value = Math.max(this.hurtV, lowHp);
    this.drawOverlay(dt, B);
    this.drawMap(B);
  }

  drawOverlay(dt, B) {
    const ctx = this.ctx, dpr = this.dpr;
    const W = window.innerWidth, H = window.innerHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cam = B.world.camera;
    if (B.state !== 'fight' && B.state !== 'victory') return;
    // health bars
    for (const u of B.units) {
      if (!u.alive || u.isHero || u.isBoss) continue;
      if (u.hp >= u.maxHp && u.team === TEAM.PLAYER) continue;
      if (u.hp >= u.maxHp && u.team === TEAM.ENEMY && !u.target?.isHero) continue;
      _p.copy(u.pos); _p.y += u.isLarge ? 4.6 : 2.5;
      const d = _p.distanceTo(cam.position);
      if (d > 60) continue;
      _p.project(cam);
      if (_p.z > 1 || _p.z < -1) continue;
      const x = (_p.x * 0.5 + 0.5) * W, y = (-_p.y * 0.5 + 0.5) * H;
      const w = (u.isLarge ? 64 : 38) * clamp(14 / d + 0.35, 0.45, 1.2), h = u.isLarge ? 5 : 4;
      ctx.fillStyle = 'rgba(8,6,8,0.75)';
      ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = u.team === TEAM.PLAYER ? '#d8b25a' : (B.enemyRim || '#a04aff');
      ctx.fillRect(x - w / 2, y, w * clamp(u.hp / u.maxHp, 0, 1), h);
      if (u.status.stun || u.status.freeze || u.status.root) { ctx.fillStyle = '#9fd8ff'; ctx.fillRect(x - w / 2, y - 3, w, 1.5); }
    }
    // floating numbers
    ctx.textAlign = 'center';
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      if (f.t > f.life) { this.floats.splice(i, 1); continue; }
      _p.copy(f.pos); _p.y += f.t * 1.4;
      _p.project(cam);
      if (_p.z > 1) continue;
      const x = (_p.x * 0.5 + 0.5) * W + f.dx * f.t, y = (-_p.y * 0.5 + 0.5) * H;
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k * k;
      const size = (f.big ? 26 : 17) * (1 + (1 - Math.min(1, f.t * 8)) * 0.5);
      ctx.font = `700 ${size}px "Cinzel", Georgia, serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  drawMap(B) {
    const c = this.mapCtx, W = 260, H = 104;
    const X = x => (x - MAP.xMin) / (MAP.xMax - MAP.xMin) * W;
    const Z = z => (z + 36) / 72 * H;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(10,10,14,0.82)'; c.fillRect(0, 0, W, H);
    // fog on the enemy side
    const g = c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(120,110,150,0.25)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(150,130,100,0.35)'; c.lineWidth = 3; c.beginPath();
    for (let x = MAP.castleX; x <= MAP.fortressX; x += 4) { const px = X(x), pz = Z(roadZ(x)); x === MAP.castleX ? c.moveTo(px, pz) : c.lineTo(px, pz); }
    c.stroke();
    c.strokeStyle = '#c8a860'; c.lineWidth = 3; c.beginPath(); c.moveTo(X(MAP.castleX), Z(-31)); c.lineTo(X(MAP.castleX), Z(31)); c.stroke();
    const rp = B.rift.pos;
    c.fillStyle = B.rift.invulnerable ? 'rgba(160,90,255,0.5)' : (performance.now() % 600 < 300 ? '#d090ff' : '#8a4aff');
    c.beginPath(); c.arc(X(rp.x), Z(rp.z), 6, 0, 6.28); c.fill();
    for (const s of B.level.shrines) {
      c.fillStyle = s.owner === 0 ? '#ffc870' : s.owner === 1 ? '#a04aff' : '#777';
      c.save(); c.translate(X(s.pos.x), Z(s.pos.z)); c.rotate(Math.PI / 4); c.fillRect(-4, -4, 8, 8); c.restore();
    }
    for (const u of B.units) {
      if (!u.alive || u.isHero) continue;
      c.fillStyle = u.team === TEAM.PLAYER ? '#e8c070' : (u.isBoss ? '#ff4a4a' : '#c0485a');
      const r = u.isBoss ? 4 : u.isLarge ? 2.6 : 1.6;
      c.fillRect(X(u.pos.x) - r, Z(u.pos.z) - r, r * 2, r * 2);
    }
    const h = B.hero;
    if (h.alive) {
      c.save(); c.translate(X(h.pos.x), Z(h.pos.z)); c.rotate(-h.facing + Math.PI);
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 4); c.lineTo(-4, 4); c.closePath(); c.fill(); c.restore();
    }
  }
}
