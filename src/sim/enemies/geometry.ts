import type { BoxDef, LevelDef, PropDef } from '../../content/levelTypes';

/** 2D footprint of a static obstacle (box OBB or cylinder) with a vertical extent. */
export interface Obstacle {
  circle: boolean;
  cx: number;
  cz: number;
  /** Half extent along local X (radius for circles). */
  hx: number;
  hz: number;
  c: number;
  s: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  yMin: number;
  yMax: number;
  /** Box id when this is a gate. */
  gateId: string | null;
  gateArena: string | null;
  active: boolean;
  stamp: number;
}

export interface Ramp {
  lowX: number;
  lowY: number;
  lowZ: number;
  highX: number;
  highY: number;
  highZ: number;
}

function mk(circle: boolean, cx: number, cz: number, hx: number, hz: number, yaw: number, yMin: number, yMax: number): Obstacle {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const ex = circle ? hx : Math.abs(c) * hx + Math.abs(s) * hz;
  const ez = circle ? hx : Math.abs(s) * hx + Math.abs(c) * hz;
  return {
    circle, cx, cz, hx, hz, c, s,
    minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez,
    yMin, yMax, gateId: null, gateArena: null, active: true, stamp: 0,
  };
}

export function boxObstacle(b: BoxDef): Obstacle | null {
  if (b.pitch && Math.abs(b.pitch) > 1e-4) return null; // ramps are walkable
  if (b.id && b.id.startsWith('ramp')) return null;
  const yMax = b.pos.y + b.size.y / 2;
  const yMin = b.pos.y - b.size.y / 2;
  if (yMax <= 0.5) return null; // floors and decals
  const o = mk(false, b.pos.x, b.pos.z, b.size.x / 2, b.size.z / 2, b.yaw ?? 0, yMin, yMax);
  if (b.gateOpensAfter) {
    o.gateId = b.id ?? null;
    o.gateArena = b.gateOpensAfter;
  }
  return o;
}

export function propObstacle(p: PropDef): Obstacle | null {
  const col = p.collider;
  if (!col) return null;
  const ox = col.offset?.x ?? 0;
  const oy = col.offset?.y ?? 0;
  const oz = col.offset?.z ?? 0;
  const yaw = p.yaw ?? 0;
  // Rotate the offset by yaw (Three.js rotation about +Y).
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const wx = p.pos.x + ox * c + oz * s;
  const wz = p.pos.z - ox * s + oz * c;
  if (col.type === 'cylinder') {
    return mk(true, wx, wz, col.radius, col.radius, 0, p.pos.y + oy - col.height / 2, p.pos.y + oy + col.height / 2);
  }
  return mk(false, wx, wz, col.size.x / 2, col.size.z / 2, yaw, p.pos.y + oy - col.size.y / 2, p.pos.y + oy + col.size.y / 2);
}

export function buildObstacles(level: LevelDef): Obstacle[] {
  const out: Obstacle[] = [];
  for (const b of level.boxes) {
    const o = boxObstacle(b);
    if (o) out.push(o);
  }
  for (const p of level.props) {
    const o = propObstacle(p);
    if (o) out.push(o);
  }
  return out;
}

export function buildRamps(level: LevelDef): Ramp[] {
  const out: Ramp[] = [];
  for (const b of level.boxes) {
    if (!b.id || !b.id.startsWith('ramp') || !b.pitch) continue;
    const yaw = b.yaw ?? 0;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const half = b.size.z / 2;
    const ax = b.pos.x + fx * half * Math.cos(b.pitch);
    const az = b.pos.z + fz * half * Math.cos(b.pitch);
    const ay = b.pos.y + Math.sin(b.pitch) * half;
    const bx = b.pos.x - fx * half * Math.cos(b.pitch);
    const bz = b.pos.z - fz * half * Math.cos(b.pitch);
    const by = b.pos.y - Math.sin(b.pitch) * half;
    if (ay >= by) out.push({ highX: ax, highY: ay, highZ: az, lowX: bx, lowY: by, lowZ: bz });
    else out.push({ highX: bx, highY: by, highZ: bz, lowX: ax, lowY: ay, lowZ: az });
  }
  return out;
}

/** Uniform grid over obstacles (cell = 8 m). */
export class ObstacleGrid {
  readonly cell = 8;
  private ox: number;
  private oz: number;
  private w: number;
  private h: number;
  private cells: number[][];
  readonly list: Obstacle[];
  private stamp = 1;
  // scratch push-out result
  pushX = 0;
  pushZ = 0;

  constructor(list: Obstacle[], minX: number, minZ: number, maxX: number, maxZ: number) {
    this.list = list;
    this.ox = minX - 1;
    this.oz = minZ - 1;
    this.w = Math.ceil((maxX - minX + 2) / this.cell) + 1;
    this.h = Math.ceil((maxZ - minZ + 2) / this.cell) + 1;
    this.cells = Array.from({ length: this.w * this.h }, () => []);
    list.forEach((o, i) => {
      const x0 = this.cx(o.minX);
      const x1 = this.cx(o.maxX);
      const z0 = this.cz(o.minZ);
      const z1 = this.cz(o.maxZ);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.cells[z * this.w + x]!.push(i);
    });
  }

