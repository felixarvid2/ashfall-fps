import type { ArenaDef, LevelDef, PickupDef, PickupKind } from '../content/levelTypes';
import type {
  AmmoType,
  CombatWorld,
  DamageEvent,
  DamageOrigin,
  DraftOffer,
  EnemyInfo,
  EnemyKind,
  GameEvent,
  MainWeaponId,
  RayEnemyHit,
  Vec3,
  WeaponId,
} from '../sim/types';
import { SIM_DT } from '../sim/types';
import type { EnemyRenderState, PickupRenderState, ProjectileRenderState } from '../render/types';
import type { DraftView, OwnedCardView, RunSetup } from '../ui/types';
import { Rng } from '../core/rng';
import { ENCOUNTERS } from '../content/encounters';
import { AMMO_OF, AMMO_PICKUP, BASE_PLAYER, MAIN_WEAPONS, WEAPONS } from '../content/weapons';
import {
  CardRuntime,
  CardState,
  DraftSystem,
  applyDebugLoadout,
  cardView,
  computePlayerStats,
  computeWeaponStats,
  ownedCardViews,
  supplyView,
} from '../sim/cards';
import type { SupplyId } from '../content/cards';
import { Player, NO_INPUT } from '../sim/player';
import { WeaponSystem, NO_WEAPON_INPUT } from '../sim/weapons';
import { PhysicsWorld } from '../physics/world';
import type { InputSample } from '../input/input';
import { dist, dist2D } from './math';

// ---------------------------------------------------------------------------
// Dependencies from the enemy/director modules, typed structurally against
// docs/ARCHITECTURE.md so tests can substitute fakes.
// ---------------------------------------------------------------------------

export interface PlayerTarget {
  readonly pos: Vec3;
  readonly vel: Vec3;
  readonly alive: boolean;
  hurt(amount: number, from: Vec3): void;
}

export interface EnemyManagerApi {
  spawn(kind: EnemyKind, pos: Vec3, laneId?: string): number;
  step(dt: number, time: number, player: PlayerTarget): void;
  info(id: number): EnemyInfo | undefined;
  inRadius(center: Vec3, r: number): EnemyInfo[];
  applyDamage(id: number, amount: number, point: Vec3, origin: DamageOrigin): { killed: boolean; armorBreak: boolean } | null;
  push(id: number, dir: Vec3, strength: number): void;
  stagger(id: number, seconds: number): void;
  setIonized(id: number, until: number): void;
  raycast(origin: Vec3, dir: Vec3, maxDist: number, maxHits: number): RayEnemyHit[];
  liveCount(): number;
  renderStates(alpha: number): EnemyRenderState[];
  projectiles(): ProjectileRenderState[];
  projectileCount(): number;
  setGateOpen(id: string, open: boolean): void;
  clear(): void;
}

export interface DirectorApi {
  startArena(id: string): void;
  step(dt: number, time: number, playerPos: Vec3): void;
  readonly status: { arena: string | null; wave: number; waves: number; live: number; queued: number; cleared: string[] };
  isCleared(id: string): boolean;
  reset(): void;
  startStress?(count?: number): void;
}

export interface RunFactories {
  createEnemies(level: LevelDef, phys: PhysicsWorld, rng: Rng, emit: (e: GameEvent) => void): EnemyManagerApi;
  createDirector(level: LevelDef, enemies: EnemyManagerApi, rng: Rng, emit: (e: GameEvent) => void): DirectorApi;
}

export interface RunOptions {
  level: LevelDef;
  seed: string;
  starter: MainWeaponId;
  /** Dev: debug loadout key from DEBUG_LOADOUTS (also skips the deployment draft). */
  loadout?: string | null;
  /** Dev: start at an arena with earlier gates open (skips the deployment draft). */
  skipTo?: 'yard' | 'slag' | 'relay' | null;
}

// ---------------------------------------------------------------------------

/** Reward index opened by the supply cache of each arena (relay has no cache). */
export const ARENA_REWARD: Record<string, number> = { yard: 1, slag: 2, approach: 3 };

