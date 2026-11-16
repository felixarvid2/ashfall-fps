import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 256.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Bounded CPU particle system rendered as soft points. One draw call. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private c0: Float32Array; // r,g,b,a
  private s01: Float32Array; // s0,s1
  private grav: Float32Array;
  private next = 0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;

  constructor(
    capacity: number,
    map: THREE.Texture,
    opts: { additive: boolean; drag?: number } = { additive: true },
  ) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    this.c0 = new Float32Array(capacity * 4);
    this.s01 = new Float32Array(capacity * 2);
    this.grav = new Float32Array(capacity);
    this.drag = opts.drag ?? 0.2;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  private drag: number;

  setScale(pixelsPerMeterAtUnit: number): void {
    this.mat.uniforms.uScale.value = pixelsPerMeterAtUnit;
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number,
    r: number, g: number, b: number, a: number,
    s0: number, s1: number,
    gravity = 0,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.c0[i * 4] = r; this.c0[i * 4 + 1] = g; this.c0[i * 4 + 2] = b; this.c0[i * 4 + 3] = a;
    this.s01[i * 2] = s0; this.s01[i * 2 + 1] = s1;
    this.grav[i] = gravity;
  }

  clear(): void {
    this.life.fill(0);
    this.col.fill(0);
    this.size.fill(0);
    this.geo.attributes.aColor.needsUpdate = true;
  }

  update(dt: number): void {
    const dragK = Math.exp(-this.drag * dt * 5);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= dragK; this.vel[i * 3 + 1] *= dragK; this.vel[i * 3 + 2] *= dragK;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fade = this.life[i] <= 0 ? 0 : (1 - t) * (1 - t) * Math.min(1, t * 12 + 0.2);
      this.col[i * 4] = this.c0[i * 4];
      this.col[i * 4 + 1] = this.c0[i * 4 + 1];
      this.col[i * 4 + 2] = this.c0[i * 4 + 2];
      this.col[i * 4 + 3] = this.c0[i * 4 + 3] * fade;
      this.size[i] = this.s01[i * 2] + (this.s01[i * 2 + 1] - this.s01[i * 2]) * t;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

/** Camera-facing ribbon beams (tracers, lightning). One draw call for the whole pool. */
export const BEAM_PTS = 7;
export interface Beam {
  active: boolean;
  life: number;
  max: number;
  kind: 'tracer' | 'arc' | 'line';
  from: THREE.Vector3;
  to: THREE.Vector3;
  width: number;
  color: THREE.Color;
  speed: number;
  pulse: number;
  jitter: number;
  alpha: number;
}

export class BeamPool {
  readonly mesh: THREE.Mesh;
  readonly beams: Beam[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private geo = new THREE.BufferGeometry();
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private side = new THREE.Vector3();
  private toCam = new THREE.Vector3();
  private pts: THREE.Vector3[] = Array.from({ length: BEAM_PTS }, () => new THREE.Vector3());
  private alphas = new Float32Array(BEAM_PTS);
  private widths = new Float32Array(BEAM_PTS);

  constructor(readonly capacity: number) {
    const nv = capacity * BEAM_PTS * 2;
    this.pos = new Float32Array(nv * 3);
    this.col = new Float32Array(nv * 4);
    const idx: number[] = [];
    for (let b = 0; b < capacity; b++) {
      for (let s = 0; s < BEAM_PTS - 1; s++) {
        const a = (b * BEAM_PTS + s) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      this.beams.push({
        active: false, life: 0, max: 1, kind: 'line', from: new THREE.Vector3(), to: new THREE.Vector3(),
        width: 0.03, color: new THREE.Color(), speed: 200, pulse: 3, jitter: 0, alpha: 1,
      });
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  spawn(kind: Beam['kind'], from: THREE.Vector3, to: THREE.Vector3, o: { width: number; color: number; life: number; speed?: number; pulse?: number; jitter?: number; alpha?: number }): Beam {
    let b = this.beams.find((x) => !x.active);
    if (!b) {
      // steal the oldest
      b = this.beams.reduce((a, c) => (c.life < a.life ? c : a));
    }
    b.active = true;
    b.kind = kind;
    b.from.copy(from);
    b.to.copy(to);
    b.width = o.width;
    b.color.setHex(o.color);
    b.life = b.max = o.life;
    b.speed = o.speed ?? 220;
    b.pulse = o.pulse ?? 3;
    b.jitter = o.jitter ?? 0;
    b.alpha = o.alpha ?? 1;
    return b;
  }

  clear(): void {
    for (const b of this.beams) b.active = false;
    this.col.fill(0);
    this.geo.attributes.color.needsUpdate = true;
  }

  update(dt: number, camPos: THREE.Vector3): void {
    let any = false;
    for (let bi = 0; bi < this.capacity; bi++) {
      const b = this.beams[bi];
      const base = bi * BEAM_PTS * 2;
      if (!b.active) {
        // keep alpha zero (already zero after deactivation write)
        if (this.col[base * 4 + 3] !== 0 || this.col[(base + 1) * 4 + 3] !== 0) this.zero(base);
        continue;
      }
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        this.zero(base);
        any = true;
        continue;
      }
      any = true;
      const t = 1 - b.life / b.max;
      this.dir.subVectors(b.to, b.from);
      const len = this.dir.length();
      this.dir.multiplyScalar(1 / Math.max(len, 1e-4));
      const fade = Math.min(1, (1 - t) * 1.6);
      if (b.kind === 'tracer') {
        const hd = Math.min(len, (b.max - b.life) * b.speed + 0.5);
        const tail = Math.max(0, hd - b.pulse);
        for (let i = 0; i < BEAM_PTS; i++) {
          const f = i / (BEAM_PTS - 1);
          this.pts[i].copy(b.from).addScaledVector(this.dir, tail + (hd - tail) * f);
          this.alphas[i] = Math.pow(f, 1.6) * fade * b.alpha;
          this.widths[i] = b.width * (0.35 + 0.65 * f);
        }
      } else {
        // straight or jittered polyline from -> to, flickering
        for (let i = 0; i < BEAM_PTS; i++) {
          const f = i / (BEAM_PTS - 1);
          this.pts[i].copy(b.from).addScaledVector(this.dir, len * f);
          if (b.jitter > 0 && i > 0 && i < BEAM_PTS - 1) {
            const j = b.jitter * Math.sin(Math.PI * f) * Math.min(1.2, 0.35 + len * 0.05);
            this.pts[i].x += (Math.random() - 0.5) * 2 * j;
            this.pts[i].y += (Math.random() - 0.5) * 2 * j;
            this.pts[i].z += (Math.random() - 0.5) * 2 * j;
          }
          this.alphas[i] = fade * b.alpha * (b.kind === 'arc' ? 0.7 + Math.random() * 0.3 : 1);
          this.widths[i] = b.width;
        }
      }
      for (let i = 0; i < BEAM_PTS; i++) {
        const p = this.pts[i];
        const q = i < BEAM_PTS - 1 ? this.pts[i + 1] : p;
        const o = i > 0 ? this.pts[i - 1] : p;
        this.tmp.subVectors(q, o);
        if (this.tmp.lengthSq() < 1e-8) this.tmp.copy(this.dir);
        this.toCam.subVectors(camPos, p);
        this.side.crossVectors(this.tmp, this.toCam);
        if (this.side.lengthSq() < 1e-10) this.side.set(0, 1, 0);
        this.side.normalize().multiplyScalar(this.widths[i] * 0.5);
        const v = base + i * 2;
        this.pos[v * 3] = p.x + this.side.x; this.pos[v * 3 + 1] = p.y + this.side.y; this.pos[v * 3 + 2] = p.z + this.side.z;
        this.pos[(v + 1) * 3] = p.x - this.side.x; this.pos[(v + 1) * 3 + 1] = p.y - this.side.y; this.pos[(v + 1) * 3 + 2] = p.z - this.side.z;
        for (let k = 0; k < 2; k++) {
          const c = (v + k) * 4;
          this.col[c] = b.color.r; this.col[c + 1] = b.color.g; this.col[c + 2] = b.color.b; this.col[c + 3] = this.alphas[i];
        }
      }
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }

  private zero(base: number): void {
    for (let i = 0; i < BEAM_PTS * 2; i++) this.col[(base + i) * 4 + 3] = 0;
    this.geo.attributes.color.needsUpdate = true;
  }
}
