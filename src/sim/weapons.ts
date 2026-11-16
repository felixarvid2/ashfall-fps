import type {
  AmmoType,
  CombatWorld,
  GameEvent,
  MainWeaponId,
  PelletTrace,
  RayEnemyHit,
  ShotShape,
  ShotTrace,
  Vec3,
  WeaponId,
  WeaponStats,
} from './types';
import type { PhysicsQueries } from '../physics/types';
import type { Rng } from '../core/rng';
import { AMMO_CONVERSION, AMMO_OF, AMMO_PICKUP, MAIN_WEAPONS, PACT_WEAPON_PICKUP, WEAPONS } from '../content/weapons';
import { MUZZLE_OFFSET } from '../render/types';
import { add, basisOf, cameraToWorld, clamp, dist, normalize, sub } from '../game/math';

export interface WeaponDeps {
  phys: PhysicsQueries;
  enemies: { raycast(origin: Vec3, dir: Vec3, maxDist: number, maxHits: number): RayEnemyHit[] };
  cards: {
    shotShape(w: WeaponId): ShotShape;
    resolveShot(trace: ShotTrace, world: CombatWorld): { tracerEnds: Vec3[] };
    onReloadComplete(w: WeaponId): void;
    onSwap(): void;
  };
  stats(w: WeaponId): WeaponStats;
  /** Resolved lazily: the combat world holds a reference back to this system. */
  world(): CombatWorld;
  /** Dedicated 'spread' stream. */
  rng: Rng;
  emit(e: GameEvent): void;
}

export interface WeaponInput {
  fireHeld: boolean;
  /** Fresh press since the last step. */
  firePressed: boolean;
  reload: boolean;
  slot1: boolean;
  slot2: boolean;
  backup: boolean;
}

export const NO_WEAPON_INPUT: WeaponInput = {
  fireHeld: false,
  firePressed: false,
  reload: false,
  slot1: false,
  slot2: false,
  backup: false,
};

export interface WeaponView {
  eye: Vec3;
  yaw: number;
  pitch: number;
  time: number;
}

interface WState {
  owned: boolean;
  locked: boolean;
  mag: number;
  reserve: number;
  /** Earliest sim time of the next trigger pull. */
  nextFire: number;
}

const EPS = 1e-9;
const MAX_ENEMY_HITS = 4;
const SEMI_BUFFER = 0.14;
const DRY_COOLDOWN = 0.3;

export class WeaponSystem {
  current: WeaponId;
  private lastMain: MainWeaponId;
  private st: Record<WeaponId, WState>;
  /** Main slots in pick-up order: [starter, rack weapon]. */
  mains: MainWeaponId[];
  /** Emitter charge in 'shots' (float). */
  charge: number;

  reloadTotal = 0;
  reloadRemaining = 0;
  reloading = false;
  equipTotal = 0;
  equipRemaining = 0;
  /** Camera kick (radians), recovers exponentially. */
  recoilPitch = 0;
  recoilYaw = 0;
  /** Viewmodel kick 0..1. */
  kick = 0;
  sinceShot = 99;
  shotCounter = 0;
  private fireBuffer = 0;
  private dryUntil = 0;
  private time = 0;
  /** Pact pledge: second main is locked, ammo is redirected. */
  pact: MainWeaponId | null = null;

  constructor(private deps: WeaponDeps, starter: MainWeaponId) {
    const mk = (): WState => ({ owned: false, locked: false, mag: 0, reserve: 0, nextFire: 0 });
    this.st = { coil_carbine: mk(), arc_scattergun: mk(), service_emitter: mk() };
    this.mains = [starter];
    this.current = starter;
    this.lastMain = starter;
    this.grant(starter);
    this.st.service_emitter.owned = true;
    this.charge = this.capacityOf('service_emitter');
  }

  // -- queries -------------------------------------------------------------

  capacityOf(w: WeaponId): number {
    return this.deps.stats(w).capacity;
  }
  magazine(w: WeaponId = this.current): number {
    return w === 'service_emitter' ? Math.floor(this.charge + 1e-6) : this.st[w].mag;
  }
  reserve(w: WeaponId = this.current): number {
    return this.st[w].reserve;
  }
  owns(w: WeaponId): boolean {
    return this.st[w].owned;
  }
  isLocked(w: WeaponId): boolean {
    return this.st[w].locked;
  }
  get ready(): boolean {
    return this.equipRemaining <= EPS;
  }
  /** 0 lowered .. 1 raised. */
  get raise(): number {
    return this.equipTotal <= 0 ? 1 : clamp(1 - this.equipRemaining / this.equipTotal, 0, 1);
  }
  get reloadProgress(): number | null {
    return this.reloading && this.reloadTotal > 0 ? clamp(1 - this.reloadRemaining / this.reloadTotal, 0, 1) : null;
  }
  chargeFrac(): number {
    return clamp(this.charge / Math.max(1, this.capacityOf('service_emitter')), 0, 1);
  }
  /** Slots for the HUD: held mains then the backup. */
  slots(): { id: WeaponId; locked: boolean; active: boolean }[] {
    const ids: WeaponId[] = [...this.mains, 'service_emitter'];
    return ids.map((id) => ({ id, locked: this.st[id].locked, active: this.current === id }));
  }

