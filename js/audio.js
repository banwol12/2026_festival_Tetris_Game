'use strict';

// Korobeiniki (traditional, public domain) — [midi note, beats]. 0 = rest.
const MELODY = [
  [76, 1], [71, 0.5], [72, 0.5], [74, 1], [72, 0.5], [71, 0.5],
  [69, 1], [69, 0.5], [72, 0.5], [76, 1], [74, 0.5], [72, 0.5],
  [71, 1.5], [72, 0.5], [74, 1], [76, 1],
  [72, 1], [69, 1], [69, 1], [0, 1],
  [0, 0.5], [74, 1], [77, 0.5], [81, 1], [79, 0.5], [77, 0.5],
  [76, 1.5], [72, 0.5], [76, 1], [74, 0.5], [72, 0.5],
  [71, 1], [71, 0.5], [72, 0.5], [74, 1], [76, 1],
  [72, 1], [69, 1], [69, 1], [0, 1],
];
// Bass root per bar (8 bars of 4 beats), alternating root / fifth per beat.
const BASS = [40, 45, 47, 40, 38, 36, 47, 40];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.bgmOn = true;
    this.bgm = null;
    this.timer = null;
    this.tempo = 150;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.7;
      this.sfxGain.connect(this.master);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.32;
      this.bgmGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  midi(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  play(freq, { type = 'square', dur = 0.08, vol = 0.25, slide = 0, delay = 0, at = null, dest = null } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = at != null ? at : ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  tone(freq, opts) {
    if (!this.sfxOn) return;
    this.play(freq, opts);
  }

  noise(dur = 0.1, vol = 0.3, delay = 0) {
    if (!this.sfxOn) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur);
  }

  // ---- SFX ------------------------------------------------------------------
  move() { this.tone(200, { type: 'square', dur: 0.03, vol: 0.07 }); }
  rotate() { this.tone(420, { type: 'triangle', dur: 0.06, vol: 0.14, slide: 1.3 }); }
  hold() {
    this.tone(330, { type: 'triangle', dur: 0.06, vol: 0.14 });
    this.tone(495, { type: 'triangle', dur: 0.08, vol: 0.14, delay: 0.06 });
  }
  lock() { this.tone(150, { type: 'square', dur: 0.05, vol: 0.12, slide: 0.7 }); }
  hardDrop() {
    this.noise(0.09, 0.35);
    this.tone(110, { type: 'sine', dur: 0.1, vol: 0.3, slide: 0.5 });
  }
  clear(n, tspin) {
    const notes = tspin
      ? [880, 1108, 1318, 1760]
      : n >= 4
        ? [523, 659, 784, 1046, 1318]
        : [523, 659, 784].slice(0, n + 1);
    const big = n >= 4 || tspin;
    notes.forEach((f, i) =>
      this.tone(f, { type: 'square', dur: big ? 0.18 : 0.12, vol: 0.18, delay: i * 0.06 })
    );
  }
  levelUp() {
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) =>
      this.tone(f, { type: 'triangle', dur: 0.15, vol: 0.2, delay: i * 0.07 })
    );
  }
  gameOver() {
    [392, 349, 311, 261, 196].forEach((f, i) =>
      this.tone(f, { type: 'sawtooth', dur: 0.28, vol: 0.16, delay: i * 0.18 })
    );
  }

  // ---- BGM sequencer --------------------------------------------------------
  setLevel(level) {
    this.tempo = Math.min(200, 145 + (level - 1) * 4);
  }

  startBgm(level) {
    if (!this.bgmOn) return;
    const ctx = this.ensure();
    if (!ctx) return;
    if (level) this.setLevel(level);
    if (this.timer) return;
    const now = ctx.currentTime + 0.1;
    if (!this.bgm) this.bgm = { mi: 0, bi: 0 };
    this.bgm.mt = now;
    this.bgm.bt = now;
    this.timer = setInterval(() => this.schedule(), 30);
    this.schedule();
  }

  stopBgm() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  resetBgm() {
    this.stopBgm();
    this.bgm = null;
  }

  schedule() {
    if (!this.ctx || !this.bgm) return;
    const ctx = this.ctx;
    const b = this.bgm;
    const spb = 60 / this.tempo;
    const ahead = ctx.currentTime + 0.25;
    while (b.mt < ahead) {
      const [m, beats] = MELODY[b.mi];
      if (m) {
        this.play(this.midi(m), {
          type: 'square', dur: beats * spb * 0.8, vol: 0.1, at: b.mt, dest: this.bgmGain,
        });
      }
      b.mt += beats * spb;
      b.mi = (b.mi + 1) % MELODY.length;
    }
    while (b.bt < ahead) {
      const bar = Math.floor(b.bi / 4) % BASS.length;
      const root = BASS[bar];
      const m = b.bi % 2 === 0 ? root : root + 7;
      this.play(this.midi(m), {
        type: 'triangle', dur: spb * 0.6, vol: 0.16, at: b.bt, dest: this.bgmGain,
      });
      b.bt += spb;
      b.bi = (b.bi + 1) % (4 * BASS.length);
    }
  }
}
