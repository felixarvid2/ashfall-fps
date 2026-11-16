/**
 * Shared simulation contracts for ASHFALL: SLAGWIRE.
 *
 * Everything under src/sim, src/content and src/core is plain TypeScript with
 * no Three.js scene objects and no DOM access. Render, audio and UI read the
 * simulation through `RunSnapshot`-style state and the `GameEvent` queue.
 *
 * World units are meters, +Y is up. Yaw 0 looks down -Z (Three.js default),
 * positive yaw turns left (counter-clockwise seen from above).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type MainWeaponId = 'coil_carbine' | 'arc_scattergun';
export type WeaponId = MainWeaponId | 'service_emitter';
export type AmmoType = 'coil_cells' | 'arc_charges';

export type FireModel = 'hitscan' | 'pellets';

export interface RecoilDef {
  /** Camera kick per shot, degrees. */
  pitch: number;
  yawJitter: number;
  /** Seconds to recover 1/e of the kick. */
  recover: number;
  /** Viewmodel kick back in meters. */
  kickBack: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: 'main' | 'backup';
  fireModel: FireModel;
  automatic: boolean;
  /** null for the rechargeable Service Emitter. */
  ammo: AmmoType | null;
  /** Damage of a complete trigger pull (all pellets summed for pellet weapons). */
  damage: number;
  pellets: number;
  /** Full cone angle in degrees. */
  spreadDeg: number;
  /** Damage is full up to this range... */
  rangeEffective: number;
  /** ...and falls linearly to `falloffMinMul` at this range; nothing beyond. */
  rangeMax: number;
  falloffMinMul: number;
  /** Seconds between trigger pulls at base fire rate. */
  fireInterval: number;
  capacity: number;
  reloadTime: number;
  reserveMax: number;
  startReserve: number;
  equipTime: number;
  /** Emitter only: charge regen per second and capacity. */
  rechargePerSec?: number;
  recoil: RecoilDef;
  /** Card/mod sockets (informational; cards are global in the first slice). */
  sockets: number;
  audio: { fire: string; reload: string; empty: string; impact: string; equip: string };
  fx: { tracerColor: number; flashColor: number; tracerWidth: number; tracerLife: number };
}

/** Derived per-weapon stats after cards. Produced by the card engine. */
export interface WeaponStats {
  id: WeaponId;
  damage: number;
  /** Additive damage bonus already folded into `damage`; kept for previews. */
  damageBonus: number;
  pellets: number;
  spreadDeg: number;
  fireInterval: number;
  reloadTime: number;
  capacity: number;
  rangeEffective: number;
  rangeMax: number;
  falloffMinMul: number;
  /** Mass Driver style pierce count (0 = stops at first enemy). */
  pierce: number;
  pierceDamageMul: number;
  /** false when surrendered by a pact. */
  active: boolean;
}

