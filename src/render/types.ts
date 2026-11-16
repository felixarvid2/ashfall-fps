import type { EnemyKind, EnemyState, Vec3, WeaponId } from '../sim/types';

/**
 * Camera-space muzzle offsets (meters; +X right, +Y up, -Z forward) for the
 * held weapons at rest. The simulation uses these to place tracer origins and
 * to reconcile muzzle obstruction; the renderer places each viewmodel so its
 * `Muzzle` anchor lands here.
 */
export const MUZZLE_OFFSET: Record<WeaponId, Vec3> = {
  coil_carbine: { x: 0.2, y: -0.16, z: -0.78 },
  arc_scattergun: { x: 0.22, y: -0.19, z: -0.72 },
  service_emitter: { x: 0.19, y: -0.14, z: -0.76 },
};

export interface ViewmodelState {
  weapon: WeaponId;
  /** 0 = lowered/holstered, 1 = fully raised (equip/swap animation). */
  raise: number;
  /** Reload progress 0..1, or null. */
  reload: number | null;
  /** Recoil kick 0..1 (decays in sim). */
  kick: number;
  /** Seconds since last shot (muzzle flash / cycling motion). */
  sinceShot: number;
  /** Horizontal speed 0..1 of max, grounded flag (bob/sway). */
  speed: number;
  grounded: boolean;
  /** Mouse look delta this frame in radians (sway). */
  lookDX: number;
  lookDY: number;
  /** Arc scattergun: Cold Chamber slug primed (emissive hint). */
  slugReady: boolean;
  /** Service emitter charge 0..1 (wrist glow). */
  charge: number;
  dashing: boolean;
}

export interface EnemyRenderState {
  id: number;
  kind: EnemyKind;
  pos: Vec3;
  yaw: number;
  state: EnemyState;
  /** Seconds in current state. */
  stateTime: number;
  /** Duration of the current state if known (windups/recover), else 0. */
  stateDuration: number;
  hpFrac: number;
  ionized: boolean;
  /** Seconds since last hit (flash/flinch). */
  sinceHit: number;
  /** 0..1 corpse fade (only for state === 'dead'). */
  fade: number;
  /** Cargo Loader extras. */
  loader?: { attack: 'sweep' | 'slam' | 'call' | null; jointExposed: boolean; clawYaw: number };
}

export interface PickupRenderState {
  id: number;
  kind: string; // 'ammo_coil' | 'ammo_arc' | 'health' | 'salvage' | 'armor' | 'weapon_arc_scattergun' | ...
  pos: Vec3;
}

export interface RenderFrame {
  time: number;
  camera: { pos: Vec3; yaw: number; pitch: number; roll: number; fov: number; shake: number };
  viewmodel: ViewmodelState;
  enemies: EnemyRenderState[];
  pickups: PickupRenderState[];
  hazards: { id: string; phase: 'idle' | 'warn' | 'active'; t: number }[];
  caches: { arena: string; pos: Vec3; open: boolean; available: boolean }[];
  rackHasWeapon: boolean;
  relay: { progress: number; active: boolean; done: boolean };
  extractionActive: boolean;
  gatesOpen: Record<string, boolean>;
  projectiles: ProjectileRenderState[];
  /** Screen flash 0..1 (damage) and color. */
  flash: { amount: number; color: number };
}

export interface ProjectileRenderState {
  id: number;
  kind: 'fireball';
  pos: Vec3;
  vel: Vec3;
}

export interface RenderFrameExtras {
  projectiles: ProjectileRenderState[];
}