  // -- loadout -------------------------------------------------------------

  /** Adds a main weapon to the second slot (rack). Returns false if already held. */
  giveMain(w: MainWeaponId): boolean {
    if (this.st[w].owned) return false;
    if (this.mains.length >= 2) return false;
    this.mains.push(w);
    this.grant(w);
    return true;
  }

  private grant(w: MainWeaponId): void {
    const s = this.st[w];
    s.owned = true;
    s.mag = this.deps.stats(w).capacity;
    s.reserve = Math.max(s.reserve, WEAPONS[w].startReserve);
  }

  /**
   * Pact: surrender every other main weapon, keep the pledged one and switch to it.
   * Ammo pickups for the surrendered type are redirected through AMMO_CONVERSION.
   */
  applyPact(w: MainWeaponId): void {
    if (!this.st[w].owned) this.giveMain(w) || this.forceGrant(w);
    this.pact = w;
    for (const m of MAIN_WEAPONS) if (m !== w) this.st[m].locked = true;
    this.st[w].locked = false;
    if (this.current !== w && this.current !== 'service_emitter') this.switchTo(w);
    this.lastMain = w;
  }

  private forceGrant(w: MainWeaponId): void {
    if (!this.mains.includes(w)) this.mains.push(w);
    this.grant(w);
  }

  // -- ammo ----------------------------------------------------------------

  /** Adds ammo to a weapon reserve respecting reserveMax; returns amount added. */
  refundReserve(w: MainWeaponId, amount: number): number {
    const s = this.st[w];
    if (!s.owned || s.locked || amount <= 0) return 0;
    const room = Math.max(0, WEAPONS[w].reserveMax - s.reserve);
    const add = Math.min(room, Math.floor(amount + 1e-9));
    s.reserve += add;
    return add;
  }

  /** Moves up to `amount` from reserve into free magazine space. */
  transferReserveToMagazine(w: MainWeaponId, amount: number): number {
    const s = this.st[w];
    if (!s.owned) return 0;
    const free = Math.max(0, this.capacityOf(w) - s.mag);
    const n = Math.max(0, Math.min(free, s.reserve, Math.floor(amount)));
    s.mag += n;
    s.reserve -= n;
    return n;
  }

  /** Reserve of `type` for the weapon that would receive it, honouring a pact. */
  private ammoTarget(type: AmmoType): { weapon: MainWeaponId; mul: number } | null {
    if (this.pact) {
      return { weapon: this.pact, mul: AMMO_CONVERSION[type][AMMO_OF[this.pact]] };
    }
    const weapon = MAIN_WEAPONS.find((m) => AMMO_OF[m] === type)!;
    if (!this.st[weapon].owned) return null;
    return { weapon, mul: 1 };
  }

  /**
   * Ammo pickup. `mul` is PlayerStats.pickupAmmoMul. Returns whole rounds added to
   * the receiving weapon (0 = full or not applicable: leave the pickup).
   */
  addAmmoPickup(type: AmmoType, mul: number, size?: number): { weapon: MainWeaponId; added: number } | null {
    const target = this.ammoTarget(type);
    if (!target) return null;
    const base = size ?? AMMO_PICKUP[type];
    const amount = Math.max(1, Math.round(base * mul * target.mul));
    const added = this.refundReserve(target.weapon, amount);
    return { weapon: target.weapon, added };
  }

  /** A full-size weapon pickup under a pact converts into ammo + salvage. */
  pactWeaponConversion(): { weapon: MainWeaponId; ammo: number; salvage: number } | null {
    if (!this.pact) return null;
    const w = this.pact;
    const ammo = Math.round(WEAPONS[w].reserveMax * PACT_WEAPON_PICKUP.ammoFraction);
    const added = this.refundReserve(w, ammo);
    return { weapon: w, ammo: added, salvage: PACT_WEAPON_PICKUP.salvage };
  }

  // -- switching -----------------------------------------------------------

  private canUse(w: WeaponId): boolean {
    const s = this.st[w];
    return s.owned && !s.locked;
  }

