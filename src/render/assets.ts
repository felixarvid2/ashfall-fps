import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSETS } from '../content/assets';
import { assetUrl } from '../content/assetTypes';
import { makeCrackEmissive } from './textures';

/**
 * LOD files whose simplified triangles stretch across UV islands (verified
 * visually: texture looks smeared/muddy vs LOD0) even though vertex UVs match.
 */
const LOD_BLOCKLIST = new Set(['props/fuel_tank_lod1.glb', 'props/fuel_tank_lod2.glb']);

/** Everything the renderer knows how to load, shared across runs. */
export class AssetLibrary {
  private loader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();
  private gltfs = new Map<string, GLTF | null>();
  private texs = new Map<string, THREE.Texture>();
  private normCache = new Map<string, { size: THREE.Vector3; min: THREE.Vector3; center: THREE.Vector3 }>();
  /** Ids that failed to load (placeholders used). */
  readonly failed = new Set<string>();
  /** LODs that were skipped because their materials/UVs could not be matched. */
  readonly skippedLods: string[] = [];
  /** Mean UV error per LOD file vs LOD0 (diagnostic). */
  readonly uvErr = new Map<string, number>();
  crackEmissive: THREE.Texture | null = null;

  constructor() {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  private async loadFile(file: string): Promise<GLTF | null> {
    if (this.gltfs.has(file)) return this.gltfs.get(file) ?? null;
    try {
      const g = await this.loader.loadAsync(assetUrl(file));
      this.gltfs.set(file, g);
      return g;
    } catch (e) {
      console.warn('[render] failed to load', file, e);
      this.gltfs.set(file, null);
      return null;
    }
  }

  private async loadTexture(id: string): Promise<void> {
    const e = ASSETS[id];
    if (!e) return;
    try {
      const t = await this.texLoader.loadAsync(assetUrl(e.file));
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      this.texs.set(id, t);
      if (id === 'tex.cooling_slag') {
        try {
          this.crackEmissive = makeCrackEmissive(t.image as HTMLImageElement);
        } catch {
          /* no emissive mask */
        }
      }
    } catch (err) {
      console.warn('[render] failed texture', id, err);
      this.failed.add(id);
    }
  }

  tex(id: string): THREE.Texture | null {
    return this.texs.get(id) ?? null;
  }

  /** Load everything in the registry that the renderer uses. */
  async loadAll(onProgress: (f: number, label: string) => void): Promise<void> {
    const ids = Object.keys(ASSETS).filter((id) => ASSETS[id].kind !== 'audio');
    const files: { id: string; file: string; lod: boolean }[] = [];
    for (const id of ids) {
      const e = ASSETS[id];
      if (e.kind === 'texture') continue;
      files.push({ id, file: e.file, lod: false });
      for (const l of e.lods ?? []) files.push({ id, file: l, lod: true });
    }
    const texIds = ids.filter((id) => ASSETS[id].kind === 'texture');
    const total = files.length + texIds.length;
    let done = 0;
    const tick = (label: string) => onProgress(++done / total, label);
    // Load LOD0 files first (needed), LODs after; all in parallel in small batches.
    const jobs: (() => Promise<void>)[] = [
      ...texIds.map((id) => async () => {
        await this.loadTexture(id);
        tick(id);
      }),
      ...files.map((f) => async () => {
        const g = await this.loadFile(f.file);
        if (!g && !f.lod) this.failed.add(f.id);
        tick(f.id);
      }),
    ];
    const queue = jobs.slice();
    const workers = Array.from({ length: 6 }, async () => {
      for (;;) {
        const j = queue.shift();
        if (!j) return;
        await j();
      }
    });
    await Promise.all(workers);
  }

  has(assetId: string): boolean {
    const e = ASSETS[assetId];
    return !!e && !!this.gltfs.get(e.file);
  }

  scene(assetId: string): THREE.Object3D | null {
    const e = ASSETS[assetId];
    return e ? (this.gltfs.get(e.file)?.scene ?? null) : null;
  }

  animations(assetId: string): THREE.AnimationClip[] {
    const e = ASSETS[assetId];
    return e ? (this.gltfs.get(e.file)?.animations ?? []) : [];
  }

  private bbox(assetId: string, obj: THREE.Object3D) {
    let n = this.normCache.get(assetId);
    if (!n) {
      obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(obj, true);
      const size = b.getSize(new THREE.Vector3());
      n = { size, min: b.min.clone(), center: b.getCenter(new THREE.Vector3()) };
      this.normCache.set(assetId, n);
    }
    return n;
  }

  /** Wrap `obj` so its base-center is at the origin and its height is `height` m. */
  private normalize(obj: THREE.Object3D, height: number, ref?: { size: THREE.Vector3; min: THREE.Vector3; center: THREE.Vector3 }) {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj, true);
    const size = b.getSize(new THREE.Vector3());
    const center = b.getCenter(new THREE.Vector3());
    const s = height / Math.max(size.y, 1e-4);
    const wrap = new THREE.Group();
    wrap.add(obj);
    obj.position.set(-center.x, -b.min.y, -center.z);
    const outer = new THREE.Group();
    outer.add(wrap);
    wrap.scale.setScalar(s);
    wrap.position.set(0, 0, 0);
    // obj offset is in obj's parent space (pre-scale) -> scaled by wrap automatically.
    void ref;
    return outer;
  }

