import type { Vec3 } from '../sim/types';
import { assetUrl } from '../content/assetTypes';
import type { AudioSystem, PlayOptions, SfxId } from './types';
import { SFX, SFX_IDS, renderSfx, type SfxDef } from './sfxDesign';

export { SFX_IDS } from './sfxDesign';

const MAX_VOICES = 28;
/** Per-id minimum spacing so a crowd of enemies cannot flood one sound. */
const MIN_GAP = 0.025;
/** Positional sounds beyond this distance are not started at all. */
const CULL_DIST = 110;
const BED_LEVEL = 0.6;
const TENSION_LEVEL = 0.25;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  sfxBus: GainNode;
  ambBus: GainNode;
}

interface Voice {
  id: SfxId;
  prio: number;
  endAt: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode | null;
}

interface Ambience {
  bed: GainNode;
  tension: GainNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

class AudioEngine implements AudioSystem {
  private graph: Graph | null = null;
  private unavailable = false;
  private vols = { master: 0.8, sfx: 0.9, amb: 0.7 };
  /** Oldest first. */
  private voices: Voice[] = [];
  private bank = new Map<SfxId, AudioBuffer[]>();
  private inflight = new Map<SfxId, Promise<void>>();
  private lastPlay = new Map<SfxId, number>();
  private prerenderStarted = false;
  private listener: Vec3 | null = null;
  private intensity = 0;
  private amb: Ambience | null = null;

  private ensure(): Graph | null {
    if (this.graph) return this.graph;
    if (this.unavailable) return null;
    try {
      const w = globalThis as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) {
        this.unavailable = true;
        return null;
      }
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      const master = ctx.createGain();
      master.gain.value = this.vols.master;
      master.connect(comp);
      comp.connect(ctx.destination);
      const sfxBus = ctx.createGain();
      sfxBus.gain.value = this.vols.sfx;
      sfxBus.connect(master);
      const ambBus = ctx.createGain();
      ambBus.gain.value = this.vols.amb;
      ambBus.connect(master);
      this.graph = { ctx, master, sfxBus, ambBus };
      return this.graph;
    } catch {
      this.unavailable = true;
      return null;
    }
  }

  private ramp(g: Graph, p: AudioParam, v: number, timeConstant = 0.06): void {
    const t = g.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(v, t, timeConstant);
  }

  async resume(): Promise<void> {
    const g = this.ensure();
    if (!g) return;
    try {
      if (g.ctx.state !== 'running') await g.ctx.resume();
    } catch {
      /* no audio output available; sounds stay silent */
    }
    if (!this.prerenderStarted) {
      this.prerenderStarted = true;
      void this.renderAll();
    }
  }

  private async renderAll(): Promise<void> {
    for (const id of SFX_IDS) {
      await this.renderId(id);
      // Yield between sounds so rendering never blocks a frame for long.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  private renderId(id: SfxId): Promise<void> {
    if (this.bank.has(id)) return Promise.resolve();
    let p = this.inflight.get(id);
    if (!p) {
      const def: SfxDef = SFX[id];
      p = (async () => {
        const list: AudioBuffer[] = [];
        for (let v = 0; v < def.variants; v++) {
          const buf = await renderSfx(id, v).catch(() => null);
          if (buf) list.push(buf);
        }
        this.bank.set(id, list);
        this.inflight.delete(id);
      })();
      this.inflight.set(id, p);
    }
    return p;
  }

  play(id: SfxId, opts: PlayOptions = {}): void {
    const g = this.ensure();
    if (!g) return;
    const def = SFX[id];
    if (!def) return;
    const ctx = g.ctx;
    const now = ctx.currentTime;

    const last = this.lastPlay.get(id);
    if (last !== undefined && now - last < MIN_GAP) return;

    if (opts.pos && this.listener) {
      const l = this.listener;
      const dist = Math.hypot(opts.pos.x - l.x, opts.pos.y - l.y, opts.pos.z - l.z);
      if (dist > CULL_DIST) return;
    }

    const list = this.bank.get(id);
    if (!list) {
      void this.renderId(id);
      return;
    }
    if (list.length === 0) return;

    this.prune(now);

    // Per-id cap: steal the oldest voice of this id.
    let sameCount = 0;
    let oldestSame: Voice | null = null;
    for (const v of this.voices) {
      if (v.id === id) {
        sameCount++;
        if (!oldestSame) oldestSame = v;
      }
    }
    if (sameCount >= def.cap && oldestSame) this.stopVoice(oldestSame);

    // Global cap: steal the lowest-priority, oldest voice that is not above us.
    if (this.voices.length >= MAX_VOICES) {
      const victim = this.findVictim(def.prio);
      if (!victim) return;
      this.stopVoice(victim);
    }

    this.lastPlay.set(id, now);
    const buf = list[Math.floor(Math.random() * list.length)];
    const rate =
      (opts.rate ?? 1) * (def.jitter > 0 ? 1 + (Math.random() * 2 - 1) * def.jitter : 1);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain);

    let panner: PannerNode | null = null;
    if (opts.pos) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 4;
      panner.maxDistance = 80;
      panner.rolloffFactor = 1;
      panner.positionX.value = opts.pos.x;
      panner.positionY.value = opts.pos.y;
      panner.positionZ.value = opts.pos.z;
      gain.connect(panner);
      panner.connect(g.sfxBus);
    } else {
      gain.connect(g.sfxBus);
    }

