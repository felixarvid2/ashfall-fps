import * as THREE from 'three';
import type { EnemyKind } from '../sim/types';
import type { EnemyRenderState } from './types';
import { ASSETS } from '../content/assets';
import type { AssetLibrary } from './assets';
import { columnGeometry, makeFlameMaterial } from './shaders';
import { makeGlowTexture, makeRingTexture } from './textures';

type Logical = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'death';

interface KindCfg {
  asset: string;
  height: number;
  /** Added to sim yaw so the model's visual front faces the sim's forward (-Z at yaw 0). */
  yawOffset: number;
  /** Tell colour. */
  tell: number;
  /** Head height (m) for marks/eyes. */
  head: number;
  radius: number;
}
export const ENEMY_CFG: Record<EnemyKind, KindCfg> = {
  walker: { asset: 'enemy.walker', height: 1.75, yawOffset: Math.PI, tell: 0xff7a20, head: 1.9, radius: 0.5 },
  hound: { asset: 'enemy.hound', height: 1.5, yawOffset: Math.PI, tell: 0xff2010, head: 1.0, radius: 0.7 },
  drone: { asset: 'enemy.drone', height: 1.0, yawOffset: Math.PI, tell: 0xff8a20, head: 0.8, radius: 0.5 },
  loader: { asset: 'enemy.loader', height: 3.2, yawOffset: Math.PI, tell: 0xffc040, head: 3.5, radius: 1.4 },
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** One pooled enemy instance. */
class EnemyInst {
  readonly group = new THREE.Group();
  readonly model = new THREE.Group();
  mixer: THREE.AnimationMixer | null = null;
  actions = new Map<Logical, THREE.AnimationAction>();
  current: Logical | null = null;
  mats: THREE.Material[] = [];
  flash = { value: new THREE.Vector3() };
  lastPos = new THREE.Vector3();
  speed = 0;
  accDt = 0;
  frameN = 0;
  id = -1;
  placeholder = false;
  // lazily created tell/mark objects
  mark: THREE.Sprite | null = null;
  tellSprite: THREE.Sprite | null = null;
  streak: THREE.Sprite | null = null;
  cone: THREE.Mesh | null = null;
  coneMat: THREE.ShaderMaterial | null = null;
  arc: THREE.Mesh | null = null;
  arcMat: THREE.MeshBasicMaterial | null = null;
  slamRing: THREE.Mesh | null = null;
  claw: THREE.Group | null = null;
  clawJoint: THREE.Sprite | null = null;
  shadowOn = true;
  meshes: THREE.Mesh[] = [];
  lastState = '';
  deathStarted = false;
  constructor(public kind: EnemyKind) {}
}

const arcGeoCache = new Map<number, THREE.BufferGeometry>();

/** Pool + animation + telegraphs for every enemy on screen. */
export class EnemiesView {
  readonly group = new THREE.Group();
  private live = new Map<number, EnemyInst>();
  private free: Record<EnemyKind, EnemyInst[]> = { walker: [], hound: [], drone: [], loader: [] };
  private glow = makeGlowTexture();
  private ring = makeRingTexture();
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private tmp = new THREE.Vector3();
  private frameCount = 0;
  private coneGeo = columnGeometry(0.12, 0.95, 18, 6).rotateX(-Math.PI / 2);

  constructor(private assets: AssetLibrary) {}

  reset(): void {
    for (const e of this.live.values()) this.release(e);
    this.live.clear();
  }

  private release(e: EnemyInst): void {
    e.group.visible = false;
    e.id = -1;
    this.free[e.kind].push(e);
  }

  // ---------------------------------------------------------------- build
  private makeInst(kind: EnemyKind): EnemyInst {
    const cfg = ENEMY_CFG[kind];
    const e = new EnemyInst(kind);
    const entry = ASSETS[cfg.asset];
    let root: THREE.Object3D;
    if (entry?.kind === 'skinned') {
      const s = this.assets.makeSkinned(cfg.asset, cfg.height);
      root = s.root;
      e.placeholder = s.placeholder;
      if (!s.placeholder && s.clips.length) {
        e.mixer = new THREE.AnimationMixer(root);
        const byName = new Map(s.clips.map((c) => [c.name.toLowerCase(), c]));
        for (const [logical, name] of Object.entries(entry.clips ?? {})) {
          const clip = byName.get((name ?? '').toLowerCase());
          if (clip) {
            const a = e.mixer.clipAction(clip);
            if (logical === 'attack' || logical === 'hit' || logical === 'death') {
              a.setLoop(THREE.LoopOnce, 1);
              a.clampWhenFinished = true;
            }
            e.actions.set(logical as Logical, a);
          }
        }
      }
    } else {
      root = this.assets.makeStatic(cfg.asset, cfg.height, { lod: true, cloneMaterials: true });
      e.placeholder = !this.assets.has(cfg.asset);
    }
    const orient = new THREE.Group();
    orient.rotation.y = cfg.yawOffset;
    orient.add(root);
    e.model.add(orient);
    e.group.add(e.model);
    // materials: per-instance clones with a flash uniform hook
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      e.meshes.push(m);
      m.castShadow = true;
      m.receiveShadow = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          const u = e.flash;
          mat.onBeforeCompile = (sh) => {
            sh.uniforms.uFlash = u;
            sh.fragmentShader = 'uniform vec3 uFlash;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uFlash;');
          };
          mat.customProgramCacheKey = () => 'enemyflash';
          e.mats.push(mat);
        }
      }
    });
    if (kind === 'loader') this.buildClaw(e, cfg);
    e.group.visible = false;
    this.group.add(e.group);
    return e;
  }

  private buildClaw(e: EnemyInst, cfg: KindCfg): void {
    const H = cfg.height;
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a4540, metalness: 0.85, roughness: 0.5 });
    const rust = new THREE.MeshStandardMaterial({ color: 0x8a4a22, metalness: 0.5, roughness: 0.65 });
    const claw = new THREE.Group();
    // shoulder pivot at the right side of the torso
    claw.position.set(H * 0.42, H * 0.62, -H * 0.1);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.5), steel);
    upper.position.set(0, 0, -0.75);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), rust);
    elbow.position.set(0, 0, -1.5);
    const fore = new THREE.Group();
    fore.position.set(0, 0, -1.5);
    fore.name = 'fore';
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 1.2), steel);
    forearm.position.set(0, 0, -0.6);
    fore.add(forearm);
    for (const s of [-1, 0, 1]) {
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.9, 6), rust);
      prong.rotation.x = -Math.PI / 2 + 0.0;
      prong.position.set(s * 0.34, s === 0 ? 0 : -0.06, -1.5);
      prong.rotation.z = s * 0.25;
      fore.add(prong);
    }
    claw.add(upper, elbow, fore);
    claw.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    const joint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0x7fe8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0, fog: false }));
    joint.scale.setScalar(1.1);
    joint.position.set(0, 0, -1.5);
    joint.renderOrder = 8;
    claw.add(joint);
    e.clawJoint = joint;
    e.claw = claw;
    e.group.add(claw);
  }

  private spr(color: number, size: number, tex = this.glow): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0, fog: false }));
    s.scale.setScalar(size);
    s.renderOrder = 8;
    return s;
  }

  // --------------------------------------------------------------- update
  update(list: EnemyRenderState[], dt: number, time: number, camera: THREE.PerspectiveCamera): void {
    this.frameCount++;
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const seen = new Set<number>();
    for (const st of list) {
      seen.add(st.id);
      let e = this.live.get(st.id);
      if (e && e.kind !== st.kind) {
        this.release(e);
        this.live.delete(st.id);
        e = undefined;
      }
      if (!e) {
        e = this.free[st.kind].pop() ?? this.makeInst(st.kind);
        e.id = st.id;
        e.kind = st.kind;
        e.lastPos.set(st.pos.x, st.pos.y, st.pos.z);
        e.speed = 0;
        e.current = null;
        e.deathStarted = false;
        e.lastState = '';
        e.mixer?.stopAllAction();
        e.actions.forEach((a) => a.reset());
        this.live.set(st.id, e);
      }
      this.updateOne(e, st, dt, time, camera);
    }
    for (const [id, e] of this.live) {
      if (!seen.has(id)) {
        this.live.delete(id);
        this.release(e);
      }
    }
  }

  private play(e: EnemyInst, logical: Logical, fade = 0.15, timeScale = 1, restart = false): THREE.AnimationAction | null {
    const a = e.actions.get(logical) ?? (logical === 'run' ? e.actions.get('walk') : undefined) ?? (logical === 'walk' ? e.actions.get('idle') : undefined);
    if (!a) return null;
    if (e.current === logical && !restart) {
      a.timeScale = timeScale;
      return a;
    }
    const prev = e.current ? (e.actions.get(e.current) ?? null) : null;
    a.enabled = true;
    a.timeScale = timeScale;
    if (restart || !a.isRunning()) {
      a.reset();
      a.play();
    }
    if (prev && prev !== a) a.crossFadeFrom(prev, fade, false);
    else a.fadeIn(fade);
    e.current = logical;
    return a;
  }

  private updateOne(e: EnemyInst, st: EnemyRenderState, dt: number, time: number, camera: THREE.PerspectiveCamera): void {
    const cfg = ENEMY_CFG[st.kind];
    const g = e.group;
    const dx = st.pos.x - camera.position.x, dy = st.pos.y - camera.position.y, dz = st.pos.z - camera.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // visibility: frustum + distance
    this.sphere.center.set(st.pos.x, st.pos.y + cfg.height * 0.5, st.pos.z);
    this.sphere.radius = cfg.height * 1.2 + 1.5;
    const visible = dist < 140 && this.frustum.intersectsSphere(this.sphere);
    g.visible = visible;

    g.position.set(st.pos.x, st.pos.y, st.pos.z);
    g.rotation.y = st.yaw;
    // estimated ground speed for walk blend
    const mdx = st.pos.x - e.lastPos.x, mdz = st.pos.z - e.lastPos.z;
    const inst = dt > 1e-4 ? Math.hypot(mdx, mdz) / dt : 0;
    e.speed += (Math.min(inst, 14) - e.speed) * Math.min(1, dt * 8);
    e.lastPos.set(st.pos.x, st.pos.y, st.pos.z);

    const dead = st.state === 'dead';
    const prog = st.stateDuration > 0 ? clamp01(st.stateTime / st.stateDuration) : clamp01(st.stateTime / 0.6);

    // ----- logical animation
    if (e.mixer && e.actions.size) {
      if (st.state !== e.lastState) {
        e.lastState = st.state;
        switch (st.state) {
          case 'spawning':
            this.play(e, 'idle', 0.05);
            break;
          case 'windup': {
            const a = this.play(e, 'attack', 0.1, 0, true);
            if (a) a.time = 0;
            break;
          }
          case 'attack':
            this.play(e, 'attack', 0.05, 1, true);
            break;
          case 'stagger':
            this.play(e, 'hit', 0.05, 1, true);
            break;
          case 'dead':
            if (!this.play(e, 'death', 0.1, 1, true) && !e.actions.has('death')) {
              /* drone: procedural */
            }
            e.deathStarted = true;
            break;
          default:
            e.current = null; // movement states are re-picked below
        }
      }
      if (st.state === 'advance' || st.state === 'flank' || st.state === 'recover' || st.state === 'spawning') {
        const moving = e.speed > 0.35 && st.state !== 'recover' && st.state !== 'spawning';
        if (moving) {
          const fast = st.kind === 'hound' || e.speed > 3.2;
          const ts = st.kind === 'walker' ? THREE.MathUtils.clamp(e.speed / 1.5, 0.7, 2) : st.kind === 'hound' ? THREE.MathUtils.clamp(e.speed / 6, 0.7, 1.6) : 1;
          this.play(e, fast && st.kind !== 'walker' ? 'run' : 'walk', 0.2, ts);
        } else this.play(e, 'idle', 0.2, 1);
      } else if (st.state === 'windup') {
        // slow creep through the first part of the attack clip so the tell is readable
        const a = e.actions.get('attack');
        if (a) {
          const maxT = a.getClip().duration * 0.3;
          a.paused = false;
          a.time = Math.min(maxT, prog * maxT);
          a.timeScale = 0;
        }
      }
      // mixer update throttle by distance
      e.accDt += dt;
      e.frameN++;
      const step = dist < 22 ? 1 : dist < 45 ? 2 : dist < 90 ? 4 : 0;
      if (visible && step > 0 && ((e.frameN + e.id) % step === 0 || dead)) {
        e.mixer.update(e.accDt);
        e.accDt = 0;
      } else if (!visible || step === 0) {
        e.accDt = Math.min(e.accDt, 0.25);
      }
    }

    // ----- procedural motion (drone / loader / placeholders)
    const m = e.model;
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scale.setScalar(1);
    let sink = 0;
    if (st.kind === 'drone') {
      m.position.y = Math.sin(time * 3.1 + st.id) * 0.07;
      m.rotation.z = Math.sin(time * 1.7 + st.id) * 0.05;
      m.rotation.x = st.state === 'advance' || st.state === 'flank' ? -0.12 : 0;
      if (st.state === 'windup') m.rotation.x = 0.25 * prog;
      if (dead) {
        const t = st.stateTime;
        m.rotation.z += t * 4;
        m.rotation.x += Math.min(1.2, t * 2.5);
        m.position.y -= Math.min(0.6, t * t * 3);
      }
    } else if (st.kind === 'loader') {
      const walk = clamp01(e.speed / 2.5);
      const ph = time * 2.2 + st.id;
      m.position.y = Math.abs(Math.sin(ph)) * 0.07 * walk;
      m.rotation.z = Math.sin(ph) * 0.035 * walk;
      m.rotation.x = Math.sin(ph * 2) * 0.012 * walk;
      const L = st.loader;
      if (st.state === 'windup') {
        m.rotation.x -= 0.18 * prog;
      } else if (st.state === 'attack') {
        m.rotation.x += (L?.attack === 'slam' ? 0.2 : 0.06) * (1 - prog);
      }
      if (dead) {
        const t = Math.min(1, st.stateTime / 1.4);
        m.rotation.x += t * 0.35;
        m.rotation.z += t * 0.25;
        m.position.y -= t * 0.3;
      }
    } else if (e.placeholder) {
      m.position.y = Math.abs(Math.sin(time * 6 + st.id)) * 0.05 * clamp01(e.speed);
    }
    if (st.state === 'spawning') {
      const p = prog;
      sink = (1 - p) * 0.9;
      m.scale.setScalar(0.7 + 0.3 * p);
    }
    if (dead) {
      const f = st.fade;
      sink = Math.max(sink, f * f * 1.1);
      m.scale.setScalar(1 - f * 0.25);
    }
    m.position.y -= sink;

    // shadows only for nearby enemies
    const wantShadow = dist < 38 && !dead;
    if (wantShadow !== e.shadowOn) {
      e.shadowOn = wantShadow;
      for (const mesh of e.meshes) mesh.castShadow = wantShadow;
    }

    if (!visible) return;
    this.applyEmissive(e, st, cfg, prog, time);
    this.updateTells(e, st, cfg, prog, time);
    if (st.kind === 'loader') this.updateClaw(e, st, prog, time);
  }

  private applyEmissive(e: EnemyInst, st: EnemyRenderState, cfg: KindCfg, prog: number, time: number): void {
    const f = e.flash.value;
    f.set(0, 0, 0);
    const hit = Math.exp(-st.sinceHit * 13);
    if (hit > 0.02) f.add(this.tmp.set(1.0, 0.75, 0.55).multiplyScalar(hit * 0.9));
    if (st.state === 'windup') {
      const c = new THREE.Color(cfg.tell);
      const pulse = 0.55 + 0.45 * Math.sin(time * (14 + prog * 20));
      const k = (0.08 + prog * 0.42) * pulse;
      f.x += c.r * k;
      f.y += c.g * k;
      f.z += c.b * k;
    }
    if (st.ionized) {
      const p = 0.07 + 0.03 * Math.sin(time * 8 + st.id);
      f.x += 0.1 * p;
      f.y += 0.7 * p;
      f.z += 1.0 * p;
    }
    if (st.state === 'dead') f.multiplyScalar(0.3);
  }

  private updateTells(e: EnemyInst, st: EnemyRenderState, cfg: KindCfg, prog: number, time: number): void {
    const winding = st.state === 'windup';
    const attacking = st.state === 'attack';
    // ionized mark
    if (st.ionized && st.state !== 'dead') {
      if (!e.mark) {
        e.mark = this.spr(0x7ff0ff, 0.5, this.ring);
        e.group.add(e.mark);
      }
      e.mark.visible = true;
      e.mark.position.set(0, cfg.head + 0.35 + Math.sin(time * 4 + st.id) * 0.04, 0);
      (e.mark.material as THREE.SpriteMaterial).opacity = 0.85;
      e.mark.scale.setScalar(0.42 + 0.06 * Math.sin(time * 9));
    } else if (e.mark) e.mark.visible = false;

    // walker: flare at the arm/chest
    if (st.kind === 'walker') {
      if (!e.tellSprite) {
        e.tellSprite = this.spr(0xff8a30, 1);
        e.tellSprite.position.set(0, 1.3, -0.35);
        e.group.add(e.tellSprite);
      }
      const on = winding || (attacking && st.stateTime < 0.2);
      e.tellSprite.visible = on;
      if (on) {
        const k = winding ? prog : 1 - st.stateTime / 0.2;
        e.tellSprite.scale.setScalar(0.5 + k * 1.4 + Math.sin(time * 40) * 0.05);
        (e.tellSprite.material as THREE.SpriteMaterial).opacity = 0.35 + 0.65 * k;
      }
    }
    // hound: red eye streak
    if (st.kind === 'hound') {
      if (!e.streak) {
        e.streak = this.spr(0xff1a10, 1);
        e.streak.position.set(0, 0.85, -0.55);
        e.group.add(e.streak);
        e.tellSprite = this.spr(0xff3020, 0.6);
        e.tellSprite.position.set(0, 0.85, -0.55);
        e.group.add(e.tellSprite);
      }
      const on = winding || (attacking && st.stateTime < 0.25);
      e.streak.visible = e.tellSprite!.visible = on;
      if (on) {
        const k = winding ? prog : 1;
        e.streak.scale.set(0.6 + k * 3.2, 0.16 + k * 0.1, 1);
        (e.streak.material as THREE.SpriteMaterial).opacity = 0.4 + 0.6 * k;
        e.tellSprite!.scale.setScalar(0.3 + k * 0.7);
        (e.tellSprite!.material as THREE.SpriteMaterial).opacity = 0.5 + 0.5 * k;
      }
    }
    // drone: growing flame cone
    if (st.kind === 'drone') {
      if (!e.cone) {
        e.coneMat = makeFlameMaterial(0xfff0b0, 0xff4a08);
        e.cone = new THREE.Mesh(this.coneGeo, e.coneMat);
        e.cone.position.set(0, 0.45, -0.35);
        e.cone.frustumCulled = false;
        e.cone.renderOrder = 4;
        e.group.add(e.cone);
      }
      const on = winding || attacking;
      e.cone.visible = on;
      if (on) {
        const k = winding ? prog : 1;
        const len = 0.5 + k * 3.0;
        e.cone.scale.set(0.35 + k * 0.65, 0.35 + k * 0.65, len);
        e.coneMat!.uniforms.uTime.value = time;
        e.coneMat!.uniforms.uIntensity.value = winding ? 0.35 + prog * 0.9 : 1.4;
      }
    }
  }

  private updateClaw(e: EnemyInst, st: EnemyRenderState, prog: number, time: number): void {
    const claw = e.claw!;
    const L = st.loader;
    const fore = claw.getObjectByName('fore')!;
    const atk = L?.attack ?? null;
    const winding = st.state === 'windup';
    const attacking = st.state === 'attack';
    const dead = st.state === 'dead';
    // base idle sway
    let yaw = L?.clawYaw ?? 0;
    let pitch = Math.sin(time * 1.3 + st.id) * 0.04;
    let foreBend = 0.35;
    if (winding) {
      if (atk === 'slam') {
        pitch = -1.0 * prog; // raise claw overhead
        foreBend = 0.35 - 0.2 * prog;
        yaw *= 0.2;
      } else if (atk === 'sweep') {
        pitch = -0.1;
        foreBend = 0.1;
      } else {
        pitch = -0.7 * prog;
      }
    } else if (attacking) {
      if (atk === 'slam') {
        const k = clamp01(st.stateTime / 0.18);
        pitch = -1.0 + 1.45 * k;
        foreBend = 0.15;
      } else if (atk === 'sweep') {
        pitch = 0.05;
        foreBend = 0.05;
      }
    }
    if (dead) {
      pitch = 0.6;
      foreBend = 0.2;
    }
    claw.rotation.set(pitch, yaw, 0, 'YXZ');
    fore.rotation.set(0, -foreBend, 0);

    // exposed joint glow
    const j = e.clawJoint!;
    const exposed = !!L?.jointExposed && !dead;
    j.visible = exposed;
    if (exposed) {
      const p = 0.65 + 0.35 * Math.sin(time * 14);
      (j.material as THREE.SpriteMaterial).opacity = 0.7 * p + 0.3;
      j.scale.setScalar(0.9 + 0.35 * p);
    }

    // ground telegraph: sweep arc or slam ring
    const show = (winding || (attacking && st.stateTime < 0.25)) && (atk === 'sweep' || atk === 'slam');
    if (!e.arc) {
      const geo = arcGeoCache.get(0) ?? new THREE.RingGeometry(1.2, 4.4, 40, 1, Math.PI / 2 - Math.PI * 0.45, Math.PI * 0.9).rotateX(-Math.PI / 2);
      arcGeoCache.set(0, geo);
      e.arcMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      e.arc = new THREE.Mesh(geo, e.arcMat);
      e.arc.position.y = 0.08;
      e.arc.renderOrder = 3;
      e.group.add(e.arc);
      const rg = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
      e.slamRing = new THREE.Mesh(rg, e.arcMat);
      e.slamRing.position.set(0, 0.08, -3.4);
      e.slamRing.renderOrder = 3;
      e.group.add(e.slamRing);
    }
    // the group's own yaw offset is baked into the group; arc geometry points to local -Z (forward)
    e.arc.visible = show && atk === 'sweep';
    e.slamRing!.visible = show && atk === 'slam';
    if (show) {
      const k = winding ? prog : 1;
      const pulse = 0.6 + 0.4 * Math.sin(time * (12 + 20 * k));
      e.arcMat!.opacity = (0.1 + 0.4 * k) * pulse + 0.08;
      if (atk === 'slam') e.slamRing!.scale.setScalar(1.8 + k * 1.2);
    }
  }
}
