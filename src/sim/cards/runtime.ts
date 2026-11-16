import type {
  CombatWorld, DamageEvent, DamageOrigin, EnemyInfo, MainWeaponId, ShotShape, ShotTrace, Vec3, WeaponId, WeaponStats,
} from '../types';
import { WEAPONS } from '../../content/weapons';
import { paramsOf } from '../../content/cards';
import type { CardState } from './state';

export interface ShotOutcome {
  damage: DamageEvent[];
  /** One end point per pellet: first enemy hit, else world hit, else max range. */
  tracerEnds: Vec3[];
  /** Kills across direct and secondary damage of this shot. */
  kills: number;
}

interface Agg {
  id: number;
  amount: number;
  dist: number;
  point: Vec3;
  center: Vec3;
  heavy: boolean;
  wasIonized: boolean;
  pos: Vec3;
}
interface Direct extends Agg {
  ev: DamageEvent;
}

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const byDistId = (a: { d: number; id: number }, b: { d: number; id: number }) => a.d - b.d || a.id - b.id;

export class CardRuntime {
  private cascadeCount = 0;
  private coldReady = false;
  private lastChargeback = -Infinity;
  private lastGroundLoop = -Infinity;
  private lastBackwash = -Infinity;

  constructor(
    private readonly state: CardState,
    private readonly stats: (w: WeaponId) => WeaponStats,
  ) {}

  private has(id: string): boolean {
    return this.state.has(id);
  }

  /** Asked right before tracing. Pure: consuming Cold Chamber happens in resolveShot. */
  shotShape(w: WeaponId): ShotShape {
    const st = this.stats(w);
    if (w === 'arc_scattergun' && this.has('cold_chamber') && this.coldReady) {
      const p = paramsOf('cold_chamber', 'cold_chamber');
      return { pellets: p.pellets ?? 1, spreadDeg: 0, slug: true, pierce: p.pierce ?? 1 };
    }
    return { pellets: st.pellets, spreadDeg: st.spreadDeg, slug: false, pierce: st.pierce };
  }

  onReloadComplete(w: WeaponId): void {
    if (w === 'arc_scattergun' && this.has('cold_chamber')) this.coldReady = true;
  }

  /** Swapping keeps Cold Chamber charged (only a completed reload arms it, only a shot spends it). */
  onSwap(): void {}

  cascadeCounter(): { count: number; of: number } | null {
    if (!this.has('cascade_bus')) return null;
    return { count: this.cascadeCount, of: paramsOf('cascade_bus', 'cascade_bus').every ?? 6 };
  }

  coldChamberReady(): boolean | null {
    return this.has('cold_chamber') ? this.coldReady : null;
  }

  resolveShot(trace: ShotTrace, world: CombatWorld): ShotOutcome {
    const w = trace.weaponId;
    const def = WEAPONS[w];
    const stats = this.stats(w);
    const emitter = w === 'service_emitter';
    const slug = !emitter && trace.slug && w === 'arc_scattergun' && this.has('cold_chamber');
    if (slug) this.coldReady = false;

    const baseShot = def.damage * (1 + stats.damageBonus);
    const perPellet = baseShot / def.pellets;
    const cold = paramsOf('cold_chamber', 'cold_chamber');
    const slugMul = [cold.damageFrac1 ?? 0.8, cold.damageFrac2 ?? 0.45];
    const maxHits = 1 + (slug ? (cold.pierce ?? 1) : stats.pierce);
    const ionBonus = paramsOf('ion_primer', 'ion_primer').ionizedBonus ?? 0.1;

    const outcome: ShotOutcome = { damage: [], tracerEnds: [], kills: 0 };
    const falloff = (d: number): number => {
      if (d <= stats.rangeEffective) return 1;
      if (d > stats.rangeMax) return 0;
      const t = (d - stats.rangeEffective) / Math.max(1e-6, stats.rangeMax - stats.rangeEffective);
      return 1 + (stats.falloffMinMul - 1) * t;
    };

    // --- Step 3: per-target aggregation (pre-shot Ionized state captured here, once per target).
    const agg = new Map<number, Agg>();
    const infoCache = new Map<number, EnemyInfo | null>();
    const pelletHits: { id: number; dist: number }[][] = [];
    for (const p of trace.pellets) {
      const hits = p.enemyHits
        .filter((h) => h.dist <= stats.rangeMax && (!p.worldHit || h.dist <= p.worldHit.dist))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, maxHits);
      const used: { id: number; dist: number }[] = [];
      hits.forEach((h, i) => {
        let info = infoCache.get(h.enemy);
        if (info === undefined) {
          info = world.getEnemy(h.enemy) ?? null;
          infoCache.set(h.enemy, info);
        }
        if (!info || !info.alive) return;
        const mul = slug ? (slugMul[i] ?? slugMul[slugMul.length - 1]!) : i === 0 ? 1 : stats.pierceDamageMul;
        const dmg = (slug ? baseShot : perPellet) * mul * falloff(h.dist);
        if (dmg <= 0) return;
        used.push({ id: h.enemy, dist: h.dist });
        let a = agg.get(h.enemy);
        if (!a) {
          a = {
            id: h.enemy, amount: 0, dist: h.dist, point: h.point, center: info.center, pos: info.pos,
            heavy: info.heavy, wasIonized: info.ionizedUntil > world.time,
          };
          agg.set(h.enemy, a);
        }
        a.amount += dmg;
        if (h.dist < a.dist) {
          a.dist = h.dist;
          a.point = h.point;
        }
      });
      pelletHits.push(used);
      const first = hits[0];
      const dir = p.dir;
      outcome.tracerEnds.push(
        first
          ? first.point
          : p.worldHit
            ? p.worldHit.point
            : {
                x: trace.origin.x + dir.x * stats.rangeMax,
                y: trace.origin.y + dir.y * stats.rangeMax,
                z: trace.origin.z + dir.z * stats.rangeMax,
              },
      );
    }

