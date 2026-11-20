// Keyboard, mouse and touch input, sampled once per frame.
// Commander controls: click (or tap) the battlefield to move or pick a target,
// WASD also walks, Q E F R cast, 1-8 call support, wheel zooms, Esc pauses.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.zoom = 0;
    this.enabled = false;
    this.clicks = [];
    this.pointer = { x: 0, y: 0, inside: false };   // normalised device coords
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.empty = { move: { x: 0, y: 0 }, zoom: 0, click: null, ability: {}, summon: -1, pause: false };
    const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    window.addEventListener('keydown', e => {
      if (typing(e)) return;
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
      if (this.enabled && ['Space', 'Tab', 'KeyQ', 'KeyE', 'KeyF', 'KeyR'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    const ndc = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 };
    };
    // pointer events cover mouse, pen and touch alike; a tap is a click
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      const p = ndc(e.clientX, e.clientY);
      this.clicks.push({ x: p.x, y: p.y, button: e.button === 2 ? 2 : 0 });
    });
    canvas.addEventListener('pointermove', e => {
      const p = ndc(e.clientX, e.clientY);
      this.pointer.x = p.x; this.pointer.y = p.y; this.pointer.inside = true;
    });
    canvas.addEventListener('pointerleave', () => { this.pointer.inside = false; });
    canvas.addEventListener('wheel', e => { if (this.enabled) { this.zoom += e.deltaY; e.preventDefault(); } }, { passive: false });
  }

  pressed(code) { return this.edges.has(code); }

  frame() {
    if (!this.enabled) { this.edges.clear(); this.clicks.length = 0; this.zoom = 0; return this.empty; }
    const k = c => this.keys.has(c);
    const mx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const my = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    const f = {
      move: { x: mx, y: my },
      zoom: this.zoom,
      click: this.clicks.length ? this.clicks[this.clicks.length - 1] : null,
      ability: { Q: this.edges.has('KeyQ'), E: this.edges.has('KeyE'), F: this.edges.has('KeyF'), R: this.edges.has('KeyR') },
      summon: -1,
      pause: this.edges.has('Escape') || this.edges.has('KeyP'),
    };
    for (let i = 1; i <= 8; i++) if (this.edges.has('Digit' + i) || this.edges.has('Numpad' + i)) f.summon = i - 1;
    for (const key of ['Q', 'E', 'F', 'R']) if (this.edges.has('Touch' + key)) f.ability[key] = true;
    for (let i = 0; i < 8; i++) if (this.edges.has('TouchCard' + i)) f.summon = i;
    this.edges.clear();
    this.clicks.length = 0;
    this.zoom = 0;
    return f;
  }

  edge(name) { this.edges.add(name); }
  // kept so older call sites stay harmless
  requestLock() {}
  releaseLock() {}
}
