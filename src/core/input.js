// Keyboard, mouse and touch input, sampled once per frame.
// Commander controls: click (or tap) the battlefield to move or pick a target,
// WASD also walks, Q E F R cast, 1-8 call support, wheel or pinch zooms, Esc pauses.
// Touch: a tap counts on release (so a pinch or a drag never sends a move order).
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
    // pointer events cover mouse, pen and touch alike
    const touches = new Map();      // pointerId -> { x0, y0, x, y, t0 }
    let pinchD = 0, pinchUsed = false;
    const spread = () => { const t = [...touches.values()]; return t.length < 2 ? 0 : Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y); };
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (e.button !== 0 && e.button !== 2) return;
        const p = ndc(e.clientX, e.clientY);
        this.clicks.push({ x: p.x, y: p.y, button: e.button === 2 ? 2 : 0 });
        return;
      }
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      touches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() });
      if (touches.size === 1) pinchUsed = false;
      if (touches.size === 2) { pinchD = spread(); pinchUsed = true; }
    });
    canvas.addEventListener('pointermove', e => {
      const p = ndc(e.clientX, e.clientY);
      if (e.pointerType === 'mouse') { this.pointer.x = p.x; this.pointer.y = p.y; this.pointer.inside = true; return; }
      const t = touches.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX; t.y = e.clientY;
      if (touches.size >= 2 && this.enabled) {
        const d = spread();
        if (pinchD > 0) this.zoom += (pinchD - d) * 4;   // fingers apart = zoom in
        pinchD = d;
      }
    });
    const lift = e => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      touches.delete(e.pointerId);
      if (touches.size < 2) pinchD = 0;
      if (e.type !== 'pointerup' || !this.enabled || pinchUsed) return;
      const moved = Math.hypot(e.clientX - t.x0, e.clientY - t.y0);
      if (moved < 18 && performance.now() - t.t0 < 600) {
        const p = ndc(e.clientX, e.clientY);
        this.clicks.push({ x: p.x, y: p.y, button: 0 });
      }
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.pointer.inside = false; });
    // iOS Safari: stop the page itself from pinch-zooming
    for (const g of ['gesturestart', 'gesturechange']) document.addEventListener(g, e => e.preventDefault(), { passive: false });
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
      pause: this.edges.has('Escape') || this.edges.has('KeyP') || this.edges.has('TouchPause'),
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
