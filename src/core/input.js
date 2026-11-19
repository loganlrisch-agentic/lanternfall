// Keyboard, mouse (pointer lock with drag fallback) and touch input, sampled once per frame.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { l: false, r: false };
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    this.edges = new Set();
    this.locked = false;
    this.lockWanted = false;
    this.enabled = false;
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, attack: false, block: false };
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.empty = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, attackDown: false, attackUp: false, attackHeld: false, block: false, dodge: false, sprint: false, aim: false, ability: {}, summon: -1, command: null };
    const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    window.addEventListener('keydown', e => {
      if (typing(e)) return;
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
      if (this.enabled && ['Space', 'Tab', 'KeyQ', 'KeyE', 'KeyF', 'KeyR'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (this.lockWanted && !this.locked) { this.requestLock(); if (e.button === 0) return; }
      if (e.button === 0) { this.mouse.l = true; this.edges.add('MouseL'); }
      if (e.button === 2) { this.mouse.r = true; this.edges.add('MouseR'); }
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0 && this.mouse.l) { this.mouse.l = false; this.edges.add('MouseLUp'); }
      if (e.button === 2) this.mouse.r = false;
    });
    window.addEventListener('mousemove', e => {
      if (!this.enabled) return;
      if (this.locked || this.mouse.r) { this.look.x += e.movementX || 0; this.look.y += e.movementY || 0; }
    });
    canvas.addEventListener('wheel', e => { if (this.enabled) { this.zoom += e.deltaY; e.preventDefault(); } }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (this.onLockChange) this.onLockChange(this.locked); });
    document.addEventListener('pointerlockerror', () => { this.locked = false; this.lockFailed = true; });
  }

  requestLock() {
    this.lockWanted = true;
    if (this.isTouch || this.lockFailed) return;
    try {
      const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockFailed = true; });
    } catch (e) { this.lockFailed = true; }
  }
  releaseLock() { this.lockWanted = false; if (document.pointerLockElement) try { document.exitPointerLock(); } catch (e) {} }

  pressed(code) { return this.edges.has(code); }

  frame() {
    if (!this.enabled) { this.edges.clear(); this.look.x = this.look.y = 0; this.zoom = 0; return this.empty; }
    const k = c => this.keys.has(c);
    let mx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let my = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    if (this.touch.move.x || this.touch.move.y) { mx = this.touch.move.x; my = this.touch.move.y; }
    const t = this.touch;
    const f = {
      move: { x: mx, y: my },
      look: { x: this.look.x + t.look.x, y: this.look.y + t.look.y },
      zoom: this.zoom,
      attackDown: this.edges.has('MouseL') || this.edges.has('TouchAttack'),
      attackUp: this.edges.has('MouseLUp') || this.edges.has('TouchAttackUp'),
      attackHeld: this.mouse.l || t.attack,
      block: (this.mouse.r && this.locked) || t.block || k('KeyV'),
      aim: this.mouse.r && this.locked,
      dodge: this.edges.has('Space') || this.edges.has('TouchDodge'),
      sprint: k('ShiftLeft') || k('ShiftRight'),
      ability: { Q: this.edges.has('KeyQ'), E: this.edges.has('KeyE'), F: this.edges.has('KeyF'), R: this.edges.has('KeyR') },
      summon: -1,
      command: this.edges.has('KeyZ') ? 'charge' : this.edges.has('KeyX') ? 'hold' : this.edges.has('KeyC') ? 'rally' : null,
      pause: this.edges.has('Escape') || this.edges.has('KeyP'),
    };
    for (let i = 1; i <= 8; i++) if (this.edges.has('Digit' + i) || this.edges.has('Numpad' + i)) f.summon = i - 1;
    for (const key of ['Q', 'E', 'F', 'R']) if (this.edges.has('Touch' + key)) f.ability[key] = true;
    for (let i = 0; i < 8; i++) if (this.edges.has('TouchCard' + i)) f.summon = i;
    for (const c of ['charge', 'hold', 'rally']) if (this.edges.has('TouchCmd_' + c)) f.command = c;
    this.edges.clear();
    this.look.x = this.look.y = 0; t.look.x = t.look.y = 0;
    this.zoom = 0;
    return f;
  }

  edge(name) { this.edges.add(name); }
}
