// Lanternfall's adaptive score. Everything is synthesized live with Web Audio, so there are no music files to download.
//
// The battle tells the score what is happening (enemies on the field, how close they are to the walls, how long until
// the next wave, the boss, the castle's health) and the score layers war drums, low string ostinatos, tremolo strings,
// choir, doom brass, bells and whispers to match. Each battlefield has its own key, mode and "fear": the later nights
// are darker and more dissonant, and the quiet before every wave is built to make you dread what comes out of the fog.
//
// Two recurring ideas tie it together: the Lantern theme (hope; it turns major at dawn) and the Hollow call, three
// falling notes ending on a tritone, which the brass sounds whenever the enemy is coming.

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

// tonic (MIDI, low register), fear 0..1, ostinato style, colours
const FIELDS = {
  title:     { root: 38, fear: 0.3, ost: 'drive', bells: true },
  dawnhold:  { root: 38, fear: 0.35, ost: 'drive', bells: true },
  thornwood: { root: 40, fear: 0.5, ost: 'gallop', whisper: 1.4 },
  highforge: { root: 35, fear: 0.55, ost: 'drive', metal: true, harmonic: true },
  redmaw:    { root: 33, fear: 0.66, ost: 'gallop', metal: true, tribal: true },
  drowned:   { root: 36, fear: 0.82, ost: 'spic', bells: true, organ: true },
  citadel:   { root: 42, fear: 1.0, ost: 'odd', bells: true, odd: true },
};

// chords as semitones above the tonic
const PROG = {
  lull:      [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [0, 3, 7]],     // i  bVI  iv  i
  lullDark:  [[0, 3, 7], [-4, -1, 3], [0, 3, 6], [1, 5, 8]],     // i  bvi  i°  bII
  fight:     [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]],     // i  i  bVI  bVII
  fightH:    [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-5, -1, 2]],    // i  i  bVI  V
  fightDark: [[0, 3, 7], [-4, -1, 3], [1, 5, 8], [-5, -1, 2]],   // i  bvi  bII  V
  boss:      [[0, 3, 7], [1, 5, 8], [-4, -1, 3], [-6, -3, 0]],   // i  bII  bvi  (tritone)
  menu:      [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [-5, -1, 2]],   // i  bVI  iv  V
  camp:      [[0, 3, 7], [3, 7, 10], [-2, 2, 5], [5, 8, 12]],    // i  bIII  bVII  iv
};

// ostinato patterns: r = root, f = fifth, o = octave, . = rest
const OST = {
  drive:  'rrorrrorrrorfrof',
  gallop: 'r.rrr.rrr.rro.f.',
  spic:   'r.o.f.o.r.o.f.r.',
  odd:    'rrorroorrorfof',          // 7/8
};

// [step, semitones, length in steps]; 4 bars of 16ths
const LANTERN = [[0, 0, 4], [4, 3, 4], [8, 7, 6], [14, 8, 2], [16, 7, 4], [20, 3, 4], [24, 5, 8], [32, 2, 4], [36, 3, 4], [40, 7, 8], [48, 0, 16]];
const MAJOR = { 3: 4, 8: 9, 10: 11 };
const HOLLOW = [[0, 0, 8], [8, -1, 8], [16, -6, 16]];

const VOWELS = {
  ah: [[720, 4.5, 1], [1180, 5.5, 0.6], [2700, 7, 0.35]],
  oo: [[340, 3.5, 1], [800, 4.5, 0.45], [2500, 7, 0.16]],
  eh: [[480, 4, 1], [1750, 6, 0.5], [2650, 7, 0.3]],
};

export class Score {
  // au needs: ctx, music (a GainNode to play into), noise (a looping noise buffer)
  constructor(au) {
    this.au = au;
    this.mood = null; this.field = FIELDS.title;
    this.state = { active: false, alive: 0, danger: 0, waveIn: Infinity, castle: 1, boss: false };
    this.int = 0;            // smoothed intensity 0..1
    this.layers = null;
    this.nextT = 0; this.step = 0; this.bar = 0; this.bpm = 64; this.spb = 16;
    this.hbNext = 0; this.lastWaveIn = Infinity; this.risen = false; this.called = false; this.screechAt = 0;
    this.section = 'lull'; this.sectionBar = 0;
  }
  get c() { return this.au.ctx; }

