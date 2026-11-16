import * as THREE from 'three';
import type { GameEvent, Vec3, WeaponId } from '../sim/types';
import type { PickupRenderState, ProjectileRenderState, RenderFrame } from './types';
import { WEAPONS } from '../content/weapons';
import type { Settings } from '../ui/types';
import type { AssetLibrary } from './assets';
import { BeamPool, ParticleSystem } from './particles';
import { makeCrossTexture, makeDecalTexture, makeGlowTexture } from './textures';

const v3 = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Flash {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  s0: number;
  s1: number;
  alpha: number;
  light: number; // light intensity contribution (0 none)
  color: number;
  kind: 'sphere' | 'cone' | 'ring' | 'beacon';
}

interface PickupObj {
  group: THREE.Group;
  glow: THREE.Sprite;
  spin: number;
  baseY: number;
  seen: boolean;
}
interface FireballObj {
  group: THREE.Group;
  seen: boolean;
  trail: number;
}

/** Pooled effects: tracers, sparks, decals, flashes, fireballs, pickups, light pool. */
export class Fx {
  readonly group = new THREE.Group();
  readonly lights: THREE.PointLight[] = [];
  readonly sparks: ParticleSystem;
  readonly smoke: ParticleSystem;
  readonly beams = new BeamPool(56);
  private flashes: Flash[] = [];
  private decals: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];
  private decalNext = 0;
  private pickups = new Map<number, PickupObj>();
  private fireballs = new Map<number, FireballObj>();
  private muzzle: (w: WeaponId) => THREE.Vector3 = () => new THREE.Vector3();
  private glowTex = makeGlowTexture();
  private pickupTemplates = new Map<string, THREE.Object3D>();
  private geoSphere = new THREE.SphereGeometry(1, 16, 12);
  private geoCone: THREE.BufferGeometry;
  private geoRing = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
  private geoBeacon = new THREE.CylinderGeometry(0.5, 0.8, 1, 12, 1, true).translate(0, 0.5, 0);
  private geoDecal = new THREE.PlaneGeometry(1, 1);
  private decalTex = makeDecalTexture();
  private lightCands: { p: THREE.Vector3; c: number; i: number; d: number }[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private nowT = 0;
  private flashScale = 1;

  constructor(private assets: AssetLibrary) {
    this.geoCone = new THREE.ConeGeometry(0.45, 1, 20, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
    const soft = makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.5)');
    this.sparks = new ParticleSystem(520, soft, { additive: true, drag: 0.15 });
    this.smoke = new ParticleSystem(180, makeGlowTexture('rgba(255,255,255,0.7)', 'rgba(255,255,255,0.4)'), { additive: false, drag: 0.6 });
    this.group.add(this.sparks.points, this.smoke.points, this.beams.mesh);
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff8a30, 0, 14, 1.6);
      this.lights.push(l);
      this.group.add(l);
    }
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(this.geoSphere, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.flashes.push({ mesh, mat, life: 0, max: 1, s0: 1, s1: 1, alpha: 1, light: 0, color: 0xffffff, kind: 'sphere' });
    }
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const mesh = new THREE.Mesh(this.geoDecal, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.decals.push({ mesh, mat, life: 0 });
    }
  }

  setMuzzleProvider(fn: (w: WeaponId) => THREE.Vector3): void {
    this.muzzle = fn;
  }

  reset(): void {
    this.sparks.clear();
    this.smoke.clear();
    this.beams.clear();
    for (const f of this.flashes) {
      f.life = 0;
      f.mesh.visible = false;
    }
    for (const d of this.decals) {
      d.life = 0;
      d.mesh.visible = false;
    }
    for (const p of this.pickups.values()) this.group.remove(p.group);
    this.pickups.clear();
    for (const p of this.fireballs.values()) this.group.remove(p.group);
    this.fireballs.clear();
  }

  // -------------------------------------------------------------- events
  handleEvent(ev: GameEvent): void {
    switch (ev.type) {
      case 'shot':
        this.onShot(ev);
        break;
      case 'impact':
        this.onImpact(ev.weapon, ev.point, ev.normal, ev.surface);
        break;
      case 'enemy_hit': {
        const n = ev.armorBreak ? 14 : 4;
        for (let i = 0; i < n; i++) {
          const a = ev.armorBreak ? [1, 0.9, 0.6] : [1, 0.35, 0.12];
          this.sparks.emit(ev.point.x, ev.point.y, ev.point.z, rnd(-3, 3), rnd(0.5, 3.5), rnd(-3, 3), rnd(0.15, 0.4), a[0], a[1], a[2], 1, 0.06, 0.01, 7);
        }
        this.smoke.emit(ev.point.x, ev.point.y, ev.point.z, rnd(-0.4, 0.4), rnd(0.2, 0.8), rnd(-0.4, 0.4), 0.5, 0.18, 0.05, 0.04, 0.55, 0.18, 0.55);
        break;
      }
      case 'enemy_die': {
        const p = ev.pos;
        const big = ev.kind === 'loader' ? 3 : 1;
        for (let i = 0; i < 12 * big; i++) {
          this.sparks.emit(p.x, p.y + 0.9 * big, p.z, rnd(-4, 4), rnd(1, 6), rnd(-4, 4), rnd(0.3, 0.9), 1, rnd(0.25, 0.5), 0.08, 1, 0.07, 0.015, 9);
        }
        for (let i = 0; i < 3 * big; i++) {
          this.smoke.emit(p.x + rnd(-0.3, 0.3), p.y + 0.5, p.z + rnd(-0.3, 0.3), rnd(-0.5, 0.5), rnd(0.6, 1.6), rnd(-0.5, 0.5), 1.2, 0.12, 0.09, 0.07, 0.7, 0.3, 1.1);
        }
        break;
      }
      case 'enemy_spawn': {
        const p = ev.pos;
        for (let i = 0; i < 10; i++) {
          this.sparks.emit(p.x + rnd(-0.4, 0.4), p.y + 0.1, p.z + rnd(-0.4, 0.4), rnd(-0.6, 0.6), rnd(1.5, 4), rnd(-0.6, 0.6), rnd(0.5, 1), 1, 0.4, 0.1, 0.9, 0.05, 0.01, -0.5);
        }
        break;
      }
      case 'enemy_attack':
        if (ev.kind === 'loader' && ev.attack === 'slam') this.addFlash('ring', ev.pos, 0xffa040, 0.5, 1, 7, 0.9, 0);
        break;
      case 'arc': {
        const a = v3(ev.from);
        const b = v3(ev.to);
        const hue = ev.origin === 'rupture' ? 0xffa8ff : 0xa8e8ff;
        this.beams.spawn('arc', a, b, { width: 0.09, color: hue, life: 0.2, jitter: 0.22 });
        this.beams.spawn('arc', a, b, { width: 0.035, color: 0xffffff, life: 0.2, jitter: 0.12 });
        for (let i = 0; i < 6; i++) this.sparks.emit(b.x, b.y, b.z, rnd(-3, 3), rnd(0, 3), rnd(-3, 3), rnd(0.15, 0.35), 0.6, 0.85, 1, 1, 0.05, 0.01, 6);
        this.addLightFlash(b, 0x80c8ff, 0.15, 1.6);
        break;
      }
      case 'burst': {
        const col = ev.origin === 'burst' ? 0x9fe8ff : 0xffa850;
        this.addFlash('sphere', ev.pos, col, 0.28, 0.3, Math.max(0.5, ev.radius), 0.85, 2.5);
        this.addFlash('ring', ev.pos, col, 0.35, 0.4, Math.max(0.5, ev.radius) * 1.15, 0.9, 0);
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = rnd(2, ev.radius * 3);
          this.sparks.emit(ev.pos.x, ev.pos.y, ev.pos.z, Math.cos(a) * s, rnd(0, 4), Math.sin(a) * s, rnd(0.2, 0.5), 0.7, 0.9, 1, 1, 0.07, 0.01, 7);
        }
        break;
      }
      case 'cone': {
        const d = v3(ev.dir).normalize();
        const f = this.addFlash('cone', ev.pos, 0xaee6ff, 0.22, ev.range * 0.6, ev.range, 0.4, 1.5);
        if (f) f.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
        break;
      }
      case 'wave_warn':
        this.addFlash('beacon', ev.pos, 0xff6a20, 2.4, 1, 1, 0.55, 0);
        break;
      case 'pickup': {
        for (let i = 0; i < 10; i++) {
          this.sparks.emit(ev.pos.x, ev.pos.y + 0.4, ev.pos.z, rnd(-1.5, 1.5), rnd(1, 3), rnd(-1.5, 1.5), rnd(0.3, 0.6), 0.6, 1, 0.9, 1, 0.05, 0.01, 3);
        }
        break;
      }
      default:
        break;
    }
  }

  private onShot(ev: Extract<GameEvent, { type: 'shot' }>): void {
    const w = WEAPONS[ev.weapon];
    const muzzle = this.muzzle(ev.weapon);
    const dir = v3(ev.dir).normalize();
    const ends: THREE.Vector3[] = ev.hits.length ? ev.hits.slice(0, 9).map(v3) : [muzzle.clone().addScaledVector(dir, 45)];
    const scatter = ev.weapon === 'arc_scattergun';
    for (const e of ends) {
      const len = e.distanceTo(muzzle);
      if (scatter) {
        const col = ev.slug ? 0xffffff : w.fx.tracerColor;
        // short bright jagged arcs
        const to = e.clone();
        if (len > 14) to.copy(muzzle).addScaledVector(this.tmp2.subVectors(e, muzzle).normalize(), 14);
        this.beams.spawn('arc', muzzle, to, { width: ev.slug ? 0.14 : 0.07, color: col, life: 0.07 + w.fx.tracerLife, jitter: 0.12 });
        if (ev.slug) this.beams.spawn('line', muzzle, e, { width: 0.05, color: 0x9fd8ff, life: 0.12, alpha: 0.9 });
      } else if (ev.weapon === 'coil_carbine') {
        this.beams.spawn('tracer', muzzle, e, { width: w.fx.tracerWidth * 1.6, color: w.fx.tracerColor, life: Math.max(0.1, len / 240 + 0.04), speed: 240, pulse: 3.2 });
        this.beams.spawn('line', muzzle, e, { width: w.fx.tracerWidth * 0.5, color: w.fx.tracerColor, life: 0.07, alpha: 0.35 });
      } else {
        this.beams.spawn('tracer', muzzle, e, { width: w.fx.tracerWidth * 1.8, color: w.fx.tracerColor, life: Math.max(0.1, len / 160 + 0.04), speed: 160, pulse: 1.6 });
      }
    }
  }

  private onImpact(weapon: WeaponId | null, p: Vec3, n: Vec3, surface: 'world' | 'enemy'): void {
    const scatter = weapon === 'arc_scattergun';
    if (surface === 'enemy') {
      for (let i = 0; i < 2; i++) this.sparks.emit(p.x, p.y, p.z, rnd(-2, 2) + n.x * 2, rnd(0, 2.5), rnd(-2, 2) + n.z * 2, rnd(0.12, 0.3), 1, 0.5, 0.15, 1, 0.05, 0.01, 7);
      return;
    }
    const col = scatter ? [0.6, 0.85, 1] : [1, 0.65, 0.25];
    const count = scatter ? 3 : 7;
    for (let i = 0; i < count; i++) {
      const s = rnd(1.5, 5);
      this.sparks.emit(p.x, p.y, p.z, n.x * s + rnd(-2, 2), n.y * s + rnd(0, 2.5), n.z * s + rnd(-2, 2), rnd(0.15, 0.45), col[0], col[1], col[2], 1, 0.05, 0.008, 9);
    }
    this.smoke.emit(p.x, p.y, p.z, n.x * 0.5, n.y * 0.5 + 0.3, n.z * 0.5, 0.6, 0.25, 0.2, 0.17, 0.4, 0.1, 0.4);
    if (!scatter || Math.random() < 0.35) this.addDecal(p, n, scatter ? 0.18 : 0.12);
    if (!scatter) this.addLightFlash(new THREE.Vector3(p.x + n.x * 0.1, p.y + n.y * 0.1, p.z + n.z * 0.1), 0xffa050, 0.05, 0.9);
  }

  private addDecal(p: Vec3, n: Vec3, size: number): void {
    const d = this.decals[this.decalNext];
    this.decalNext = (this.decalNext + 1) % this.decals.length;
    d.life = 25;
    d.mesh.visible = true;
    d.mesh.position.set(p.x + n.x * 0.012, p.y + n.y * 0.012, p.z + n.z * 0.012);
    this.tmp.set(n.x, n.y, n.z).normalize();
    d.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.tmp);
    d.mesh.rotateZ(Math.random() * 6.28);
    d.mesh.scale.setScalar(size * rnd(0.8, 1.4) * 2);
    d.mat.opacity = 0.9;
  }

  private addFlash(kind: Flash['kind'], pos: Vec3, color: number, life: number, s0: number, s1: number, alpha: number, light: number): Flash | null {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.kind = kind;
    f.mesh.geometry = kind === 'sphere' ? this.geoSphere : kind === 'cone' ? this.geoCone : kind === 'ring' ? this.geoRing : this.geoBeacon;
    f.mesh.visible = true;
    f.mesh.position.set(pos.x, pos.y, pos.z);
    f.mesh.quaternion.identity();
    f.mat.color.setHex(color);
    f.life = f.max = life;
    f.s0 = s0;
    f.s1 = s1;
    f.alpha = alpha;
    f.light = light;
    f.color = color;
    return f;
  }

  /** Transient point-light-only flash (no mesh). */
  private addLightFlash(p: THREE.Vector3, color: number, life: number, intensity: number): void {
    const f = this.addFlash('sphere', p, color, life, 0.01, 0.01, 0, intensity);
    if (f) f.mesh.visible = false;
  }

  // -------------------------------------------------------------- frame
  update(frame: RenderFrame, dt: number, cam: THREE.Camera, pixelScale: number, settings: Settings | null): void {
    this.nowT = frame.time;
    this.flashScale = settings ? 0.4 + 0.6 * settings.flashIntensity : 1;
    this.sparks.setScale(pixelScale);
    this.smoke.setScale(pixelScale);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.beams.update(dt, cam.position);
    this.lightCands.length = 0;
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.mesh.visible = false;
        continue;
      }
      const t = 1 - f.life / f.max;
      const e = 1 - Math.pow(1 - t, 3);
      if (f.mesh.visible) {
        if (f.kind === 'beacon') {
          const pulse = 0.5 + 0.5 * Math.sin(this.nowT * 10);
          f.mesh.scale.set(0.6 + t * 0.3, 40, 0.6 + t * 0.3);
          f.mat.opacity = f.alpha * (1 - t) * (0.5 + 0.5 * pulse) * Math.min(1, t * 6);
        } else {
          const s = f.s0 + (f.s1 - f.s0) * e;
          f.mesh.scale.setScalar(s);
          f.mat.opacity = f.alpha * (1 - t) * (1 - t) * this.flashScale;
        }
      }
      if (f.light > 0) this.lightCands.push({ p: f.mesh.position, c: f.color, i: f.light * (1 - t), d: cam.position.distanceToSquared(f.mesh.position) });
    }
    for (const d of this.decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) d.mesh.visible = false;
      else if (d.life < 4) d.mat.opacity = 0.9 * (d.life / 4);
    }
    this.updateFireballs(frame.projectiles, dt, cam);
    this.updatePickups(frame.pickups, frame.time);
  }

  /** Call after every system had a chance to requestLight(): assigns the 3 pooled lights to the nearest candidates. */
  assignLights(): void {
    this.lightCands.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.lights.length; i++) {
      const c = this.lightCands[i];
      const l = this.lights[i];
      if (c) {
        l.position.copy(c.p);
        l.color.setHex(c.c);
        l.intensity = c.i * 14 * this.flashScale;
        l.distance = 12;
      } else l.intensity = 0;
    }
  }

  /** Lets level code (vents) request a pooled light for this frame. */
  requestLight(p: THREE.Vector3, color: number, intensity: number, camPos: THREE.Vector3): void {
    this.lightCands.push({ p, c: color, i: intensity, d: camPos.distanceToSquared(p) });
  }

  // --------------------------------------------------------- fireballs
  private makeFireball(): FireballObj {
    const g = new THREE.Group();
    const core = new THREE.Mesh(this.geoSphere, new THREE.MeshBasicMaterial({ color: 0xffe0a0, fog: false }));
    core.scale.setScalar(0.22);
    const mid = new THREE.Mesh(this.geoSphere, new THREE.MeshBasicMaterial({ color: 0xff6a14, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    mid.scale.setScalar(0.38);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff7a20, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.scale.setScalar(1.8);
    g.add(core, mid, sp);
    this.group.add(g);
    return { group: g, seen: true, trail: 0 };
  }

  private updateFireballs(list: ProjectileRenderState[], dt: number, cam: THREE.Camera): void {
    for (const f of this.fireballs.values()) f.seen = false;
    for (const p of list) {
      let f = this.fireballs.get(p.id);
      if (!f) {
        f = this.makeFireball();
        this.fireballs.set(p.id, f);
      }
      f.seen = true;
      f.group.position.set(p.pos.x, p.pos.y, p.pos.z);
      const flick = 1 + Math.sin(this.nowT * 40 + p.id) * 0.12;
      f.group.scale.setScalar(flick);
      f.trail -= dt;
      if (f.trail <= 0) {
        f.trail = 0.025;
        this.sparks.emit(p.pos.x, p.pos.y, p.pos.z, rnd(-0.5, 0.5) - p.vel.x * 0.05, rnd(-0.2, 0.8), rnd(-0.5, 0.5) - p.vel.z * 0.05, rnd(0.25, 0.5), 1, rnd(0.3, 0.55), 0.08, 0.9, 0.22, 0.04, -0.5);
      }
      this.lightCands.push({ p: f.group.position, c: 0xff7020, i: 1.1, d: cam.position.distanceToSquared(f.group.position) - 400 });
    }
    for (const [id, f] of this.fireballs) {
      if (!f.seen) {
        this.group.remove(f.group);
        this.fireballs.delete(id);
        this.sparks.emit(f.group.position.x, f.group.position.y, f.group.position.z, 0, 0.5, 0, 0.3, 1, 0.5, 0.1, 0.8, 0.9, 1.6);
      }
    }
  }

  // ----------------------------------------------------------- pickups
  private pickupTemplate(kind: string): THREE.Object3D {
    let t = this.pickupTemplates.get(kind);
    if (t) return t;
    if (kind === 'ammo_coil' || kind === 'ammo_arc') {
      const tint = kind === 'ammo_coil' ? 0xffa030 : 0x70c0ff;
      t = this.assets.makeStatic('env.ammo_box', 0.32, { lod: false, cloneMaterials: true });
      t.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m.emissive) {
          m.emissive.setHex(tint);
          m.emissiveIntensity = 0.35;
        }
      });
      // tinted stripe so the two types read at a glance
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.2), new THREE.MeshBasicMaterial({ color: tint }));
      stripe.position.y = 0.2;
      t.add(stripe);
    } else if (kind === 'health') {
      const tx = makeCrossTexture();
      const m = new THREE.MeshStandardMaterial({ map: tx, emissive: 0x552222, emissiveIntensity: 0.6, roughness: 0.6 });
      t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.22), m);
      t.position.y = 0.1;
      const g = new THREE.Group();
      g.add(t);
      t = g;
    } else if (kind === 'salvage') {
      const m = new THREE.MeshStandardMaterial({ color: 0xd9a030, emissive: 0xffa010, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.35 });
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), m);
      mesh.position.y = 0.13;
      mesh.scale.y = 1.4;
      const g = new THREE.Group();
      g.add(mesh);
      t = g;
    } else if (kind === 'armor') {
      const m = new THREE.MeshStandardMaterial({ color: 0x6a8aa8, emissive: 0x2a60a0, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.4 });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.07, 6), m);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = 0.17;
      const g = new THREE.Group();
      g.add(mesh);
      t = g;
    } else if (kind.startsWith('weapon_')) {
      const id = kind === 'weapon_coil_carbine' ? 'weapon.coil_carbine' : 'weapon.arc_scattergun';
      const gun = this.assets.rawClone(id);
      const g = new THREE.Group();
      if (gun) {
        gun.scale.setScalar(0.6 / 1.9);
        gun.rotation.z = 0.3;
        g.add(gun);
        gun.position.y = 0.2;
      } else g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.15), new THREE.MeshStandardMaterial({ color: 0x888888 })));
      t = g;
    } else {
      t = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xff00ff }));
    }
    this.pickupTemplates.set(kind, t);
    return t;
  }

  private pickupColor(kind: string): number {
    if (kind === 'ammo_coil') return 0xffa030;
    if (kind === 'ammo_arc') return 0x70c0ff;
    if (kind === 'health') return 0xff5050;
    if (kind === 'salvage') return 0xffc040;
    if (kind === 'armor') return 0x60a0ff;
    return 0xa0ffd0;
  }

  private updatePickups(list: PickupRenderState[], time: number): void {
    for (const p of this.pickups.values()) p.seen = false;
    for (const pk of list) {
      let o = this.pickups.get(pk.id);
      if (!o) {
        const group = new THREE.Group();
        group.add(this.pickupTemplate(pk.kind).clone(true));
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: this.pickupColor(pk.kind), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: false }));
        glow.scale.setScalar(0.9);
        glow.position.y = 0.2;
        group.add(glow);
        this.group.add(group);
        o = { group, glow, spin: Math.random() * 6, baseY: pk.pos.y, seen: true };
        this.pickups.set(pk.id, o);
      }
      o.seen = true;
      o.group.position.set(pk.pos.x, pk.pos.y + 0.32 + Math.sin(time * 2.4 + pk.id) * 0.06, pk.pos.z);
      o.group.rotation.y = time * 1.4 + o.spin;
      o.glow.material.opacity = 0.4 + 0.2 * Math.sin(time * 4 + pk.id);
    }
    for (const [id, o] of this.pickups) {
      if (!o.seen) {
        this.group.remove(o.group);
        this.pickups.delete(id);
      }
    }
  }

  dispose(): void {
    this.reset();
  }
}
