// Pong Quest audio: a small WebAudio synthesiser. No samples, no assets —
// every sound is oscillators and filtered noise, so nothing copyrighted ships.
//
// Voice: bright chiptune-meets-JRPG. Weapons each have their own strike,
// monsters squeak, coins chime, power-ups get jingles, and two gentle looping
// tracks play under the menu/shop and the arena.

import type { CreatureType, PowerUpType } from "./data";

export type WeaponKind = "sword" | "axe" | "hammer" | "staff";
export type MusicTrack = "menu" | "arena";

export const WEAPON_KIND: Record<string, WeaponKind> = {
  classic: "sword", neon: "sword", gold: "sword", inferno: "axe", matrix: "hammer", royal: "staff",
};

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// ── music data ───────────────────────────────────────────────────────────

export interface TrackDef {
  bpm: number;
  /** One chord per bar: root midi note + intervals. */
  chords: Array<{ root: number; third: number }>;
  /** 16 steps per bar; each entry is an index into the chord arpeggio or -1 for rest. */
  arp: number[];
  /** Lead phrase over the loop, midi offsets from the chord root, null = rest (one entry per 2 steps). */
  lead: Array<number | null>;
  leadWave: OscillatorType;
  arpWave: OscillatorType;
}

export const TRACKS: Record<MusicTrack, TrackDef> = {
  // A-minor town theme: Am - F - C - G, slow and warm.
  menu: {
    bpm: 84,
    chords: [
      { root: 57, third: 3 }, // Am
      { root: 53, third: 4 }, // F
      { root: 48, third: 4 }, // C
      { root: 55, third: 4 }, // G
    ],
    arp: [0, -1, 1, -1, 2, -1, 1, -1, 0, -1, 1, -1, 2, -1, 3, -1],
    lead: [
      12, null, 15, 14, null, 12, null, 10,
      9, null, 12, null, 14, 12, null, null,
      16, null, 14, 12, null, 11, null, 12,
      14, null, null, null, 7, null, 9, null,
    ],
    leadWave: "triangle",
    arpWave: "square",
  },
  // D-dorian arena theme: a touch brighter and steadier.
  arena: {
    bpm: 104,
    chords: [
      { root: 50, third: 3 }, // Dm
      { root: 50, third: 3 },
      { root: 55, third: 4 }, // G
      { root: 53, third: 4 }, // F
    ],
    arp: [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 3, 2, 1, 0],
    lead: [
      14, null, null, 12, null, 14, 17, null,
      16, null, 14, null, 12, null, null, null,
      19, null, 17, null, 14, null, 12, 14,
      16, null, null, null, null, null, null, null,
    ],
    leadWave: "square",
    arpWave: "triangle",
  },
};

// ── engine ───────────────────────────────────────────────────────────────

interface ToneOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  slideTo?: number;
  detune?: number;
  when?: number;
  bus?: "sfx" | "music";
  vibrato?: number;
}