  // ---------------------------------------------------------------- public
  setMood(mood, biome, t) {
    const prev = this.mood, prevField = this.field;
    this.mood = mood;
    this.field = FIELDS[biome] || FIELDS.dawnhold;
    const keep = (prev === 'battle' || prev === 'boss') && (mood === 'battle' || mood === 'boss') && prevField === this.field;
    if (!keep) {
      this.dropLayers(t);
      if (mood !== 'victory' && mood !== 'defeat') this.layers = this.buildLayers(t);
      this.step = 0; this.bar = 0; this.sectionBar = 0; this.int = 0;
      this.nextT = t + 0.2;
      this.risen = false; this.called = false; this.lastWaveIn = Infinity;
    }
    if (mood === 'boss' && prev !== 'boss') this.cue('boss', t);
    if (mood === 'victory') this.dawn(t + 0.3);
    if (mood === 'defeat') this.fall(t + 0.2);
  }

  setBattle(s) { Object.assign(this.state, s); }

  cue(name, t) {
    const r = this.field.root;
    if (name === 'wave') {
      // the hit as a wave comes out of the fog
      this.braam(t, r, 0.9, this.field.fear > 0.6);
      this.taiko(t, 1, 42);
      this.cymbal(t, 2.5, 0.12);
      this.choir(t + 0.05, [r + 12, r + 19, r + 24], 2.6, 0.06, 'ah');
      this.risen = false; this.called = false;
      if (this.layers) this.layers.duck.gain.setTargetAtTime(1, t, 0.05);
    } else if (name === 'boss') {
      [0, 1.6, 3.2].forEach(d => this.toll(t + d, NOTE(r + 12), 0.6));
      this.braam(t + 0.1, r, 1, true);
      this.subDrop(t, 1);
      this.hollowCall(t + 4.4, r, 0.9, 0, 1);
      this.choir(t + 4.4, [r + 12, r + 13, r + 18], 6, 0.07, 'ah');
      if (this.layers) this.layers.duck.gain.setTargetAtTime(1, t, 0.05);
    } else if (name === 'foe') {
      // something new walks out of the fog
      if (this.field.fear >= 0.5) this.screech(t, r, 0.05);
      this.brass(t, [r - 12, r - 6], 2.6, 0.5, { cutoff: 700, growl: true });
    }
  }

  // called by the audio scheduler; `now` is the context time to schedule ahead of
  schedule(now) {
    if (!this.mood) return;
    if (this.nextT < now) this.nextT = now + 0.05;
    while (this.nextT < now + 0.3) {
      const t = this.nextT;
      if (this.mood === 'battle' || this.mood === 'boss') this.battleStep(t);
      else if (this.mood === 'menu' || this.mood === 'camp' || this.mood === 'story') this.calmStep(t);
      else { this.nextT += 0.5; continue; }
      this.step++;
      if (this.step % this.spb === 0) { this.bar++; this.sectionBar++; }
      this.nextT += 60 / this.bpm / 4;
    }
  }

