import type { EnemyKind } from '../sim/types';

/**
 * Enemy profiles. All tuning numbers live here (meters, seconds, m/s, hp).
 * `pos` of every enemy is its model base; drones hover with `hoverMin..hoverMax`
 * meters between the ground and their base.
 */

interface BaseProfile {
  kind: EnemyKind;
  name: string;
  hp: number;
  /** Footprint radius (steering + capsule ray radius). */
  radius: number;
  /** Capsule height (base to top). */
  height: number;
  heavy: boolean;
  /** Fraction of push impulse applied (0 = immune). */
  pushResist: number;
  /** Director budget cost. */
  cost: number;
  /** Salvage-style score weight (informational). */
  threat: number;
  /** Seconds the spawn-in state lasts. */
  spawnTime: number;
}

export interface WalkerProfile extends BaseProfile {
  kind: 'walker';
  walkSpeed: number;
  chargeSpeed: number;
  /** Starts a wind-up when within this distance of the player. */
  attackRange: number;
  windup: number;
  /** Duration of the swing itself. */
  swing: number;
  /** Damage reach measured at release (center to center). */
  reach: number;
  damage: number;
  recover: number;
}

export interface HoundProfile extends BaseProfile {
  kind: 'hound';
  runSpeed: number;
  /** Starts circling when closer than this. */
  flankRange: number;
  flankRadius: [number, number];
  flankTime: [number, number];
  /** Crouch before the lunge. */
  windup: number;
  lungeSpeed: number;
  lungeTime: number;
  lungeReach: number;
  damage: number;
  recover: number;
}

export interface DroneProfile extends BaseProfile {
  kind: 'drone';
  speed: number;
  hoverMin: number;
  hoverMax: number;
  keepMin: number;
  keepMax: number;
  /** Seconds between attacks (after the recovery gap). */
  cooldown: [number, number];
  fireball: { windup: number; speed: number; damage: number; radius: number; life: number; lead: number };
  flame: { windup: number; duration: number; range: number; arcDeg: number; hitHalfArcDeg: number; damage: number };
  /** Gap after an attack during which the drone only repositions. */
  recover: number;
}

export interface LoaderProfile extends BaseProfile {
  kind: 'loader';
  walkSpeed: number;
  /** Delay after a recovery before the next attack may start. */
  attackDelay: number;
  sweep: { range: number; windup: number; duration: number; arcDeg: number; hitHalfArcDeg: number; damage: number; recover: number };
  slam: { range: number; windup: number; duration: number; radius: number; damage: number; recover: number; leadDist: number };
  call: { windup: number; recover: number; thresholds: number[]; adds: number[] };
  /** Damage multiplier while the joint is exposed. */
  jointMul: number;
}

export const WALKER: WalkerProfile = {
  kind: 'walker',
  name: 'Scorched Walker',
  hp: 60,
  radius: 0.45,
  height: 1.8,
  heavy: false,
  pushResist: 1,
  cost: 1,
  threat: 1,
  spawnTime: 0.5,
  walkSpeed: 2.1,
  chargeSpeed: 4.4,
  attackRange: 2.0,
  windup: 0.6,
  swing: 0.15,
  reach: 2.5,
  damage: 12,
  recover: 0.9,
};

export const HOUND: HoundProfile = {
  kind: 'hound',
  name: 'Slag Hound',
  hp: 40,
  radius: 0.5,
  height: 1.0,
  heavy: false,
  pushResist: 0.7,
  cost: 2,
  threat: 2,
  spawnTime: 0.4,
  runSpeed: 7.5,
  flankRange: 20,
  flankRadius: [8, 12],
  flankTime: [1.0, 1.9],
  windup: 0.5,
  lungeSpeed: 16,
  lungeTime: 0.45,
  lungeReach: 1.7,
  damage: 14,
  recover: 0.9,
};

export const DRONE: DroneProfile = {
  kind: 'drone',
  name: 'Flame Drone',
  hp: 50,
  radius: 0.6,
  height: 1.0,
  heavy: false,
  pushResist: 0.4,
  cost: 3,
  threat: 3,
  spawnTime: 0.5,
  speed: 5.5,
  hoverMin: 3,
  hoverMax: 5,
  keepMin: 9,
  keepMax: 15,
  cooldown: [2.4, 4.2],
  fireball: { windup: 0.8, speed: 14, damage: 14, radius: 0.7, life: 4, lead: 1 },
  flame: { windup: 0.9, duration: 0.7, range: 12, arcDeg: 70, hitHalfArcDeg: 12, damage: 16 },
  recover: 1.5,
};

export const LOADER: LoaderProfile = {
  kind: 'loader',
  name: 'Cargo Loader',
  hp: 2200,
  radius: 1.5,
  height: 3.2,
  heavy: true,
  pushResist: 0,
  cost: 20,
  threat: 20,
  spawnTime: 1.2,
  walkSpeed: 2.3,
  attackDelay: 0.8,
  sweep: { range: 8, windup: 1.0, duration: 0.55, arcDeg: 110, hitHalfArcDeg: 16, damage: 30, recover: 2.4 },
  slam: { range: 12, windup: 1.3, duration: 0.3, radius: 5, damage: 38, recover: 2.8, leadDist: 4.5 },
  call: { windup: 1.4, recover: 1.6, thresholds: [0.66, 0.33], adds: [6, 8] },
  jointMul: 2,
};

export const ENEMIES = { walker: WALKER, hound: HOUND, drone: DRONE, loader: LOADER } as const;

export type AnyEnemyProfile = (typeof ENEMIES)[EnemyKind];

export function enemyCost(kind: EnemyKind): number {
  return ENEMIES[kind].cost;
}

/** Seconds a corpse stays before it is recycled. */
export const CORPSE_TIME = 2.5;
/** Corpse fade starts after this many seconds. */
export const CORPSE_FADE_START = 1.4;
/** Seconds outside the arena before an enemy is teleported back to a lane spawn. */
export const OUT_OF_BOUNDS_TIME = 6;