const TUNING = {
  pickupRadius: 1.7,
  interactRadius: 2.8,
  cacheRadius: 3.2,
  rackRadius: 2.8,
  radioRadius: 9,
  hazardTick: 0.25,
  deathDelay: 1.6,
  extractDelay: 0.6,
  dropAmmoChance: 0.28,
  dropHealthChance: 0.1,
  dropLife: 30,
  healthPickupDefault: 25,
  salvagePickupDefault: 10,
};

interface PickupEntity {
  id: number;
  kind: PickupKind;
  pos: Vec3;
  amount: number;
  /** Hidden until this arena clears. */
  afterArena?: string;
  life: number;
  active: boolean;
}

interface CacheState {
  arena: ArenaDef;
  reward: number;
  available: boolean;
  open: boolean;
}

interface HurtMark {
  from: Vec3;
  t: number;
}

type Outcome = 'extracted' | 'dead' | null;

export class Run {
  readonly level: LevelDef;
  readonly seed: string;
  readonly rng: Rng;
  readonly rngDraft: Rng;
  readonly rngSpawns: Rng;
  readonly rngPickups: Rng;
  readonly rngSpread: Rng;
  readonly rngFx: Rng;

  readonly phys: PhysicsWorld;
  readonly cards: CardState;
  readonly cardRuntime: CardRuntime;
  readonly draftSystem: DraftSystem;
  readonly enemies: EnemyManagerApi;
  readonly director: DirectorApi;
  readonly player: Player;
  readonly weapons: WeaponSystem;
  readonly starter: MainWeaponId;

  time = 0;
  salvage = 0;
  kills = 0;
  outcome: Outcome = null;
  /** True once the end-of-run delay elapsed; the shell then shows the results screen. */
  finished = false;
  hitMarker = 0;
  killMarker = 0;
  interactPrompt: string | null = null;
  objective = 'Advance to the loading yard. A scattergun waits in the rack by the gate.';

  /** Open draft (sim is frozen while set). */
  draft: { offer: DraftOffer; arena: string | null } | null = null;
  rackHasWeapon = true;
  relay = { progress: 0, active: false, done: false };
  extractionActive = false;
  readonly pickups: PickupEntity[] = [];
  readonly caches: CacheState[] = [];
  readonly hurtMarks: HurtMark[] = [];

  private events: GameEvent[] = [];
  private world: CombatWorld;
  private started = new Set<string>();
  private nextPickupId = 1;
  private endTimer = -1;
  private weaponStatsCache = new Map<WeaponId, ReturnType<typeof computeWeaponStats>>();
  private hazardPhase = new Map<string, 'idle' | 'warn' | 'active'>();
  private hazardAcc = new Map<string, number>();
  private radioDone = new Set<number>();
  private radioQueue: { speaker: string; text: string; delay: number; duration: number }[] = [];
  private radioWait = 0;
  private relayEmit = 0;
  private disposed = false;
  private draftsOpened = 0;
  private rackWeapon: MainWeaponId;
  private playerTarget: PlayerTarget;

