// Dark procedural score + sound effects. Kenney CC0 samples for foley; everything else is synthesized.
import { A } from './assets.js';
import { Score } from './score.js';

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
// D natural minor / harmonic minor material
const CHORDS = { Dm: [50, 53, 57], Bb: [46, 50, 53], Gm: [43, 50, 55], A: [45, 49, 52], F: [41, 48, 53], C: [48, 52, 55], Eb: [51, 55, 58], Cm: [48, 51, 55] };

class Audio {
  constructor() {
    this.ctx = null; this.ready = false;
    this.vol = { master: 0.8, music: 0.6, sfx: 0.8 };
    this.buffers = {};
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
    this.mood = null; this.intensity = 0.3;
    this.lastPlay = {};
    this.heartbeat = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
    } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.vol.master;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.knee.value = 8;
    this.master.connect(comp); comp.connect(c.destination);
    this.music = c.createGain(); this.music.gain.value = this.vol.music;
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.vol.sfx;
    this.amb = c.createGain(); this.amb.gain.value = 0.5;
    this.reverb = c.createConvolver(); this.reverb.buffer = this.impulse(3.4, 2.2);
    this.revGain = c.createGain(); this.revGain.gain.value = 0.5;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this.music.connect(this.master); this.sfxBus.connect(this.master); this.amb.connect(this.master);
    this.musicSend = c.createGain(); this.musicSend.gain.value = 0.55; this.music.connect(this.musicSend); this.musicSend.connect(this.reverb);
    this.sfxSend = c.createGain(); this.sfxSend.gain.value = 0.22; this.sfxBus.connect(this.sfxSend); this.sfxSend.connect(this.reverb);
    this.noise = this.makeNoise(3);
    this.score = new Score(this);
    this.ready = true;
    for (const [k, buf] of Object.entries(A.sfx)) {
      c.decodeAudioData(buf.slice(0)).then(b => { this.buffers[k] = b; }).catch(() => {});
    }
    this.startScheduler();
    if (this.pendingMood) { const m = this.pendingMood; this.pendingMood = null; this.setMood(m.mood, m.biome); }
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ready) return;
    this.master.gain.value = this.vol.master;
    this.music.gain.value = this.vol.music;
    this.sfxBus.gain.value = this.vol.sfx;
  }

  impulse(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }
  makeNoise(sec) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // ---------- low-level building blocks ----------
  env(g, t, a, peak, d, sustain = 0, rel = 0.1) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (sustain > 0) { g.gain.setTargetAtTime(sustain, t + a, d / 3); }
    else g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  osc(type, f, t, dur, peak, dest, { a = 0.005, slide = 0, filter = null, detune = 0 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    const g = c.createGain();
    this.env(g, t, a, peak, dur);
    let node = o;
    if (filter) { const fl = c.createBiquadFilter(); fl.type = filter.type || 'lowpass'; fl.frequency.value = filter.f; fl.Q.value = filter.q || 0.7; o.connect(fl); node = fl; }
    node.connect(g); g.connect(dest);
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  noiseBurst(t, dur, peak, dest, { type = 'bandpass', f = 1000, q = 1, f2 = 0, a = 0.003 } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain(); this.env(g, t, a, peak, dur);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, Math.random() * 2); s.stop(t + a + dur + 0.05);
  }
  sample(name, t, vol, dest, rate = 1) {
    const b = this.buffers[name];
    if (!b) return false;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(g); g.connect(dest); s.start(t);
    return true;
  }

  // ---------- spatial sfx ----------
  // at = where the ears are (defaults to the camera); the camera still decides left/right
  setListener(cam, at = null) {
    const p = at || cam.position; this.listener.x = p.x; this.listener.y = p.y; this.listener.z = p.z;
    const e = cam.matrixWorld.elements; this.listener.rx = e[0]; this.listener.rz = e[2];
  }

  play(name, pos = null, vol = 1) {
    if (!this.ready) return;
    const c = this.ctx, now = c.currentTime;
    // rate-limit identical sounds
    const last = this.lastPlay[name] || 0;
    const gap = { step: 0.08, hit: 0.035, swing: 0.04, arrow: 0.03, bow: 0.03, death: 0.06 }[name] ?? 0.025;
    if (now - last < gap) return;
    this.lastPlay[name] = now;
    let v = vol, pan = 0;
    if (pos) {
      const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      v *= 1 / Math.pow(1 + d / 16, 1.4);
      if (v < 0.015) return;
      pan = Math.max(-1, Math.min(1, (dx * this.listener.rx + dz * this.listener.rz) / (d + 1)));
    }
    const g = c.createGain(); g.gain.value = v;
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) { p.pan.value = pan * 0.8; g.connect(p); p.connect(this.sfxBus); } else g.connect(this.sfxBus);
    this.sfx(name, now, g);
  }

  sfx(name, t, out) {
    const r = (a, b) => a + Math.random() * (b - a);
    switch (name) {
      case 'swing': this.noiseBurst(t, 0.16, 0.35, out, { f: r(1400, 1900), f2: 380, q: 1.4 }); break;
      case 'hit':
        if (!this.sample(Math.random() < 0.5 ? 'slash1' : 'slash2', t, 0.5, out, r(0.75, 0.95))) this.noiseBurst(t, 0.08, 0.5, out, { f: 1800, q: 0.8 });
        this.osc('sine', r(140, 170), t, 0.12, 0.4, out, { slide: 0.4 }); break;
      case 'clang': if (!this.sample('clang' + (1 + Math.floor(Math.random() * 3)), t, 0.32, out, r(0.55, 0.7))) this.osc('square', 900, t, 0.3, 0.1, out); this.noiseBurst(t, 0.05, 0.3, out, { f: 3000, type: 'highpass' }); break;
      case 'thud': this.osc('sine', 95, t, 0.5, 0.9, out, { slide: 0.35 }); this.noiseBurst(t, 0.35, 0.5, out, { type: 'lowpass', f: 380 }); break;
      case 'bow': this.osc('triangle', r(180, 220), t, 0.14, 0.25, out, { slide: 0.7 }); this.noiseBurst(t + 0.01, 0.2, 0.18, out, { f: 2400, f2: 900, q: 2 }); break;
      case 'crossbow': this.noiseBurst(t, 0.03, 0.4, out, { f: 3500, type: 'highpass' }); this.osc('square', 140, t, 0.08, 0.15, out, { slide: 0.5, filter: { f: 900 } }); break;
      case 'gun': this.noiseBurst(t, 0.25, 0.8, out, { type: 'lowpass', f: 2200, f2: 300 }); this.osc('sine', 70, t, 0.3, 0.8, out, { slide: 0.5 }); break;
      case 'cast': this.osc('sine', r(330, 380), t, 0.3, 0.18, out, { slide: 2.4 }); this.noiseBurst(t, 0.25, 0.12, out, { type: 'highpass', f: 4000 }); break;
      case 'hex': this.osc('square', 392, t, 0.4, 0.08, out, { slide: 0.6, filter: { f: 1200 } }); this.osc('square', 415, t, 0.4, 0.08, out, { slide: 0.62, filter: { f: 1200 } }); break;
      case 'fire': this.noiseBurst(t, 0.6, 0.5, out, { type: 'lowpass', f: 900, f2: 300 }); for (let i = 0; i < 6; i++) this.noiseBurst(t + Math.random() * 0.5, 0.02, 0.25, out, { type: 'highpass', f: 3000 }); break;
      case 'boom': this.osc('sine', 110, t, 1.1, 1.0, out, { slide: 0.25 }); this.noiseBurst(t, 1.0, 0.9, out, { type: 'lowpass', f: 700, f2: 90 }); break;
      case 'holy': [76, 80, 83].forEach((n, i) => this.osc('sine', NOTE(n), t + i * 0.02, 0.8, 0.07, out, { a: 0.02 })); break;
      case 'arrow': this.noiseBurst(t, 0.05, 0.35, out, { f: 700, q: 2 }); break;
      case 'catapult': this.sample('creak', t, 0.6, out, 0.8); this.noiseBurst(t + 0.15, 0.4, 0.3, out, { f: 600, f2: 200 }); break;
      case 'cannon': this.osc('sine', 80, t, 0.9, 1, out, { slide: 0.3 }); this.noiseBurst(t, 0.6, 1, out, { type: 'lowpass', f: 1500, f2: 120 }); break;
      case 'throw': case 'whoosh': this.noiseBurst(t, 0.3, 0.35, out, { f: 500, f2: 2200, q: 1.5 }); break;
      case 'charge': this.noiseBurst(t, 0.5, 0.35, out, { f: 300, f2: 1600, q: 2 }); break;
      case 'latch': if (!this.sample('latch', t, 0.7, out, 0.8)) this.noiseBurst(t, 0.05, 0.4, out, { f: 2500 }); break;
      case 'ice': for (let i = 0; i < 8; i++) this.osc('sine', r(1800, 3600), t + i * 0.03, 0.4, 0.05, out); this.noiseBurst(t, 0.5, 0.25, out, { type: 'highpass', f: 5000 }); break;
      case 'roar': case 'growl': {
        const base = name === 'roar' ? 110 : 75;
        this.osc('sawtooth', base, t, 0.9, 0.25, out, { a: 0.05, slide: 0.7, filter: { type: 'bandpass', f: 520, q: 3 } });
        this.osc('sawtooth', base * 1.02, t, 0.9, 0.25, out, { a: 0.05, slide: 0.66, filter: { type: 'bandpass', f: 900, q: 3 } });
        this.noiseBurst(t, 0.8, 0.2, out, { f: 600, q: 1 }); break;
      }
      case 'step': this.sample('step' + Math.floor(Math.random() * 5), t, 0.35, out, r(0.8, 1)); break;
      case 'cloth': this.sample(Math.random() < 0.5 ? 'cloth1' : 'cloth2', t, 0.6, out); break;
      case 'death':
        for (let i = 0; i < 10; i++) this.noiseBurst(t + i * 0.025 + Math.random() * 0.02, 0.012, 0.3, out, { type: 'highpass', f: 2500 });
        this.osc('sawtooth', 90, t, 0.6, 0.06, out, { slide: 0.6, filter: { f: 400 } }); break;
      case 'scream': this.osc('sawtooth', 520, t, 0.6, 0.12, out, { slide: 0.3, filter: { type: 'bandpass', f: 1200, q: 4 } }); this.noiseBurst(t, 0.5, 0.15, out, { f: 1600, f2: 400, q: 3 }); break;
      case 'manDeath': this.osc('sawtooth', 220, t, 0.5, 0.08, out, { slide: 0.5, filter: { type: 'bandpass', f: 800, q: 3 } }); break;
      case 'rise': this.noiseBurst(t, 0.8, 0.25, out, { f: 200, f2: 900, q: 2 }); for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.3 + i * 0.05, 0.012, 0.2, out, { type: 'highpass', f: 2500 }); break;
      case 'summon': if (!this.sample(Math.random() < 0.5 ? 'draw1' : 'draw2', t, 0.55, out)) this.noiseBurst(t, 0.2, 0.3, out, { f: 3000 }); this.osc('sine', NOTE(50), t, 0.6, 0.05, out, { a: 0.05 }); break;
      case 'horn': this.horn(t, out, 0.5, 1.4, [50, 57]); break;
      case 'warhorn': this.horn(t, out, 0.9, 3.2, [38, 45], 450); break;
      case 'bell': this.bell(t, out, NOTE(38), 0.5); break;
      case 'nova': this.noiseBurst(t, 1.2, 0.5, out, { f: 300, f2: 3000, q: 1 }); this.bell(t + 0.1, out, NOTE(62), 0.3); break;
      case 'thunder': this.noiseBurst(t, 3.2, 1.0, out, { type: 'lowpass', f: 400, f2: 60, a: 0.02 }); this.noiseBurst(t, 0.3, 0.6, out, { type: 'lowpass', f: 2500, f2: 300 }); break;
      case 'coins': this.sample('coins', t, 0.5, out); break;
      case 'page': this.sample(Math.random() < 0.5 ? 'page1' : 'page2', t, 0.4, out); break;
      case 'ui': this.sample('ui_click', t, 0.4, out, 0.8); break;
      case 'equip': if (!this.sample(Math.random() < 0.5 ? 'draw1' : 'draw2', t, 0.35, out, r(0.9, 1.1))) this.sample('ui_click', t, 0.4, out, 0.7); break;
      case 'hover': this.sample('ui_hover', t, 0.15, out, 0.7); break;
      case 'levelup': this.choir(t, out, [50, 57, 62, 66], 3, 0.06); this.bell(t, out, NOTE(62), 0.25); break;
      case 'unlock': this.bell(t, out, NOTE(57), 0.3); this.choir(t, out, [45, 52, 57], 2.4, 0.05); break;
      case 'gate': this.osc('sine', 60, t, 0.6, 0.9, out, { slide: 0.5 }); this.noiseBurst(t, 0.4, 0.5, out, { type: 'lowpass', f: 500 }); if (Math.random() < 0.3) this.sample('creak', t + 0.1, 0.4, out, 0.6); break;
      case 'stingVictory': this.horn(t, out, 0.6, 2.2, [50, 57, 62]); this.bell(t, out, NOTE(50), 0.45); this.choir(t + 0.4, out, [50, 54, 57, 62], 4, 0.07); break;
      case 'stingDefeat': [0, 1.8, 3.6].forEach(d => this.bell(t + d, out, NOTE(34), 0.5)); this.choir(t, out, [38, 41, 45], 6, 0.07); break;
      case 'heart': this.osc('sine', 55, t, 0.18, 0.9, out, { slide: 0.6 }); this.osc('sine', 50, t + 0.22, 0.2, 0.7, out, { slide: 0.6 }); break;
      case 'shriek': this.osc('sawtooth', 900, t, 1.4, 0.06, out, { a: 0.3, slide: 0.45, filter: { type: 'bandpass', f: 1400, q: 6 } }); this.noiseBurst(t, 1.4, 0.08, out, { f: 2000, f2: 500, q: 5, a: 0.3 }); break;
      default: break;
    }
  }

  horn(t, out, peak, dur, notes, cutoff = 900) {
    const c = this.ctx;
    for (const n of notes) {
      for (const det of [-6, 5]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        const f = NOTE(n);
        o.frequency.setValueAtTime(f * 0.94, t); o.frequency.linearRampToValueAtTime(f, t + 0.25);
        o.detune.value = det;
        const vib = c.createOscillator(); vib.frequency.value = 5; const vg = c.createGain(); vg.gain.value = 2.5; vib.connect(vg); vg.connect(o.frequency);
        const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(cutoff * 0.4, t); fl.frequency.linearRampToValueAtTime(cutoff, t + 0.4); fl.Q.value = 1.5;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak * 0.12, t + 0.35); g.gain.setValueAtTime(peak * 0.12, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(fl); fl.connect(g); g.connect(out);
        o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
      }
    }
  }

  bell(t, out, f, peak) {
    const c = this.ctx;
    for (const [ratio, amp, dec] of [[1, 1, 6], [2.0, 0.5, 4], [2.76, 0.4, 3], [5.4, 0.25, 1.8], [0.5, 0.6, 7]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * ratio;
      const m = c.createOscillator(); m.frequency.value = f * ratio * 1.41;
      const mg = c.createGain(); mg.gain.setValueAtTime(f * ratio * 0.9, t); mg.gain.exponentialRampToValueAtTime(1, t + dec * 0.4);
      m.connect(mg); mg.connect(o.frequency);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak * amp * 0.25, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(out);
      o.start(t); m.start(t); o.stop(t + dec + 0.1); m.stop(t + dec + 0.1);
    }
  }

  choir(t, out, notes, dur, peak) {
    const c = this.ctx;
    const formants = [[650, 9], [1080, 10], [2650, 12]];
    for (const n of notes) {
      const f = NOTE(n);
      const mix = c.createGain(); mix.gain.value = 1;
      for (const det of [-9, 0, 8]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + (Math.random() - 0.5) * 6;
        const vib = c.createOscillator(); vib.frequency.value = 4.5 + Math.random(); const vg = c.createGain(); vg.gain.value = f * 0.006; vib.connect(vg); vg.connect(o.frequency);
        o.connect(mix);
        o.start(t); vib.start(t); o.stop(t + dur + 2.2); vib.stop(t + dur + 2.2);
      }
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + Math.min(1.6, dur * 0.4)); g.gain.setValueAtTime(peak, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 2);
      for (const [ff, q] of formants) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q; mix.connect(bp); bp.connect(g); }
      g.connect(out);
    }
  }

  drum(t, out, f = 60, peak = 0.9, decay = 0.7) {
    this.osc('sine', f * 2.2, t, decay, peak, out, { slide: 1 / 2.2, a: 0.002 });
    this.noiseBurst(t, 0.12, peak * 0.4, out, { type: 'lowpass', f: 900, f2: 200 });
  }

  // ---------- ambience ----------
  startAmbience(biome) {
    if (!this.ready) return;
    this.stopAmbience();
    const c = this.ctx, t = c.currentTime;
    const nodes = [];
    // wind
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.9;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(bp.frequency);
    const wg = c.createGain(); wg.gain.value = biome === 'highforge' ? 0.32 : 0.16;
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = c.createGain(); lg2.gain.value = wg.gain.value * 0.6; lfo2.connect(lg2); lg2.connect(wg.gain);
    s.connect(bp); bp.connect(wg); wg.connect(this.amb);
    s.start(t); lfo.start(t); lfo2.start(t);
    nodes.push(s, lfo, lfo2);
    // rain hiss
    if (biome === 'drowned') {
      const rs = c.createBufferSource(); rs.buffer = this.noise; rs.loop = true;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      const rg = c.createGain(); rg.gain.value = 0.09;
      rs.connect(hp); hp.connect(rg); rg.connect(this.amb); rs.start(t); nodes.push(rs);
    }
    this.ambNodes = { nodes, gains: [wg] };
  }
  stopAmbience() {
    if (!this.ambNodes) return;
    const t = this.ctx.currentTime;
    for (const g of this.ambNodes.gains) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, 0.6); }
    const ns = this.ambNodes.nodes;
    setTimeout(() => ns.forEach(n => { try { n.stop(); } catch (e) {} }), 3000);
    this.ambNodes = null;
  }

  // ---------- music (see score.js) ----------
  setMood(mood, biome) {
    if (!this.ready) { this.pendingMood = { mood, biome }; return; }
    if (mood === this.mood && biome === this.biome) return;
    this.mood = mood; this.biome = biome;
    this.score.setMood(mood, biome, this.ctx.currentTime);
  }
  // what the battle is doing right now, for the score to follow
  battleState(s) { if (this.score) this.score.setBattle(s); }
  cue(name) { if (this.ready && this.ctx.state === 'running') this.score.cue(name, this.ctx.currentTime + 0.03); }

  startScheduler() {
    setInterval(() => this.schedule(), 60);
  }

  schedule() {
    if (!this.ready || this.ctx.state !== 'running') return;
    this.score.schedule(this.ctx.currentTime);
  }
}

export const audio = new Audio();
