import type { Vec3 } from '../sim/types';

export interface StaticRayHit {
  dist: number;
  point: Vec3;
  normal: Vec3;
}

/** Static-world queries shared by weapons, enemies and cards. */
export interface PhysicsQueries {
  /** Static world only (boxes, prop proxies, closed gates). `dir` must be normalized. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, opts?: { includeNonBlocking?: boolean }): StaticRayHit | null;
  lineOfSight(a: Vec3, b: Vec3): boolean;
  /** Highest walkable surface at (x, z) at or below `fromY` (+0.6 step), or null. */
  groundHeight(x: number, z: number, fromY: number): number | null;
}
