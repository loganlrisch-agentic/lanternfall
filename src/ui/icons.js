// Small stroke icons for abilities and commands (original SVG glyphs).
const P = {
  charge: '<path d="M4 20 L14 10 M10 6 h8 v8 M14 10 L20 4"/><path d="M3 13 l4 4"/>',
  banner: '<path d="M6 21 V3"/><path d="M6 4 h11 l-3 4 3 4 H6"/>',
  spin: '<path d="M12 3 a9 9 0 1 1 -8.5 6"/><path d="M3 4 v5 h5"/><path d="M12 8 l2 4 -2 4 -2 -4z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  arrows: '<path d="M5 3 l3 10 M11 2 l1 11 M17 3 l-3 10"/><path d="M4 16 h16 M7 19 h10"/>',
  smoke: '<path d="M6 15 a4 4 0 0 1 2-7 a5 5 0 0 1 9 1 a3.5 3.5 0 0 1 0 7 H7"/><path d="M8 20 h8"/>',
  trap: '<path d="M3 15 l3-6 3 6 3-6 3 6 3-6 3 6"/><path d="M3 19 h18"/>',
  raven: '<path d="M2 12 c4-1 6-5 10-5 c3 0 4 2 4 2 l5 1 -5 2 c0 4-4 7-9 7 c2-2 2-4 1-5 c-2 1-4 1-6-2z"/>',
  flame: '<path d="M12 22 c-4 0 -7-3 -7-7 c0-4 3-6 4-10 c2 3 3 4 4 7 c1-2 2-3 2-5 c3 3 4 6 4 8 c0 4-3 7-7 7z"/>',
  blink: '<circle cx="6" cy="12" r="2"/><circle cx="18" cy="12" r="3"/><path d="M8 12 h2 M12 12 h2"/><path d="M15 6 l3 -3 M15 18 l3 3"/>',
  frost: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  meteor: '<circle cx="15" cy="15" r="4.5"/><path d="M3 3 l8 8 M3 8 l5 5 M8 3 l5 5"/>',
  leap: '<path d="M4 20 c2-10 14-14 16-6"/><path d="M17 11 l3 3 -4 1"/><path d="M3 21 h6"/>',
  blood: '<path d="M12 3 c3 5 6 8 6 12 a6 6 0 0 1 -12 0 c0-4 3-7 6-12z"/><path d="M9 15 a3 3 0 0 0 3 3"/>',
  quake: '<path d="M2 18 h4 l2-5 3 8 3-12 3 9 2-3 h3"/><path d="M5 5 l3 3 M19 5 l-3 3"/>',
  hold: '<path d="M12 3 l8 3 v6 c0 5-4 8-8 9 c-4-1-8-4-8-9 V6z"/>',
  rally: '<path d="M12 21 V8"/><path d="M5 12 l7-7 7 7"/><circle cx="12" cy="3" r="1.4"/>',
  attack: '<path d="M14 4 l6 0 0 6 -10 10 -6 -6z"/><path d="M4 14 l-2 6 6-2"/>',
  dodge: '<path d="M4 16 c4 0 6-8 12-8"/><path d="M13 5 l3 3 -3 3"/><path d="M4 20 h5"/>',
  shield: '<path d="M12 3 l8 3 v6 c0 5-4 8-8 9 c-4-1-8-4-8-9 V6z"/><path d="M12 7 v10"/>',
};
export function icon(name, size = 26) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.attack}</svg>`;
}