  switchTo(w: WeaponId): boolean {
    if (w === this.current || !this.canUse(w)) return false;
    if (this.reloading) {
      this.reloading = false;
      this.reloadRemaining = 0;
      this.deps.emit({ type: 'reload_cancel', weapon: this.current });
    }
    const from = this.current;
    this.current = w;
    if (w !== 'service_emitter') this.lastMain = w as MainWeaponId;
    const dur = WEAPONS[w].equipTime;
    this.equipTotal = dur;
    this.equipRemaining = dur;
    this.fireBuffer = 0;
    this.deps.cards.onSwap();
    this.deps.emit({ type: 'swap', from, to: w, duration: dur });
    return true;
  }

  // -- reload --------------------------------------------------------------

  startReload(): boolean {
    const w = this.current;
    if (w === 'service_emitter' || this.reloading || !this.ready) return false;
    const s = this.st[w];
    const st = this.deps.stats(w);
    if (s.mag >= st.capacity || s.reserve <= 0) return false;
    this.reloading = true;
    this.reloadTotal = Math.max(0.05, st.reloadTime);
    this.reloadRemaining = this.reloadTotal;
    this.deps.emit({ type: 'reload_start', weapon: w, duration: this.reloadTotal });
    return true;
  }

  private finishReload(): void {
    const w = this.current as MainWeaponId;
    const s = this.st[w];
    const cap = this.capacityOf(w);
    const n = Math.max(0, Math.min(cap - s.mag, s.reserve));
    s.mag += n;
    s.reserve -= n;
    this.reloading = false;
    this.reloadRemaining = 0;
    this.deps.emit({ type: 'reload_done', weapon: w });
    this.deps.cards.onReloadComplete(w);
  }

  // -- step ----------------------------------------------------------------

  step(dt: number, input: WeaponInput, view: WeaponView): void {
    this.time = view.time;
    this.sinceShot += dt;
    this.fireBuffer = Math.max(0, this.fireBuffer - dt);
    this.equipRemaining = Math.max(0, this.equipRemaining - dt);

    // Recoil recovery (exponential).
    const rec = WEAPONS[this.current].recoil;
    const k = Math.exp(-dt / Math.max(0.02, rec.recover));
    this.recoilPitch *= k;
    this.recoilYaw *= k;
    this.kick *= Math.exp(-dt / Math.max(0.02, rec.recover * 1.4));
    if (this.kick < 1e-4) this.kick = 0;

    // Emitter recharges whenever it is not being fired this very tick.
    const em = WEAPONS.service_emitter;
    const emCap = this.capacityOf('service_emitter');
    if (this.charge < emCap) this.charge = Math.min(emCap, this.charge + (em.rechargePerSec ?? 0) * dt);

    // Swapping.
    if (input.slot1 && this.mains[0]) this.switchTo(this.mains[0]);
    if (input.slot2 && this.mains[1]) this.switchTo(this.mains[1]);
    if (input.backup) {
      if (this.current === 'service_emitter') this.switchTo(this.lastMain);
      else this.switchTo('service_emitter');
    }

    // Reload.
    if (input.reload) this.startReload();
    if (this.reloading) {
      this.reloadRemaining -= dt;
      if (this.reloadRemaining <= EPS) this.finishReload();
    }

    // Trigger.
    const w = this.current;
    const def = WEAPONS[w];
    const s = this.st[w];
    if (!def.automatic && input.firePressed) this.fireBuffer = SEMI_BUFFER;
    const trigger = def.automatic ? input.fireHeld : this.fireBuffer > 0;
    if (!trigger || !this.ready || this.reloading) return;
    if (this.time + EPS < s.nextFire) return;

    const hasAmmo = w === 'service_emitter' ? this.charge >= 1 - 1e-6 : s.mag > 0;
    if (!hasAmmo) {
      this.fireBuffer = 0;
      if (this.time + EPS >= this.dryUntil) {
        this.dryUntil = this.time + DRY_COOLDOWN;
        this.deps.emit({ type: 'dry_fire', weapon: w });
      }
      if (w !== 'service_emitter' && s.reserve > 0) this.startReload();
      return;
    }
    this.fireBuffer = 0;
    this.fire(w, view);
  }

