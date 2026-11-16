import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { WeaponId } from '../sim/types';
import { MUZZLE_OFFSET, type ViewmodelState } from './types';
import type { Settings } from '../ui/types';
import { WEAPONS } from '../content/weapons';
import type { AssetLibrary } from './assets';
import { cloneMaterials } from './assets';
import { makeFlashTexture, makeGlowTexture } from './textures';

/** Held length of the weapon model in meters. */
const HELD_LENGTH: Record<WeaponId, number> = { coil_carbine: 0.74, arc_scattergun: 0.72, service_emitter: 0.2 };
/** Toe-in yaw (rad, +left) and pitch (rad) so the barrel points a little toward screen centre. */
const TOE: Record<WeaponId, { yaw: number; pitch: number; roll: number }> = {
  coil_carbine: { yaw: 0.07, pitch: 0.02, roll: 0 },
  arc_scattergun: { yaw: 0.07, pitch: 0.02, roll: 0 },
  service_emitter: { yaw: 0.1, pitch: 0.0, roll: 0 },
};
const CELL_COLOR: Record<WeaponId, number> = { coil_carbine: 0xffa030, arc_scattergun: 0x70c8ff, service_emitter: 0x8affc8 };

interface Rig {
  id: WeaponId;
  /** Animated root, positioned at the pivot (camera space). */
  root: THREE.Group;
  /** Rest-pose holder. */
  pose: THREE.Group;
  muzzle: THREE.Object3D;
  pivot: THREE.Vector3;
  mats: THREE.MeshStandardMaterial[];
  cell?: THREE.Mesh;
  cell2?: THREE.Mesh;
  cellBase: THREE.Vector3;
  glow?: THREE.Sprite;
  ring?: THREE.Mesh;
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 10);
  private rigs = new Map<WeaponId, Rig>();
  private flashSprite: THREE.Sprite;
  private flashCore: THREE.Sprite;
  private flashLight: THREE.PointLight;
  private bobPhase = 0;
  private swayX = 0;
  private swayY = 0;
  private bobAmt = 0;
  private lastSinceShot = 99;
  private flashRot = 0;
  private flashSize = 1;
  private slap = 0;
  private dashBlend = 0;
  private kickSm = 0;
  private tmp = new THREE.Vector3();
  private time = 0;
  private prevReload: number | null = null;

  constructor(private assets: AssetLibrary, renderer: THREE.WebGLRenderer) {
    this.camera.position.set(0, 0, 0);
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();

    this.scene.add(new THREE.AmbientLight(0x8a7060, 0.9));
    const key = new THREE.DirectionalLight(0xffc896, 2.2);
    key.position.set(-1.5, 2, 1);
    this.scene.add(key);
    const rim = new THREE.PointLight(0xff6a20, 4, 3, 1.5);
    rim.position.set(0.6, -0.4, 0.2);
    this.scene.add(rim);

    const fl = makeFlashTexture();
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: fl, color: 0xffc070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));
    this.flashCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));
    this.flashSprite.visible = this.flashCore.visible = false;
    this.flashSprite.renderOrder = 20;
    this.flashCore.renderOrder = 21;
    this.flashLight = new THREE.PointLight(0xffc070, 0, 4, 1.4);
    this.scene.add(this.flashSprite, this.flashCore, this.flashLight);

    for (const id of ['coil_carbine', 'arc_scattergun', 'service_emitter'] as WeaponId[]) {
      const rig = id === 'service_emitter' ? this.buildEmitter() : this.buildGun(id);
      rig.root.visible = false;
      this.scene.add(rig.root);
      this.rigs.set(id, rig);
    }
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- build
  private pivotFor(id: WeaponId): THREE.Vector3 {
    const m = MUZZLE_OFFSET[id];
    return new THREE.Vector3(m.x - 0.02, m.y + 0.03, m.z + (id === 'service_emitter' ? 0.12 : 0.4));
  }

  private addCell(rig: Rig, id: WeaponId): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2622, emissive: CELL_COLOR[id], emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.35 });
    const geo = new THREE.BoxGeometry(0.045, 0.05, 0.13);
    const mk = () => {
      const c = new THREE.Mesh(geo, mat);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, 0.03), new THREE.MeshStandardMaterial({ color: 0x1a1816, metalness: 0.8, roughness: 0.4 }));
      cap.position.z = 0.07;
      c.add(cap);
      c.visible = false;
      return c;
    };
    rig.cell = mk();
    rig.cell2 = mk();
    this.scene.add(rig.cell, rig.cell2);
    rig.cellBase.set(rig.pivot.x + 0.015, rig.pivot.y - 0.085, rig.pivot.z + 0.03);
  }

  private buildGun(id: WeaponId): Rig {
    const root = new THREE.Group();
    const pose = new THREE.Group();
    const pivot = this.pivotFor(id);
    root.position.copy(pivot);
    root.add(pose);
    const orient = new THREE.Group();
    pose.add(orient);
    const muzzle = new THREE.Object3D();
    muzzle.name = 'Muzzle';
    const mats: THREE.MeshStandardMaterial[] = [];
    const src = this.assets.rawClone(id === 'coil_carbine' ? 'weapon.coil_carbine' : 'weapon.arc_scattergun');
    const L = HELD_LENGTH[id];
    if (src) {
      cloneMaterials(src);
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.frustumCulled = false;
          const ms = Array.isArray(m.material) ? m.material : [m.material];
          for (const x of ms) if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial) mats.push(x as THREE.MeshStandardMaterial);
        }
      });
      // locate muzzle (min-X end): average Y/Z of vertices near the tip
      const box = new THREE.Box3().setFromObject(src, true);
      let sy = 0, sz = 0, n = 0;
      src.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          if (v.x < box.min.x + 0.06) {
            sy += v.y;
            sz += v.z;
            n++;
          }
        }
      });
      muzzle.position.set(box.min.x, n ? sy / n : 0, n ? sz / n : 0);
      src.add(muzzle);
      orient.add(src);
      orient.scale.setScalar(L / Math.max(0.1, box.max.x - box.min.x));
    } else {
      // placeholder gun: a box with a barrel
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.2), new THREE.MeshStandardMaterial({ color: 0x555050, metalness: 0.7, roughness: 0.5 }));
      body.position.x = 0.35;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 10), new THREE.MeshStandardMaterial({ color: 0x333030 }));
      barrel.rotation.z = Math.PI / 2;
      barrel.position.x = -0.55;
      muzzle.position.set(-0.95, 0, 0);
      const g = new THREE.Group();
      g.add(body, barrel, muzzle);
      orient.add(g);
      orient.scale.setScalar(L / 1.9);
    }
    const toe = TOE[id];
    // model muzzle points -X; rotate so -X -> -Z
    orient.rotation.set(toe.pitch, -Math.PI / 2 + toe.yaw, toe.roll, 'YXZ');
    // align the Muzzle anchor to MUZZLE_OFFSET
    root.updateMatrixWorld(true);
    muzzle.getWorldPosition(this.tmp);
    const t = MUZZLE_OFFSET[id];
    orient.position.set(t.x - this.tmp.x, t.y - this.tmp.y, t.z - this.tmp.z);
    root.updateMatrixWorld(true);

    const rig: Rig = { id, root, pose, muzzle, pivot, mats, cellBase: new THREE.Vector3() };
    this.addCell(rig, id);
    // cold-chamber / charge glow at the muzzle tip
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: id === 'arc_scattergun' ? 0x90d0ff : 0xffb050, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    glow.scale.setScalar(0.18);
    glow.renderOrder = 19;
    muzzle.add(glow);
    rig.glow = glow;
    return rig;
  }

  private buildEmitter(): Rig {
    const id: WeaponId = 'service_emitter';
    const root = new THREE.Group();
    const pose = new THREE.Group();
    const pivot = this.pivotFor(id);
    root.position.copy(pivot);
    root.add(pose);
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c2a28, metalness: 0.8, roughness: 0.45 });
    const orange = new THREE.MeshStandardMaterial({ color: 0x9a4a18, metalness: 0.5, roughness: 0.55 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x302820, roughness: 0.95 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x103828, emissive: 0x8affc8, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.3 });
    const g = new THREE.Group();
    // forearm sleeve running back toward camera, lower right
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.5, 12), cloth);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0.04, -0.06, 0.32);
    g.add(arm);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.07, 12), orange);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0.04, -0.06, 0.06);
    g.add(cuff);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.2), dark);
    body.position.set(0.0, 0.0, -0.06);
    g.add(body);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 12), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, 0.005, -0.22);
    g.add(nozzle);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 8, 20), glowMat);
    ring.position.set(0, 0.005, -0.17);
    g.add(ring);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.012, 0.12), orange);
    stripe.position.set(0, 0.04, -0.05);
    g.add(stripe);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.004, 0.06), glowMat);
    screen.position.set(0, 0.037, 0.0);
    g.add(screen);
    const muzzle = new THREE.Object3D();
    muzzle.name = 'Muzzle';
    muzzle.position.set(0, 0.005, -0.285);
    g.add(muzzle);
    const orient = new THREE.Group();
    orient.add(g);
    pose.add(orient);
    const toe = TOE[id];
    orient.rotation.set(toe.pitch, toe.yaw, 0, 'YXZ');
    root.updateMatrixWorld(true);
    muzzle.getWorldPosition(this.tmp);
    const t = MUZZLE_OFFSET[id];
    orient.position.set(t.x - this.tmp.x, t.y - this.tmp.y, t.z - this.tmp.z);
    root.updateMatrixWorld(true);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0x8affc8, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    glow.scale.setScalar(0.16);
    glow.renderOrder = 19;
    muzzle.add(glow);
    return { id, root, pose, muzzle, pivot, mats: [glowMat], cellBase: new THREE.Vector3(), glow, ring };
  }

  // --------------------------------------------------------------- update
  /** Camera-space (viewmodel scene) position of the active Muzzle anchor. */
  muzzleCameraSpace(w: WeaponId, out: THREE.Vector3): THREE.Vector3 {
    const r = this.rigs.get(w);
    if (!r) return out.set(MUZZLE_OFFSET[w].x, MUZZLE_OFFSET[w].y, MUZZLE_OFFSET[w].z);
    r.root.updateMatrixWorld(true);
    return r.muzzle.getWorldPosition(out);
  }

  update(vm: ViewmodelState, dt: number, settings: Settings | null): void {
    this.time += dt;
    const bobScale = settings ? settings.cameraBob : 1;
    const flashScale = settings ? settings.flashIntensity : 1;
    for (const [id, r] of this.rigs) {
      const on = id === vm.weapon && vm.raise > 0.001;
      r.root.visible = on;
      if (!on && r.cell) r.cell.visible = r.cell2!.visible = false;
    }
    const rig = this.rigs.get(vm.weapon);
    if (!rig) return;
    const root = rig.root;

    // bob (grounded movement) + idle breathing
    const moving = vm.grounded ? vm.speed : 0;
    this.bobAmt += (moving - this.bobAmt) * Math.min(1, dt * 8);
    this.bobPhase += dt * (4 + this.bobAmt * 8) * (0.4 + this.bobAmt);
    const bx = Math.sin(this.bobPhase) * 0.012 * this.bobAmt * bobScale;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.014 * this.bobAmt * bobScale;
    const breathe = Math.sin(this.time * 1.7) * 0.0012 * (1 - this.bobAmt);

    // sway from look delta (spring toward -look)
    const k = Math.min(1, dt * 10);
    const lookX = Math.max(-0.12, Math.min(0.12, vm.lookDX));
    const lookY = Math.max(-0.12, Math.min(0.12, vm.lookDY));
    this.swayX += (-lookX * 0.35 - this.swayX) * k;
    this.swayY += (lookY * 0.35 - this.swayY) * k;
    const sway = bobScale; // scale with camera bob setting too (motion comfort)

    // recoil
    this.kickSm += (vm.kick - this.kickSm) * Math.min(1, dt * 30);
    const def = WEAPONS[vm.weapon];
    const kickBack = def.recoil.kickBack * 1.6;
    const kick = this.kickSm;

    // raise / lower
    const rs = 1 - Math.max(0, Math.min(1, vm.raise));
    const rsE = rs * rs;

    // dash lean
    this.dashBlend += ((vm.dashing ? 1 : 0) - this.dashBlend) * Math.min(1, dt * 10);

    // reload tilt envelope
    let tilt = 0;
    if (vm.reload !== null && vm.weapon !== 'service_emitter') {
      const r = vm.reload;
      tilt = r < 0.18 ? smooth(r / 0.18) : r < 0.78 ? 1 : 1 - smooth((r - 0.78) / 0.22);
    }
    if (this.prevReload !== null && vm.reload === null) this.slap = 0.8;
    this.prevReload = vm.reload;
    this.slap = Math.max(0, this.slap - dt * 5);

    root.position.copy(rig.pivot);
    root.position.x += bx + this.swayX * sway + this.dashBlend * -0.04 - tilt * 0.05;
    root.position.y += by + this.swayY * sway + breathe - rsE * 0.4 - tilt * 0.06 + this.slap * -0.01;
    root.position.z += kick * kickBack + rsE * 0.12 + this.slap * 0.02 + this.dashBlend * 0.03;
    root.rotation.set(
      kick * 0.09 - rsE * 0.9 + tilt * 0.18 + this.swayY * 1.2 * sway + by * 1.5 + this.slap * 0.05,
      -this.swayX * 1.6 * sway + this.dashBlend * 0.18 + tilt * 0.25 + bx * 1.2,
      tilt * 0.55 + this.swayX * 0.9 * sway + this.dashBlend * 0.12 - bx * 1.5,
      'YXZ',
    );

    // reload cells
    if (rig.cell && rig.cell2) {
      const r = vm.reload;
      const old = rig.cell;
      const neu = rig.cell2;
      const base = rig.cellBase;
      // cells live in viewmodel scene space; follow the gun roughly via the same offset
      const off = this.tmp.copy(root.position).sub(rig.pivot);
      if (r !== null && vm.weapon !== 'service_emitter') {
        if (r > 0.1 && r < 0.5) {
          const t = (r - 0.1) / 0.4;
          old.visible = true;
          old.position.set(base.x + off.x + t * 0.03, base.y + off.y - t * t * 0.9, base.z + off.z + t * 0.05);
          old.rotation.set(t * 2.2, t * 1.4, t * 3);
        } else old.visible = false;
        if (r > 0.42 && r < 0.74) {
          const t = smooth((r - 0.42) / 0.3);
          neu.visible = true;
          neu.position.set(base.x + off.x + (1 - t) * 0.05, base.y + off.y - (1 - t) * 0.3, base.z + off.z + (1 - t) * 0.04);
          neu.rotation.set((1 - t) * 0.9, (1 - t) * -0.5, 0);
          (neu.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 + (r > 0.7 ? 3 : 0);
        } else neu.visible = false;
      } else old.visible = neu.visible = false;
      void old;
    }

    // glows: cold chamber / emitter charge
    if (rig.glow) {
      const m = rig.glow.material as THREE.SpriteMaterial;
      if (vm.weapon === 'arc_scattergun') {
        const pulse = 0.65 + 0.35 * Math.sin(this.time * 9);
        m.opacity = vm.slugReady ? pulse * (0.5 + 0.5 * flashScale) : 0;
        for (const mt of rig.mats) {
          mt.emissive.setHex(0x4aa0ff);
          mt.emissiveIntensity = vm.slugReady ? 0.25 * pulse : 0;
        }
      } else if (vm.weapon === 'service_emitter') {
        const c = vm.charge;
        m.opacity = c * (0.45 + 0.25 * Math.sin(this.time * 12)) * (0.5 + 0.5 * flashScale);
        for (const mt of rig.mats) mt.emissiveIntensity = 0.3 + c * 2.6;
      } else {
        m.opacity = 0;
      }
    }

    // muzzle flash
    if (vm.sinceShot < this.lastSinceShot - 0.0001) {
      this.flashRot = Math.random() * 6.28;
      this.flashSize = 0.8 + Math.random() * 0.5;
    }
    this.lastSinceShot = vm.sinceShot;
    const fl = vm.weapon === 'service_emitter' ? 0.05 : vm.weapon === 'arc_scattergun' ? 0.09 : 0.06;
    if (vm.sinceShot < fl && vm.raise > 0.5) {
      const t = vm.sinceShot / fl;
      this.muzzleCameraSpace(vm.weapon, this.tmp);
      const sz = (vm.weapon === 'arc_scattergun' ? 0.55 : vm.weapon === 'service_emitter' ? 0.2 : 0.34) * this.flashSize * (1 - t * 0.5);
      const fs = this.flashSprite;
      const col = def.fx.flashColor;
      fs.visible = this.flashCore.visible = true;
      fs.position.copy(this.tmp);
      fs.scale.setScalar(sz);
      (fs.material as THREE.SpriteMaterial).color.setHex(col);
      (fs.material as THREE.SpriteMaterial).rotation = this.flashRot;
      (fs.material as THREE.SpriteMaterial).opacity = (1 - t) * (0.25 + 0.75 * flashScale);
      this.flashCore.position.copy(this.tmp);
      this.flashCore.scale.setScalar(sz * 0.5);
      (this.flashCore.material as THREE.SpriteMaterial).opacity = (1 - t) * (0.2 + 0.8 * flashScale);
      this.flashLight.color.setHex(col);
      this.flashLight.position.copy(this.tmp).add(this.tmp2.set(0, 0.02, -0.12));
      this.flashLight.intensity = (1 - t) * 14 * flashScale * (vm.weapon === 'arc_scattergun' ? 1.4 : 1);
    } else {
      this.flashSprite.visible = this.flashCore.visible = false;
      this.flashLight.intensity = 0;
    }
  }
  private tmp2 = new THREE.Vector3();
}

function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