  constructor(opts: RunOptions, phys: PhysicsWorld, factories: RunFactories) {
    this.level = opts.level;
    this.seed = opts.seed;
    this.starter = opts.starter;
    this.phys = phys;
    this.rng = new Rng(opts.seed);
    this.rngDraft = this.rng.fork('draft');
    this.rngSpawns = this.rng.fork('spawns');
    this.rngPickups = this.rng.fork('pickups');
    this.rngSpread = this.rng.fork('spread');
    this.rngFx = this.rng.fork('fx');

    this.cards = new CardState([opts.starter]);
    this.cardRuntime = new CardRuntime(this.cards, (w) => this.weaponStats(w));
    this.draftSystem = new DraftSystem(this.rngDraft);
    const emit = (e: GameEvent): void => this.emit(e);
    this.enemies = factories.createEnemies(opts.level, phys, this.rngSpawns.fork('enemies'), emit);
    this.director = factories.createDirector(opts.level, this.enemies, this.rngSpawns, emit);

    this.player = new Player(phys, computePlayerStats(BASE_PLAYER, this.cards), opts.level.playerStart, opts.level.killY, emit);
    this.rackWeapon = opts.starter === opts.level.weaponRack.weapon ? MAIN_WEAPONS.find((w) => w !== opts.starter)! : opts.level.weaponRack.weapon;

    this.world = this.makeCombatWorld();
    this.weapons = new WeaponSystem(
      {
        phys,
        enemies: { raycast: (o, d, m, n) => this.enemies.raycast(o, d, m, n) },
        cards: this.cardRuntime,
        stats: (w) => this.weaponStats(w),
        world: () => this.world,
        rng: this.rngSpread,
        emit,
      },
      opts.starter,
    );

    // Authored pickups.
    for (const p of opts.level.pickups) this.addPickupFromDef(p);
    // Supply caches.
    for (const a of opts.level.arenas) {
      const reward = ARENA_REWARD[a.id];
      if (reward !== undefined) this.caches.push({ arena: a, reward, available: false, open: false });
    }
    // Gates that start closed/open are configured by the physics world already; mirror into enemies.
    for (const g of phys.gates) this.enemies.setGateOpen(g.key, phys.isGateOpen(g.key));

    this.playerTarget = this.makePlayerTarget();
    this.applyDevOptions(opts);
  }

  static async create(opts: RunOptions, factories: RunFactories): Promise<Run> {
    const phys = await PhysicsWorld.create(opts.level);
    return new Run(opts, phys, factories);
  }

  // -- setup ---------------------------------------------------------------

  private applyDevOptions(opts: RunOptions): void {
    const skip = opts.skipTo ?? null;
    if (opts.loadout) {
      const heal = applyDebugLoadout(this.cards, opts.loadout);
      this.giveCardWeapons();
      this.cardsChanged();
      this.player.heal(heal);
    }
    if (skip) {
      const order = this.level.arenas.map((a) => a.id);
      const idx = Math.max(0, order.indexOf(skip));
      if (!this.cards.equipped.includes(this.rackWeapon) && this.cards.pact === null) this.takeRackWeapon(true);
      for (let i = 0; i < idx; i++) this.forceClear(order[i]!);
      const arena = this.level.arenas[idx]!;
      const cx = (arena.trigger.min.x + arena.trigger.max.x) / 2;
      const z = arena.trigger.max.z + 8;
      const gy = this.phys.groundHeight(cx, z, arena.trigger.max.y + 2) ?? arena.trigger.min.y;
      this.player.pos = { x: cx, y: gy, z };
      this.player.prevPos = { ...this.player.pos };
      this.player.yaw = 0;
    }
  }

  /** Dev: mark an arena as finished without fighting (opens its gates, shows its pickups). */
  private forceClear(id: string): void {
    this.started.add(id);
    this.onArenaCleared(id, 0, false);
  }

  /** Syncs the weapon system with weapons/pact the card state already holds. */
  private giveCardWeapons(): void {
    for (const w of this.cards.equipped) this.weapons.giveMain(w);
    if (this.cards.pact) {
      this.weapons.applyPact(this.cards.pact);
      this.rackHasWeapon = false;
    } else if (this.cards.equipped.length >= 2) this.rackHasWeapon = false;
  }

  /** Opens the deployment draft (reward 0). Call after construction unless dev options skip it. */
  start(opts?: { skipDeployment?: boolean }): void {
    if (!opts?.skipDeployment) this.openDraft(0, null);
  }

  // -- stats ---------------------------------------------------------------

  weaponStatsFor(w: WeaponId) {
    return this.weaponStats(w);
  }

  private weaponStats(w: WeaponId) {
    let s = this.weaponStatsCache.get(w);
    if (!s) {
      s = computeWeaponStats(WEAPONS[w], this.cards);
      this.weaponStatsCache.set(w, s);
    }
    return s;
  }

