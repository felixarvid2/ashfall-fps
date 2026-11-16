import type { MainWeaponId, Vec3 } from '../sim/types';

/**
 * Authored level data. One `LevelDef` drives: Rapier static colliders
 * (src/physics), render meshes (src/render/level), enemy navigation footprints
 * (src/sim/enemies) and encounter scripting (src/sim/director).
 *
 * Coordinates in meters, +Y up. Box `pos` is the box CENTER, `size` is full
 * extents. `yaw` rotates about +Y (radians), `pitch` about the box's local +X
 * (used for ramps: a ramp is a thin box pitched so its top surface is walkable).
 */
export type SurfaceMat =
  | 'slag' // slag_ground.webp
  | 'cooling_slag' // cooling_slag.webp, emissive cracks
  | 'grit' // industrial_grit.webp
  | 'concrete'
  | 'metal'
  | 'rust'
  | 'hazard' // yellow/black stripes
  | 'conveyor'
  | 'invisible'; // boundary walls: collide, not rendered

export interface BoxDef {
  id?: string;
  pos: Vec3;
  size: Vec3;
  yaw?: number;
  pitch?: number;
  mat: SurfaceMat;
  /** Shots and LOS are blocked by default; set false for grates/railings. */
  blocksShots?: boolean;
  /** When set, the box is a gate removed after that arena is cleared. */
  gateOpensAfter?: string;
  /** Gate that closes behind the player when the arena's trigger fires. */
  gateClosesOn?: string;
}

export type ColliderProxy =
  | { type: 'box'; size: Vec3; offset?: Vec3 }
  | { type: 'cylinder'; radius: number; height: number; offset?: Vec3 };

export interface PropDef {
  /** Asset id from src/content/assets.ts (e.g. 'prop.fuel_tank'). */
  asset: string;
  pos: Vec3;
  yaw?: number;
  /** Target height in meters (asset is uniformly scaled to it); default: manifest height. */
  height?: number;
  collider?: ColliderProxy | null;
}

export interface LaneDef {
  id: string;
  /** Text for wave cues, e.g. "MAIN GATE", "OUTER LANE". */
  label: string;
  /** Spawn points (enemies appear here, ideally out of direct sight or at long range). */
  spawns: Vec3[];
  /** Waypoints from the spawn into the arena. Enemies follow then switch to direct pursuit. */
  path: Vec3[];
  /** Flying lanes are for drones. */
  air?: boolean;
}

export interface ArenaDef {
  id: string;
  name: string;
  /** Player entering this AABB starts the encounter. */
  trigger: { min: Vec3; max: Vec3 };
  /** Battle area; enemies outside it for > 6 s are teleported to a lane spawn. */
  bounds: { min: Vec3; max: Vec3 };
  lanes: LaneDef[];
  /** Where the supply cache appears after the block clears (draft opens on use). */
  cache: Vec3;
  /** Objective text while the arena is active. */
  objective: string;
}

export type PickupKind = 'ammo_coil' | 'ammo_arc' | 'health' | 'salvage' | 'armor';

export interface PickupDef {
  kind: PickupKind;
  pos: Vec3;
  amount?: number;
  /** Appears only after this arena clears (predictable top-ups between encounters). */
  afterArena?: string;
}

export interface HazardDef {
  id: string;
  kind: 'vent';
  pos: Vec3;
  radius: number;
  /** Cycle: idle → warn (visible/audible) → active (damage) → idle. */
  period: number;
  warn: number;
  active: number;
  offset: number;
  damagePerSec: number;
}

export interface SignDef {
  pos: Vec3;
  yaw: number;
  width: number;
  height: number;
  lines: string[];
  style: 'stencil' | 'warning' | 'scrawl';
}

export interface LevelDef {
  name: string;
  playerStart: { pos: Vec3; yaw: number };
  boxes: BoxDef[];
  props: PropDef[];
  /** Far landmarks: rendered, no collision (The Pillar, crane, silhouettes). */
  landmarks: PropDef[];
  arenas: ArenaDef[];
  pickups: PickupDef[];
  hazards: HazardDef[];
  weaponRack: { pos: Vec3; yaw: number; weapon: MainWeaponId };
  relay: { pos: Vec3; interactRadius: number; shutdownTime: number; arena: string };
  extraction: { pos: Vec3; radius: number };
  radio: { pos: Vec3; lines: { speaker: string; text: string }[] }[];
  signs: SignDef[];
  /** Below this Y the player/enemy is recovered to the last safe point. */
  killY: number;
  /** Soft outer limits of the playable space (also invisible walls in boxes). */
  bounds: { min: Vec3; max: Vec3 };
}