export class PongAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private echo: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private voices = 0;
  private _muted = false;

  private track: MusicTrack | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;

  get muted() { return this._muted; }
  setMuted(v: boolean) { this.muted = v; }
  set muted(v: boolean) {
    this._muted = v;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(v ? 0 : 0.9, this.ctx.currentTime, 0.03);
    }
    if (v) this.stopScheduler();
    else if (this.track) this.startScheduler();
  }

  /** Create/resume the context. Call from a user gesture. */
  ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      this.ctx = ctx;
      // glue compressor, then a brick-wall limiter so stacked hits never clip
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.08;
      // Compressors add makeup gain, so peaks can still overshoot: a tanh
      // shaper is the last stage and guarantees nothing hard-clips at the DAC.
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
      }
      shaper.curve = curve;
      limiter.connect(shaper);
      shaper.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      comp.connect(limiter);
      this.master = ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.9;
      this.master.connect(comp);
      // voices are written at low gain so they stack safely; the buses bring them up
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 6.5;
      this.sfx.connect(this.master);
      this.music = ctx.createGain();
      this.music.gain.value = 0.17;
      this.music.connect(this.master);
      // small feedback echo for chimes
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.17;
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3600;
      this.echo = ctx.createGain();
      this.echo.gain.value = 0.22;
      this.echo.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(this.sfx);
      // shared white noise
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    // Chrome warns on every resume() without a prior gesture: only ask once the user has interacted.
    const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
    if (this.ctx.state === "suspended" && activated) void this.ctx.resume();
    return this.ctx;
  }

  // ── primitives ──────────────────────────────────────────────────────

  private tone(o: ToneOpts, echo = false) {
    if (this._muted) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== "running" || !this.sfx || !this.music || this.voices > 48) return;
    const t0 = ctx.currentTime + (o.when ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? "square";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t0 + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const peak = o.gain ?? 0.08;
    const atk = o.attack ?? 0.004;
    g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 22;
      lg.gain.value = o.vibrato;
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + o.dur + 0.02);
    }
    osc.connect(g);
    g.connect(o.bus === "music" ? this.music : this.sfx);
    if (echo && this.echo) g.connect(this.echo);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.03);
    this.voices++;
    osc.onended = () => { this.voices--; };
  }

  private noise(o: { dur: number; type?: BiquadFilterType; f0: number; f1?: number; q?: number; gain?: number; when?: number }) {
    if (this._muted) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== "running" || !this.sfx || !this.noiseBuf || this.voices > 48) return;
    const t0 = ctx.currentTime + (o.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? "bandpass";
    f.Q.value = o.q ?? 1.2;
    // set the resting values first: an automation event only takes over at t0,
    // and until then the node sits at its default (gain 1) — which, for a
    // voice scheduled ahead of time, leaks as a loud burst at the start.
    f.frequency.value = o.f0;
    f.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(o.gain ?? 0.1, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + o.dur + 0.03);
    this.voices++;
    src.onended = () => { this.voices--; };
  }

  /** Bell/metal strike: inharmonic partials with decaying amplitude. */
  private bell(freq: number, dur: number, gain: number, when = 0, partials: number[] = [1, 2.76, 5.4, 8.9]) {
    partials.forEach((p, i) => {
      this.tone({ freq: freq * p, dur: dur / (1 + i * 0.7), type: "sine", gain: gain / (1 + i * 0.9), when }, i === 0);
    });
  }

  // ── sound effects ───────────────────────────────────────────────────

  /** Weapon strike. `speed` is 0..1 (ball speed vs the cap), `foe` is the AI's weapon. */
  hit(kind: WeaponKind, speed: number, sweet = false, foe = false) {
    const punch: Record<WeaponKind, number> = { sword: 2.7, axe: 2.5, hammer: 1.7, staff: 1.5 };
    const g = (foe ? 0.62 : 1) * punch[kind];
    const pitch = 2 ** (((speed * 3) - (foe ? 2 : 0)) / 12);
    switch (kind) {
      case "sword":
        this.noise({ dur: 0.05, type: "highpass", f0: 3500, gain: 0.12 * g });
        this.bell(880 * pitch, 0.22, 0.075 * g);
        this.tone({ freq: 1760 * pitch, dur: 0.035, type: "square", gain: 0.05 * g });
        break;
      case "axe":
        this.tone({ freq: 150 * pitch, slideTo: 55, dur: 0.12, type: "sine", gain: 0.2 * g });
        this.noise({ dur: 0.09, f0: 1300, f1: 500, q: 0.9, gain: 0.14 * g });
        this.bell(520 * pitch, 0.18, 0.05 * g, 0, [1, 2.7, 4.1]);
        break;
      case "hammer":
        this.tone({ freq: 95 * pitch, slideTo: 38, dur: 0.18, type: "sine", gain: 0.26 * g });
        this.noise({ dur: 0.1, type: "lowpass", f0: 900, f1: 220, gain: 0.16 * g });
        this.bell(330 * pitch, 0.28, 0.06 * g, 0.005, [1, 2.76, 5.4]);
        break;
      case "staff":
        this.tone({ freq: 660 * pitch, slideTo: 1320 * pitch, dur: 0.14, type: "sine", gain: 0.1 * g }, true);
        [1047, 1319, 1568].forEach((f, i) => this.tone({ freq: f * pitch, dur: 0.1, type: "triangle", gain: 0.05 * g, when: 0.03 + i * 0.045 }, true));
        this.noise({ dur: 0.07, type: "highpass", f0: 4500, gain: 0.05 * g });
        break;
    }
    if (sweet) {
      // crit chime on top
      [1319, 1760, 2349].forEach((f, i) => this.tone({ freq: f, dur: 0.16, type: "triangle", gain: 0.04, when: 0.02 + i * 0.04 }, true));
    }
  }

  whiff() { this.noise({ dur: 0.16, f0: 2400, f1: 450, q: 1.4, gain: 0.22 }); }
  wall() {
    this.tone({ freq: 330, slideTo: 260, dur: 0.05, type: "triangle", gain: 0.1 });
    this.noise({ dur: 0.025, type: "highpass", f0: 5000, gain: 0.07 });
  }

  /** Player scored. */
  score() {
    this.tone({ freq: 784, dur: 0.1, type: "triangle", gain: 0.09 }, true);
    this.tone({ freq: 1047, dur: 0.16, type: "triangle", gain: 0.09, when: 0.07 }, true);
    this.tone({ freq: 1568, dur: 0.2, type: "sine", gain: 0.06, when: 0.13 }, true);
  }
  /** Player lost a heart. */
  hurt() {
    this.tone({ freq: 220, slideTo: 90, dur: 0.3, type: "sawtooth", gain: 0.2 });
    this.noise({ dur: 0.2, type: "lowpass", f0: 700, f1: 150, gain: 0.26 });
  }
  shield() {
    this.bell(1047, 0.35, 0.07, 0, [1, 2.01, 3.0]);
    this.tone({ freq: 523, dur: 0.25, type: "triangle", gain: 0.07, when: 0.05 });
  }

  powerup(type: PowerUpType) {
    const arp = (notes: number[], step: number, wave: OscillatorType = "triangle", gain = 0.08, dur = 0.14) =>
      notes.forEach((n, i) => this.tone({ freq: midi(n), dur, type: wave, gain: gain * 0.6, when: i * step }, true));
    switch (type) {
      case "grow": arp([72, 76, 79, 84], 0.055); break;
      case "multiball": arp([79, 79, 83, 86, 91], 0.045, "square", 0.055, 0.1); break;
      case "slowmo": arp([84, 79, 76, 72], 0.07, "sine", 0.09, 0.2); this.tone({ freq: 1046, slideTo: 262, dur: 0.4, type: "sine", gain: 0.04 }); break;
      case "shield": this.shield(); arp([84, 88, 91], 0.06, "sine", 0.05, 0.3); break;
      case "heart": arp([76, 80, 83, 88], 0.06, "sine", 0.09, 0.22); this.tone({ freq: 164, dur: 0.3, type: "sine", gain: 0.1 }); break;
    }
  }

  monster(type: CreatureType) {
    switch (type) {
      case "ghost": // "woo-hoo"
        this.tone({ freq: 480, slideTo: 880, dur: 0.12, type: "sine", gain: 0.07, vibrato: 18 });
        this.tone({ freq: 880, slideTo: 540, dur: 0.18, type: "sine", gain: 0.06, when: 0.11, vibrato: 18 });
        break;
      case "demon": // snarl + yip
        this.tone({ freq: 190, slideTo: 90, dur: 0.18, type: "sawtooth", gain: 0.09 });
        this.noise({ dur: 0.14, f0: 900, f1: 300, q: 2, gain: 0.07 });
        this.tone({ freq: 700, slideTo: 1100, dur: 0.07, type: "square", gain: 0.05, when: 0.16 });
        break;
      case "fairy": // twinkle
        [2093, 2637, 3136].forEach((f, i) => this.tone({ freq: f, dur: 0.12, type: "sine", gain: 0.06, when: i * 0.05, vibrato: 30 }, true));
        break;
      case "blob": // blorp
        this.tone({ freq: 260, slideTo: 90, dur: 0.16, type: "sine", gain: 0.085, vibrato: 40 });
        this.tone({ freq: 160, slideTo: 420, dur: 0.1, type: "sine", gain: 0.06, when: 0.15 });
        break;
    }
  }

  coin(count = 1) {
    const n = Math.min(4, Math.max(1, count));
    for (let i = 0; i < n; i++) {
      this.tone({ freq: 1319, dur: 0.07, type: "square", gain: 0.035, when: i * 0.06 }, true);
      this.tone({ freq: 1976, dur: 0.2, type: "triangle", gain: 0.05, when: i * 0.06 + 0.045 }, true);
    }
  }

  shopBell() {
    this.bell(1568, 1.1, 0.06, 0, [1, 2.0, 3.01, 4.2]);
    this.bell(2093, 0.8, 0.03, 0.1, [1, 2.0]);
  }
  buy() { this.coin(2); this.shopBell(); }
  deny() {
    this.tone({ freq: 330, dur: 0.1, type: "triangle", gain: 0.05 });
    this.tone({ freq: 247, dur: 0.18, type: "triangle", gain: 0.05, when: 0.09 });
  }
  equip() { this.tone({ freq: 880, dur: 0.07, type: "triangle", gain: 0.07 }, true); this.tone({ freq: 1319, dur: 0.14, type: "triangle", gain: 0.07, when: 0.06 }, true); }
  click() { this.tone({ freq: 1200, slideTo: 800, dur: 0.05, type: "triangle", gain: 0.1 }); }

  /** Round cleared. */
  levelUp() {
    const seq: Array<[number, number, number]> = [
      [72, 0, 0.12], [76, 0.1, 0.12], [79, 0.2, 0.12], [84, 0.3, 0.28],
      [79, 0.55, 0.1], [84, 0.65, 0.1], [88, 0.75, 0.5],
    ];
    seq.forEach(([n, t, d]) => {
      this.tone({ freq: midi(n), dur: d, type: "square", gain: 0.04, when: t }, true);
      this.tone({ freq: midi(n - 12), dur: d, type: "triangle", gain: 0.05, when: t });
    });
    [60, 64, 67].forEach((n) => this.tone({ freq: midi(n), dur: 0.7, type: "triangle", gain: 0.03, when: 0.75 }));
  }

  gameOver() {
    [69, 65, 62, 57].forEach((n, i) => {
      this.tone({ freq: midi(n), dur: 0.5, type: "triangle", gain: 0.055, when: i * 0.28 }, true);
      this.tone({ freq: midi(n - 12), dur: 0.5, type: "sine", gain: 0.05, when: i * 0.28 });
    });
  }

  // ── music ───────────────────────────────────────────────────────────

  setMusic(track: MusicTrack | null) {
    if (track === this.track) return;
    this.track = track;
    this.step = 0;
    if (!track) { this.stopScheduler(); return; }
    if (this._muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.nextTime = ctx.currentTime + 0.08;
    this.startScheduler();
  }

  private startScheduler() {
    if (this.timer || !this.track) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.nextTime = Math.max(this.nextTime, ctx.currentTime + 0.05);
    this.timer = setInterval(() => this.pump(), 40);
  }

  private stopScheduler() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private pump() {
    const ctx = this.ctx;
    if (!ctx || !this.track || this._muted || ctx.state !== "running") return;
    const def = TRACKS[this.track];
    const stepDur = 60 / def.bpm / 4;
    // tab was in the background: don't burst-schedule a backlog
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.18) {
      this.scheduleStep(def, this.step, this.nextTime - ctx.currentTime, stepDur);
      this.step = (this.step + 1) % (def.chords.length * 16);
      this.nextTime += stepDur;
    }
  }

  private scheduleStep(def: TrackDef, step: number, when: number, stepDur: number) {
    const bar = (step / 16) | 0;
    const s = step % 16;
    const chord = def.chords[bar % def.chords.length];
    const tones = [0, chord.third, 7, 12];
    const root = chord.root;
    // pad: whole-bar chord, struck once, long release
    if (s === 0) {
      for (const iv of [0, chord.third, 7]) {
        this.tone({ freq: midi(root + iv), dur: stepDur * 15, type: "sine", gain: 0.14, attack: 0.25, when, bus: "music" });
      }
      this.tone({ freq: midi(root - 12), dur: stepDur * 7, type: "triangle", gain: 0.22, attack: 0.02, when, bus: "music" });
    }
    if (s === 8) this.tone({ freq: midi(root - 12), dur: stepDur * 7, type: "triangle", gain: 0.18, attack: 0.02, when, bus: "music" });
    // arpeggio
    const a = def.arp[s];
    if (a >= 0) {
      this.tone({ freq: midi(root + 12 + tones[a % 4]), dur: stepDur * 1.6, type: def.arpWave, gain: 0.1, when, bus: "music" });
    }
    // lead: one entry per two steps over the whole 4-bar loop
    if (s % 2 === 0) {
      const l = def.lead[(step / 2) % def.lead.length];
      if (l !== null && l !== undefined) {
        this.tone({ freq: midi(root + 12 + l), dur: stepDur * 3, type: def.leadWave, gain: 0.13, attack: 0.01, when, bus: "music", vibrato: 2 });
      }
    }
    // soft tick on the off-beats
    if (s % 4 === 2) this.noise({ dur: 0.025, type: "highpass", f0: 7000, gain: 0.015, when });
  }

  dispose() {
    this.stopScheduler();
    void this.ctx?.close();
    this.ctx = null;
  }
}
