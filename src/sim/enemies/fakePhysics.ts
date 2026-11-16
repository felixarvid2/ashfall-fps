import type { LevelDef } from '../../content/levelTypes';
import type { PhysicsQueries, StaticRayHit } from '../../physics/types';
import type { Vec3 } from '../types';

interface FBox {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  cy0: number; sy0: number; // cos/sin yaw
  cp: number; sp: number; // cos/sin pitch
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
  blocksShots: boolean;
  gate: string | null;
}

/**
 * Simple PhysicsQueries over the level's boxes (and prop collider proxies as
 * boxes): analytic oriented-box ray tests. Good enough for unit tests and
 * headless profiling; the real game uses Rapier.
 */
export class FakePhysics implements PhysicsQueries {
  private boxes: FBox[] = [];
  private open = new Set<string>();
  raycasts = 0;

  constructor(level: LevelDef) {
    for (const b of level.boxes) {
      const yaw = b.yaw ?? 0;
      const pitch = b.pitch ?? 0;
      this.add(b.pos, b.size, yaw, pitch, b.blocksShots !== false, b.gateOpensAfter ?? null);
    }
    for (const p of level.props) {
      const col = p.collider;
      if (!col) continue;
      const off = col.offset ?? { x: 0, y: 0, z: 0 };
      const size = col.type === 'box' ? col.size : { x: col.radius * 2, y: col.height, z: col.radius * 2 };
      const yaw = col.type === 'box' ? (p.yaw ?? 0) : 0;
      this.add({ x: p.pos.x + off.x, y: p.pos.y + off.y, z: p.pos.z + off.z }, size, yaw, 0, true, null);
    }
  }

  private add(pos: Vec3, size: Vec3, yaw: number, pitch: number, blocks: boolean, gate: string | null): void {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const ex = Math.abs(Math.cos(yaw)) * hx + Math.abs(Math.sin(yaw)) * (Math.abs(Math.cos(pitch)) * hz + Math.abs(Math.sin(pitch)) * hy);
    const ez = Math.abs(Math.sin(yaw)) * hx + Math.abs(Math.cos(yaw)) * (Math.abs(Math.cos(pitch)) * hz + Math.abs(Math.sin(pitch)) * hy);
    const ey = Math.abs(Math.cos(pitch)) * hy + Math.abs(Math.sin(pitch)) * hz;
    this.boxes.push({
      cx: pos.x, cy: pos.y, cz: pos.z, hx, hy, hz,
      cy0: Math.cos(yaw), sy0: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch),
      minX: pos.x - ex, maxX: pos.x + ex, minY: pos.y - ey, maxY: pos.y + ey, minZ: pos.z - ez, maxZ: pos.z + ez,
      blocksShots: blocks, gate,
    });
  }

  setGateOpen(arena: string, open: boolean): void {
    if (open) this.open.add(arena);
    else this.open.delete(arena);
  }

  /** Ray vs one box; returns entry t (>=0) or -1. Writes normal into nrm. Origin inside returns -2. */
  private hit(b: FBox, o: Vec3, dx: number, dy: number, dz: number, maxT: number, nrm: Vec3 | null): number {
    // broad phase: segment AABB
    const ex = o.x + dx * maxT;
    const ey = o.y + dy * maxT;
    const ez = o.z + dz * maxT;
    if (Math.max(o.x, ex) < b.minX || Math.min(o.x, ex) > b.maxX) return -1;
    if (Math.max(o.y, ey) < b.minY || Math.min(o.y, ey) > b.maxY) return -1;
    if (Math.max(o.z, ez) < b.minZ || Math.min(o.z, ez) > b.maxZ) return -1;
    // to local: inverse yaw then inverse pitch
    const px = o.x - b.cx;
    const py = o.y - b.cy;
    const pz = o.z - b.cz;
    let lx = px * b.cy0 - pz * b.sy0;
    let lz = px * b.sy0 + pz * b.cy0;
    let ly = py;
    let ly2 = ly * b.cp + lz * b.sp;
    let lz2 = -ly * b.sp + lz * b.cp;
    ly = ly2;
    lz = lz2;
    let ldx = dx * b.cy0 - dz * b.sy0;
    let ldz = dx * b.sy0 + dz * b.cy0;
    let ldy = dy;
    ly2 = ldy * b.cp + ldz * b.sp;
    lz2 = -ldy * b.sp + ldz * b.cp;
    ldy = ly2;
    ldz = lz2;
    let t0 = 0;
    let t1 = maxT;
    let ax = -1;
    let sgn = 0;
    const o3 = [lx, ly, lz];
    const d3 = [ldx, ldy, ldz];
    const h3 = [b.hx, b.hy, b.hz];
    let inside = true;
    for (let i = 0; i < 3; i++) {
      const oi = o3[i]!;
      const di = d3[i]!;
      const hi = h3[i]!;
      if (Math.abs(di) < 1e-12) {
        if (oi < -hi || oi > hi) return -1;
        continue;
      }
      let ta = (-hi - oi) / di;
      let tb = (hi - oi) / di;
      let s = -1;
      if (ta > tb) {
        const tmp = ta;
        ta = tb;
        tb = tmp;
        s = 1;
      }
      if (ta > t0) {
        t0 = ta;
        ax = i;
        sgn = s;
        inside = false;
      }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    void inside;
    void lx;
    void ldx;
    if (ax < 0) return -2; // started inside
    if (nrm) {
      const n = [0, 0, 0];
      n[ax] = sgn;
      // local normal -> world: pitch then yaw
      const ny = n[1]! * b.cp - n[2]! * b.sp;
      const nz = n[1]! * b.sp + n[2]! * b.cp;
      nrm.x = n[0]! * b.cy0 + nz * b.sy0;
      nrm.y = ny;
      nrm.z = -n[0]! * b.sy0 + nz * b.cy0;
    }
    lx = 0;
    ldx = 0;
    ldz = 0;
    return t0;
  }

  raycast(origin: Vec3, dir: Vec3, maxDist: number, opts?: { includeNonBlocking?: boolean }): StaticRayHit | null {
    this.raycasts++;
    let best = Infinity;
    let bn: Vec3 = { x: 0, y: 1, z: 0 };
    const n: Vec3 = { x: 0, y: 0, z: 0 };
    for (const b of this.boxes) {
      if (b.gate && this.open.has(b.gate)) continue;
      if (!b.blocksShots && !opts?.includeNonBlocking) continue;
      const t = this.hit(b, origin, dir.x, dir.y, dir.z, Math.min(maxDist, best), n);
      if (t >= 0 && t < best) {
        best = t;
        bn = { x: n.x, y: n.y, z: n.z };
      }
    }
    if (best === Infinity) return null;
    return { dist: best, point: { x: origin.x + dir.x * best, y: origin.y + dir.y * best, z: origin.z + dir.z * best }, normal: bn };
  }

  lineOfSight(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    return this.raycast(a, { x: dx / d, y: dy / d, z: dz / d }, d - 0.02) === null;
  }

  groundHeight(x: number, z: number, fromY: number): number | null {
    const o = { x, y: fromY + 0.6, z };
    let best: number | null = null;
    let bestT = Infinity;
    for (const b of this.boxes) {
      if (b.gate && this.open.has(b.gate)) continue;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || o.y < b.minY) continue;
      const t = this.hit(b, o, 0, -1, 0, 400, null);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = o.y - t;
      }
    }
    return best;
  }
}
