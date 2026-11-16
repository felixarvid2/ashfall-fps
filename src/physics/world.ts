import RAPIER from '@dimforge/rapier3d-compat';
import type { BoxDef, LevelDef, PropDef } from '../content/levelTypes';
import type { Vec3 } from '../sim/types';
import type { PhysicsQueries, StaticRayHit } from './types';

/** Player capsule dimensions (meters). Position of the player = feet. */
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;

/** Collision roles (membership bits). */
export const GROUP = {
  WORLD: 0x1, // blocks movement, shots and line of sight
  NON_BLOCKING: 0x2, // blocks movement only (grates, railings)
  PLAYER: 0x4,
} as const;

const ALL = 0xffff;
const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

export interface MoveResult {
  pos: Vec3;
  grounded: boolean;
  hitCeiling: boolean;
}

export interface GateInfo {
  key: string;
  box: BoxDef;
  /** Open at start (a "closes on" gate) or closed at start (an "opens after" gate). */
  startsOpen: boolean;
  opensAfter?: string;
  closesOn?: string;
}

let rapierReady: Promise<void> | null = null;
/** Initialise the Rapier wasm module once (browser and Node). */
export function initPhysics(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

function quatYawPitch(yaw: number, pitch: number): { x: number; y: number; z: number; w: number } {
  const hy = yaw / 2;
  const hp = pitch / 2;
  const qy = { x: 0, y: Math.sin(hy), z: 0, w: Math.cos(hy) };
  const qp = { x: Math.sin(hp), y: 0, z: 0, w: Math.cos(hp) };
  // q = qy * qp (pitch about the box's local X, then yaw about world Y)
  return {
    w: qy.w * qp.w - qy.x * qp.x - qy.y * qp.y - qy.z * qp.z,
    x: qy.w * qp.x + qy.x * qp.w + qy.y * qp.z - qy.z * qp.y,
    y: qy.w * qp.y - qy.x * qp.z + qy.y * qp.w + qy.z * qp.x,
    z: qy.w * qp.z + qy.x * qp.y - qy.y * qp.x + qy.z * qp.w,
  };
}

function rotateY(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

export class PhysicsWorld implements PhysicsQueries {
  private world: RAPIER.World;
  private controller: RAPIER.KinematicCharacterController;
  private playerCollider: RAPIER.Collider;
  private gateColliders = new Map<string, RAPIER.Collider[]>();
  private gateOpen = new Map<string, boolean>();
  readonly gates: GateInfo[] = [];
  private disposed = false;
  private ray: RAPIER.Ray;

  private constructor(readonly level: LevelDef) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const r = PLAYER_RADIUS;
    const half = (PLAYER_HEIGHT - 2 * r) / 2;
    const desc = RAPIER.ColliderDesc.capsule(half, r)
      .setTranslation(0, PLAYER_HEIGHT / 2, 0)
      .setCollisionGroups(groups(GROUP.PLAYER, GROUP.WORLD | GROUP.NON_BLOCKING));
    this.playerCollider = this.world.createCollider(desc);
    const cc = this.world.createCharacterController(0.01);
    cc.setUp({ x: 0, y: 1, z: 0 });
    cc.setSlideEnabled(true);
    cc.enableAutostep(0.45, 0.2, false);
    cc.enableSnapToGround(0.35);
    cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    cc.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    cc.setApplyImpulsesToDynamicBodies(false);
    this.controller = cc;
  }

  /** Builds the world. Awaits Rapier init (idempotent). */
  static async create(level: LevelDef): Promise<PhysicsWorld> {
    await initPhysics();
    const pw = new PhysicsWorld(level);
    pw.build(level);
    return pw;
  }

  private build(level: LevelDef): void {
    level.boxes.forEach((box, i) => this.addBox(box, i));
    for (const p of level.props) this.addProp(p);
    this.refresh();
  }

  private addBox(box: BoxDef, index: number): void {
    const membership = box.blocksShots === false ? GROUP.NON_BLOCKING : GROUP.WORLD;
    const desc = RAPIER.ColliderDesc.cuboid(box.size.x / 2, box.size.y / 2, box.size.z / 2)
      .setTranslation(box.pos.x, box.pos.y, box.pos.z)
      .setRotation(quatYawPitch(box.yaw ?? 0, box.pitch ?? 0))
      .setCollisionGroups(groups(membership, ALL))
      .setFriction(0);
    const collider = this.world.createCollider(desc);
    if (box.gateOpensAfter || box.gateClosesOn) {
      const key = box.id ?? `gate${index}`;
      const list = this.gateColliders.get(key) ?? [];
      list.push(collider);
      this.gateColliders.set(key, list);
      const startsOpen = !!box.gateClosesOn && !box.gateOpensAfter;
      if (!this.gates.some((g) => g.key === key)) {
        this.gates.push({ key, box, startsOpen, opensAfter: box.gateOpensAfter, closesOn: box.gateClosesOn });
      }
      this.gateOpen.set(key, startsOpen);
      collider.setEnabled(!startsOpen);
    }
  }

  private addProp(p: PropDef): void {
    const c = p.collider;
    if (!c) return;
    const yaw = p.yaw ?? 0;
    let desc: RAPIER.ColliderDesc;
    let off: Vec3;
    if (c.type === 'box') {
      off = c.offset ?? { x: 0, y: c.size.y / 2, z: 0 };
      desc = RAPIER.ColliderDesc.cuboid(c.size.x / 2, c.size.y / 2, c.size.z / 2);
    } else {
      off = c.offset ?? { x: 0, y: c.height / 2, z: 0 };
      desc = RAPIER.ColliderDesc.cylinder(c.height / 2, c.radius);
    }
    const o = rotateY(off, yaw);
    desc
      .setTranslation(p.pos.x + o.x, p.pos.y + o.y, p.pos.z + o.z)
      .setRotation(quatYawPitch(yaw, 0))
      .setCollisionGroups(groups(GROUP.WORLD, ALL))
      .setFriction(0);
    this.world.createCollider(desc);
  }

  /** Re-syncs the broad phase after colliders were added/enabled/disabled. */
  private refresh(): void {
    this.world.step();
  }

  // -- gates ---------------------------------------------------------------

  setGateOpen(key: string, open: boolean): void {
    const list = this.gateColliders.get(key);
    if (!list || this.gateOpen.get(key) === open) return;
    this.gateOpen.set(key, open);
    for (const c of list) c.setEnabled(!open);
    this.refresh();
  }

  isGateOpen(key: string): boolean {
    return this.gateOpen.get(key) ?? true;
  }

  gateStates(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const [k, v] of this.gateOpen) out[k] = v;
    return out;
  }

  // -- queries -------------------------------------------------------------

  raycast(origin: Vec3, dir: Vec3, maxDist: number, opts?: { includeNonBlocking?: boolean }): StaticRayHit | null {
    if (maxDist <= 0) return null;
    this.ray.origin = origin;
    this.ray.dir = dir;
    const filter = opts?.includeNonBlocking ? GROUP.WORLD | GROUP.NON_BLOCKING : GROUP.WORLD;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, groups(ALL, filter));
    if (!hit) return null;
    const t = hit.timeOfImpact;
    let n = hit.normal;
    // Ray started inside a solid: report a normal facing the ray.
    if (t === 0 && n.x === 0 && n.y === 0 && n.z === 0) n = { x: -dir.x, y: -dir.y, z: -dir.z };
    return {
      dist: t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      normal: { x: n.x, y: n.y, z: n.z },
    };
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
    const top = fromY + 0.6;
    this.ray.origin = { x, y: top, z };
    this.ray.dir = { x: 0, y: -1, z: 0 };
    const hit = this.world.castRay(this.ray, top - this.level.killY + 5, true, undefined, groups(ALL, GROUP.WORLD | GROUP.NON_BLOCKING));
    if (!hit) return null;
    return top - hit.timeOfImpact;
  }

  // -- player capsule ------------------------------------------------------

  /**
   * Moves the player capsule (feet position) by `desired` with sliding, auto-step
   * and slope handling. `snap` enables snap-to-ground (disable while jumping up).
   */
  moveCharacter(feet: Vec3, desired: Vec3, snap = true): MoveResult {
    const c = this.playerCollider;
    c.setTranslation({ x: feet.x, y: feet.y + PLAYER_HEIGHT / 2, z: feet.z });
    if (snap) this.controller.enableSnapToGround(0.35);
    else this.controller.disableSnapToGround();
    this.controller.computeColliderMovement(c, desired, undefined, groups(GROUP.PLAYER, GROUP.WORLD | GROUP.NON_BLOCKING));
    const m = this.controller.computedMovement();
    let hitCeiling = false;
    if (desired.y > 1e-6 && m.y < desired.y - 1e-4) hitCeiling = true;
    return {
      pos: { x: feet.x + m.x, y: feet.y + m.y, z: feet.z + m.z },
      grounded: this.controller.computedGrounded(),
      hitCeiling,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.removeCharacterController(this.controller);
    this.world.free();
    this.gateColliders.clear();
  }
}