  // ---------------------------------------------------------------- battle
  battleStep(t) {
    const F = this.field, S = this.state, L = this.layers;
    const boss = this.mood === 'boss';
    const s = this.step % this.spb;
    // intensity follows the fight: rises fast, settles slowly
    const target = boss ? 1 : S.alive > 0 ? clamp(0.22 + S.alive / 32 * 0.45 + S.danger * 0.45, 0, 1) : 0;
    const k = target > this.int ? 0.06 : 0.012;
    this.int += (target - this.int) * k;
    const I = this.int;
    const dreadWin = 20;
    const dread = S.active && S.waveIn < dreadWin ? 1 - S.waveIn / dreadWin : 0;
    const siege = S.danger > 0.8 || S.castle < 0.35;
    let tier = boss ? 4 : I < 0.1 ? 0 : I < 0.38 ? 1 : I < 0.68 ? 2 : 3;
    if (siege && tier > 0) tier = Math.min(4, tier + 1);

    if (s === 0) this.battleBar(t, boss, tier, dread);

    // ---- persistent layers
    if (L) {
      const breath = S.active && S.waveIn < 1.4 && S.waveIn > 0;      // the held breath before a wave hits
      L.duck.gain.setTargetAtTime(breath ? 0.18 : 1, t, breath ? 0.25 : 0.4);
      L.pad.g.gain.setTargetAtTime((tier === 0 ? 0.05 - dread * 0.012 : 0.05) * (F.organ ? 1.2 : 1), t, 0.8);
      L.pad.lp.frequency.setTargetAtTime(240 + I * 700 + dread * 300, t, 1);
      const trem = Math.max(dread * 0.9, tier >= 2 ? 0.35 + tier * 0.12 : 0, boss ? 0.85 : 0);
      L.trem.g.gain.setTargetAtTime(trem * 0.05, t, 0.6);
      L.trem.lfo.frequency.setTargetAtTime(9 + dread * 6 + tier, t, 0.5);
      L.trem.bp.frequency.setTargetAtTime(700 + dread * 1600 + I * 600, t, 0.6);
      const wl = F.fear * (F.whisper || 1) * (tier <= 1 ? 1 : 0.25) * (0.5 + dread);
      L.whisper.level.gain.setTargetAtTime(wl * 0.6, t, 1);
      if (wl > 0.05 && Math.random() < 0.18 * wl) this.whisperSyllable(t);
    }

    // ---- dread before a wave: heartbeat, the enemy's horn, a rising swell
    if (S.active && S.waveIn < Infinity) {
      if (dread > 0.45 && !this.called && F.fear >= 0.3) { this.called = true; this.hollowCall(t, F.root, 0.45, 0.6, 0.35); }
      if (S.waveIn < 4.6 && !this.risen) { this.risen = true; this.riser(t, Math.max(1.5, S.waveIn), 0.05 + F.fear * 0.03); this.cymbal(t + Math.max(0, S.waveIn - 2), 2, 0.1, true); }
    }
    const hbRate = S.castle < 0.3 ? lerp(0.9, 0.5, 1 - S.castle / 0.3) : dread > 0 && tier <= 1 ? lerp(1.3, 0.48, dread) : 0;
    if (hbRate && t >= this.hbNext) { this.heart(t, 0.55 + dread * 0.3); this.hbNext = t + hbRate; }
    if (!hbRate) this.hbNext = 0;

    // ---- drums
    this.drums(t, s, tier, boss);

    // ---- low string ostinato
    if (tier >= 1) {
      const pat = OST[this.spb === 14 ? 'odd' : F.ost] || OST.drive;
      const ch = this.chord;
      const sym = pat[s];
      if (sym && sym !== '.') {
        const n = this.root + (sym === 'f' ? ch[2] : sym === 'o' ? ch[0] + 12 : ch[0]);
        const len = 60 / this.bpm / 4 * 0.9;
        this.spic(t, n - 12, len, 0.07 + I * 0.05, I);
        if (tier >= 3) this.spic(t, n, len, 0.035 + I * 0.02, I);
      }
    }

    // ---- unsettling extras on the darker nights
    if (F.fear >= 0.6 && tier <= 1 && !boss && t > this.screechAt && Math.random() < 0.004 * F.fear) {
      this.screechAt = t + 30;
      this.screech(t, F.root, 0.035);
    }
  }

  battleBar(t, boss, tier, dread) {
    const F = this.field, r = F.root;
    const section = boss ? 'boss' : tier === 0 ? 'lull' : 'fight';
    if (section !== this.section) { this.section = section; this.sectionBar = 0; }
    // tempo and metre for this bar
    this.spb = F.odd && section !== 'lull' ? 14 : 16;
    this.bpm = section === 'boss' ? (F.odd ? 112 : 104) : section === 'lull' ? 60 : tier >= 3 ? 98 : tier === 2 ? 92 : 84;
    // harmony
    const dark = F.fear >= 0.6;
    const prog = section === 'boss' ? PROG.boss : section === 'lull' ? (dark ? PROG.lullDark : PROG.lull) : dark ? PROG.fightDark : F.harmonic ? PROG.fightH : PROG.fight;
    const per = section === 'lull' ? 2 : 1;
    // the dread before a wave holds on the tonic and lets the strings creep
    let ch = dread > 0.3 && section === 'lull' ? [0, 3, 7] : prog[Math.floor(this.sectionBar / per) % prog.length];
    this.chord = ch; this.root = r;
    this.setPad(t, r, ch, dread);
    this.setTrem(t, r, ch, dread);
    const barLen = 60 / this.bpm / 4 * this.spb;
    // choir
    if (section === 'lull' && this.sectionBar % 2 === 0) {
      const notes = ch.map(x => r + 12 + x);
      if (dark) notes.push(r + 13);                         // a minor second that never resolves
      this.choir(t, notes, barLen * 2, 0.022 + dread * 0.02, 'oo');
    } else if (section === 'fight' && this.sectionBar % 2 === 0 && tier >= 2) {
      this.choir(t, ch.map(x => r + 12 + x), barLen * 2, 0.026 + tier * 0.006, 'ah');
    } else if (section === 'boss') {
      this.choir(t, [...ch.map(x => r + 12 + x), r + 24 + ch[0]], barLen, 0.034, this.sectionBar % 4 === 3 ? 'eh' : 'ah');
    }
    // brass
    if (section === 'boss' && this.sectionBar % 8 === 4) this.hollowCall(t, r, 0.8, 0, 0.9);
    else if (section === 'boss' && this.sectionBar % 2 === 0) this.brass(t, [r - 12 + ch[0], r - 5 + ch[0]], barLen * 1.6, 0.6, { cutoff: 1100, growl: true });
    else if (tier >= 3 && this.sectionBar % 2 === 0) this.brass(t, [r - 12 + ch[0], r - 12 + ch[2]], barLen * 1.4, 0.45, { cutoff: 800 + tier * 120, growl: tier >= 4 });
    // bells count down to the wave, and toll through the quiet on the bell nights
    if (F.bells && section === 'lull' && (dread > 0.4 || this.sectionBar % 4 === 0)) this.toll(t, NOTE(r + 12 + (dread > 0.4 ? 0 : ch[0])), 0.25 + dread * 0.2);
    if (section === 'lull' && dread > 0.6) this.subPulse(t, 0.35 * dread);
  }