  /** Call whenever the card state changed. */
  private cardsChanged(): void {
    this.weaponStatsCache.clear();
    this.player.setStats(computePlayerStats(BASE_PLAYER, this.cards));
  }

  // -- events --------------------------------------------------------------

  emit(e: GameEvent): void {
    this.events.push(e);
    switch (e.type) {
      case 'enemy_hit':
        if (e.origin === 'direct' || e.origin === 'emitter') this.hitMarker = 1;
        break;
      case 'enemy_die':
        this.kills++;
        this.killMarker = 1;
        this.maybeDrop(e.kind, e.pos);
        break;
      case 'player_hurt':
        if (e.from) this.hurtMarks.push({ from: e.from, t: 0 });
        break;
      case 'player_die':
        if (!this.outcome) {
          this.outcome = 'dead';
          this.endTimer = TUNING.deathDelay;
        }
        break;
      case 'wave_start': {
        const w = ENCOUNTERS[e.encounter]?.waves[e.wave - 1];
        if (w?.resupply) for (const r of w.resupply) this.spawnPickup(r.kind, r.pos, r.amount);
        break;
      }
      case 'encounter_clear':
        this.onArenaCleared(e.encounter, e.salvage, true);
        break;
      case 'objective':
        this.objective = e.text;
        break;
    }
  }

  /** Returns and clears queued events. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // -- combat world --------------------------------------------------------

  private makeCombatWorld(): CombatWorld {
    const self = this;
    return {
      get time() {
        return self.time;
      },
      getEnemy: (id) => self.enemies.info(id),
      enemiesInRadius: (c, r) => {
        const d = (e: EnemyInfo) => dist(e.center, c);
        return self.enemies
          .inRadius(c, r)
          .filter((e) => e.alive && d(e) <= r)
          .sort((a, b) => d(a) - d(b) || a.id - b.id);
      },
      lineOfSight: (a, b) => self.phys.lineOfSight(a, b),
      damageEnemy: (id, amount, origin, shotId, weaponId, point): DamageEvent | null => {
        const info = self.enemies.info(id);
        if (!info || !info.alive) return null;
        const wasIonized = info.ionizedUntil > self.time;
        const r = self.enemies.applyDamage(id, amount, point, origin);
        if (!r) return null;
        return { shotId, weaponId, attacker: 'player', target: id, amount, origin, killed: r.killed, wasIonized, point };
      },
      setIonized: (id, until) => self.enemies.setIonized(id, until),
      pushEnemy: (id, dir, strength) => self.enemies.push(id, dir, strength),
      staggerEnemy: (id, s) => self.enemies.stagger(id, s),
      refundReserve: (w, n) => self.weapons.refundReserve(w, n),
      transferReserveToMagazine: (w, n) => self.weapons.transferReserveToMagazine(w, n),
      playerIsMoving: () => self.player.horizontalSpeed > 1,
      emit: (e) => self.emit(e),
    };
  }

  private makePlayerTarget(): PlayerTarget {
    const p = this.player;
    return {
      get pos() {
        return p.pos;
      },
      get vel() {
        return p.vel;
      },
      get alive() {
        return p.alive;
      },
      hurt: (amount, from) => p.hurt(amount, from),
    };
  }

  // -- step ----------------------------------------------------------------

  /** True while the simulation must not advance (draft open, run over). */
  get frozen(): boolean {
    return this.draft !== null || this.finished || this.disposed;
  }

