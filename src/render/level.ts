import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BoxDef, LevelDef, SurfaceMat } from '../content/levelTypes';
import type { RenderFrame } from './types';
import type { AssetLibrary } from './assets';
import type { Fx } from './fx';
import { columnGeometry, makeBeamMaterial, makeFlameMaterial } from './shaders';
import { makeGlowTexture, makeHazardTexture, makeSignTexture } from './textures';

interface SurfDef {
  tex?: string;
  tile: number;
  color: number;
  rough: number;
  metal: number;
  emissive?: boolean;
}
const SURF: Record<Exclude<SurfaceMat, 'invisible'>, SurfDef> = {
  slag: { tex: 'tex.slag', tile: 6, color: 0xd8c8c0, rough: 0.95, metal: 0 },
  cooling_slag: { tex: 'tex.cooling_slag', tile: 6, color: 0xffffff, rough: 0.9, metal: 0.05, emissive: true },
  grit: { tex: 'tex.grit', tile: 5, color: 0xd8c0b0, rough: 1, metal: 0 },
  concrete: { tex: 'tex.concrete', tile: 3, color: 0xcfc4bc, rough: 0.95, metal: 0 },
  metal: { tex: 'tex.steel_plating', tile: 2.5, color: 0xd0c8c0, rough: 0.6, metal: 0.45 },
  rust: { tex: 'tex.steel_plating', tile: 2, color: 0x9a7058, rough: 0.8, metal: 0.25 },
  hazard: { tile: 1.6, color: 0xffffff, rough: 0.7, metal: 0.1 },
  conveyor: { tex: 'tex.steel_grating', tile: 2, color: 0xb0aaa4, rough: 0.55, metal: 0.55 },
};

function boxMatrix(b: BoxDef): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.pitch ?? 0, b.yaw ?? 0, 0, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z), q, new THREE.Vector3(1, 1, 1));
}

/** Box geometry with meter-scaled UVs (world-ish tiling) already transformed to world space. */
function boxGeometry(b: BoxDef, tile: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.size.x, b.size.y, b.size.z);
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const ox = b.pos.x, oy = b.pos.y, oz = b.pos.z;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) {
      u = x + ox;
      v = z + oz;
    } else if (ax >= az) {
      u = z + oz;
      v = y + oy;
    } else {
      u = x + ox;
      v = y + oy;
    }
    uv.setXY(i, u / tile, v / tile);
  }
  g.applyMatrix4(boxMatrix(b));
  return g;
}

interface VentObj {
  id: string;
  group: THREE.Group;
  disc: THREE.Mesh;
  discMat: THREE.MeshBasicMaterial;
  flame: THREE.Mesh;
  flameMat: THREE.ShaderMaterial;
  pos: THREE.Vector3;
  radius: number;
  inten: number;
}

interface GateObj {
  mesh: THREE.Mesh;
  keys: string[];
  opensAfter: boolean;
}

/** Everything built from a LevelDef. */
export class LevelView {
  readonly group = new THREE.Group();
  private mats = new Map<string, THREE.Material>();
  private gates: GateObj[] = [];
  private vents: VentObj[] = [];
  private caches = new Map<string, THREE.Group>();
  private cacheGlow = new Map<string, { sprite: THREE.Sprite; beam: THREE.Mesh; mat: THREE.ShaderMaterial }>();
  private rack: { group: THREE.Group; gun: THREE.Object3D; glow: THREE.Sprite } | null = null;
  private relay: { beam: THREE.Mesh; mat: THREE.ShaderMaterial; lamp: THREE.Sprite; top: THREE.Vector3; ring: THREE.Mesh; ringProg: number; radius: number } | null = null;
  private extraction: { group: THREE.Group; col: THREE.Mesh; colMat: THREE.ShaderMaterial; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; pos: THREE.Vector3 } | null = null;
  private pillar: { flame: THREE.Mesh; mat: THREE.ShaderMaterial; glow: THREE.Sprite } | null = null;
  private shaderMats: THREE.ShaderMaterial[] = [];
  private glowTex = makeGlowTexture();
  private disposables: { dispose(): void }[] = [];
  private tmp = new THREE.Vector3();
  private landmarkMats = new Map<THREE.Material, THREE.Material>();
  groundMats: THREE.Material[] = [];