  drums(t, s, tier, boss) {
    if (tier === 0) return;
    const F = this.field, odd = this.spb === 14;
    const P = odd ? [
      null,
      { taiko: [0, 7] },
      { taiko: [0, 7], tom: [4, 11, 12] },
      { taiko: [0, 3, 7, 10], tom: [5, 6, 12, 13], rim: [2, 9] },
      { taiko: [0, 3, 5, 7, 10, 12], tom: [1, 4, 8, 11, 13], rim: [2, 9], anvil: [6] },
    ] : [
      null,
      { taiko: [0, 8] },
      { taiko: [0, 8], tom: [6, 10, 14] },
      { taiko: [0, 3, 8, 11], tom: [6, 7, 14, 15], rim: [4, 12] },
      { taiko: [0, 3, 6, 8, 11, 14], tom: [1, 5, 9, 13, 15], rim: [4, 12], anvil: [4, 12] },
    ];
    const p = P[Math.min(tier, 4)];
    const I = this.int;
    if (p.taiko.includes(s)) this.taiko(t, s === 0 ? 0.85 : 0.55 + I * 0.2, s === 0 ? 44 : 50);
    if (p.tom && p.tom.includes(s)) this.tom(t, 0.3 + I * 0.25, F.tribal ? 120 : 98);
    if (p.rim && p.rim.includes(s) && !p.anvil?.includes(s)) this.rim(t, 0.12 + I * 0.08);
    if (p.anvil && p.anvil.includes(s) && F.metal) this.anvil(t, 0.12);
    if (F.tribal && tier >= 2 && s % 2 === 1 && Math.random() < 0.25 + I * 0.3) this.tom(t, 0.12 + I * 0.1, 140);
    if (boss && s === this.spb - 1 && this.sectionBar % 4 === 3) [0, 1, 2].forEach(i => this.tom(t + i * 0.06, 0.35, 90 + i * 12));   // roll into the next phrase
  }

  // ---------------------------------------------------------------- title, camp, story
  calmStep(t) {
    const m = this.mood, F = this.field, L = this.layers;
    const r = m === 'story' ? F.root : 38;
    const s = this.step % 16;
    if (s === 0) {
      this.spb = 16;
      this.bpm = m === 'menu' ? 64 : m === 'camp' ? 72 : 56;
      const prog = m === 'camp' ? PROG.camp : m === 'story' ? (F.fear >= 0.6 ? PROG.lullDark : PROG.lull) : PROG.menu;
      const ch = prog[Math.floor(this.bar / 2) % 4];
      this.chord = ch; this.root = r;
      this.setPad(t, r, ch, 0);
      const barLen = 60 / this.bpm / 4 * 16;
      if (this.bar % 2 === 0) this.choir(t, ch.map(x => r + 12 + x), barLen * 2, m === 'menu' ? 0.03 : 0.018, 'oo');
      if (m === 'menu' && this.bar % 4 === 0) { this.taiko(t, 0.5, 42); this.toll(t + 0.05, NOTE(r + 12), 0.22); }
      if (m === 'story' && F.bells && this.bar % 4 === 0) this.toll(t, NOTE(r + 12), 0.18);
      if (m === 'story' && F.fear >= 0.6 && this.bar % 8 === 6) this.hollowCall(t, r, 0.35, 0.5, 0.3);
      // the Lantern theme
      if (m === 'menu' && this.bar % 8 === 2) this.melody(t, r + 24, LANTERN, false, 'choir', 0.05);
      if (m === 'camp' && this.bar % 8 === 4) this.melody(t, r + 24, LANTERN, false, 'pluck', 0.09);
    }
    if (L) {
      L.duck.gain.setTargetAtTime(1, t, 0.5);
      L.pad.g.gain.setTargetAtTime(m === 'camp' ? 0.055 : 0.06, t, 1);
      L.pad.lp.frequency.setTargetAtTime(m === 'camp' ? 520 : 380, t, 1);
      L.trem.g.gain.setTargetAtTime(m === 'story' ? 0.008 : 0, t, 1);
      const wl = (m === 'camp' ? 0 : F.fear * 0.5) * (F.whisper || 1);
      L.whisper.level.gain.setTargetAtTime(wl * 0.5, t, 1);
      if (wl > 0.05 && Math.random() < 0.08 * wl) this.whisperSyllable(t);
    }
    if (m === 'camp' && s % 2 === 0) {
      // a lute picking through the chord
      const ch = this.chord || [0, 3, 7];
      const seq = [0, 2, 1, 2, 0, 2, 1, 2];
      const n = r + 12 + ch[seq[(s / 2) % 8]] + (s >= 8 ? 12 : 0);
      this.pluck(t, n, 0.05);
    }
  }