  /** Mean UV error of a LOD vs LOD0 at matching positions (both already normalized to the same height/base). */
  private uvError(a: THREE.Object3D, b: THREE.Object3D): number {
    const collect = (root: THREE.Object3D, stride: number) => {
      root.updateMatrixWorld(true);
      const out: number[] = [];
      const v = new THREE.Vector3();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.getAttribute('position');
        const uv = m.geometry.getAttribute('uv');
        if (!uv) return;
        for (let i = 0; i < pos.count; i += stride) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          out.push(v.x, v.y, v.z, uv.getX(i), uv.getY(i));
        }
      });
      return out;
    };
    const A = collect(a, 1);
    const B = collect(b, 5);
    if (!A.length || !B.length) return 1;
    let sum = 0;
    let cnt = 0;
    for (let j = 0; j < B.length; j += 5) {
      let best = Infinity;
      for (let i = 0; i < A.length; i += 5) {
        const dx = A[i] - B[j], dy = A[i + 1] - B[j + 1], dz = A[i + 2] - B[j + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
      const tol = best + 1e-6;
      let e = Infinity;
      for (let i = 0; i < A.length; i += 5) {
        const dx = A[i] - B[j], dy = A[i + 1] - B[j + 1], dz = A[i + 2] - B[j + 2];
        if (dx * dx + dy * dy + dz * dz <= tol) {
          const du = A[i + 3] - B[j + 3], dv = A[i + 4] - B[j + 4];
          e = Math.min(e, Math.hypot(du, dv));
        }
      }
      sum += Math.min(e, 1);
      cnt++;
    }
    return sum / Math.max(1, cnt);
  }

  /** Match LOD materials to LOD0 materials (LOD files carry no images). Returns false if unusable. */
  private shareMaterials(lod0: THREE.Object3D, lod: THREE.Object3D, label: string): boolean {
    const l0: THREE.Material[] = [];
    lod0.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) if (!l0.includes(mm)) l0.push(mm);
    });
    if (!l0.length) return false;
    const seen: THREE.Material[] = [];
    let ok = true;
    lod.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map((m) => {
        let idx = seen.indexOf(m);
        if (idx < 0) {
          seen.push(m);
          idx = seen.length - 1;
        }
        const byName = m.name ? l0.find((x) => x.name === m.name) : undefined;
        const pick = byName ?? l0[Math.min(idx, l0.length - 1)];
        if ((pick as THREE.MeshStandardMaterial).map && !mesh.geometry.getAttribute('uv')) ok = false;
        return pick;
      });
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
    });
    if (!ok) {
      this.skippedLods.push(label);
      console.warn('[render] LOD skipped (no UVs for textured material):', label);
    }
    return ok;
  }

  /**
   * Static prop (optionally LOD'd), uniformly scaled to `height` (default
   * manifest heightMeters), base center at origin. Never throws: falls back
   * to a placeholder box when the asset failed.
   */
  makeStatic(assetId: string, height?: number, opts: { lod?: boolean; cloneMaterials?: boolean } = {}): THREE.Object3D {
    const e = ASSETS[assetId];
    const h = height ?? e?.heightMeters ?? 1;
    const src = this.scene(assetId);
    if (!e || !src) return placeholder(h, assetId);
    const useLod = opts.lod !== false && !!e.lods?.length;
    const mk = (s: THREE.Object3D) => {
      const c = s.clone(true);
      return this.normalize(c, h);
    };
    let out: THREE.Object3D;
    const lod0 = mk(src);
    if (!useLod) out = lod0;
    else {
      const lod = new THREE.LOD();
      lod.addLevel(lod0, 0);
      const big = h >= 25;
      const d1 = big ? h * 4 : Math.min(80, Math.max(18, h * 5));
      const d2 = big ? h * 9 : Math.min(160, Math.max(45, h * 12));
      const dist = [d1, d2];
      (e.lods ?? []).forEach((file, i) => {
        const g = this.gltfs.get(file);
        if (!g) return;
        const copy = g.scene.clone(true);
        if (!this.shareMaterials(src, copy, file)) return;
        const norm = this.normalize(copy, h);
        // verify the LOD's UVs line up with LOD0's texture atlas; otherwise skip the LOD
        let err = this.uvErr.get(file);
        if (err === undefined) {
          err = LOD_BLOCKLIST.has(file) ? 1 : this.uvError(lod0, norm);
          this.uvErr.set(file, err);
          if (err > 0.03) {
            this.skippedLods.push(file);
            console.warn(`[render] LOD skipped (uv error ${err.toFixed(3)}):`, file);
          }
        }
        if (err > 0.03) return;
        lod.addLevel(norm, dist[i] ?? d2);
      });
      out = lod;
    }
    if (opts.cloneMaterials) cloneMaterials(out);
    out.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.frustumCulled = true;
    });
    return out;
  }

  /** Static model (no scaling, no LOD) e.g. weapon GLBs: a plain clone. */
  rawClone(assetId: string): THREE.Object3D | null {
    const s = this.scene(assetId);
    return s ? s.clone(true) : null;
  }

  /** Clone a skinned model scaled to `height`. */
  makeSkinned(assetId: string, height?: number): { root: THREE.Object3D; clips: THREE.AnimationClip[]; placeholder: boolean } {
    const e = ASSETS[assetId];
    const h = height ?? e?.heightMeters ?? 1.7;
    const src = this.scene(assetId);
    if (!e || !src) return { root: placeholder(h, assetId), clips: [], placeholder: true };
    const n = this.bbox(assetId, src);
    const c = cloneSkinned(src);
    const wrap = new THREE.Group();
    wrap.add(c);
    c.position.set(-n.center.x, -n.min.y, -n.center.z);
    const s = h / Math.max(n.size.y, 1e-4);
    const outer = new THREE.Group();
    outer.add(wrap);
    wrap.scale.setScalar(s);
    cloneMaterials(outer);
    outer.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    });
    return { root: outer, clips: this.animations(assetId), placeholder: false };
  }
}

export function cloneMaterials(root: THREE.Object3D): void {
  const map = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const cl = (x: THREE.Material) => {
      let c = map.get(x);
      if (!c) {
        c = x.clone();
        map.set(x, c);
      }
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(cl) : cl(m.material);
  });
}

const phMat = new THREE.MeshStandardMaterial({ color: 0x6a5a4c, roughness: 0.9, metalness: 0.2 });
const phGeo = new THREE.BoxGeometry(1, 1, 1);
export function placeholder(h: number, label: string): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.Mesh(phGeo, phMat);
  const w = Math.max(0.3, h * 0.45);
  m.scale.set(w, h, w);
  m.position.y = h / 2;
  m.name = `placeholder:${label}`;
  g.add(m);
  return g;
}