    const voice: Voice = {
      id,
      prio: def.prio,
      endAt: now + buf.duration / rate + 0.1,
      src,
      gain,
      panner,
    };
    this.voices.push(voice);
    src.onended = () => this.removeVoice(voice);
    src.start(now);
  }

  private findVictim(prio: number): Voice | null {
    let best: Voice | null = null;
    for (const v of this.voices) {
      if (v.prio <= prio && (!best || v.prio < best.prio)) best = v;
    }
    return best;
  }

  private prune(now: number): void {
    for (const v of this.voices.slice()) {
      if (v.endAt < now) this.removeVoice(v);
    }
  }

  private removeVoice(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    try {
      v.gain.disconnect();
      v.panner?.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private stopVoice(v: Voice): void {
    const g = this.graph;
    if (g) {
      const t = g.ctx.currentTime;
      try {
        // Short fade avoids a click when a voice is stolen.
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0, t, 0.004);
        v.src.stop(t + 0.03);
      } catch {
        /* never started or already stopped */
      }
    }
    this.removeVoice(v);
  }

  setListener(pos: Vec3, forward: Vec3): void {
    this.listener = { x: pos.x, y: pos.y, z: pos.z };
    const g = this.graph;
    if (!g) return;
    const l = g.ctx.listener;
    const len = Math.hypot(forward.x, forward.y, forward.z) || 1;
    l.positionX.value = pos.x;
    l.positionY.value = pos.y;
    l.positionZ.value = pos.z;
    l.forwardX.value = forward.x / len;
    l.forwardY.value = forward.y / len;
    l.forwardZ.value = forward.z / len;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }

  setVolumes(master: number, sfx: number, ambience: number): void {
    this.vols = { master: clamp01(master), sfx: clamp01(sfx), amb: clamp01(ambience) };
    const g = this.graph;
    if (!g) return;
    this.ramp(g, g.master.gain, this.vols.master, 0.05);
    this.ramp(g, g.sfxBus.gain, this.vols.sfx, 0.05);
    this.ramp(g, g.ambBus.gain, this.vols.amb, 0.05);
  }

  /** Brown noise loop used by the rumble layer and the fallback bed. */
  private brownBuffer(ctx: BaseAudioContext): AudioBuffer {
    const len = Math.ceil(ctx.sampleRate * 4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  private buildAmbience(g: Graph): Ambience {
    const ctx = g.ctx;
    const t = ctx.currentTime;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];

    // Bed: the sample loop (or fallback) ducks slightly with intensity.
    const bed = ctx.createGain();
    bed.gain.value = BED_LEVEL * (1 - 0.25 * this.intensity);
    bed.connect(g.ambBus);
    nodes.push(bed);

    // Subtle synthesized refinery rumble, always on.
    const rumble = ctx.createGain();
    rumble.gain.value = 0.1;
    rumble.connect(g.ambBus);
    nodes.push(rumble);
    for (const [f, amp] of [
      [31, 0.5],
      [46.5, 0.25],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og);
      og.connect(rumble);
      sources.push(o);
      nodes.push(og);
    }
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 0.07;
    const wobbleAmt = ctx.createGain();
    wobbleAmt.gain.value = 0.03;
    wobble.connect(wobbleAmt);
    wobbleAmt.connect(rumble.gain);
    sources.push(wobble);
    nodes.push(wobbleAmt);
    const brownSrc = ctx.createBufferSource();
    brownSrc.buffer = this.brownBuffer(ctx);
    brownSrc.loop = true;
    const brownLp = ctx.createBiquadFilter();
    brownLp.type = 'lowpass';
    brownLp.frequency.value = 140;
    const brownGain = ctx.createGain();
    brownGain.gain.value = 0.35;
    brownSrc.connect(brownLp);
    brownLp.connect(brownGain);
    brownGain.connect(rumble);
    sources.push(brownSrc);
    nodes.push(brownLp, brownGain);

    // Tension layer: pulsing filtered low drone, level set by setIntensity.
    const tension = ctx.createGain();
    tension.gain.value = TENSION_LEVEL * this.intensity;
    tension.connect(g.ambBus);
    nodes.push(tension);
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    pulse.connect(tension);
    const tf = ctx.createBiquadFilter();
    tf.type = 'lowpass';
    tf.frequency.value = 220;
    tf.Q.value = 4;
    tf.connect(pulse);
    nodes.push(pulse, tf);
    const pulseLfo = ctx.createOscillator();
    pulseLfo.frequency.value = 1.6;
    const pulseAmt = ctx.createGain();
    pulseAmt.gain.value = 0.5;
    pulseLfo.connect(pulseAmt);
    pulseAmt.connect(pulse.gain);
    sources.push(pulseLfo);
    nodes.push(pulseAmt);
    for (const f of [55, 55.7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(tf);
      sources.push(o);
    }

    for (const s of sources) s.start(t);
    return { bed, tension, nodes, sources };
  }

  /** Fills the bed with the shipped loop, or a synthesized drone if it cannot load. */
  private async loadBed(g: Graph, amb: Ambience): Promise<void> {
    let buf: AudioBuffer | null = null;
    try {
      const res = await fetch(assetUrl('audio/amb/industrial.ogg'));
      if (res.ok) buf = await g.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      buf = null;
    }
    if (this.amb !== amb) return; // stopped or restarted while loading

    const ctx = g.ctx;
    const t = ctx.currentTime;
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(amb.bed);
      amb.sources.push(src);
      src.start(t);
      return;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = this.brownBuffer(ctx);
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const ng = ctx.createGain();
    ng.gain.value = 0.6;
    noise.connect(lp);
    lp.connect(ng);
    ng.connect(amb.bed);
    const drone = ctx.createOscillator();
    drone.frequency.value = 38;
    const dg = ctx.createGain();
    dg.gain.value = 0.3;
    drone.connect(dg);
    dg.connect(amb.bed);
    amb.sources.push(noise, drone);
    amb.nodes.push(lp, ng, dg);
    noise.start(t);
    drone.start(t);
  }

  startAmbience(): void {
    const g = this.ensure();
    if (!g || this.amb) return;
    const amb = this.buildAmbience(g);
    this.amb = amb;
    void this.loadBed(g, amb);
  }

  stopAll(): void {
    for (const v of this.voices.slice()) this.stopVoice(v);
    const amb = this.amb;
    if (amb) {
      for (const s of amb.sources) {
        try {
          s.stop();
        } catch {
          /* not started */
        }
      }
      for (const n of amb.nodes) n.disconnect();
      amb.bed.disconnect();
      amb.tension.disconnect();
      this.amb = null;
    }
    this.intensity = 0;
  }

  setIntensity(v: number): void {
    this.intensity = clamp01(v);
    const g = this.graph;
    const amb = this.amb;
    if (!g || !amb) return;
    this.ramp(g, amb.bed.gain, BED_LEVEL * (1 - 0.25 * this.intensity), 0.3);
    this.ramp(g, amb.tension.gain, TENSION_LEVEL * this.intensity, 0.3);
  }
}

/** Creates the audio system. Safe to call in Node: no globals are touched until used. */
export function createAudioSystem(): AudioSystem {
  return new AudioEngine();
}
