import type { ObstacleGrid } from './geometry';

/**
 * Coarse ground flow field toward the player (2 m cells, BFS over cells free of
 * ground-level obstacles). Used only when an enemy's straight line is blocked,
 * so long cover (the conveyor housing) is rounded instead of oscillated against.
 */
export class FlowField {
  private readonly cell = 2;
  private ox: number;
  private oz: number;
  private w: number;
  private h: number;
  private free: Uint8Array;
  private dist: Uint16Array;
  private queue: Int32Array;
  private lastCell = -1;
  private nextAt = 0;
  private dirty = true;
  /** Result of `dir`. */
  outX = 0;
  outZ = 0;

  constructor(private og: ObstacleGrid, minX: number, minZ: number, maxX: number, maxZ: number) {
    this.ox = minX;
    this.oz = minZ;
    this.w = Math.ceil((maxX - minX) / this.cell);
    this.h = Math.ceil((maxZ - minZ) / this.cell);
    this.free = new Uint8Array(this.w * this.h);
    this.dist = new Uint16Array(this.w * this.h);
    this.queue = new Int32Array(this.w * this.h);
    this.rebuild();
  }

  markDirty(): void {
    this.dirty = true;
  }

  private rebuild(): void {
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const wx = this.ox + (x + 0.5) * this.cell;
        const wz = this.oz + (z + 0.5) * this.cell;
        this.free[z * this.w + x] = this.og.blocked(wx, wz, 0.75, 0, 1.8) ? 0 : 1;
      }
    }
    this.dirty = false;
    this.lastCell = -1;
  }

  update(px: number, pz: number, time: number): void {
    if (this.dirty) this.rebuild();
    let cx = Math.floor((px - this.ox) / this.cell);
    let cz = Math.floor((pz - this.oz) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return;
    const idx = cz * this.w + cx;
    if (idx === this.lastCell || time < this.nextAt) return;
    this.lastCell = idx;
    this.nextAt = time + 0.35;
    // Seed from the nearest free cell if the player's own cell is blocked.
    if (!this.free[idx]) {
      let found = false;
      for (let r = 1; r <= 4 && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            const x = cx + dx;
            const z = cz + dz;
            if (x < 0 || z < 0 || x >= this.w || z >= this.h || !this.free[z * this.w + x]) continue;
            cx = x;
            cz = z;
            found = true;
          }
        }
      }
      if (!found) return;
    }
    this.dist.fill(0xffff);
    const q = this.queue;
    let head = 0;
    let tail = 0;
    const start = cz * this.w + cx;
    this.dist[start] = 0;
    q[tail++] = start;
    const w = this.w;
    const h = this.h;
    while (head < tail) {
      const cur = q[head++]!;
      const x = cur % w;
      const z = (cur - x) / w;
      const d = this.dist[cur]! + 1;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const ni = nz * w + nx;
          if (!this.free[ni] || this.dist[ni]! <= d) continue;
          if (dx && dz && (!this.free[z * w + nx] || !this.free[nz * w + x])) continue;
          this.dist[ni] = d;
          q[tail++] = ni;
        }
      }
    }
  }

  /** Writes the descent direction at (x,z) into outX/outZ; false if the cell is unreachable. */
  dir(x: number, z: number): boolean {
    const cx = Math.floor((x - this.ox) / this.cell);
    const cz = Math.floor((z - this.oz) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return false;
    let best = this.free[cz * this.w + cx] ? this.dist[cz * this.w + cx]! : 0xfffe;
    let bx = 0;
    let bz = 0;
    let found = false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h) continue;
        const d = this.dist[nz * this.w + nx]!;
        if (d < best) {
          best = d;
          bx = dx;
          bz = dz;
          found = true;
        }
      }
    }
    if (!found) return false;
    const l = Math.hypot(bx, bz);
    this.outX = bx / l;
    this.outZ = bz / l;
    return true;
  }
}