  // ---------------------------------------------------------------- endings
  dawn(t) {
    const r = this.field.root + 12;
    // the night breaks: the Lantern theme in a major key over a widening choir
    this.toll(t, NOTE(r + 12), 0.5);
    this.choir(t, [r, r + 4, r + 7, r + 12], 5, 0.06, 'ah');
    this.choir(t + 4.6, [r + 5, r + 9, r + 12, r + 17], 4, 0.055, 'ah');
    this.choir(t + 8.4, [r, r + 4, r + 7, r + 12, r + 16], 7, 0.065, 'ah');
    this.melody(t + 0.6, r + 12, LANTERN, true, 'brass', 0.5, 0.42);
    this.taiko(t, 0.7, 44);
    [8.4, 9.9].forEach(d => this.toll(t + d, NOTE(r + 12), 0.35));
    this.cymbal(t + 6.4, 2, 0.08, true);
  }
  fall(t) {
    const r = this.field.root;
    [0, 2.2, 4.4].forEach(d => this.toll(t + d, NOTE(r + 12), 0.45));
    this.choir(t, [r + 12, r + 15, r + 19], 3, 0.05, 'ah');
    this.choir(t + 3, [r + 11, r + 14, r + 18], 3, 0.045, 'oo');
    this.choir(t + 6, [r + 7, r + 10, r + 13], 5, 0.04, 'oo');
    this.hollowCall(t + 1, r, 0.6, 0, 0.8);
    this.subDrop(t, 0.8);
  }

