// Campaign progress + settings, persisted in localStorage when available.
import { ALLIES } from './data/units.js';

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
