// Campaign progress + settings, persisted in localStorage when available.
import { ALLIES, HEROES } from './data/units.js';

const KEY = 'lanternfall_save_v1';
const SKEY = 'lanternfall_settings_v1';

export function newSave(hero, difficulty = 'normal') {
  return {
    v: 1, hero, difficulty, chapter: 1, level: 1, xp: 0, valor: 0, talents: {}, gold: 150,
    flags: {}, unitLevels: {}, upgrades: {}, loadout: ['militia', 'footman', 'archer', 'bannerman'],
    seenUnlocks: [], stats: { kills: 0, battles: 0, lost: 0 }, created: Date.now(),
  };
}

export function loadSave() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
}
export function clearSave() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

export function loadSettings() {
  const d = { quality: 'medium', master: 0.8, music: 0.6, sfx: 0.8, sens: 1, invertY: false, help: true };
  try { const s = localStorage.getItem(SKEY); return s ? { ...d, ...JSON.parse(s) } : d; } catch (e) { return d; }
}
export function writeSettings(s) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

export function isUnlocked(a, save) {
  if (typeof a.unlock === 'number') return a.unlock < save.chapter;
  return !!save.flags[a.unlock];
}
export function unlockedAllies(save) { return ALLIES.filter(a => isUnlocked(a, save)); }
export function loadoutSize(save) { return Math.min(8, 4 + Math.floor((save.chapter - 1) * 0.8) + 1); }

// ---------------- arcade ----------------
// Kept apart from the story save: the last setup you used and your best score on each battlefield.
const AKEY = 'lanternfall_arcade_v1';
export function loadArcade() {
  const d = { last: null, best: {} };
  try { const s = localStorage.getItem(AKEY); return s ? { ...d, ...JSON.parse(s) } : d; } catch (e) { return d; }
}
export function writeArcade(a) { try { localStorage.setItem(AKEY, JSON.stringify(a)); } catch (e) { /* ignore */ } }

export const ARCADE_PICKS = 8;

// A ready-made army and Warden for an arcade battle on a given night: what a player who had
// fought through the story to that point would typically have.
export function arcadeSave(cfg) {
  const n = cfg.night;
  const s = newSave(cfg.hero, cfg.diff);
  s.chapter = n;
  s.loadout = cfg.picks.slice(0, 8);
  for (const k of ['spareCursed', 'orcs', 'redeemAldous']) s.flags[k] = true;
  const r = Math.max(0, n - 2);
  s.level = 1 + (n - 1) * 2;
  for (const k of ['walls', 'towers', 'barracks', 'armory', 'plate']) s.upgrades[k] = r;
  for (const k of ['lantern', 'horn']) s.upgrades[k] = Math.max(0, r - 1);
  if (n >= 3) for (const id of s.loadout) s.unitLevels[id] = n >= 5 ? 3 : 2;
  const t = Math.min(3, Math.floor((n - 1) / 2));
  for (const ab of HEROES[cfg.hero]?.abilities || []) s.talents[ab] = t;
  s.arcade = true;
  return s;
}
