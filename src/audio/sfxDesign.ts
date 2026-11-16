import type { SfxId } from './types';

/**
 * Procedural sound design. Every SfxId is built from oscillators, filtered
 * noise and envelopes, rendered once through an OfflineAudioContext into an
 * AudioBuffer. Nothing here touches the DOM or the live AudioContext, and
 * nothing runs at import time.
 */

export type SfxPrio = 0 | 1 | 2;

export interface SfxDef {
  /** Rendered length in seconds; must cover the whole tail. */
  dur: number;
  /** Stealing priority: higher-priority voices are never cut for lower ones. */
  prio: SfxPrio;
  /** Maximum simultaneous voices of this id. */
  cap: number;
  /** Pre-rendered variants (different seeds and slight pitch offsets). */
  variants: number;
  /** Random playback-rate jitter (+/- fraction) applied at play time. */
  jitter: number;
  build: (s: Synth) => void;
}

export const SFX_SAMPLE_RATE = 44100;

export interface FilterSpec {
  type: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
}

export interface Shape {
  attack?: number;
  hold?: number;
  release?: number;
  detune?: number;
  filter?: FilterSpec;
}

export class Synth {
  private readonly c: BaseAudioContext;
  private readonly out: AudioNode;
  private readonly pitch: number;
  private state: number;
  private noiseBuf: AudioBuffer | null = null;

  constructor(c: BaseAudioContext, out: AudioNode, seed: number, pitch: number) {
    this.c = c;
    this.out = out;
    this.pitch = pitch;
    this.state = seed >>> 0;
  }