export interface PlayerStats {
  maxHealth: number;
  dashCooldown: number;
  pickupAmmoMul: number;
  moveSpeed: number;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type CardScope = 'both_mains' | 'ammo' | 'player' | 'pact' | 'coil_pact' | 'arc_pact';

export type StatKey =
  | 'damageBonus' // additive, +0.10 per rank
  | 'reloadSpeed' // additive, reload = base / (1 + sum), floored
  | 'capacityBonus' // additive, capacity = ceil(base * (1 + sum))
  | 'fireRate' // additive, interval = base / (1 + sum), floored
  | 'pickupAmmo' // additive multiplier on ammo pickups
  | 'maxHealth' // flat
  | 'dashCooldown' // additive reduction, cooldown = base * (1 - sum), floored
  | 'pellets' // flat
  | 'spread' // additive multiplier on spread
  | 'pierce'; // flat

export interface StatModifier {
  stat: StatKey;
  /** Per rank. */
  value: number;
  /** Which weapons the modifier applies to; omitted for player/global stats. */
  weapons?: MainWeaponId[];
}

export type TriggerKind =
  | 'chargeback' // direct kill refunds ammo
  | 'ion_primer' // direct hits apply Ionized
  | 'breaker_fuse' // direct kill on pre-Ionized target bursts
  | 'cascade_bus' // every Nth coil shot arcs
  | 'rupture_relay' // cascade arc chains to a third target if first recipient Ionized
  | 'ground_loop' // moving coil kill moves reserve to magazine
  | 'repulsion_chamber' // arc pellets push light enemies
  | 'cold_chamber' // first pull after reload fires a piercing slug
  | 'backwash' // a shot that damages >= N enemies emits stagger cone
  | 'mass_driver' // pierce damage multiplier marker
  | 'on_pick' // one-shot effect applied when picked (e.g. heal)
  | 'pact'; // weapon pact commitment marker

export interface TriggeredEffect {
  kind: TriggerKind;
  /** Free-form numeric parameters read by both preview text and runtime. */
  params: Record<string, number>;
}

export interface CardDef {
  id: string;
  name: string;
  rarity: Rarity;
  scope: CardScope;
  maxRank: number;
  /** Card ids that must be owned (rank >= 1). */
  requires: string[];
  /** Weapon whose pact must be active for the card to be eligible. */
  requiresPact?: MainWeaponId;
  /** Pact cards: the weapon pledged. */
  pactWeapon?: MainWeaponId;
  modifiers: StatModifier[];
  effects: TriggeredEffect[];
  /** Short rules text with {param} placeholders filled from the first effect / modifiers. */
  text: string;
  drawback?: string;
  /** Grouping for the inspection panel. */
  group: 'damage' | 'handling' | 'ammo' | 'survival' | 'mobility' | 'proc' | 'pact';
  /** Weapon cards count toward the ~2/3 weapon-offer target. */
  affectsWeapons: boolean;
}

export type SupplyKind = 'supply_ammo' | 'supply_health' | 'supply_salvage';

export interface DraftOption {
  /** Card id, or a supply filler. */
  kind: 'card' | 'supply';
  id: string;
  /** Rank the player would reach (cards only). */
  nextRank?: number;
}

export interface DraftOffer {
  /** Monotonic id; a pick must quote the offer id it was made against. */
  offerId: number;
  rewardIndex: number;
  options: DraftOption[];
  rerollsLeft: number;
  rerollCost: number;
  skipSalvage: number;
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

export type DamageOrigin =
  | 'direct' // weapon trigger pull (hitscan / pellet / slug)
  | 'emitter' // Service Emitter, counts as direct for its own shot but no card procs
  | 'cascade'
  | 'rupture'
  | 'burst'
  | 'backwash'
  | 'hazard'
  | 'enemy';

export interface DamageEvent {
  shotId: number;
  weaponId: WeaponId | null;
  attacker: 'player' | number;
  /** Enemy id, or -1 for the player. */
  target: number;
  amount: number;
  origin: DamageOrigin;
  killed: boolean;
  /** Was the target Ionized before this shot resolved? */
  wasIonized: boolean;
  point: Vec3;
}

export type EnemyKind = 'walker' | 'hound' | 'drone' | 'loader';

export type EnemyState =
  | 'spawning'
  | 'advance'
  | 'flank'
  | 'windup'
  | 'attack'
  | 'recover'
  | 'stagger'
  | 'dead';

// ---------------------------------------------------------------------------
// Events: the one-way channel from simulation to presentation.
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'shot'; shotId: number; weapon: WeaponId; origin: Vec3; dir: Vec3; hits: Vec3[]; slug?: boolean }
  | { type: 'impact'; weapon: WeaponId | null; point: Vec3; normal: Vec3; surface: 'world' | 'enemy' }
  | { type: 'dry_fire'; weapon: WeaponId }
  | { type: 'reload_start'; weapon: WeaponId; duration: number }
  | { type: 'reload_done'; weapon: WeaponId }
  | { type: 'reload_cancel'; weapon: WeaponId }
  | { type: 'swap'; from: WeaponId; to: WeaponId; duration: number }
  | { type: 'enemy_hit'; id: number; kind: EnemyKind; amount: number; point: Vec3; origin: DamageOrigin; armorBreak?: boolean }
  | { type: 'enemy_die'; id: number; kind: EnemyKind; pos: Vec3; origin: DamageOrigin }
  | { type: 'enemy_spawn'; id: number; kind: EnemyKind; pos: Vec3 }
  | { type: 'enemy_tell'; id: number; kind: EnemyKind; attack: string; pos: Vec3; duration: number }
  | { type: 'enemy_attack'; id: number; kind: EnemyKind; attack: string; pos: Vec3 }
  | { type: 'arc'; from: Vec3; to: Vec3; origin: DamageOrigin }
  | { type: 'burst'; pos: Vec3; radius: number; origin: DamageOrigin }
  | { type: 'cone'; pos: Vec3; dir: Vec3; range: number }
  | { type: 'player_hurt'; amount: number; from: Vec3 | null }
  | { type: 'player_die' }
  | { type: 'player_jump' }
  | { type: 'player_land'; speed: number }
  | { type: 'player_step' }
  | { type: 'player_dash'; dir: Vec3 }
  | { type: 'pickup'; item: string; amount: number; pos: Vec3 }
  | { type: 'hazard_warn'; id: string; pos: Vec3; duration: number }
  | { type: 'hazard_active'; id: string; pos: Vec3; duration: number }
  | { type: 'wave_warn'; label: string; lane: string; pos: Vec3 }
  | { type: 'wave_start'; encounter: string; wave: number; total: number }
  | { type: 'encounter_clear'; encounter: string; salvage: number }
  | { type: 'objective'; text: string }
  | { type: 'subtitle'; speaker: string; text: string; duration: number }
  | { type: 'draft_open'; rewardIndex: number }
  | { type: 'card_picked'; id: string; rank: number }
  | { type: 'pact'; weapon: MainWeaponId }
  | { type: 'boss_phase'; phase: number }
  | { type: 'relay_progress'; value: number }
  | { type: 'run_end'; outcome: 'extracted' | 'dead' };

// ---------------------------------------------------------------------------
// Shot pipeline contracts (geometry from the weapon sim → damage in combat).
// ---------------------------------------------------------------------------

export interface RayEnemyHit {
  enemy: number;
  /** Distance from the shot origin (eye) along the ray. */
  dist: number;
  point: Vec3;
}

export interface PelletTrace {
  dir: Vec3;
  /** Every enemy the ray passes through before the world obstruction, sorted by distance (max 4). */
  enemyHits: RayEnemyHit[];
  /** First solid world obstruction (after muzzle reconciliation), or null if none within rangeMax. */
  worldHit: { dist: number; point: Vec3; normal: Vec3 } | null;
}

export interface ShotTrace {
  shotId: number;
  weaponId: WeaponId;
  /** Eye position the rays were cast from. */
  origin: Vec3;
  /** Viewmodel muzzle in world space (for tracers). */
  muzzle: Vec3;
  pellets: PelletTrace[];
  /** Cold Chamber slug shot. */
  slug: boolean;
  time: number;
}

/** What a trigger pull looks like after cards (asked right before tracing). */
export interface ShotShape {
  pellets: number;
  spreadDeg: number;
  slug: boolean;
  /** Extra enemies a ray may pass through (Mass Driver / slug). */
  pierce: number;
}

/** Read-only enemy facts the combat/card layer may query. */
export interface EnemyInfo {
  id: number;
  kind: EnemyKind;
  pos: Vec3;
  /** Center of mass used for arc endpoints and LOS checks. */
  center: Vec3;
  hp: number;
  maxHp: number;
  heavy: boolean;
  alive: boolean;
  ionizedUntil: number;
}

/**
 * The world as seen by the combat + card layer. Implemented by the run
 * (src/game) on top of the enemy manager and physics; faked in unit tests.
 */
export interface CombatWorld {
  /** Simulation time in seconds (frozen during drafts). */
  readonly time: number;
  getEnemy(id: number): EnemyInfo | undefined;
  /** Alive enemies whose center is within `radius`, sorted by (distance, id). */
  enemiesInRadius(center: Vec3, radius: number): EnemyInfo[];
  /** True when no static world geometry blocks the segment. */
  lineOfSight(a: Vec3, b: Vec3): boolean;
  /** Applies damage once; marks the enemy dead when hp <= 0. Returns the resulting event. */
  damageEnemy(
    id: number,
    amount: number,
    origin: DamageOrigin,
    shotId: number,
    weaponId: WeaponId | null,
    point: Vec3,
  ): DamageEvent | null;
  setIonized(id: number, until: number): void;
  /** Horizontal impulse in m/s; heavies may ignore it. */
  pushEnemy(id: number, dir: Vec3, strength: number): void;
  staggerEnemy(id: number, seconds: number): void;
  /** Adds ammo to the weapon's reserve (respecting reserveMax); returns amount actually added. */
  refundReserve(weapon: MainWeaponId, amount: number): number;
  /** Moves up to `amount` from reserve into free magazine space; returns amount moved. */
  transferReserveToMagazine(weapon: MainWeaponId, amount: number): number;
  playerIsMoving(): boolean;
  emit(ev: GameEvent): void;
}