  // ---------------------------------------------------------------- persistent layers
  buildLayers(t) {
    const c = this.c, F = this.field;
    const duck = c.createGain(); duck.gain.value = 1; duck.connect(this.au.music);
    const nodes = [];
    // drone pad: four detuned saws (and an organ octave on the cathedral night) under a slowly breathing filter
    const pg = c.createGain(); pg.gain.value = 0.0001;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.6;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.06; const lg = c.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(lp.frequency);
    const voices = [];
    for (let i = 0; i < 4; i++) { const o = c.createOscillator(); o.type = F.organ && i === 3 ? 'square' : 'sawtooth'; o.detune.value = (i - 1.5) * 6; o.frequency.value = NOTE(F.root); o.connect(lp); voices.push(o); }
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = NOTE(F.root - 12);
    const sg = c.createGain(); sg.gain.value = 0.4; sub.connect(sg); sg.connect(pg);
    lp.connect(pg); pg.connect(duck);
    nodes.push(...voices, sub, lfo);
    // tremolo strings: bowed fast and nervous, brightening as dread rises
    const tg = c.createGain(); tg.gain.value = 0.0001;
    const am = c.createGain(); am.gain.value = 0.55;
    const tl = c.createOscillator(); tl.type = 'triangle'; tl.frequency.value = 10; const tlg = c.createGain(); tlg.gain.value = 0.45; tl.connect(tlg); tlg.connect(am.gain);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
    const strings = [];
    for (let i = 0; i < 4; i++) { const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = (i - 1.5) * 9; o.frequency.value = NOTE(F.root + 12); o.connect(bp); strings.push(o); }
    bp.connect(hp); hp.connect(am); am.connect(tg); tg.connect(duck);
    nodes.push(...strings, tl);
    // whispers: breath through shifting mouth shapes, wandering left and right
    const ws = c.createBufferSource(); ws.buffer = this.au.noise; ws.loop = true;
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 900; f1.Q.value = 5;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2400; f2.Q.value = 7;
    const wenv = c.createGain(); wenv.gain.value = 0;
    const wl = c.createGain(); wl.gain.value = 0;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    ws.connect(f1); ws.connect(f2); f1.connect(wenv); f2.connect(wenv); wenv.connect(wl);
    if (pan) { wl.connect(pan); pan.connect(duck); } else wl.connect(duck);
    nodes.push(ws);
    for (const n of nodes) n.start(t);
    pg.gain.setTargetAtTime(0.05, t, 1.5);
    return { duck, nodes, pad: { g: pg, lp, voices, sub }, trem: { g: tg, lfo: tl, bp, strings }, whisper: { env: wenv, level: wl, f1, f2, pan } };
  }
  dropLayers(t) {
    const L = this.layers; if (!L) return;
    L.duck.gain.cancelScheduledValues(t);
    L.duck.gain.setTargetAtTime(0.0001, t, 0.7);
    for (const n of L.nodes) { try { n.stop(t + 4); } catch (e) { /* already stopped */ } }
    this.layers = null;
  }
  setPad(t, r, ch, dread) {
    const L = this.layers; if (!L) return;
    const v = [r + ch[0] - 12, r + ch[0], r + ch[2], r + ch[1] + 12];
    if (dread > 0.55) v[3] = r + 13;                     // the minor ninth creeps in as the wave nears
    L.pad.voices.forEach((o, i) => o.frequency.setTargetAtTime(NOTE(v[i]), t, 0.35));
    let sub = r + ch[0] - 12; if (sub < 28) sub += 12;
    L.pad.sub.frequency.setTargetAtTime(NOTE(sub), t, 0.4);
  }
  setTrem(t, r, ch, dread) {
    const L = this.layers; if (!L) return;
    const v = dread > 0.35 ? [r + 12, r + 13 + (dread > 0.7 ? 5 : 0), r + 18, r + 24] : [r + 12 + ch[0], r + 12 + ch[1], r + 12 + ch[2], r + 24 + ch[0]];
    L.trem.strings.forEach((o, i) => o.frequency.setTargetAtTime(NOTE(v[i]), t, 0.2));
  }
  whisperSyllable(t) {
    const W = this.layers?.whisper; if (!W) return;
    const len = rnd(0.08, 0.35);
    W.f1.frequency.setTargetAtTime(rnd(500, 1400), t, 0.03);
    W.f2.frequency.setTargetAtTime(rnd(1800, 3600), t, 0.03);
    W.env.gain.setTargetAtTime(rnd(0.5, 1), t, 0.03);
    W.env.gain.setTargetAtTime(0, t + len, 0.06);
    if (W.pan) W.pan.pan.setTargetAtTime(rnd(-0.9, 0.9), t, 0.4);
  }

  // ---------------------------------------------------------------- instruments
  out(pan = 0) {
    const L = this.layers;
    const dest = L ? L.duck : this.au.music;
    if (!pan || !this.c.createStereoPanner) return dest;
    const p = this.c.createStereoPanner(); p.pan.value = pan; p.connect(dest);
    return p;
  }
  gainEnv(t, a, peak, hold, rel) {
    const g = this.c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    return g;
  }
  shaper() {
    if (!this._curve) {
      const n = 1024, k = 3.2, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
      this._curve = curve;
    }
    const s = this.c.createWaveShaper(); s.curve = this._curve; return s;
  }
  noise(t, dur, g, filt) {
    const c = this.c, s = c.createBufferSource(); s.buffer = this.au.noise; s.loop = true;
    let node = s;
    for (const f of filt) { const b = c.createBiquadFilter(); b.type = f.type; b.frequency.setValueAtTime(f.f, t); if (f.f2) b.frequency.exponentialRampToValueAtTime(f.f2, t + dur); b.Q.value = f.q || 0.7; node.connect(b); node = b; }
    node.connect(g);
    s.start(t, Math.random() * 2); s.stop(t + dur + 0.1);
  }