  /** Deterministic [0,1) generator (mulberry32) so variants are reproducible. */
  rnd(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noiseBuf) {
      const len = Math.ceil(this.c.sampleRate * 2);
      const buf = this.c.createBuffer(1, len, this.c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = this.rnd() * 2 - 1;
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
  }

  /** Attack to peak, hold, then exponential release to silence. */
  private env(p: AudioParam, t: number, peak: number, a: number, hold: number, r: number): void {
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(peak, t + a);
    if (hold > 0) p.setValueAtTime(peak, t + a + hold);
    p.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
  }

  private sweep(p: AudioParam, f0: number, f1: number, t: number, total: number): void {
    p.setValueAtTime(f0, t);
    if (f1 !== f0) p.exponentialRampToValueAtTime(f1, t + total);
  }

  /** source -> [filter] -> gain -> out. Returns the gain for the envelope. */
  private route(src: AudioNode, t: number, total: number, filter?: FilterSpec): GainNode {
    const g = this.c.createGain();
    if (filter) {
      const bq = this.c.createBiquadFilter();
      bq.type = filter.type;
      bq.Q.value = filter.q ?? 1;
      this.sweep(bq.frequency, filter.f0, filter.f1 ?? filter.f0, t, total);
      src.connect(bq);
      bq.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(this.out);
    return g;
  }

  tone(type: OscillatorType, f0: number, f1: number, t: number, peak: number, o: Shape = {}): void {
    const a = Math.max(o.attack ?? 0.002, 0.001);
    const h = o.hold ?? 0;
    const r = Math.max(o.release ?? 0.08, 0.005);
    const total = a + h + r;
    const osc = this.c.createOscillator();
    osc.type = type;
    osc.detune.value = o.detune ?? 0;
    this.sweep(osc.frequency, f0 * this.pitch, f1 * this.pitch, t, total);
    const g = this.route(osc, t, total, o.filter);
    this.env(g.gain, t, peak, a, h, r);
    osc.start(t);
    osc.stop(t + total + 0.02);
  }

  noise(t: number, peak: number, o: Shape = {}): void {
    const a = Math.max(o.attack ?? 0.002, 0.001);
    const h = o.hold ?? 0;
    const r = Math.max(o.release ?? 0.08, 0.005);
    const total = a + h + r;
    const src = this.c.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const g = this.route(src, t, total, o.filter);
    this.env(g.gain, t, peak, a, h, r);
    src.start(t, this.rnd() * 1.5);
    src.stop(t + total + 0.02);
  }
}

const d = (
  dur: number,
  prio: SfxPrio,
  cap: number,
  build: (s: Synth) => void,
  variants = 1,
  jitter = 0,
): SfxDef => ({ dur, prio, cap, build, variants, jitter });

export const SFX: Record<SfxId, SfxDef> = {
  // --- Player weapons -----------------------------------------------------
  // Coil carbine: short electric "tchk" pulse.
  coil_fire: d(0.09, 1, 6, (s) => {
    s.tone('square', 1800, 900, 0, 0.3, { release: 0.05 });
    s.tone('sawtooth', 4000, 1200, 0, 0.12, { release: 0.035 });
    s.noise(0, 0.45, { release: 0.025, filter: { type: 'highpass', f0: 3000 } });
    s.tone('sine', 220, 120, 0, 0.12, { release: 0.05 });
  }, 3, 0.03),
  coil_reload: d(0.75, 1, 3, (s) => {
    s.noise(0, 0.5, { release: 0.02, filter: { type: 'bandpass', f0: 2600, q: 4 } });
    s.tone('square', 1200, 900, 0, 0.12, { release: 0.03 });
    s.noise(0.3, 0.45, { release: 0.03, filter: { type: 'bandpass', f0: 1800, q: 3 } });
    s.tone('square', 260, 200, 0.3, 0.12, { release: 0.05 });
    s.tone('sine', 300, 1400, 0.35, 0.14, { attack: 0.12, hold: 0.1, release: 0.1 });
  }),
  coil_empty: d(0.12, 1, 4, (s) => {
    s.noise(0, 0.5, { release: 0.012, filter: { type: 'highpass', f0: 4000 } });
    s.tone('square', 900, 700, 0, 0.12, { release: 0.02 });
  }),
  coil_equip: d(0.4, 1, 2, (s) => {
    s.tone('square', 600, 900, 0, 0.08, { release: 0.08 });
    s.noise(0.22, 0.4, { release: 0.03, filter: { type: 'bandpass', f0: 2000, q: 2 } });
    s.tone('sine', 1200, 1200, 0.25, 0.05, { release: 0.1 });
  }),

  // Arc scattergun: heavy wide crack with crackle tail.
  arc_fire: d(0.4, 1, 3, (s) => {
    s.tone('sine', 120, 40, 0, 0.9, { release: 0.25 });
    s.noise(0, 0.8, { release: 0.05, filter: { type: 'bandpass', f0: 3000, q: 0.7 } });
    s.noise(0, 0.35, { hold: 0.02, release: 0.15, filter: { type: 'highpass', f0: 2000 } });
    for (let i = 0; i < 7; i++) {
      s.noise(0.04 + s.rnd() * 0.28, 0.18 + s.rnd() * 0.15, {
        release: 0.012,
        filter: { type: 'highpass', f0: 4500 },
      });
    }
  }, 2, 0.03),
  arc_reload: d(1.05, 1, 2, (s) => {
    s.tone('sine', 90, 50, 0, 0.9, { release: 0.15 });
    s.noise(0.42, 0.5, { release: 0.03, filter: { type: 'bandpass', f0: 1200, q: 2 } });
    s.tone('square', 180, 180, 0.42, 0.08, { release: 0.05 });
    s.tone('sawtooth', 200, 1200, 0.55, 0.1, {
      attack: 0.35,
      release: 0.1,
      filter: { type: 'lowpass', f0: 1500, q: 1 },
    });
    s.noise(0.55, 0.12, { attack: 0.3, release: 0.15, filter: { type: 'highpass', f0: 3000 } });
  }),
  arc_empty: d(0.16, 1, 3, (s) => {
    s.noise(0, 0.6, { release: 0.03, filter: { type: 'bandpass', f0: 1500, q: 2 } });
    s.tone('sine', 110, 90, 0, 0.3, { release: 0.08 });
  }),
  arc_equip: d(0.55, 1, 2, (s) => {
    s.tone('sine', 140, 70, 0, 0.5, { release: 0.15 });
    s.tone('sawtooth', 300, 600, 0.1, 0.08, { attack: 0.3, release: 0.12 });
    s.noise(0, 0.5, { release: 0.02, filter: { type: 'bandpass', f0: 2500, q: 2 } });
  }),
  // Arc slug: deeper, punchier boom (alt fire).
  arc_slug: d(0.6, 1, 3, (s) => {
    s.tone('sine', 70, 30, 0, 1.0, { release: 0.5 });
    s.tone('sine', 180, 60, 0, 0.5, { release: 0.12 });
    s.noise(0, 0.5, { release: 0.3, filter: { type: 'lowpass', f0: 900 } });
  }, 2, 0.03),
  // Service emitter: thin soft zap.
  emitter_fire: d(0.12, 1, 4, (s) => {
    s.tone('sine', 1400, 500, 0, 0.25, { attack: 0.003, release: 0.09 });
    s.tone('triangle', 2200, 800, 0, 0.12, { release: 0.06 });
  }),
  emitter_empty: d(0.1, 1, 3, (s) => {
    s.noise(0, 0.3, { release: 0.015, filter: { type: 'bandpass', f0: 3000, q: 2 } });
    s.tone('triangle', 700, 700, 0, 0.1, { release: 0.03 });
  }),
  emitter_equip: d(0.3, 1, 2, (s) => {
    s.tone('sine', 500, 1200, 0, 0.15, { attack: 0.02, release: 0.25 });
  }),

  // --- Impacts ------------------------------------------------------------
  impact_world: d(0.1, 0, 6, (s) => {
    s.noise(0, 0.6, { release: 0.06, filter: { type: 'bandpass', f0: 1400, q: 2 } });
    s.tone('sine', 300, 200, 0, 0.2, { release: 0.05 });
  }, 3, 0.05),
  impact_flesh: d(0.12, 0, 6, (s) => {
    s.noise(0, 0.5, { release: 0.08, filter: { type: 'lowpass', f0: 700 } });
    s.tone('sine', 160, 80, 0, 0.4, { release: 0.08 });
  }, 3, 0.05),
  impact_metal: d(0.12, 0, 6, (s) => {
    s.tone('sine', 2400, 2400, 0, 0.2, { release: 0.1 });
    s.tone('sine', 3410, 3410, 0, 0.08, { release: 0.08 });
    s.noise(0, 0.4, { release: 0.01, filter: { type: 'highpass', f0: 5000 } });
  }, 3, 0.05),
  armor_break: d(0.3, 1, 2, (s) => {
    s.noise(0, 0.5, { release: 0.2, filter: { type: 'bandpass', f0: 3000, f1: 1200, q: 1 } });
    s.tone('square', 900, 300, 0, 0.12, { release: 0.15 });
  }),

  // --- Enemies ------------------------------------------------------------
  enemy_die: d(0.6, 1, 6, (s) => {
    s.tone('sine', 220, 70, 0, 0.35, { attack: 0.005, release: 0.5 });
    s.noise(0, 0.3, { attack: 0.01, release: 0.4, filter: { type: 'lowpass', f0: 500 } });
  }, 2, 0.04),
  // Tells: priority 2, they must cut through the mix.
  walker_tell: d(1.0, 2, 4, (s) => {
    s.tone('sawtooth', 80, 220, 0, 0.3, {
      attack: 0.15,
      hold: 0.5,
      release: 0.3,
      filter: { type: 'lowpass', f0: 300, f1: 1200, q: 3 },
    });
    s.noise(0, 0.2, {
      attack: 0.2,
      hold: 0.5,
      release: 0.3,
      filter: { type: 'bandpass', f0: 400, f1: 900, q: 3 },
    });
    s.tone('square', 40, 40, 0, 0.15, { attack: 0.15, hold: 0.5, release: 0.3 });
  }),
  walker_growl: d(0.9, 1, 3, (s) => {
    s.tone('sawtooth', 60, 90, 0, 0.2, {
      attack: 0.1,
      hold: 0.5,
      release: 0.3,
      filter: { type: 'lowpass', f0: 400, q: 1.5 },
    });
    s.noise(0, 0.15, { attack: 0.1, hold: 0.4, release: 0.4, filter: { type: 'lowpass', f0: 250 } });
  }, 2, 0.04),
  hound_charge: d(0.7, 2, 4, (s) => {
    s.tone('sawtooth', 800, 2600, 0, 0.18, { attack: 0.05, hold: 0.4, release: 0.2 });
    s.tone('square', 1600, 3400, 0, 0.08, { attack: 0.05, hold: 0.4, release: 0.2 });
    s.noise(0, 0.15, {
      attack: 0.05,
      hold: 0.4,
      release: 0.2,
      filter: { type: 'bandpass', f0: 3500, f1: 4500, q: 6 },
    });
  }),
  hound_lunge: d(0.35, 1, 3, (s) => {
    s.noise(0, 0.4, {
      attack: 0.02,
      hold: 0.1,
      release: 0.2,
      filter: { type: 'bandpass', f0: 1200, f1: 600, q: 1 },
    });
    s.tone('sawtooth', 300, 120, 0, 0.2, { release: 0.3 });
  }, 2, 0.04),
  drone_hum: d(1.6, 0, 2, (s) => {
    s.tone('sine', 110, 110, 0, 0.12, { attack: 0.2, hold: 1.1, release: 0.3 });
    s.tone('sine', 110, 110, 0, 0.04, { attack: 0.3, hold: 1.0, release: 0.3, detune: 6 });
  }),
  drone_tell: d(1.0, 2, 4, (s) => {
    s.tone('sine', 300, 1200, 0, 0.25, { attack: 0.1, hold: 0.6, release: 0.3 });
    s.tone('sine', 300, 1212, 0, 0.15, { attack: 0.1, hold: 0.6, release: 0.3, detune: 9 });
    s.tone('triangle', 150, 400, 0, 0.08, { attack: 0.1, hold: 0.6, release: 0.3 });
  }),
  drone_flame: d(1.3, 1, 2, (s) => {
    s.noise(0, 0.8, {
      attack: 0.05,
      hold: 1.0,
      release: 0.25,
      filter: { type: 'bandpass', f0: 600, f1: 1400, q: 0.8 },
    });
    s.noise(0, 0.5, { attack: 0.05, hold: 1.0, release: 0.25, filter: { type: 'lowpass', f0: 250 } });
    s.tone('sawtooth', 60, 60, 0, 0.08, { attack: 0.05, hold: 1.0, release: 0.25 });
  }),
  loader_tell: d(1.3, 2, 3, (s) => {
    // Deep hydraulic horn: detuned saw pair plus a square sub.
    s.tone('sawtooth', 98, 110, 0, 0.25, {
      attack: 0.15,
      hold: 0.9,
      release: 0.25,
      filter: { type: 'lowpass', f0: 700, q: 2 },
    });
    s.tone('sawtooth', 147, 165, 0, 0.15, {
      attack: 0.15,
      hold: 0.9,
      release: 0.25,
      filter: { type: 'lowpass', f0: 900, q: 2 },
    });
    s.tone('square', 55, 55, 0, 0.2, { attack: 0.15, hold: 0.9, release: 0.25 });
    s.noise(0, 0.1, { attack: 0.05, hold: 0.3, release: 0.3, filter: { type: 'highpass', f0: 2000 } });
  }),
  loader_swing: d(0.5, 1, 3, (s) => {
    s.noise(0, 0.5, {
      attack: 0.1,
      hold: 0.15,
      release: 0.25,
      filter: { type: 'bandpass', f0: 900, f1: 300, q: 1 },
    });
    s.tone('sine', 150, 90, 0, 0.15, { attack: 0.1, hold: 0.1, release: 0.2 });
  }),
  loader_slam: d(1.5, 2, 2, (s) => {
    s.tone('sine', 60, 25, 0, 1.0, { release: 1.2 });
    s.tone('sine', 120, 40, 0, 0.6, { release: 0.4 });
    s.noise(0, 0.6, { release: 0.8, filter: { type: 'lowpass', f0: 400 } });
    s.noise(0.05, 0.3, { release: 0.5, filter: { type: 'bandpass', f0: 1000, q: 1 } });
  }),
  loader_call: d(1.0, 1, 2, (s) => {
    s.tone('sawtooth', 147, 165, 0, 0.2, {
      attack: 0.15,
      hold: 0.5,
      release: 0.3,
      filter: { type: 'lowpass', f0: 800, q: 2 },
    });
    s.tone('square', 73, 73, 0, 0.15, { attack: 0.15, hold: 0.5, release: 0.3 });
  }),

  // --- Proc / tag feedback -----------------------------------------------
  arc_proc: d(0.3, 1, 4, (s) => {
    s.tone('sawtooth', 1200, 400, 0, 0.15, { release: 0.2 });
    s.noise(0, 0.3, { release: 0.02, filter: { type: 'highpass', f0: 4000 } });
    s.noise(0.08, 0.25, { release: 0.02, filter: { type: 'highpass', f0: 4000 } });
    s.noise(0.16, 0.2, { release: 0.02, filter: { type: 'highpass', f0: 4000 } });
  }, 2),
  burst_proc: d(0.25, 1, 4, (s) => {
    s.tone('sine', 500, 200, 0, 0.5, { release: 0.15 });
    s.noise(0, 0.3, { release: 0.05, filter: { type: 'lowpass', f0: 2000 } });
  }),
  backwash_proc: d(0.4, 1, 3, (s) => {
    s.noise(0, 0.4, {
      attack: 0.1,
      hold: 0.1,
      release: 0.2,
      filter: { type: 'bandpass', f0: 400, f1: 2000, q: 1 },
    });
    s.tone('sine', 200, 500, 0, 0.1, { attack: 0.1, hold: 0.1, release: 0.2 });
  }),
  ion_tag: d(0.22, 1, 4, (s) => {
    s.tone('sine', 1800, 1800, 0, 0.2, { release: 0.18 });
    s.tone('sine', 2700, 2700, 0.02, 0.07, { release: 0.15 });
  }),

  // --- Player ---------------------------------------------------------------
  player_hurt: d(0.45, 2, 2, (s) => {
    s.noise(0, 0.7, { release: 0.15, filter: { type: 'lowpass', f0: 400 } });
    s.tone('triangle', 140, 90, 0, 0.6, { release: 0.35 });
    s.tone('sine', 220, 150, 0, 0.15, { release: 0.2 });
  }),
  player_die: d(1.2, 2, 1, (s) => {
    s.tone('sine', 200, 40, 0, 0.5, { attack: 0.01, release: 1.1 });
    s.noise(0, 0.5, { release: 0.5, filter: { type: 'lowpass', f0: 300 } });
  }),
  footstep: d(0.08, 0, 2, (s) => {
    s.noise(0, 0.35, { release: 0.05, filter: { type: 'bandpass', f0: 1200, q: 1.5 } });
    s.tone('sine', 180, 180, 0, 0.08, { release: 0.04 });
  }, 3, 0.06),
  jump: d(0.2, 1, 2, (s) => {
    s.noise(0, 0.25, { attack: 0.02, hold: 0.03, release: 0.12, filter: { type: 'bandpass', f0: 700, q: 1 } });
    s.tone('sine', 220, 330, 0, 0.08, { attack: 0.02, release: 0.12 });
  }),
  land: d(0.25, 1, 2, (s) => {
    s.tone('sine', 110, 55, 0, 0.6, { release: 0.2 });
    s.noise(0, 0.3, { release: 0.1, filter: { type: 'lowpass', f0: 500 } });
  }),
  dash: d(0.4, 1, 2, (s) => {
    s.noise(0, 0.5, {
      attack: 0.05,
      hold: 0.05,
      release: 0.3,
      filter: { type: 'bandpass', f0: 500, f1: 2500, q: 1.2 },
    });
    s.tone('sine', 800, 300, 0, 0.05, { attack: 0.05, release: 0.3 });
  }),

  // --- Pickups ----------------------------------------------------------------
  pickup_ammo: d(0.2, 1, 3, (s) => {
    s.tone('sine', 1200, 1200, 0, 0.2, { release: 0.15 });
    s.tone('sine', 1800, 1800, 0.05, 0.15, { release: 0.12 });
  }),
  pickup_health: d(0.3, 1, 3, (s) => {
    s.tone('sine', 600, 900, 0, 0.2, { release: 0.25 });
    s.tone('sine', 1200, 1200, 0.08, 0.1, { release: 0.2 });
  }),
  pickup_salvage: d(0.25, 1, 3, (s) => {
    s.noise(0, 0.4, { release: 0.03, filter: { type: 'bandpass', f0: 2500, q: 2 } });
    s.tone('sine', 900, 900, 0.02, 0.15, { release: 0.1 });
  }),
  pickup_weapon: d(0.4, 1, 2, (s) => {
    s.tone('sine', 500, 500, 0, 0.25, { release: 0.1 });
    s.tone('sine', 750, 750, 0.1, 0.25, { release: 0.25 });
  }),

  // --- Director / UI ---------------------------------------------------------
  vent_warn: d(1.5, 2, 2, (s) => {
    s.noise(0, 0.4, {
      attack: 0.3,
      hold: 0.7,
      release: 0.4,
      filter: { type: 'bandpass', f0: 1000, f1: 4000, q: 1 },
    });
    s.noise(0, 0.15, { attack: 0.3, hold: 0.7, release: 0.4, filter: { type: 'highpass', f0: 2000 } });
    s.tone('sine', 300, 600, 0, 0.08, { attack: 0.3, hold: 0.7, release: 0.4 });
  }),
  vent_burst: d(0.8, 2, 2, (s) => {
    s.noise(0, 0.8, { attack: 0.005, release: 0.6, filter: { type: 'lowpass', f0: 3000, f1: 400 } });
    s.tone('sine', 90, 40, 0, 0.5, { release: 0.5 });
  }),
  // Distant klaxon: alternating two-tone square through a lowpass.
  wave_warn: d(1.6, 2, 1, (s) => {
    for (let i = 0; i < 4; i++) {
      const f = i % 2 ? 330 : 440;
      s.tone('square', f, f, i * 0.4, 0.15, {
        attack: 0.01,
        hold: 0.28,
        release: 0.05,
        filter: { type: 'lowpass', f0: 1200, q: 1 },
      });
    }
  }),
  encounter_clear: d(0.8, 1, 1, (s) => {
    s.tone('sine', 523, 523, 0, 0.15, { attack: 0.01, hold: 0.05, release: 0.2 });
    s.tone('sine', 659, 659, 0.15, 0.15, { attack: 0.01, hold: 0.05, release: 0.2 });
    s.tone('sine', 784, 784, 0.3, 0.15, { attack: 0.01, hold: 0.1, release: 0.35 });
  }),
  radio_blip: d(0.12, 1, 2, (s) => {
    s.tone('square', 1400, 1400, 0, 0.12, {
      attack: 0.003,
      hold: 0.04,
      release: 0.03,
      filter: { type: 'bandpass', f0: 2000, q: 2 },
    });
  }),
  ui_hover: d(0.04, 0, 2, (s) => {
    s.tone('sine', 2000, 2000, 0, 0.05, { release: 0.03 });
  }, 3, 0.03),
  ui_select: d(0.09, 1, 2, (s) => {
    s.tone('sine', 880, 880, 0, 0.12, { release: 0.07 });
    s.tone('sine', 1320, 1320, 0.02, 0.05, { release: 0.05 });
  }),
  ui_reroll: d(0.25, 1, 1, (s) => {
    s.noise(0, 0.15, {
      attack: 0.03,
      hold: 0.05,
      release: 0.15,
      filter: { type: 'bandpass', f0: 1500, f1: 3000, q: 1 },
    });
    s.tone('sine', 600, 1000, 0, 0.08, { attack: 0.02, release: 0.2 });
  }),
  ui_open: d(0.2, 1, 1, (s) => {
    s.tone('sine', 400, 800, 0, 0.08, { attack: 0.02, hold: 0.03, release: 0.15 });
  }),
  // Relay hum: one-shot 2 s hum, used as a looped-style source.
  relay_hum: d(2.0, 0, 2, (s) => {
    s.tone('sine', 60, 60, 0, 0.15, { attack: 0.2, hold: 1.4, release: 0.4 });
    s.tone('sine', 120, 120, 0, 0.06, { attack: 0.2, hold: 1.4, release: 0.4 });
  }),
  relay_down: d(1.2, 1, 1, (s) => {
    s.tone('sawtooth', 400, 30, 0, 0.25, {
      attack: 0.005,
      release: 1.1,
      filter: { type: 'lowpass', f0: 2000, f1: 200, q: 1.5 },
    });
    s.noise(0, 0.3, { attack: 0.005, release: 0.6, filter: { type: 'lowpass', f0: 300 } });
  }),
};

/** Stable list of every sound id, for pre-rendering and the dev page. */
export const SFX_IDS = Object.keys(SFX) as SfxId[];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Render one variant of a sound offline. Resolves null when OfflineAudioContext is missing. */
export async function renderSfx(id: SfxId, variant: number): Promise<AudioBuffer | null> {
  const def = SFX[id];
  const w = globalThis as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctor) return null;
  const off = new Ctor(1, Math.ceil(def.dur * SFX_SAMPLE_RATE), SFX_SAMPLE_RATE);
  const pitch = variant === 0 ? 1 : variant === 1 ? 0.94 : 1.06;
  const synth = new Synth(off, off.destination, hash(id) + variant * 7919 + 1, pitch);
  def.build(synth);
  const buf = await off.startRendering();
  // Hot sounds can sum past full scale; pull them under 0.95 so the bus never hard-clips.
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak > 0.95) {
    const k = 0.95 / peak;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
  }
  return buf;
}