    // --- Step 3/4: apply direct damage once per target, deterministic order.
    const origin: DamageOrigin = emitter ? 'emitter' : 'direct';
    const targets = [...agg.values()].sort((a, b) => a.dist - b.dist || a.id - b.id);
    const directs: Direct[] = [];
    for (const t of targets) {
      let amount = t.amount;
      if (!emitter && t.wasIonized) amount *= 1 + ionBonus;
      const ev = world.damageEnemy(t.id, amount, origin, trace.shotId, w, t.point);
      if (!ev) continue;
      const e2 = { ...ev, wasIonized: t.wasIonized };
      outcome.damage.push(e2);
      if (e2.killed) outcome.kills++;
      directs.push({ ...t, ev: e2 });
    }
    if (emitter || directs.length === 0) {
      return outcome;
    }

    const main = w as MainWeaponId;
    const time = world.time;
    const kills = directs.filter((d) => d.ev.killed);
    const secondary = (e: EnemyInfo | { id: number; center: Vec3 }, amount: number, o: DamageOrigin) => {
      const ev = world.damageEnemy(e.id, amount, o, trace.shotId, w, e.center);
      if (ev) {
        outcome.damage.push(ev);
        if (ev.killed) outcome.kills++;
      }
      return ev;
    };
    const near = (center: Vec3, radius: number, exclude: Set<number>, max: number) =>
      world
        .enemiesInRadius(center, radius)
        .filter((e) => e.alive && !exclude.has(e.id) && dist3(center, e.center) <= radius + 1e-9 && world.lineOfSight(center, e.center))
        .map((e) => ({ e, d: dist3(center, e.center), id: e.id }))
        .sort(byDistId)
        .slice(0, max)
        .map((x) => x.e);

    // 5a. Ion Primer: tag surviving direct targets.
    if (this.has('ion_primer')) {
      const p = paramsOf('ion_primer', 'ion_primer');
      for (const d of directs) if (!d.ev.killed) world.setIonized(d.id, time + (p.duration ?? 3));
    }

    // 5b. Chargeback.
    if (this.has('chargeback') && kills.length > 0) {
      const p = paramsOf('chargeback', 'chargeback');
      if (time - this.lastChargeback >= (p.cooldown ?? 1.5)) {
        this.lastChargeback = time;
        world.refundReserve(main, p.amount ?? 1);
      }
    }

    // 5c. Ground Loop.
    if (this.has('ground_loop') && w === 'coil_carbine' && kills.length > 0 && world.playerIsMoving()) {
      const p = paramsOf('ground_loop', 'ground_loop');
      if (time - this.lastGroundLoop >= (p.cooldown ?? 0.75)) {
        this.lastGroundLoop = time;
        world.transferReserveToMagazine(main, p.amount ?? 2);
      }
    }