  private cx(x: number): number {
    const v = Math.floor((x - this.ox) / this.cell);
    return v < 0 ? 0 : v >= this.w ? this.w - 1 : v;
  }
  private cz(z: number): number {
    const v = Math.floor((z - this.oz) / this.cell);
    return v < 0 ? 0 : v >= this.h ? this.h - 1 : v;
  }

  /** Circle (x,z,r) at vertical span [y, y+h] vs obstacle; sets pushX/pushZ. */
  overlap(o: Obstacle, x: number, z: number, r: number): boolean {
    if (o.circle) {
      const dx = x - o.cx;
      const dz = z - o.cz;
      const rr = r + o.hx;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return false;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        this.pushX = rr;
        this.pushZ = 0;
      } else {
        this.pushX = (dx / d) * (rr - d);
        this.pushZ = (dz / d) * (rr - d);
      }
      return true;
    }
    if (x + r < o.minX || x - r > o.maxX || z + r < o.minZ || z - r > o.maxZ) return false;
    const dx = x - o.cx;
    const dz = z - o.cz;
    const lx = dx * o.c - dz * o.s;
    const lz = dx * o.s + dz * o.c;
    const clx = lx < -o.hx ? -o.hx : lx > o.hx ? o.hx : lx;
    const clz = lz < -o.hz ? -o.hz : lz > o.hz ? o.hz : lz;
    const ddx = lx - clx;
    const ddz = lz - clz;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 >= r * r) return false;
    let px: number;
    let pz: number;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      px = (ddx / d) * (r - d);
      pz = (ddz / d) * (r - d);
    } else {
      // Center inside the box: push out through the nearest face.
      const penX = o.hx - Math.abs(lx);
      const penZ = o.hz - Math.abs(lz);
      if (penX < penZ) {
        px = (lx >= 0 ? 1 : -1) * (penX + r);
        pz = 0;
      } else {
        px = 0;
        pz = (lz >= 0 ? 1 : -1) * (penZ + r);
      }
    }
    // local -> world (inverse of the transform above)
    this.pushX = px * o.c + pz * o.s;
    this.pushZ = -px * o.s + pz * o.c;
    return true;
  }

  /** True if the circle at (x,z) collides with an active obstacle spanning the given height window. */
  blocked(x: number, z: number, r: number, y: number, h: number): boolean {
    const x0 = this.cx(x - r);
    const x1 = this.cx(x + r);
    const z0 = this.cz(z - r);
    const z1 = this.cz(z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cz * this.w + cx]!;
        for (let k = 0; k < cell.length; k++) {
          const o = this.list[cell[k]!]!;
          if (!o.active || o.yMax <= y + 1.0 || o.yMin >= y + h) continue;
          if (this.overlap(o, x, z, r)) return true;
        }
      }
    }
    return false;
  }

  /** Pushes (pos) out of all obstacles; returns accumulated displacement via outX/outZ. */
  outX = 0;
  outZ = 0;
  resolve(x: number, z: number, r: number, y: number, h: number): boolean {
    let hit = false;
    this.outX = x;
    this.outZ = z;
    for (let pass = 0; pass < 2; pass++) {
      const st = ++this.stamp;
      const x0 = this.cx(this.outX - r);
      const x1 = this.cx(this.outX + r);
      const z0 = this.cz(this.outZ - r);
      const z1 = this.cz(this.outZ + r);
      let moved = false;
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const cell = this.cells[cz * this.w + cx]!;
          for (let k = 0; k < cell.length; k++) {
            const o = this.list[cell[k]!]!;
            if (o.stamp === st || !o.active) continue;
            o.stamp = st;
            if (o.yMax <= y + 1.0 || o.yMin >= y + h) continue;
            if (this.overlap(o, this.outX, this.outZ, r)) {
              this.outX += this.pushX;
              this.outZ += this.pushZ;
              moved = true;
              hit = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return hit;
  }
}

/**
 * Ray vs vertical capsule (axis from y0 to y1, radius r) around (cx, cz).
 * Returns the entry distance t in [0, maxT] or -1 when missed.
 */
export function rayVerticalCapsule(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cz: number, ya: number, yb: number, r: number, maxT: number,
): number {
  let best = Infinity;
  const rx = ox - cx;
  const rz = oz - cz;
  // Cylinder body.
  const a = dx * dx + dz * dz;
  const c = rx * rx + rz * rz - r * r;
  if (a > 1e-9) {
    const b = rx * dx + rz * dz;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / a;
      if (c <= 0) t = 0; // origin inside the infinite cylinder
      if (t >= 0 && t <= maxT) {
        const y = oy + dy * t;
        if (y >= ya && y <= yb) best = t;
      }
    }
  } else if (c <= 0 && oy >= ya && oy <= yb) {
    return 0;
  }
  // End spheres.
  for (let k = 0; k < 2; k++) {
    const cy = k === 0 ? ya : yb;
    const sy = oy - cy;
    const b = rx * dx + sy * dy + rz * dz;
    const cc = rx * rx + sy * sy + rz * rz - r * r;
    if (cc <= 0) {
      best = 0;
      continue;
    }
    const disc = b * b - cc;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t <= maxT && t < best) best = t;
  }
  return best === Infinity ? -1 : best;
}
