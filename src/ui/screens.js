// Menus: title, hero select, chapter cards, prologue, war camp, results, pause, settings, credits, ending.
import { A } from '../core/assets.js';
import { HEROES, ABILITIES, ALLIES, ENEMIES } from '../game/data/units.js';
import { CHAPTERS, PROLOGUE, UPGRADES, UNIT_LEVEL_COSTS, NEW_FOES } from '../game/data/campaign.js';
import { DIFFICULTY } from '../game/battle.js';
import { isUnlocked, loadoutSize, writeSave, writeSettings, loadArcade, writeArcade } from '../game/save.js';
import { icon } from './icons.js';
import { audio } from '../core/audio.js';
import { QUALITY } from '../core/renderer.js';

const $ = (s, r = document) => r.querySelector(s);
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export class Screens {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.cur = null;
    root.addEventListener('mouseover', e => { if (e.target.closest('button:not([disabled])')) audio.play('hover'); });
    root.addEventListener('click', e => { if (e.target.closest('button')) audio.play('ui'); }, true);
  }

  show(el) {
    if (this.cur && this.cur !== el) { const old = this.cur; old.classList.remove('on'); setTimeout(() => old.remove(), 450); }
    this.cur = el;
    if (el) { this.root.appendChild(el); requestAnimationFrame(() => el.classList.add('on')); }
  }
  hide() { this.show(null); }

  // ---------------- title ----------------
  title(save) {
    const ch = save && CHAPTERS[Math.min(save.chapter, 6) - 1];
    const el = h(`<div class="screen title-screen">
      <div class="logo"><h1>Lanternfall</h1><p>When the last light dies, the fog comes for you.</p></div>
      <nav class="menu">
        <button class="btn primary" data-a="arcade">Arcade<small>Any eight troops · any battlefield</small></button>
        ${save && save.chapter <= 6 ? `<button class="btn" data-a="continue">Continue Story<small>Chapter ${ROMAN[save.chapter]} · ${ch.title}</small></button>` : ''}
        <button class="btn" data-a="new">${save ? 'New Story' : 'Story Campaign'}</button>
        <button class="btn" data-a="settings">Settings</button>
        <button class="btn" data-a="credits">Credits</button>
        ${canFullscreen() ? `<button class="btn" data-a="fullscreen">${document.fullscreenElement ? 'Leave full screen' : 'Full screen'}</button>` : ''}
      </nav>
      <div class="foot">An original dark-fantasy siege game · inspired by the castle-defense classics</div>
    </div>`);
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      audio.init();
      if (a === 'arcade') this.game.toArcade();
      if (a === 'continue') this.game.continueCampaign();
      if (a === 'new') { if (save) this.confirm('Begin a new campaign? Your current progress will be lost.', () => this.heroSelect()); else this.heroSelect(); }
      if (a === 'settings') this.settings(() => this.title(save));
      if (a === 'credits') this.credits(() => this.title(save));
      if (a === 'fullscreen') toggleFullscreen().then(() => setTimeout(() => this.title(save), 250));
    });
    this.show(el);
  }

  confirm(text, yes, no) {
    const el = h(`<div class="modal"><div class="panel"><p>${text}</p><div class="row"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">Confirm</button></div></div></div>`);
    el.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; el.remove(); if (a === 'yes') yes(); else no && no(); });
    this.root.appendChild(el);
  }

  // ---------------- hero select ----------------
  heroSelect() {
    let diff = 'normal';
    let pick = 'knight';
    const stat = (v, max) => `<div class="pip"><i style="width:${Math.min(100, v / max * 100)}%"></i></div>`;
    const el = h(`<div class="screen hero-screen">
      <h2 class="screen-title">Choose your Warden</h2>
      <div class="hero-cards">${Object.values(HEROES).map(hr => `
        <div class="hero-card ${hr.id === pick ? 'sel' : ''}" data-h="${hr.id}">
          <div class="por"><img src="${A.portraits['hero_' + hr.id] || ''}" alt=""></div>
          <h3>${hr.name}</h3><div class="sub">${hr.title}</div>
          <p>${hr.blurb}</p>
          <div class="stats">
            <label>Health</label>${stat(hr.hp, 620)}
            <label>Damage</label>${stat(hr.dmg * (hr.melee ? 1 : 1.25), 50)}
            <label>Speed</label>${stat(hr.speed - 4, 3)}
            <label>Range</label>${stat(hr.melee ? 1 : 3, 3)}
          </div>
          <div class="abl">${hr.abilities.map((a, i) => `<span title="${ABILITIES[a].desc}">${icon(ABILITIES[a].icon, 18)}<b>${['Q', 'E', 'F', 'R'][i]}</b> ${ABILITIES[a].name}</span>`).join('')}</div>
        </div>`).join('')}
      </div>
      <div class="diff">${Object.entries(DIFFICULTY).map(([k, d]) => `<button class="chip ${k === diff ? 'sel' : ''}" data-d="${k}">${d.label}</button>`).join('')}
        <span class="dnote"></span></div>
      <div class="row"><button class="btn" data-a="back">Back</button><button class="btn primary" data-a="go">Begin the Vigil</button></div>
    </div>`);
    const notes = { story: 'For the story. The dead hit softer and your walls stand longer.', normal: 'The intended vigil. The fog will test you.', hard: 'Merciless. For those who have already survived it once.' };
    const upd = () => { $('.dnote', el).textContent = notes[diff]; };
    upd();
    el.addEventListener('click', e => {
      const c = e.target.closest('[data-h]');
      if (c) { pick = c.dataset.h; el.querySelectorAll('.hero-card').forEach(x => x.classList.toggle('sel', x === c)); }
      const d = e.target.closest('[data-d]');
      if (d) { diff = d.dataset.d; el.querySelectorAll('.chip').forEach(x => x.classList.toggle('sel', x === d)); upd(); }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'back') this.game.toTitle();
      if (a === 'go') this.game.newCampaign(pick, diff);
    });
    this.show(el);
  }

  // ---------------- arcade ----------------
  arcade() {
    const store = loadArcade();
    const valid = id => ALLIES.some(a => a.id === id);
    const cfg = { hero: 'knight', diff: 'normal', night: 1, picks: ['footman', 'shieldbearer', 'pikeman', 'archer', 'adept', 'cleric', 'bannerman', 'paladin'], ...(store.last || {}) };
    cfg.picks = (cfg.picks || []).filter(valid).slice(0, 8);
    let filter = 'all', info = null;
    const ROLE = a => a.anim === 'siege' ? 'heavy' : (a.anim === 'support' || a.special?.heal || a.special?.regrowth) ? 'support'
      : a.range > 4 ? 'ranged' : (a.pop >= 3 || /^large/.test(a.anim)) ? 'heavy'
      : (/shield/i.test(a.anim) || a.armor >= 6 || a.anim === 'spear') ? 'front' : 'melee';
    const FILTERS = { all: 'All', front: 'Front line', melee: 'Fighters', ranged: 'Ranged', support: 'Support', heavy: 'Giants & siege' };
    const ORDER = ['Dawnhold', 'Lantern Order', 'Thornwood', 'Highforge', 'Red Maw', 'The Unquiet', 'Wanderers'];
    const roster = ALLIES.slice().sort((a, b) => ORDER.indexOf(a.faction) - ORDER.indexOf(b.faction) || a.cost - b.cost);
    const foesOf = n => {
      const c = CHAPTERS[n - 1];
      const ids = new Set(c.waves.flatMap(w => w.spawn.map(x => x[0])));
      for (const [t] of NEW_FOES[n] || []) ids.add(t);
      return [...ids].filter(k => ENEMIES[k]).concat(c.boss.type);
    };
    const best = n => store.best[`${n}:${cfg.diff}`];
    const el = h(`<div class="screen arcade-screen">
      <header><div><div class="eyebrow">Arcade</div><h2>Choose your eight</h2></div><div class="arc-count"></div></header>
      <div class="arc-body">
        <section class="arc-setup">
          <h4>Warden</h4><div class="arc-heroes"></div>
          <h4>Battlefield</h4><div class="arc-nights"></div>
          <h4>Difficulty</h4><div class="chips arc-diff"></div>
          <h4>In the fog tonight</h4><div class="arc-foes"></div>
        </section>
        <section class="arc-roster"><div class="arc-filters"></div><div class="grid"></div></section>
      </div>
      <div class="arc-dock"><div class="arc-info"></div>
      <footer><button class="btn" data-a="back">Back</button><div class="loadout"></div><button class="btn" data-a="random">Random eight</button><button class="btn primary" data-a="go">Fight</button></footer></div>
    </div>`);
    const save = () => { store.last = { ...cfg }; writeArcade(store); };
    const setInfo = (html) => { info = html; $('.arc-info', el).innerHTML = html || `<span class="hint">Tap a troop to add it to your eight; tap it again to send it home. Every troop costs coin in battle, and coin is always short. Up to 50 soldiers can hold the field at once. Mix a front line, shooters and healers.</span>`; };
    const unitInfo = a => `<img src="${A.portraits['ally_' + a.id]}"><div><b>${a.name}</b>${a.count > 1 ? ` ×${a.count}` : ''} <span class="fac">${a.faction}</span><div class="kvs"><span>${icon('sun', 12)} ${a.cost} coin</span><span>Army ${a.pop * a.count}</span><span>${a.range > 4 ? 'Range ' + a.range : 'Melee'}</span><span>HP ${a.hp}</span><span>DMG ${a.dmg}</span>${a.limit < 99 ? `<span>Max ${a.limit}</span>` : ''}</div><p>${a.desc}</p></div>`;
    const foeInfo = k => { const e = ENEMIES[k]; return `<img src="${A.portraits['enemy_' + k] || ''}"><div><b>${e.name}</b> <span class="fac">${e.boss ? 'Boss' : 'Enemy'}</span><div class="kvs"><span>HP ${e.hp}</span><span>DMG ${e.dmg}</span><span>${e.range > 4 ? 'Range ' + e.range : 'Melee'}</span></div><p>${e.desc || ''}</p></div>`; };
    const heroInfo = hr => `<img src="${A.portraits['hero_' + hr.id]}"><div><b>${hr.name}</b> <span class="fac">${hr.title}</span><p>${hr.blurb}</p><div class="kvs">${hr.abilities.map(ab => `<span>${icon(ABILITIES[ab].icon, 12)} ${ABILITIES[ab].name}</span>`).join('')}</div></div>`;

    const render = () => {
      $('.arc-heroes', el).innerHTML = Object.values(HEROES).map(hr => `<button class="arc-hero ${cfg.hero === hr.id ? 'sel' : ''}" data-h="${hr.id}"><img src="${A.portraits['hero_' + hr.id] || ''}"><b>${hr.name}</b><small>${hr.title}</small></button>`).join('');
      $('.arc-nights', el).innerHTML = CHAPTERS.map(c => { const b = best(c.n); return `<button class="arc-night ${cfg.night === c.n ? 'sel' : ''}" data-n="${c.n}"><i>${ROMAN[c.n]}</i><b>${c.title}</b><small>${c.place}${b ? ` · best ${b.score.toLocaleString()}${b.win ? ' ' + b.rank : ''}` : ''}</small></button>`; }).join('');
      $('.arc-diff', el).innerHTML = Object.entries(DIFFICULTY).map(([k, d]) => `<button class="chip ${k === cfg.diff ? 'sel' : ''}" data-d="${k}">${d.label}</button>`).join('');
      $('.arc-foes', el).innerHTML = foesOf(cfg.night).map(k => `<button class="arc-foe ${ENEMIES[k].boss ? 'boss' : ''}" data-f="${k}" title="${ENEMIES[k].name}"><img src="${A.portraits['enemy_' + k] || ''}"></button>`).join('');
      $('.arc-filters', el).innerHTML = Object.entries(FILTERS).map(([k, l]) => `<button class="chip ${filter === k ? 'sel' : ''}" data-filter="${k}">${l}</button>`).join('');
      $('.arc-roster .grid', el).innerHTML = roster.filter(a => filter === 'all' || ROLE(a) === filter).map(a => {
        const i = cfg.picks.indexOf(a.id);
        return `<div class="ucard ${i >= 0 ? 'in' : ''}" data-u="${a.id}"><img src="${A.portraits['ally_' + a.id]}" alt=""><span class="c">${a.cost}</span>${i >= 0 ? `<span class="pick">${i + 1}</span>` : ''}<div class="nm">${a.name}</div></div>`;
      }).join('');
      $('.loadout', el).innerHTML = `<label>Your eight</label>` + Array.from({ length: 8 }, (_, i) => {
        const a = cfg.picks[i] && ALLIES.find(x => x.id === cfg.picks[i]);
        return a ? `<div class="slot" data-rm="${a.id}" title="Remove ${a.name}"><img src="${A.portraits['ally_' + a.id]}"><span>${a.cost}</span></div>` : `<div class="slot empty"></div>`;
      }).join('');
      $('.arc-count', el).innerHTML = `<b>${ALLIES.length}</b> troops · <b>${Object.keys(ENEMIES).length}</b> horrors`;
      $('[data-a="go"]', el).disabled = !cfg.picks.length;
    };
    const randomSix = () => {
      // a sensible random army: a front line, fighters, shooters, a healer and support, then two wild cards
      const pool = r => roster.filter(a => ROLE(a) === r && !cfg.picks.includes(a.id));
      const take = r => { const p = pool(r); if (p.length) cfg.picks.push(p[Math.floor(Math.random() * p.length)].id); };
      cfg.picks = [];
      take('front'); take('front'); take('melee'); take('ranged'); take('ranged'); take('support');
      take(['heavy', 'melee', 'ranged', 'front'][Math.floor(Math.random() * 4)]);
      take(['heavy', 'melee', 'ranged', 'support'][Math.floor(Math.random() * 4)]);
    };
    el.addEventListener('click', e => {
      const t = e.target;
      const hh = t.closest('[data-h]'); if (hh) { cfg.hero = hh.dataset.h; setInfo(heroInfo(HEROES[cfg.hero])); save(); render(); return; }
      const n = t.closest('[data-n]'); if (n) { cfg.night = +n.dataset.n; save(); render(); return; }
      const d = t.closest('[data-d]'); if (d) { cfg.diff = d.dataset.d; save(); render(); return; }
      const f = t.closest('[data-f]'); if (f) { setInfo(foeInfo(f.dataset.f)); return; }
      const fl = t.closest('[data-filter]'); if (fl) { filter = fl.dataset.filter; render(); return; }
      const rm = t.closest('[data-rm]'); if (rm) { cfg.picks = cfg.picks.filter(x => x !== rm.dataset.rm); save(); render(); return; }
      const u = t.closest('[data-u]');
      if (u) {
        const id = u.dataset.u, a = ALLIES.find(x => x.id === id);
        const i = cfg.picks.indexOf(id);
        if (i >= 0) cfg.picks.splice(i, 1);
        else if (cfg.picks.length < 8) { cfg.picks.push(id); audio.play('equip', null, 0.4); }
        else { setInfo(unitInfo(a) + `<em class="full">Your eight are chosen. Remove one first.</em>`); return; }
        setInfo(unitInfo(a)); save(); render(); return;
      }
      const a = t.closest('[data-a]')?.dataset.a;
      if (a === 'back') this.game.toTitle();
      if (a === 'random') { randomSix(); save(); render(); setInfo(null); }
      if (a === 'go') {
        if (!cfg.picks.length) return;
        const go = () => this.game.startArcade({ hero: cfg.hero, diff: cfg.diff, night: cfg.night, picks: cfg.picks.slice() });
        if (cfg.picks.length < 8) this.confirm(`March with only ${cfg.picks.length} of eight?`, go); else go();
      }
    });
    el.addEventListener('mouseover', e => {
      if (matchMedia('(pointer: coarse)').matches) return;
      const u = e.target.closest('[data-u]'); if (u) return setInfo(unitInfo(ALLIES.find(x => x.id === u.dataset.u)));
      const f = e.target.closest('[data-f]'); if (f) return setInfo(foeInfo(f.dataset.f));
    });
    render(); setInfo(null);
    this.show(el);
  }

  arcadeResults(win, d) {
    return new Promise(res => {
      const t = `${Math.floor(d.time / 60)}:${String(Math.floor(d.time % 60)).padStart(2, '0')}`;
      const c = CHAPTERS[d.cfg.night - 1];
      const el = h(`<div class="screen results arcade-results ${win ? 'win' : 'lose'}">
        <div class="eyebrow">Arcade · Night ${ROMAN[c.n]} · ${c.title} · ${DIFFICULTY[d.cfg.diff].label}</div>
        <h1>${win ? 'Dawn Breaks' : 'The Walls Fall'}</h1>
        <div class="arc-score"><div class="rank r-${d.rank === '—' ? 'x' : d.rank}">${d.rank}</div><div><div class="num">${d.score.toLocaleString()}</div>
          <div class="sub">${d.record ? '<b class="rec">New best!</b>' : d.prev ? `Best: ${d.prev.score.toLocaleString()}` : ''}</div></div></div>
        <div class="kv big">
          ${d.parts.map(([k, v, pts]) => `<span>${k} <em>${v}</em></span><b>+${pts.toLocaleString()}</b>`).join('')}
          ${d.mult !== 1 ? `<span>${DIFFICULTY[d.cfg.diff].label}</span><b>×${d.mult}</b>` : ''}
          <span>Soldiers called · lost</span><b>${d.summoned} · ${d.lost}</b>
          <span>Time</span><b>${t}</b>
        </div>
        <div class="row arc-six">${d.cfg.picks.map(id => `<div class="slot"><img src="${A.portraits['ally_' + id]}"></div>`).join('')}</div>
        <div class="row"><button class="btn" data-a="title">Title</button><button class="btn" data-a="troops">Change troops</button><button class="btn primary" data-a="again">Play again</button></div>
      </div>`);
      el.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { this.hide(); res(a); } });
      this.show(el);
      audio.play(win ? 'unlock' : 'bell', null, 0.6);
    });
  }

  // ---------------- story cards ----------------
  prologue() {
    return new Promise(res => {
      const el = h(`<div class="screen prologue"><p></p><small>Click to continue</small></div>`);
      let i = -1;
      const next = () => {
        i++;
        if (i >= PROLOGUE.length) { el.removeEventListener('click', next); this.hide(); setTimeout(res, 300); return; }
        const p = $('p', el); p.classList.remove('in'); void p.offsetWidth;
        p.textContent = PROLOGUE[i]; p.classList.add('in');
        audio.play(i === PROLOGUE.length - 1 ? 'bell' : 'page', null, 0.5);
      };
      el.addEventListener('click', next);
      this.show(el);
      setTimeout(next, 500);
    });
  }

  chapterCard(ch, label = `Chapter ${ROMAN[ch.n]}`, ms = 3000) {
    return new Promise(res => {
      const el = h(`<div class="screen chapter-card"><div class="n">${label}</div><h1>${ch.title}</h1><div class="p">${ch.place}</div></div>`);
      this.show(el);
      audio.play('bell', null, 0.5);
      setTimeout(() => { this.hide(); setTimeout(res, 350); }, ms);
    });
  }

  // ---------------- war camp ----------------
  camp(save) {
    const ch = CHAPTERS[save.chapter - 1];
    let tab = this.lastTab || 'muster';
    let selected = null;
    const el = h(`<div class="screen camp-screen">
      <header><div><div class="eyebrow">War camp · before Chapter ${ROMAN[ch.n]}</div><h2>${ch.title} <span>${ch.place}</span></h2></div>
        <div class="purse"><span class="gold">${icon('sun', 16)} <b></b> gold</span><span class="valor">${icon('banner', 16)} <b></b> valor</span></div></header>
      <nav class="tabs"><button data-t="muster">Muster</button><button data-t="fortify">Fortify</button><button data-t="hero">Warden</button><button data-t="chronicle">Chronicle</button></nav>
      <main></main>
      <footer><button class="btn" data-a="title">Quit to title</button><div class="loadout"></div><button class="btn primary" data-a="march">March to battle</button></footer>
    </div>`);
    const main = $('main', el);
    const save_ = () => writeSave(save);
    const purse = () => { $('.gold b', el).textContent = save.gold; $('.valor b', el).textContent = save.valor; };
    const maxLoad = loadoutSize(save);

    const loadout = () => {
      const box = $('.loadout', el);
      box.innerHTML = `<label>Battle loadout ${save.loadout.length}/${maxLoad}</label>` + Array.from({ length: maxLoad }, (_, i) => {
        const id = save.loadout[i];
        const a = id && ALLIES.find(x => x.id === id);
        return a ? `<div class="slot" data-rm="${id}" title="Remove ${a.name}"><img src="${A.portraits['ally_' + id]}"><span>${a.cost}</span></div>` : `<div class="slot empty"></div>`;
      }).join('');
    };

    const detail = (a) => {
      const lvl = save.unitLevels[a.id] || 1;
      const unlocked = isUnlocked(a, save);
      const inLoad = save.loadout.includes(a.id);
      const cost = UNIT_LEVEL_COSTS[lvl - 1];
      const rows = [['Health', a.hp], ['Damage', a.dmg], ['Range', a.range > 4 ? a.range : 'Melee'], ['Speed', a.speed], ['Coin cost', a.cost], ['Army size', a.pop * a.count]];
      return `<div class="detail">
        <button class="sheet-close" data-close aria-label="Close">✕</button>
        <div class="dpor"><img src="${A.portraits['ally_' + a.id]}"></div>
        <div class="dbody"><div class="eyebrow">${a.faction}</div><h3>${a.name}${a.count > 1 ? ` <small>×${a.count}</small>` : ''}</h3>
          <div class="stars">${[1, 2, 3].map(s => `<i class="${s <= lvl ? 'on' : ''}"></i>`).join('')} <span>${['Recruit', 'Veteran', 'Elite'][lvl - 1]}</span></div>
          <p>${a.desc}</p><p class="lore">${a.lore}</p>
          <div class="kv">${rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
          <div class="row">
            ${unlocked ? `<button class="btn" data-load="${a.id}" ${!inLoad && save.loadout.length >= maxLoad ? 'disabled' : ''}>${inLoad ? 'Remove from loadout' : 'Add to loadout'}</button>` : ''}
            ${unlocked && lvl < 3 ? `<button class="btn primary" data-lvl="${a.id}" ${save.gold < cost ? 'disabled' : ''}>Train to ${['', 'Veteran', 'Elite'][lvl]} · ${cost} gold</button>` : ''}
          </div></div></div>`;
    };

    const render = () => {
      el.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('sel', b.dataset.t === tab));
      purse(); loadout();
      if (tab === 'muster') {
        const ORDER = ['Dawnhold', 'Lantern Order', 'Thornwood', 'Highforge', 'Red Maw', 'The Unquiet', 'Wanderers'];
        const groups = {};
        for (const f of ORDER) groups[f] = [];
        for (const a of ALLIES) (groups[a.faction] = groups[a.faction] || []).push(a);
        for (const f of Object.keys(groups)) if (!groups[f].length) delete groups[f];
        const lockText = a => typeof a.unlock === 'number' ? `After Chapter ${ROMAN[a.unlock]}` : ({ spareCursed: 'Spare the cursed', orcs: 'Shelter the Red Maw', redeemAldous: 'Redeem the fallen knight' }[a.unlock] || 'Locked');
        main.innerHTML = `<div class="muster ${selected ? 'has-sel' : ''}"><div class="roster">${Object.entries(groups).map(([f, list]) => `
          <h4>${f}</h4><div class="grid">${list.map(a => {
            const u = isUnlocked(a, save);
            const lvl = save.unitLevels[a.id] || 1;
            return `<div class="ucard ${u ? '' : 'locked'} ${save.loadout.includes(a.id) ? 'in' : ''} ${selected === a.id ? 'sel' : ''}" data-u="${a.id}">
              <img src="${A.portraits['ally_' + a.id]}" alt=""><span class="c">${a.cost}</span>${u ? `<span class="lv">${'★'.repeat(lvl)}</span>` : `<span class="lk">${lockText(a)}</span>`}<div class="nm">${a.name}</div></div>`;
          }).join('')}</div>`).join('')}</div>
          <aside>${selected ? detail(ALLIES.find(a => a.id === selected)) : '<div class="hint">Choose a unit to see its role, lore and training.<br><br>Up to ' + maxLoad + ' units can march with you. Calling a unit in battle costs coin from your war chest. Coin builds up over time, from kills, and faster with Bannermen and rekindled Lantern Shrines. Units you call fall into formation and fight on their own.</div>'}</aside></div>`;
      } else if (tab === 'fortify') {
        const list = ['walls', 'towers', 'lantern', 'horn', 'barracks'];
        main.innerHTML = `<div class="upgrades">${list.map(k => upgradeRow(k)).join('')}</div>`;
      } else if (tab === 'hero') {
        const hr = HEROES[save.hero];
        main.innerHTML = `<div class="herotab">
          <div class="hcol"><div class="dpor big"><img src="${A.portraits['hero_' + save.hero]}"></div><h3>${hr.name}</h3><div class="sub">Level ${save.level} · ${hr.title}</div>
          <div class="upgrades small">${upgradeRow('armory')}${upgradeRow('plate')}</div></div>
          <div class="talents"><h4>Talents <small>Each rank: +25% power, −10% cooldown. Valor is earned by levelling up.</small></h4>${hr.abilities.map((ab, i) => {
            const r = save.talents[ab] || 0;
            const cost = r + 1;
            return `<div class="talent"><div class="ic">${icon(ABILITIES[ab].icon, 30)}<kbd>${['Q', 'E', 'F', 'R'][i]}</kbd></div><div><b>${ABILITIES[ab].name}</b><p>${ABILITIES[ab].desc}</p><div class="ranks">${[1, 2, 3].map(x => `<i class="${x <= r ? 'on' : ''}"></i>`).join('')}</div></div>
              ${r < 3 ? `<button class="btn" data-tal="${ab}" ${save.valor < cost ? 'disabled' : ''}>Rank ${r + 1} · ${cost} valor</button>` : '<span class="max">Mastered</span>'}</div>`;
          }).join('')}</div></div>`;
      } else {
        const done = CHAPTERS.filter(c => c.n < save.chapter);
        const f = save.flags;
        const choiceText = { spareCursed: 'You spared the cursed of the Thornwood.', burnedCursed: 'You burned the cursed of the Thornwood.', orcs: 'You opened the gate to the Red Maw.', executedGorza: 'You executed Warchief Gorza.', redeemAldous: 'You redeemed Sir Aldous.', restAldous: 'You gave Sir Aldous rest, and took up his blade.' };
        const seen = new Set(CHAPTERS.filter(c => c.n <= save.chapter).flatMap(c => c.waves.flatMap(w => w.spawn.map(s => s[0])).concat(c.boss.type)));
        main.innerHTML = `<div class="chronicle"><div class="col"><h4>The vigil so far</h4>${done.length ? done.map(c => `<div class="entry"><b>Chapter ${ROMAN[c.n]} · ${c.title}</b><span>${c.place}</span></div>`).join('') : '<p class="hint">The first night has not yet fallen.</p>'}
          ${Object.keys(choiceText).filter(k => f[k]).map(k => `<p class="choice-made">${choiceText[k]}</p>`).join('')}
          <div class="stats-line">Hollow slain: <b>${save.stats.kills}</b> · Battles won: <b>${save.stats.battles}</b> · Soldiers lost: <b>${save.stats.lost}</b></div></div>
          <div class="col"><h4>Bestiary</h4><div class="beasts">${Object.entries(ENEMIES).filter(([k]) => seen.has(k)).map(([k, e]) => `<div class="beast ${e.boss ? 'boss' : ''}"><img src="${A.portraits['enemy_' + k] || ''}"><span>${e.name}</span></div>`).join('')}</div></div></div>`;
      }
    };

    const upgradeRow = (k) => {
      const u = UPGRADES[k];
      const r = save.upgrades[k] || 0;
      const cost = u.costs[r];
      return `<div class="uprow"><div><b>${u.name}</b><p>${u.desc}</p><div class="ranks">${u.costs.map((_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}</div></div>
        ${r < u.costs.length ? `<button class="btn" data-up="${k}" ${save.gold < cost ? 'disabled' : ''}>Rank ${r + 1} · ${cost} gold</button>` : '<span class="max">Complete</span>'}</div>`;
    };

    el.addEventListener('click', e => {
      const t = e.target.closest('[data-t]'); if (t) { tab = this.lastTab = t.dataset.t; render(); return; }
      if (e.target.closest('[data-close]')) { selected = null; render(); return; }
      const u = e.target.closest('[data-u]'); if (u) { selected = u.dataset.u; render(); return; }
      const ld = e.target.closest('[data-load]');
      if (ld) { const id = ld.dataset.load; const i = save.loadout.indexOf(id); if (i >= 0) save.loadout.splice(i, 1); else if (save.loadout.length < maxLoad) save.loadout.push(id); save_(); render(); return; }
      const rm = e.target.closest('[data-rm]'); if (rm) { save.loadout = save.loadout.filter(x => x !== rm.dataset.rm); save_(); render(); return; }
      const lv = e.target.closest('[data-lvl]');
      if (lv) { const id = lv.dataset.lvl; const l = save.unitLevels[id] || 1; const c = UNIT_LEVEL_COSTS[l - 1]; if (save.gold >= c) { save.gold -= c; save.unitLevels[id] = l + 1; audio.play('coins'); save_(); render(); } return; }
      const up = e.target.closest('[data-up]');
      if (up) { const k = up.dataset.up; const r = save.upgrades[k] || 0; const c = UPGRADES[k].costs[r]; if (save.gold >= c) { save.gold -= c; save.upgrades[k] = r + 1; audio.play('coins'); save_(); render(); } return; }
      const tl = e.target.closest('[data-tal]');
      if (tl) { const k = tl.dataset.tal; const r = save.talents[k] || 0; if (save.valor >= r + 1) { save.valor -= r + 1; save.talents[k] = r + 1; audio.play('unlock'); save_(); render(); } return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'title') this.game.toTitle();
      if (a === 'march') {
        if (!save.loadout.length) { this.confirm('March with no soldiers in your loadout?', () => this.game.startChapter(save.chapter)); return; }
        this.game.startChapter(save.chapter);
      }
    });
    render();
    this.show(el);
  }

  // ---------------- results ----------------
  results(win, data) {
    return new Promise(res => {
      const unlockHtml = data.unlocks.length ? `<div class="unlocks"><h4>New allies answer the call</h4><div class="row">${data.unlocks.map(a => `<div class="ucard"><img src="${A.portraits['ally_' + a.id]}"><div class="nm">${a.name}</div></div>`).join('')}</div></div>` : '';
      const el = h(`<div class="screen results ${win ? 'win' : 'lose'}">
        <h1>${win ? 'The Fog Recedes' : 'The Lantern Goes Dark'}</h1>
        <p class="sub">${win ? `${data.chapter.rift.replace(/^the /, 'The ')} is broken.` : 'Dawnhold has fallen. But the vigil is not over.'}</p>
        <div class="kv big">
          <span>Hollow slain</span><b>${data.kills}</b>
          <span>Soldiers called in</span><b>${data.summoned}</b>
          <span>Soldiers lost</span><b>${data.lost}</b>
          <span>Time</span><b>${Math.floor(data.time / 60)}:${String(Math.floor(data.time % 60)).padStart(2, '0')}</b>
          <span>Gold</span><b>+${data.gold}</b>
          ${data.levels ? `<span>Levels gained</span><b>+${data.levels} (+${data.levels} valor)</b>` : ''}
        </div>
        ${unlockHtml}
        <div class="row">${win ? '<button class="btn primary" data-a="go">Continue</button>' : '<button class="btn" data-a="camp">Return to camp</button><button class="btn primary" data-a="retry">Try again</button>'}</div>
      </div>`);
      el.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { this.hide(); res(a); } });
      this.show(el);
    });
  }

  // ---------------- pause / settings / credits ----------------
  pause(onResume, onAction, arcade = false) {
    const el = h(`<div class="screen pause"><div class="panel"><h2>The vigil waits</h2>
      <button class="btn primary" data-a="resume">Resume</button>
      <button class="btn" data-a="settings">Settings</button>
      <button class="btn" data-a="restart">${arcade ? 'Restart battle' : 'Restart chapter'}</button>
      <button class="btn" data-a="camp">${arcade ? 'Change troops' : 'Retreat to camp'}</button>
      <button class="btn" data-a="title">Quit to title</button>
      <div class="controls">${CONTROLS}</div></div></div>`);
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'resume') { this.hide(); onResume(); }
      else if (a === 'settings') this.settings(() => this.pause(onResume, onAction, arcade), true);
      else onAction(a);
    });
    this.show(el);
  }

  settings(back, overlay = false) {
    const s = this.game.settings;
    const el = h(`<div class="screen settings"><div class="panel"><h2>Settings</h2>
      <label>Graphics quality</label><div class="chips">${Object.entries(QUALITY).map(([k, q]) => `<button class="chip ${s.quality === k ? 'sel' : ''}" data-q="${k}">${q.label}</button>`).join('')}</div>
      <p class="hint">High and Ultra add ambient occlusion. The game lowers its resolution on its own if the frame rate drops.</p>
      ${['master', 'music', 'sfx'].map(k => `<label>${{ master: 'Master volume', music: 'Music', sfx: 'Effects' }[k]}</label><input type="range" min="0" max="1" step="0.05" value="${s[k]}" data-v="${k}">`).join('')}
      <label class="check"><input type="checkbox" data-c="help" ${s.help ? 'checked' : ''}> Show control hints</label>
      <button class="btn primary" data-a="back">Done</button></div></div>`);
    el.addEventListener('input', e => {
      const v = e.target.dataset.v, c = e.target.dataset.c;
      if (v) { s[v] = parseFloat(e.target.value); this.game.applySettings(); }
      if (c) { s[c] = e.target.checked; this.game.applySettings(); }
      writeSettings(s);
    });
    el.addEventListener('click', e => {
      const q = e.target.closest('[data-q]');
      if (q) { s.quality = q.dataset.q; el.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('sel', x === q)); writeSettings(s); this.game.applySettings(true); }
      if (e.target.closest('[data-a="back"]')) back();
    });
    this.show(el);
  }

  credits(back) {
    const el = h(`<div class="screen credits"><div class="panel"><h2>Lanternfall</h2>
      <p>An original dark-fantasy siege game built in the spirit of the castle-defense action games of the mobile era: a hero on the field, a fortress at your back, and an army you call to your aid.</p>
      <h4>Art</h4><p>Characters, animations, castles, forests and graveyard pieces by <b>Kay Lousberg</b> (KayKit), released under CC0.</p>
      <h4>Sound</h4><p>Foley and interface sounds by <b>Kenney</b>, released under CC0. Score and creature sounds synthesized in the browser.</p>
      <h4>Technology</h4><p>three.js (MIT) · N8AO ambient occlusion · meshoptimizer · Google Fonts: Grenze Gotisch, Cinzel, IM Fell English (OFL).</p>
      <button class="btn primary" data-a="back">Back</button></div></div>`);
    el.addEventListener('click', e => { if (e.target.closest('[data-a]')) back(); });
    this.show(el);
  }

  ending(flag) {
    return new Promise(res => {
      const el = h(`<div class="screen ending"><h1>${flag === 'sever' ? 'The Lantern Is Dark' : 'The Light Holds'}</h1><p>${flag === 'sever' ? 'The dead are at peace. The Warden was never seen again.' : 'The dead do not rest. But Dawnhold stands.'}</p><div class="end">— The End —</div><button class="btn primary" data-a="ok">Return to title</button></div>`);
      el.addEventListener('click', e => { if (e.target.closest('[data-a]')) { this.hide(); res(); } });
      this.show(el);
      audio.play('bell', null, 0.6);
    });
  }
}

// Full screen is offered on touch devices whose browser allows it (Android; not iPhone Safari)
function canFullscreen() {
  try { return !!document.fullscreenEnabled && matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (e) { /* refused (e.g. inside an embedded viewer): nothing to do */ }
}

export const CONTROLS = matchMedia('(pointer: coarse)').matches
  ? `<b>Move</b> Tap the ground · <b>Attack</b> Tap an enemy, or let your hero pick the nearest<br><b>Spells</b> Tap a spell button, it finds its own target<br><b>Call support</b> Tap a unit card, paid from your war chest · <b>Zoom</b> Pinch · <b>Pause</b> the button in the corner`
  : `<b>Move</b> Click the ground (or WASD) · <b>Attack</b> Click an enemy, or let your hero pick the nearest<br><b>Spells</b> Q E F R, one tap each, they find their own targets<br><b>Call support</b> 1–8 or click a card, paid from your war chest · <b>Zoom</b> Mouse wheel · <b>Pause</b> Esc`;
