import type { CombatWorld, DamageEvent, DamageOrigin, EnemyInfo, GameEvent, MainWeaponId, ShotTrace, Vec3, WeaponId } from '../types';

/** Minimal in-memory CombatWorld for tests and tools. */
export class FakeWorld implements CombatWorld {
  time = 10;
  enemies = new Map<number, EnemyInfo>();
  events: GameEvent[] = [];
  damageLog: { id: number; amount: number; origin: DamageOrigin }[] = [];
  pushes: { id: number; strength: number }[] = [];
  staggers: { id: number; seconds: number }[] = [];
  refunds: { weapon: MainWeaponId; amount: number }[] = [];
  transfers: { weapon: MainWeaponId; amount: number }[] = [];
  moving = true;
  blockedLos = new Set<string>();

  add(id: number, x: number, z: number, opts: Partial<EnemyInfo> = {}): EnemyInfo {
    const e: EnemyInfo = {
      id, kind: 'walker', pos: { x, y: 0, z }, center: { x, y: 1, z }, hp: 60, maxHp: 60,
      heavy: false, alive: true, ionizedUntil: 0, ...opts,
    };
    this.enemies.set(id, e);
    return e;
  }
  getEnemy(id: number) { return this.enemies.get(id); }
  enemiesInRadius(c: Vec3, r: number): EnemyInfo[] {
    const d = (e: EnemyInfo) => Math.hypot(e.center.x - c.x, e.center.y - c.y, e.center.z - c.z);
    return [...this.enemies.values()].filter((e) => e.alive && d(e) <= r).sort((a, b) => d(a) - d(b) || a.id - b.id);
  }
  lineOfSight(a: Vec3, b: Vec3): boolean {
    return !this.blockedLos.has(`${a.x},${a.z}>${b.x},${b.z}`) && !this.blockedLos.has(`${b.x},${b.z}>${a.x},${a.z}`);
  }
  damageEnemy(id: number, amount: number, origin: DamageOrigin, shotId: number, weaponId: WeaponId | null, point: Vec3): DamageEvent | null {
    const e = this.enemies.get(id);
    if (!e || !e.alive) return null;
    const wasIonized = e.ionizedUntil > this.time;
    e.hp -= amount;
    const killed = e.hp <= 0;
    if (killed) e.alive = false;
    this.damageLog.push({ id, amount, origin });
    return { shotId, weaponId, attacker: 'player', target: id, amount, origin, killed, wasIonized, point };
  }
  setIonized(id: number, until: number) { const e = this.enemies.get(id); if (e) e.ionizedUntil = until; }
  pushEnemy(id: number, _dir: Vec3, strength: number) { this.pushes.push({ id, strength }); }
  staggerEnemy(id: number, seconds: number) { this.staggers.push({ id, seconds }); }
  refundReserve(weapon: MainWeaponId, amount: number) { this.refunds.push({ weapon, amount }); return amount; }
  transferReserveToMagazine(weapon: MainWeaponId, amount: number) { this.transfers.push({ weapon, amount }); return amount; }
  playerIsMoving() { return this.moving; }
  emit(ev: GameEvent) { this.events.push(ev); }
}

/** Builds a trace of rays along -Z from the origin; each ray hits the given enemies at their z distance. */
export function straightTrace(
  world: FakeWorld, weaponId: WeaponId, pellets: { hits: number[]; worldHitAt?: number }[], opts: { slug?: boolean; shotId?: number } = {},
): ShotTrace {
  const origin = { x: 0, y: 1, z: 0 };
  return {
    shotId: opts.shotId ?? 1, weaponId, origin, muzzle: { x: 0.2, y: 0.9, z: -0.5 }, slug: opts.slug ?? false, time: world.time,
    pellets: pellets.map((p) => ({
      dir: { x: 0, y: 0, z: -1 },
      enemyHits: p.hits.map((id) => {
        const e = world.enemies.get(id)!;
        return { enemy: id, dist: -e.center.z, point: { ...e.center } };
      }),
      worldHit: p.worldHitAt === undefined ? null : { dist: p.worldHitAt, point: { x: 0, y: 1, z: -p.worldHitAt }, normal: { x: 0, y: 0, z: 1 } },
    })),
  };
}