  private fire(w: WeaponId, view: WeaponView): void {
    const def = WEAPONS[w];
    const s = this.st[w];
    const stats = this.deps.stats(w);
    // Cadence with carry-over so the long-run rate equals 1/fireInterval at 60 Hz.
    s.nextFire = Math.max(s.nextFire, this.time - 1 / 60) + stats.fireInterval;
    if (w === 'service_emitter') this.charge = Math.max(0, this.charge - 1);
    else s.mag -= 1;

    const shape = this.deps.cards.shotShape(w);
    const shotId = ++this.shotCounter;
    const yaw = view.yaw + this.recoilYaw;
    const pitch = clamp(view.pitch + this.recoilPitch, -1.55, 1.55);
    const basis = basisOf(yaw, pitch);
    const eye = view.eye;
    const muzzle = cameraToWorld(eye, basis, MUZZLE_OFFSET[w]);
    const maxRange = stats.rangeMax;

    // Muzzle reconciliation (1): the barrel itself is tucked into geometry.
    const toMuzzle = sub(muzzle, eye);
    const muzzleLen = Math.hypot(toMuzzle.x, toMuzzle.y, toMuzzle.z);
    const muzzleDir = normalize(toMuzzle);
    const barrel = this.deps.phys.raycast(eye, muzzleDir, muzzleLen);

    const spreadHalf = (Math.max(0, shape.spreadDeg) * Math.PI) / 360;
    const tanHalf = Math.tan(spreadHalf);
    const pellets: PelletTrace[] = [];
    const rng = this.deps.rng;
    for (let i = 0; i < shape.pellets; i++) {
      let dir = basis.forward;
      if (tanHalf > 0) {
        const r = tanHalf * Math.sqrt(rng.next());
        const a = rng.next() * Math.PI * 2;
        dir = normalize({
          x: basis.forward.x + basis.right.x * r * Math.cos(a) + basis.up.x * r * Math.sin(a),
          y: basis.forward.y + basis.right.y * r * Math.cos(a) + basis.up.y * r * Math.sin(a),
          z: basis.forward.z + basis.right.z * r * Math.cos(a) + basis.up.z * r * Math.sin(a),
        });
      }
      if (barrel) {
        pellets.push({
          dir,
          enemyHits: [],
          worldHit: { dist: barrel.dist, point: barrel.point, normal: barrel.normal },
        });
        continue;
      }
      let wh = this.deps.phys.raycast(eye, dir, maxRange);
      let worldHit: PelletTrace['worldHit'] = wh ? { dist: wh.dist, point: wh.point, normal: wh.normal } : null;
      // Muzzle reconciliation (2): the tracer from the muzzle must reach the aim point.
      const end = worldHit ? worldHit.point : { x: eye.x + dir.x * maxRange, y: eye.y + dir.y * maxRange, z: eye.z + dir.z * maxRange };
      const m2e = sub(end, muzzle);
      const l = Math.hypot(m2e.x, m2e.y, m2e.z);
      if (l > 0.1) {
        const blocked = this.deps.phys.raycast(muzzle, { x: m2e.x / l, y: m2e.y / l, z: m2e.z / l }, l - 0.04);
        if (blocked) {
          wh = blocked;
          worldHit = { dist: dist(eye, blocked.point), point: blocked.point, normal: blocked.normal };
        }
      }
      const reach = worldHit ? worldHit.dist : maxRange;
      const maxHits = Math.min(MAX_ENEMY_HITS, Math.max(0, shape.pierce) + 1);
      const enemyHits = this.deps.enemies.raycast(eye, dir, reach, maxHits).filter((h) => h.dist <= reach + 1e-6).slice(0, maxHits);
      pellets.push({ dir, enemyHits, worldHit });
    }

    const trace: ShotTrace = { shotId, weaponId: w, origin: { ...eye }, muzzle, pellets, slug: shape.slug, time: view.time };

    // Recoil before resolving so cards that emit events see consistent state.
    const rc = def.recoil;
    this.recoilPitch += (rc.pitch * Math.PI) / 180;
    this.recoilYaw += ((rng.next() * 2 - 1) * rc.yawJitter * Math.PI) / 180;
    this.kick = 1;
    this.sinceShot = 0;

    const outcome = this.deps.cards.resolveShot(trace, this.deps.world());

    let hits = outcome.tracerEnds;
    if (!hits || hits.length === 0) hits = pellets.map((p) => endOf(eye, p, maxRange));
    this.deps.emit({ type: 'shot', shotId, weapon: w, origin: muzzle, dir: basis.forward, hits: hits.map((h) => ({ ...h })), slug: shape.slug || undefined });

    let impacts = 0;
    for (const p of pellets) {
      if (!p.worldHit || p.enemyHits.length > Math.max(0, shape.pierce)) continue;
      if (impacts++ >= 12) break;
      this.deps.emit({ type: 'impact', weapon: w, point: p.worldHit.point, normal: p.worldHit.normal, surface: 'world' });
    }
  }
}

function endOf(eye: Vec3, p: PelletTrace, maxRange: number): Vec3 {
  if (p.worldHit && p.enemyHits.length === 0) return p.worldHit.point;
  const last = p.enemyHits[p.enemyHits.length - 1];
  if (last) return last.point;
  return add(eye, { x: p.dir.x * maxRange, y: p.dir.y * maxRange, z: p.dir.z * maxRange });
}