  /** One 60 Hz simulation step. No-op while a draft is open. */
  step(input: InputSample): void {
    if (this.frozen) return;
    const dt = SIM_DT;
    this.time += dt;
    const alive = this.player.alive && this.outcome !== 'extracted';

    this.player.step(
      alive
        ? { moveX: input.moveX, moveZ: input.moveZ, jump: input.jump, dash: input.dash, yaw: input.yaw, pitch: input.pitch }
        : { ...NO_INPUT, yaw: input.yaw, pitch: input.pitch },
      dt,
    );
    this.weapons.step(
      dt,
      alive ? { fireHeld: input.fireHeld, firePressed: input.firePressed, reload: input.reload, slot1: input.slot1, slot2: input.slot2, backup: input.backup } : NO_WEAPON_INPUT,
      { eye: this.player.eyePos(1), yaw: input.yaw, pitch: input.pitch, time: this.time },
    );

    this.checkArenaTriggers();
    this.director.step(dt, this.time, this.player.pos);
    this.enemies.step(dt, this.time, this.playerTarget);

    this.stepHazards(dt);
    this.stepPickups(dt);
    if (alive) this.stepInteractions(input, dt);
    this.stepRadio(dt);
    this.stepMarkers(dt);

    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer < 0) {
        this.finished = true;
        this.emit({ type: 'run_end', outcome: this.outcome ?? 'dead' });
      }
    }
  }

  private stepMarkers(dt: number): void {
    this.hitMarker = Math.max(0, this.hitMarker - dt * 5);
    this.killMarker = Math.max(0, this.killMarker - dt * 2.5);
    for (const m of this.hurtMarks) m.t += dt;
    while (this.hurtMarks.length && this.hurtMarks[0]!.t > 2.2) this.hurtMarks.shift();
  }

  // -- arenas --------------------------------------------------------------

  private checkArenaTriggers(): void {
    const p = this.player.pos;
    for (const a of this.level.arenas) {
      if (this.started.has(a.id)) continue;
      const t = a.trigger;
      if (p.x >= t.min.x && p.x <= t.max.x && p.y >= t.min.y - 0.5 && p.y <= t.max.y && p.z >= t.min.z && p.z <= t.max.z) {
        this.started.add(a.id);
        this.director.startArena(a.id);
        this.emit({ type: 'objective', text: a.objective });
        for (const g of this.phys.gates) if (g.closesOn === a.id) this.setGate(g.key, false);
      }
    }
  }

  private setGate(key: string, open: boolean): void {
    this.phys.setGateOpen(key, open);
    this.enemies.setGateOpen(key, open);
  }

  private onArenaCleared(id: string, salvage: number, announce: boolean): void {
    if (salvage > 0) this.salvage += salvage;
    for (const g of this.phys.gates) {
      if (g.opensAfter === id || g.closesOn === id) this.setGate(g.key, true);
    }
    for (const p of this.pickups) if (p.afterArena === id) p.active = true;
    const cache = this.caches.find((c) => c.arena.id === id);
    if (cache) cache.available = true;
    if (id === this.level.relay.arena) {
      this.relay.active = true;
      if (announce) this.emit({ type: 'objective', text: 'Hold [E] at the relay console to cut the uplink.' });
    } else if (announce) {
      const next = cache ? 'Open the supply cache, then push on.' : 'Push on.';
      this.emit({ type: 'objective', text: `Sector clear. ${next}` });
    }
  }

  // -- pickups -------------------------------------------------------------

  private addPickupFromDef(p: PickupDef): void {
    const defaultAmount = p.kind === 'health' || p.kind === 'armor' ? TUNING.healthPickupDefault : p.kind === 'salvage' ? TUNING.salvagePickupDefault : 0;
    this.pickups.push({
      id: this.nextPickupId++,
      kind: p.kind,
      pos: { ...p.pos },
      amount: p.amount ?? defaultAmount,
      afterArena: p.afterArena,
      life: Infinity,
      active: !p.afterArena,
    });
  }

  private maybeDrop(kind: EnemyKind, pos: Vec3): void {
    if (kind === 'loader') return;
    const r = this.rngPickups;
    const roll = r.next();
    const where = { x: pos.x, y: pos.y + 0.3, z: pos.z };
    if (roll < TUNING.dropAmmoChance) {
      const owned = this.weapons.pact ? [this.weapons.pact] : MAIN_WEAPONS.filter((w) => this.weapons.owns(w));
      const weights = owned.map((w) => 0.2 + 1 - this.weapons.reserve(w) / WEAPONS[w].reserveMax);
      const i = r.weightedIndex(weights);
      const w = owned[Math.max(0, i)] ?? this.starter;
      const type = AMMO_OF[w];
      this.spawnPickup(type === 'coil_cells' ? 'ammo_coil' : 'ammo_arc', where, Math.round(AMMO_PICKUP[type] * 0.5), TUNING.dropLife);
    } else if (roll < TUNING.dropAmmoChance + TUNING.dropHealthChance) {
      this.spawnPickup('health', where, 10, TUNING.dropLife);
    }
  }

  spawnPickup(kind: PickupKind, pos: Vec3, amount: number, life = Infinity): void {
    this.pickups.push({ id: this.nextPickupId++, kind, pos: { ...pos }, amount, life, active: true });
  }

  private stepPickups(dt: number): void {
    const pp = this.player.pos;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]!;
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.pickups.splice(i, 1);
        continue;
      }
      if (!this.player.alive) continue;
      if (dist2D(pp, p.pos) > TUNING.pickupRadius || Math.abs(pp.y + 0.9 - p.pos.y) > 2.6) continue;
      if (this.collect(p)) this.pickups.splice(i, 1);
    }
  }

  /** Tries to consume a pickup; false leaves it on the ground. */
  private collect(p: PickupEntity): boolean {
    const mul = this.player.stats.pickupAmmoMul;
    switch (p.kind) {
      case 'ammo_coil':
      case 'ammo_arc': {
        const type: AmmoType = p.kind === 'ammo_coil' ? 'coil_cells' : 'arc_charges';
        const r = this.weapons.addAmmoPickup(type, mul, p.amount > 0 ? p.amount : undefined);
        if (!r || r.added <= 0) return false;
        this.emit({ type: 'pickup', item: p.kind, amount: r.added, pos: p.pos });
        return true;
      }
      case 'health':
      case 'armor': {
        const healed = this.player.heal(p.amount);
        if (healed <= 0) return false;
        this.emit({ type: 'pickup', item: p.kind, amount: healed, pos: p.pos });
        return true;
      }
      case 'salvage':
        this.salvage += p.amount;
        this.emit({ type: 'pickup', item: 'salvage', amount: p.amount, pos: p.pos });
        return true;
    }
  }

  // -- hazards -------------------------------------------------------------

  /** Phase and progress of a vent at the current sim time. */
  hazardState(h: LevelDef['hazards'][number], time = this.time): { phase: 'idle' | 'warn' | 'active'; t: number } {
    const c = (((time + h.offset) % h.period) + h.period) % h.period;
    const idle = h.period - h.warn - h.active;
    if (c < idle) return { phase: 'idle', t: idle > 0 ? c / idle : 0 };
    if (c < idle + h.warn) return { phase: 'warn', t: (c - idle) / h.warn };
    return { phase: 'active', t: (c - idle - h.warn) / h.active };
  }

  private stepHazards(dt: number): void {
    for (const h of this.level.hazards) {
      const s = this.hazardState(h);
      const prev = this.hazardPhase.get(h.id) ?? 'idle';
      if (s.phase !== prev) {
        this.hazardPhase.set(h.id, s.phase);
        if (s.phase === 'warn') this.emit({ type: 'hazard_warn', id: h.id, pos: h.pos, duration: h.warn });
        if (s.phase === 'active') this.emit({ type: 'hazard_active', id: h.id, pos: h.pos, duration: h.active });
      }
      if (s.phase !== 'active' || !this.player.alive) {
        this.hazardAcc.set(h.id, 0);
        continue;
      }
      const inside = dist2D(this.player.pos, h.pos) <= h.radius && Math.abs(this.player.pos.y - h.pos.y) < 3;
      if (!inside) continue;
      const acc = (this.hazardAcc.get(h.id) ?? 0) + dt;
      if (acc >= TUNING.hazardTick) {
        this.hazardAcc.set(h.id, acc - TUNING.hazardTick);
        this.player.hurt(h.damagePerSec * TUNING.hazardTick, h.pos);
      } else this.hazardAcc.set(h.id, acc);
    }
  }

  // -- interactions --------------------------------------------------------

  private takeRackWeapon(silent = false): void {
    const w = this.rackWeapon;
    if (this.weapons.pact) {
      const c = this.weapons.pactWeaponConversion();
      if (c) {
        this.salvage += c.salvage;
        if (!silent) this.emit({ type: 'pickup', item: 'weapon_converted', amount: c.ammo, pos: this.level.weaponRack.pos });
      }
    } else if (this.weapons.giveMain(w)) {
      this.cards.equip(w);
      this.cardsChanged();
      if (!silent) this.emit({ type: 'pickup', item: `weapon_${w}`, amount: 1, pos: this.level.weaponRack.pos });
    }
    this.rackHasWeapon = false;
  }

  private stepInteractions(input: InputSample, dt: number): void {
    const p = this.player.pos;
    let prompt: string | null = null;

    // Weapon rack.
    const rack = this.level.weaponRack;
    if (this.rackHasWeapon && dist2D(p, rack.pos) <= TUNING.rackRadius && Math.abs(p.y - rack.pos.y) < 2.5) {
      prompt = this.weapons.pact ? '[E] SALVAGE RACK WEAPON' : `[E] TAKE ${WEAPONS[this.rackWeapon].name.toUpperCase()}`;
      if (input.interactPressed) {
        this.takeRackWeapon();
        prompt = null;
      }
    }

    // Supply caches.
    for (const c of this.caches) {
      if (!c.available || c.open) continue;
      if (dist2D(p, c.arena.cache) <= TUNING.cacheRadius && Math.abs(p.y - c.arena.cache.y) < 3) {
        prompt = '[E] OPEN SUPPLY CACHE';
        if (input.interactPressed) {
          c.open = true;
          this.openDraft(c.reward, c.arena.id);
          prompt = null;
        }
        break;
      }
    }

    // Relay shutdown (hold E).
    const rl = this.level.relay;
    if (this.relay.active && !this.relay.done && dist2D(p, rl.pos) <= rl.interactRadius && Math.abs(p.y - rl.pos.y) < 3) {
      prompt = 'HOLD [E] CUT THE UPLINK';
      if (input.interactHeld) {
        this.relay.progress = Math.min(1, this.relay.progress + dt / rl.shutdownTime);
        this.relayEmit += dt;
        if (this.relayEmit >= 0.1) {
          this.relayEmit = 0;
          this.emit({ type: 'relay_progress', value: this.relay.progress });
        }
        if (this.relay.progress >= 1) {
          this.relay.done = true;
          this.relay.active = false;
          this.extractionActive = true;
          this.emit({ type: 'relay_progress', value: 1 });
          this.emit({ type: 'objective', text: 'Uplink cut. Reach the extraction marker.' });
        }
      }
    }

    // Extraction.
    if (this.extractionActive && this.outcome === null) {
      const ex = this.level.extraction;
      if (dist2D(p, ex.pos) <= ex.radius && Math.abs(p.y - ex.pos.y) < 4) {
        this.outcome = 'extracted';
        this.endTimer = TUNING.extractDelay;
      }
    }
    this.interactPrompt = prompt;

    // Radio lines (one shot, near the authored point).
    this.level.radio.forEach((r, i) => {
      if (this.radioDone.has(i)) return;
      if (dist2D(p, r.pos) <= TUNING.radioRadius) {
        this.radioDone.add(i);
        for (const l of r.lines) this.radioQueue.push({ speaker: l.speaker, text: l.text, delay: 0, duration: Math.max(3, l.text.length * 0.055) });
      }
    });
  }

  private stepRadio(dt: number): void {
    if (this.radioWait > 0) this.radioWait -= dt;
    if (this.radioWait <= 0 && this.radioQueue.length) {
      const l = this.radioQueue.shift()!;
      this.emit({ type: 'subtitle', speaker: l.speaker, text: l.text, duration: l.duration });
      this.radioWait = l.duration + 0.4;
    }
  }

  // -- drafts --------------------------------------------------------------

  private openDraft(rewardIndex: number, arena: string | null): void {
    const offer = this.draftSystem.open(rewardIndex, { state: this.cards, salvage: this.salvage, depth: rewardIndex });
    this.draft = { offer, arena };
    this.draftsOpened++;
    this.emit({ type: 'draft_open', rewardIndex });
  }

  draftView(): DraftView | null {
    if (!this.draft) return null;
    const offer = this.draft.offer;
    const cards = offer.options.map((o) => (o.kind === 'supply' ? supplyView(o.id as SupplyId) : cardView(o.id, this.cards, o.nextRank)));
    return {
      offer,
      title: offer.rewardIndex === 0 ? 'DEPLOYMENT KIT: CHOOSE ONE' : 'SUPPLY CACHE: CHOOSE ONE',
      cards,
      salvage: this.salvage,
      canReroll: offer.rerollsLeft > 0 && this.salvage >= offer.rerollCost,
      rerollCost: offer.rerollCost,
      skipSalvage: offer.skipSalvage,
    };
  }

  draftPick(offerId: number, index: number): { ok: boolean } {
    if (!this.draft) return { ok: false };
    const res = this.draftSystem.pick(offerId, index, { state: this.cards, salvage: this.salvage, depth: this.draft.offer.rewardIndex });
    if ('error' in res) return { ok: false };
    if (res.option.kind === 'card' && res.newRank !== undefined) {
      this.emit({ type: 'card_picked', id: res.option.id, rank: res.newRank });
    }
    if (res.pact) {
      this.weapons.applyPact(res.pact);
      this.emit({ type: 'pact', weapon: res.pact });
    }
    this.cardsChanged();
    if (res.heal) this.player.heal(res.heal);
    if (res.salvage) this.salvage += res.salvage;
    if (res.ammoFraction) {
      for (const w of MAIN_WEAPONS) {
        if (this.weapons.owns(w) && !this.weapons.isLocked(w)) this.weapons.refundReserve(w, WEAPONS[w].reserveMax * res.ammoFraction);
      }
    }
    this.draft = null;
    return { ok: true };
  }

  draftReroll(offerId: number): { ok: boolean } {
    if (!this.draft) return { ok: false };
    const res = this.draftSystem.reroll(offerId, { state: this.cards, salvage: this.salvage, depth: this.draft.offer.rewardIndex });
    if ('error' in res) return { ok: false };
    this.salvage = Math.max(0, this.salvage - res.cost);
    this.draft = { offer: res.offer, arena: this.draft.arena };
    return { ok: true };
  }

  draftSkip(offerId: number): { ok: boolean } {
    if (!this.draft) return { ok: false };
    const res = this.draftSystem.skip(offerId, { state: this.cards, salvage: this.salvage, depth: this.draft.offer.rewardIndex });
    if ('error' in res) return { ok: false };
    this.salvage += res.salvage;
    this.draft = null;
    return { ok: true };
  }

  // -- read models ---------------------------------------------------------

  get arenasCleared(): number {
    return this.director.status.cleared.length;
  }

  ownedCards(): OwnedCardView[] {
    return ownedCardViews(this.cards);
  }

  setupFor(): RunSetup {
    return { seed: this.seed, starter: this.starter };
  }

  renderPickups(): PickupRenderState[] {
    const out: PickupRenderState[] = [];
    for (const p of this.pickups) if (p.active) out.push({ id: p.id, kind: p.kind, pos: p.pos });
    if (this.rackHasWeapon) {
      const r = this.level.weaponRack;
      out.push({ id: 0, kind: `weapon_${this.rackWeapon}`, pos: r.pos });
    }
    return out;
  }

  get draftsSeen(): number {
    return this.draftsOpened;
  }

  /** Frees everything the run owns. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enemies.clear();
    this.director.reset();
    this.phys.dispose();
    this.pickups.length = 0;
    this.events.length = 0;
    this.hurtMarks.length = 0;
  }
}