    // 5d. Breaker Fuse: one burst per shot, from the first (distance, id) kill on a pre-Ionized target.
    if (this.has('breaker_fuse')) {
      const src = kills.find((d) => d.wasIonized);
      if (src) {
        const p = paramsOf('breaker_fuse', 'breaker_fuse');
        const radius = p.radius ?? 3;
        world.emit({ type: 'burst', pos: src.center, radius, origin: 'burst' });
        const amount = (p.damageFrac ?? 0.3) * baseShot;
        for (const e of near(src.center, radius, new Set([src.id]), p.maxTargets ?? 4)) secondary(e, amount, 'burst');
      }
    }

    // 5e. Cascade Bus (coil only) + 5f. Rupture Relay.
    if (this.has('cascade_bus') && w === 'coil_carbine') {
      const p = paramsOf('cascade_bus', 'cascade_bus');
      this.cascadeCount++;
      if (this.cascadeCount >= (p.every ?? 6)) {
        this.cascadeCount = 0;
        const first = directs[0]!;
        const [rec] = near(first.center, p.range ?? 6, new Set([first.id]), p.maxTargets ?? 1);
        if (rec) {
          const arcDmg = (p.damageFrac ?? 0.4) * baseShot;
          world.emit({ type: 'arc', from: first.center, to: rec.center, origin: 'cascade' });
          const recIonized = (world.getEnemy(rec.id)?.ionizedUntil ?? 0) > time;
          secondary(rec, arcDmg, 'cascade');
          if (this.has('rupture_relay') && recIonized) {
            const r = paramsOf('rupture_relay', 'rupture_relay');
            const [third] = near(rec.center, r.range ?? 5, new Set([first.id, rec.id]), r.maxChain ?? 1);
            if (third) {
              world.emit({ type: 'arc', from: rec.center, to: third.center, origin: 'rupture' });
              secondary(third, (r.damageFrac ?? 0.5) * arcDmg, 'rupture');
            }
          }
        }
      }
    }

    // 5g. Repulsion Chamber (arc standard discharges).
    if (this.has('repulsion_chamber') && w === 'arc_scattergun' && !slug) {
      const p = paramsOf('repulsion_chamber', 'repulsion_chamber');
      for (const d of directs) {
        if (d.dist > (p.range ?? 7) || d.ev.killed) continue;
        const info = world.getEnemy(d.id);
        if (!info || !info.alive) continue;
        if (info.heavy) {
          world.emit({ type: 'enemy_hit', id: d.id, kind: info.kind, amount: 0, point: d.point, origin: 'direct' });
        } else {
          const dx = info.pos.x - trace.origin.x;
          const dz = info.pos.z - trace.origin.z;
          const l = Math.hypot(dx, dz) || 1;
          world.pushEnemy(d.id, { x: dx / l, y: 0, z: dz / l }, p.strength ?? 7);
        }
      }
    }

    // 5h. Backwash.
    if (this.has('backwash') && w === 'arc_scattergun' && !slug) {
      const p = paramsOf('backwash', 'backwash');
      if (directs.length >= (p.minTargets ?? 3) && time - this.lastBackwash >= (p.cooldown ?? 1)) {
        this.lastBackwash = time;
        let sx = 0, sy = 0, sz = 0;
        for (const pel of trace.pellets) {
          sx += pel.dir.x; sy += pel.dir.y; sz += pel.dir.z;
        }
        const sl = Math.hypot(sx, sy, sz) || 1;
        const dir = { x: sx / sl, y: sy / sl, z: sz / sl };
        const range = p.range ?? 5.5;
        const cosMin = Math.cos(((p.halfAngleDeg ?? 40) * Math.PI) / 180);
        const o = trace.origin;
        const picks = world
          .enemiesInRadius(o, range)
          .map((e) => {
            const d = dist3(o, e.center);
            const dot = d > 1e-6 ? ((e.center.x - o.x) * dir.x + (e.center.y - o.y) * dir.y + (e.center.z - o.z) * dir.z) / d : 1;
            return { e, d, id: e.id, dot };
          })
          .filter((x) => x.e.alive && x.d <= range && x.dot >= cosMin && world.lineOfSight(o, x.e.center))
          .sort(byDistId)
          .slice(0, p.maxTargets ?? 5);
        world.emit({ type: 'cone', pos: trace.muzzle, dir, range });
        for (const x of picks) world.staggerEnemy(x.e.id, p.stagger ?? 0.9);
      }
    }

    void pelletHits;
    return outcome;
  }
}