  taiko(t, peak, f = 46) {
    const c = this.c, out = this.out();
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 2.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    const g = this.gainEnv(t, 0.002, peak * 0.9, 0, 1.0); o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 1.1);
    const skin = c.createOscillator(); skin.type = 'triangle'; skin.frequency.setValueAtTime(f * 4.4, t); skin.frequency.exponentialRampToValueAtTime(f * 2.3, t + 0.12);
    const sg = this.gainEnv(t, 0.002, peak * 0.42, 0, 0.32); skin.connect(sg); sg.connect(out); skin.start(t); skin.stop(t + 0.36);
    const ng = this.gainEnv(t, 0.002, peak * 0.45, 0, 0.2); ng.connect(out);
    this.noise(t, 0.22, ng, [{ type: 'lowpass', f: 1400, f2: 180 }]);
    const ag = this.gainEnv(t, 0.001, peak * 0.22, 0, 0.035); ag.connect(out);
    this.noise(t, 0.05, ag, [{ type: 'bandpass', f: 2200, q: 1.2 }]);
  }
  tom(t, peak, f = 98) {
    const c = this.c, out = this.out(rnd(-0.3, 0.3));
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.9, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const g = this.gainEnv(t, 0.002, peak, 0, 0.38); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.45);
    const h = c.createOscillator(); h.type = 'triangle'; h.frequency.setValueAtTime(f * 3.2, t); h.frequency.exponentialRampToValueAtTime(f * 2.1, t + 0.06);
    const hg = this.gainEnv(t, 0.001, peak * 0.3, 0, 0.18); h.connect(hg); hg.connect(out); h.start(t); h.stop(t + 0.22);
    const ng = this.gainEnv(t, 0.001, peak * 0.45, 0, 0.07); ng.connect(out);
    this.noise(t, 0.08, ng, [{ type: 'bandpass', f: 1300, q: 1 }]);
  }
  rim(t, peak) {
    const out = this.out(rnd(-0.4, 0.4));
    const ng = this.gainEnv(t, 0.001, peak, 0, 0.05); ng.connect(out);
    this.noise(t, 0.06, ng, [{ type: 'bandpass', f: 3200, q: 2.5 }]);
  }
  anvil(t, peak) {
    const c = this.c, out = this.out(rnd(-0.5, 0.5));
    for (const [ratio, amp, dec] of [[1, 1, 0.6], [2.76, 0.5, 0.35], [5.4, 0.3, 0.18]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 820 * ratio;
      const g = this.gainEnv(t, 0.001, peak * amp, 0, dec); o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + 0.05);
    }
  }
  cymbal(t, dur, peak, reverse = false) {
    const out = this.out();
    const g = this.c.createGain();
    if (reverse) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05); }
    else { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
    g.connect(out);
    this.noise(t, dur + 0.1, g, [{ type: 'highpass', f: 4500 }, { type: 'peaking', f: 7000, q: 1 }]);
  }
  spic(t, n, len, peak, bright) {
    const c = this.c, out = this.out();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(700 + bright * 2200, t); lp.frequency.exponentialRampToValueAtTime(260, t + len);
    const g = this.gainEnv(t, 0.004, peak, 0, len); lp.connect(g); g.connect(out);
    for (const [type, det] of [['sawtooth', -5], ['square', 6]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = NOTE(n); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + len + 0.05);
    }
  }
  pluck(t, n, peak) {
    const c = this.c, out = this.out(rnd(-0.3, 0.3));
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const g = this.gainEnv(t, 0.002, peak, 0, 1.3); lp.connect(g); g.connect(out);
    for (const [type, det] of [['triangle', 0], ['sawtooth', 4]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = NOTE(n); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + 1.4);
    }
  }
  choir(t, notes, dur, peak, vowel = 'ah', pan = 0) {
    const c = this.c, out = this.out(pan);
    const mix = c.createGain(); mix.gain.value = 1;
    const vib = c.createOscillator(); vib.frequency.value = rnd(4.2, 5.2);
    const vg = c.createGain(); vg.gain.value = 14; vib.connect(vg);
    const end = t + dur + 2.6;
    for (const n of notes) {
      for (const det of [-9, 8]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = NOTE(n); o.detune.value = det + rnd(-4, 4);
        vg.connect(o.detune); o.connect(mix); o.start(t); o.stop(end);
      }
    }
    vib.start(t); vib.stop(end);
    const a = Math.min(1.6, dur * 0.4);
    const g = this.gainEnv(t, a, peak, Math.max(0, dur - a), 2.4);
    for (const [f, q, amp] of VOWELS[vowel] || VOWELS.ah) {
      const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
      const bg = c.createGain(); bg.gain.value = amp * 1.5;
      mix.connect(b); b.connect(bg); bg.connect(g);
    }
    g.connect(out);
  }
  brass(t, notes, dur, peak, { cutoff = 900, growl = false, pan = 0, far = 0 } = {}) {
    const c = this.c, out = this.out(pan);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1;
    const top = cutoff * 1.4 * (1 - far * 0.6);
    lp.frequency.setValueAtTime(top * 0.25, t); lp.frequency.linearRampToValueAtTime(top, t + 0.3); lp.frequency.setTargetAtTime(top * 0.7, t + 0.5, dur * 0.4);
    const a = 0.28 + far * 0.5;
    const g = this.gainEnv(t, a, peak * 0.1, Math.max(0, dur - a - 0.5), 0.6 + far);
    if (growl) { const sh = this.shaper(); lp.connect(sh); sh.connect(g); } else lp.connect(g);
    g.connect(out);
    for (const n of notes) {
      for (const det of [-7, 6]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(NOTE(n) * 0.97, t); o.frequency.linearRampToValueAtTime(NOTE(n), t + 0.12);
        o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + 1.6);
      }
    }
  }
  // the enemy's call: three falling notes ending on a tritone, from far off in the fog
  hollowCall(t, r, peak, far, len = 1) {
    const step = 60 / 66 / 4 * len;
    for (const [s, iv, l] of HOLLOW) this.brass(t + s * step, [r - 12 + iv, r + iv], l * step + 0.4, peak, { cutoff: 650, growl: !far, pan: far ? 0.55 : 0, far });
  }
  braam(t, r, peak, dark) {
    const c = this.c, out = this.out();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.6;
    lp.frequency.setValueAtTime(180, t); lp.frequency.exponentialRampToValueAtTime(1900, t + 0.12); lp.frequency.exponentialRampToValueAtTime(300, t + 3.2);
    const sh = this.shaper();
    const g = this.gainEnv(t, 0.04, peak * 0.09, 0.4, 3.2);
    lp.connect(sh); sh.connect(g); g.connect(out);
    const notes = [r - 12, r - 5, r, r + 7];
    if (dark) notes.push(r + 1);
    for (const n of notes) for (const det of [-10, 9]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = NOTE(n); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + 3.8);
    }
    this.subDrop(t, peak * 0.8);
  }
  subDrop(t, peak) {
    const c = this.c, out = this.out();
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(92, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.8);
    const g = this.gainEnv(t, 0.01, peak * 0.7, 0.2, 1.8); o.connect(g); g.connect(out); o.start(t); o.stop(t + 2.2);
  }
  subPulse(t, peak) {
    const c = this.c, out = this.out();
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 38;
    const g = this.gainEnv(t, 0.3, peak, 0.2, 1.2); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.8);
  }
  heart(t, peak) {
    const c = this.c, out = this.out();
    for (const [d, p] of [[0, 1], [0.21, 0.7]]) {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(64, t + d); o.frequency.exponentialRampToValueAtTime(36, t + d + 0.13);
      const g = this.gainEnv(t + d, 0.008, peak * p, 0, 0.17); o.connect(g); g.connect(out); o.start(t + d); o.stop(t + d + 0.22);
    }
  }
  riser(t, dur, peak) {
    const c = this.c, out = this.out();
    // four tones an octave apart climbing together, so it seems to keep rising
    for (let k = 0; k < 4; k++) {
      const f0 = 55 * Math.pow(2, k);
      const o = c.createOscillator(); o.type = k < 2 ? 'sawtooth' : 'sine';
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2, t + dur);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak * (k === 0 || k === 3 ? 0.5 : 1), t + dur * 0.95); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
      o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.1);
    }
    const ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(peak * 1.4, t + dur); ng.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    ng.connect(out);
    this.noise(t, dur, ng, [{ type: 'bandpass', f: 300, f2: 5000, q: 2 }]);
  }
  screech(t, r, peak) {
    const c = this.c, out = this.out(rnd(-0.7, 0.7));
    // strings scraped high and out of tune, sliding upward
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    hp.connect(g); g.connect(out);
    for (const iv of [36, 37, 42, 43]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(NOTE(r + iv), t); o.frequency.exponentialRampToValueAtTime(NOTE(r + iv + 1.5), t + 3);
      o.detune.value = rnd(-15, 15); o.connect(hp); o.start(t); o.stop(t + 3.1);
    }
  }
  toll(t, f, peak) {
    const c = this.c, out = this.out();
    for (const [ratio, amp, dec] of [[0.5, 0.7, 7], [1, 1, 5.5], [1.19, 0.35, 4], [2, 0.45, 3.5], [2.76, 0.3, 2.4], [5.4, 0.15, 1.3]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * ratio;
      const g = this.gainEnv(t, 0.004, peak * amp * 0.22, 0, dec); o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + 0.1);
    }
  }
  melody(t, base, motif, major, voice, peak, beat = 60 / 64 / 4) {
    for (const [s, iv0, l] of motif) {
      const iv = major ? (MAJOR[iv0] ?? iv0) : iv0;
      const tt = t + s * beat, dur = l * beat;
      if (voice === 'pluck') this.pluck(tt, base + iv, peak);
      else if (voice === 'brass') this.brass(tt, [base - 12 + iv], dur + 0.2, peak, { cutoff: 1500 });
      else this.choir(tt, [base + iv], dur * 0.9, peak, 'ah');
    }
  }
}