  constructor(private assets: AssetLibrary, private fx: Fx) {}

  clear(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !m.userData.sharedGeo) m.geometry.dispose();
    });
    this.group.clear();
    this.gates = [];
    this.vents = [];
    this.caches.clear();
    this.cacheGlow.clear();
    this.rack = null;
    this.relay = null;
    this.extraction = null;
    this.pillar = null;
    this.shaderMats = [];
    this.landmarkMats.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private material(m: Exclude<SurfaceMat, 'invisible'>): THREE.Material {
    const key = m;
    let mat = this.mats.get(key);
    if (mat) return mat;
    const d = SURF[m];
    const std = new THREE.MeshStandardMaterial({ color: d.color, roughness: d.rough, metalness: d.metal });
    if (m === 'hazard') {
      std.map = makeHazardTexture();
      this.disposables.push(std.map);
    } else if (d.tex) {
      std.map = this.assets.tex(d.tex);
    }
    if (d.emissive && this.assets.crackEmissive) {
      std.emissiveMap = this.assets.crackEmissive;
      std.emissive = new THREE.Color(0xffffff);
      std.emissiveIntensity = 1.6;
    }
    if (m === 'slag') {
      std.emissive = new THREE.Color(0x401000);
      std.emissiveMap = std.map;
      std.emissiveIntensity = 0.12;
    }
    this.mats.set(key, std);
    return std;
  }

  build(level: LevelDef): void {
    this.clear();
    this.buildBoxes(level);
    this.buildProps(level);
    this.buildSigns(level);
    this.buildVents(level);
    this.buildCaches(level);
    this.buildRack(level);
    this.buildRelay(level);
    this.buildExtraction(level);
  }

  // ------------------------------------------------------------- boxes
  private buildBoxes(level: LevelDef): void {
    const byMat = new Map<string, THREE.BufferGeometry[]>();
    for (const b of level.boxes) {
      if (b.mat === 'invisible') continue;
      const def = SURF[b.mat];
      const geo = boxGeometry(b, def.tile);
      if (b.gateOpensAfter || b.gateClosesOn) {
        const mesh = new THREE.Mesh(geo, this.material(b.mat));
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.sharedGeo = false;
        this.group.add(mesh);
        const keys = [b.id, b.gateOpensAfter, b.gateClosesOn].filter((k): k is string => !!k);
        this.gates.push({ mesh, keys, opensAfter: !!b.gateOpensAfter });
        // hazard trim on gates so they read as barriers
        continue;
      }
      let arr = byMat.get(b.mat);
      if (!arr) byMat.set(b.mat, (arr = []));
      arr.push(geo);
    }
    for (const [m, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.material(m as Exclude<SurfaceMat, 'invisible'>));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `level:${m}`;
      this.group.add(mesh);
    }
  }

  // ------------------------------------------------------------- props
  private darkenLandmark(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const sub = (x: THREE.Material) => {
        let c = this.landmarkMats.get(x);
        if (!c) {
          c = x.clone();
          const s = c as THREE.MeshStandardMaterial;
          s.fog = false;
          if (s.color) s.color.multiplyScalar(0.42);
          if (s.envMapIntensity !== undefined) s.envMapIntensity = 0.2;
          this.landmarkMats.set(x, c);
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(sub) : sub(m.material);
    });
  }

  private buildProps(level: LevelDef): void {
    for (const p of level.props) {
      const obj = this.assets.makeStatic(p.asset, p.height);
      obj.position.set(p.pos.x, p.pos.y, p.pos.z);
      obj.rotation.y = p.yaw ?? 0;
      const h = p.height ?? 2;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = h < 8;
          m.receiveShadow = true;
        }
      });
      this.group.add(obj);
    }
    for (const p of level.landmarks) {
      const obj = this.assets.makeStatic(p.asset, p.height);
      obj.position.set(p.pos.x, p.pos.y, p.pos.z);
      obj.rotation.y = p.yaw ?? 0;
      this.darkenLandmark(obj);
      this.group.add(obj);
      if (p.asset === 'prop.the_pillar' && !this.pillar) {
        const h = p.height ?? 70;
        const mat = makeFlameMaterial(0xfff2b8, 0xff3c04);
        mat.fog = false;
        mat.uniforms.uIntensity.value = 1.3;
        const flame = new THREE.Mesh(columnGeometry(8, 3, 20, 10), mat);
        flame.scale.set(1, 46, 1);
        flame.position.set(p.pos.x, p.pos.y + h - 2, p.pos.z);
        flame.frustumCulled = false;
        flame.renderOrder = 3;
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff6a20, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8, fog: false }));
        glow.scale.setScalar(110);
        glow.position.set(p.pos.x, p.pos.y + h + 12, p.pos.z);
        this.group.add(flame, glow);
        this.shaderMats.push(mat);
        this.pillar = { flame, mat, glow };
      }
    }
  }

  private buildSigns(level: LevelDef): void {
    const edge = new THREE.MeshStandardMaterial({ color: 0x24201c, roughness: 0.8, metalness: 0.5 });
    for (const s of level.signs) {
      const tex = makeSignTexture(s);
      this.disposables.push(tex);
      const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.2, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: s.style === 'warning' ? 0.18 : 0.1 });
      this.disposables.push(front);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.width, s.height, 0.05), [edge, edge, edge, edge, front, edge]);
      mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      mesh.rotation.y = s.yaw;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  // ------------------------------------------------------------- vents
  private buildVents(level: LevelDef): void {
    for (const h of level.hazards) {
      const group = new THREE.Group();
      group.position.set(h.pos.x, h.pos.y, h.pos.z);
      const prop = this.assets.makeStatic('prop.vent', 0.4, { lod: false });
      prop.scale.setScalar(Math.max(1, h.radius * 0.7));
      group.add(prop);
      const discMat = new THREE.MeshBasicMaterial({ color: 0xff5010, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(h.radius, 36).rotateX(-Math.PI / 2), discMat);
      disc.position.y = 0.04;
      disc.renderOrder = 2;
      group.add(disc);
      const flameMat = makeFlameMaterial();
      flameMat.uniforms.uIntensity.value = 0;
      const flame = new THREE.Mesh(columnGeometry(h.radius * 0.8, h.radius * 0.35, 16, 8), flameMat);
      flame.scale.y = 0.01;
      flame.position.y = 0.1;
      flame.renderOrder = 3;
      flame.frustumCulled = false;
      group.add(flame);
      this.shaderMats.push(flameMat);
      this.group.add(group);
      this.vents.push({ id: h.id, group, disc, discMat, flame, flameMat, pos: new THREE.Vector3(h.pos.x, h.pos.y + 0.4, h.pos.z), radius: h.radius, inten: 0 });
    }
  }

  // ------------------------------------------------------------ caches
  private buildCaches(level: LevelDef): void {
    for (const a of level.arenas) {
      const g = new THREE.Group();
      g.position.set(a.cache.x, a.cache.y, a.cache.z);
      const chest = this.assets.makeStatic('prop.supply_chest', 0.9, { lod: true });
      chest.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      });
      g.add(chest);
      const beamMat = makeBeamMaterial(0x6fd8ff);
      beamMat.uniforms.uIntensity.value = 0.7;
      this.shaderMats.push(beamMat);
      const beam = new THREE.Mesh(columnGeometry(0.5, 0.25, 12, 2), beamMat);
      beam.scale.y = 6;
      beam.renderOrder = 3;
      beam.frustumCulled = false;
      g.add(beam);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x6fd8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6, fog: false }));
      sprite.scale.setScalar(2.2);
      sprite.position.y = 0.5;
      g.add(sprite);
      g.visible = false;
      this.group.add(g);
      this.caches.set(a.id, g);
      this.cacheGlow.set(a.id, { sprite, beam, mat: beamMat });
    }
  }

  // -------------------------------------------------------------- rack
  private buildRack(level: LevelDef): void {
    const r = level.weaponRack;
    const g = new THREE.Group();
    g.position.set(r.pos.x, r.pos.y, r.pos.z);
    g.rotation.y = r.yaw;
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.8, roughness: 0.55 });
    const orange = new THREE.MeshStandardMaterial({ color: 0x8a4418, metalness: 0.4, roughness: 0.6 });
    const post = new THREE.BoxGeometry(0.08, 1.5, 0.08);
    for (const x of [-0.6, 0.6]) {
      const p = new THREE.Mesh(post, steel);
      p.position.set(x, 0.75, 0);
      p.castShadow = true;
      g.add(p);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.06), steel);
    bar.position.set(0, 1.05, -0.04);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.06), steel);
    bar2.position.set(0, 0.7, -0.04);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.5), orange);
    base.position.set(0, 0.04, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.03), steel);
    back.position.set(0, 0.95, -0.1);
    g.add(bar, bar2, base, back);
    const id = r.weapon === 'coil_carbine' ? 'weapon.coil_carbine' : 'weapon.arc_scattergun';
    const gun = this.assets.rawClone(id) ?? new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.15), new THREE.MeshStandardMaterial({ color: 0x777777 }));
    gun.scale.setScalar(1.1 / 1.9);
    gun.position.set(0, 0.92, 0.0);
    gun.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    g.add(gun);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x6fd8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.5, fog: false }));
    glow.scale.setScalar(2.4);
    glow.position.set(0, 0.95, 0.15);
    g.add(glow);
    this.group.add(g);
    this.rack = { group: g, gun, glow };
  }

  // ------------------------------------------------------------- relay
  private buildRelay(level: LevelDef): void {
    const p = level.relay.pos;
    const tower = this.assets.makeStatic('prop.signal_tower', 9, { lod: true });
    tower.position.set(p.x, p.y, p.z);
    tower.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    this.group.add(tower);
    const mat = makeBeamMaterial(0x4fe0ff);
    mat.fog = false;
    this.shaderMats.push(mat);
    const beam = new THREE.Mesh(columnGeometry(0.55, 0.9, 16, 2), mat);
    beam.position.set(p.x, p.y + 9, p.z);
    beam.scale.y = 260;
    beam.renderOrder = 3;
    beam.frustumCulled = false;
    this.group.add(beam);
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x6fe8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9, fog: false }));
    lamp.scale.setScalar(5);
    lamp.position.set(p.x, p.y + 9, p.z);
    this.group.add(lamp);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4fe0ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(level.relay.interactRadius - 0.15, level.relay.interactRadius, 64, 1, 0, 0.001).rotateX(-Math.PI / 2), ringMat);
    ring.position.set(p.x, p.y + 0.06, p.z);
    this.group.add(ring);
    this.relay = { beam, mat, lamp, top: new THREE.Vector3(p.x, p.y + 9, p.z), ring, ringProg: -1, radius: level.relay.interactRadius };
  }

  // -------------------------------------------------------- extraction
  private buildExtraction(level: LevelDef): void {
    const e = level.extraction;
    const group = new THREE.Group();
    group.position.set(e.pos.x, e.pos.y, e.pos.z);
    const colMat = makeBeamMaterial(0x9dffb8);
    this.shaderMats.push(colMat);
    const col = new THREE.Mesh(columnGeometry(e.radius * 0.7, e.radius * 0.55, 24, 2), colMat);
    col.scale.y = 70;
    col.renderOrder = 3;
    col.frustumCulled = false;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x9dffb8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(e.radius - 0.25, e.radius, 64).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.06;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(e.radius - 0.25, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9dffb8, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    disc.position.y = 0.05;
    group.add(col, ring, disc);
    this.group.add(group);
    this.extraction = { group, col, colMat, ring, ringMat, pos: new THREE.Vector3(e.pos.x, e.pos.y + 2, e.pos.z) };
  }

  // ------------------------------------------------------------ update
  update(frame: RenderFrame, dt: number, camPos: THREE.Vector3): void {
    void dt;
    const time = frame.time;
    for (const m of this.shaderMats) m.uniforms.uTime.value = time;

    for (const g of this.gates) {
      let open: boolean | undefined;
      for (const k of g.keys) {
        if (k in frame.gatesOpen) {
          open = frame.gatesOpen[k];
          break;
        }
      }
      // gates removed after an arena (gateOpensAfter) default to closed; gates that
      // close behind the player (gateClosesOn) default to open until told otherwise.
      const isOpen = open ?? !g.opensAfter;
      g.mesh.visible = !isOpen;
    }

    for (const v of this.vents) {
      const h = frame.hazards.find((x) => x.id === v.id);
      const phase = h?.phase ?? 'idle';
      let targetInt = 0;
      let disc = 0.08;
      if (phase === 'warn') {
        const f = 0.5 + 0.5 * Math.sin(time * 16);
        disc = 0.22 + 0.4 * f;
        targetInt = 0.18 + 0.12 * f;
      } else if (phase === 'active') {
        disc = 0.4 + 0.1 * Math.sin(time * 22);
        targetInt = 1.15;
      }
      v.inten += (targetInt - v.inten) * Math.min(1, dt * (targetInt > v.inten ? 14 : 6));
      v.discMat.opacity = disc;
      v.flameMat.uniforms.uIntensity.value = v.inten;
      const hgt = phase === 'active' ? 5.2 : phase === 'warn' ? 1.2 : 0.05;
      v.flame.scale.y += (hgt - v.flame.scale.y) * Math.min(1, dt * 12);
      v.flame.visible = v.flame.scale.y > 0.08;
      if (phase === 'active') {
        if (Math.random() < dt * 45)
          this.fx.sparks.emit(v.pos.x + (Math.random() - 0.5) * v.radius, v.pos.y, v.pos.z + (Math.random() - 0.5) * v.radius, (Math.random() - 0.5) * 1.2, 4 + Math.random() * 5, (Math.random() - 0.5) * 1.2, 1 + Math.random(), 1, 0.45, 0.1, 0.9, 0.07, 0.015, 1);
        this.fx.requestLight(this.tmp.set(v.pos.x, v.pos.y + 1.4, v.pos.z).clone(), 0xff7a28, 1.2, camPos);
      } else if (phase === 'warn') {
        this.fx.requestLight(this.tmp.set(v.pos.x, v.pos.y + 0.4, v.pos.z).clone(), 0xff5a18, 0.35 + 0.3 * Math.sin(time * 16), camPos);
      }
    }

    for (const [id, g] of this.caches) {
      const c = frame.caches.find((x) => x.arena === id);
      const vis = !!c && (c.available || c.open);
      g.visible = vis;
      if (c && vis) {
        g.position.set(c.pos.x, c.pos.y, c.pos.z);
        const gl = this.cacheGlow.get(id)!;
        const on = c.available;
        gl.sprite.visible = on;
        gl.beam.visible = on;
        gl.sprite.material.opacity = 0.45 + 0.25 * Math.sin(time * 3 + g.position.x);
        if (on) this.fx.requestLight(this.tmp.set(c.pos.x, c.pos.y + 1, c.pos.z).clone(), 0x6fd8ff, 0.5, camPos);
      }
    }

    if (this.rack) {
      this.rack.gun.visible = frame.rackHasWeapon;
      this.rack.glow.visible = frame.rackHasWeapon;
      this.rack.glow.material.opacity = 0.35 + 0.2 * Math.sin(time * 2.5);
    }

    if (this.relay) {
      const r = this.relay;
      const rf = frame.relay;
      r.beam.visible = !rf.done;
      r.lamp.visible = !rf.done;
      r.ring.visible = !rf.done && rf.progress > 0;
      const pulse = rf.active ? 0.85 + 0.25 * Math.sin(time * 9) : 0.55;
      r.mat.uniforms.uIntensity.value = pulse;
      r.lamp.material.opacity = rf.active ? 0.9 : 0.5 + 0.2 * Math.sin(time * 2);
      r.lamp.scale.setScalar(rf.active ? 6 + Math.sin(time * 9) : 4.5);
      if (rf.progress !== r.ringProg && !rf.done) {
        r.ringProg = rf.progress;
        const old = r.ring.geometry;
        r.ring.geometry = new THREE.RingGeometry(r.radius - 0.15, r.radius, 64, 1, 0, Math.max(0.001, rf.progress * Math.PI * 2)).rotateX(-Math.PI / 2);
        old.dispose();
      }
      if (!rf.done) this.fx.requestLight(r.top, 0x4fe0ff, rf.active ? 1.3 : 0.6, camPos);
    }

    if (this.extraction) {
      const e = this.extraction;
      const on = frame.extractionActive;
      e.col.visible = on;
      e.colMat.uniforms.uIntensity.value = 0.8 + 0.2 * Math.sin(time * 4);
      e.ringMat.opacity = on ? 0.8 : 0.18;
      e.ringMat.color.setHex(on ? 0x9dffb8 : 0x886644);
      if (on) this.fx.requestLight(e.pos, 0x9dffb8, 0.9, camPos);
    }
  }
}
