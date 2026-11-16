import { afterEach, describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../src/physics/world';
import { WeaponSystem, NO_WEAPON_INPUT, type WeaponDeps, type WeaponInput, type WeaponView } from '../src/sim/weapons';
import { WEAPONS, AMMO_PICKUP } from '../src/content/weapons';
import { Rng } from '../src/core/rng';
import { SIM_DT, type CombatWorld, type GameEvent, type RayEnemyHit, type ShotTrace, type WeaponId, type WeaponStats } from '../src/sim/types';
import type { PhysicsQueries } from '../src/physics/types';
import { testLevel } from './physicsFixtures';

const noPhys: PhysicsQueries = { raycast: () => null, lineOfSight: () => true, groundHeight: () => 0 };

function baseStats(w: WeaponId): WeaponStats {
  const d = WEAPONS[w];
  return {
    id: w, damage: d.damage, damageBonus: 0, pellets: d.pellets, spreadDeg: d.spreadDeg, fireInterval: d.fireInterval,
    reloadTime: d.reloadTime, capacity: d.capacity, rangeEffective: d.rangeEffective, rangeMax: d.rangeMax,
    falloffMinMul: d.falloffMinMul, pierce: 0, pierceDamageMul: 1, active: true,
  };
}

function setup(opts: { phys?: PhysicsQueries; enemies?: WeaponDeps['enemies']; starter?: 'coil_carbine' | 'arc_scattergun' } = {}) {
  const events: GameEvent[] = [];
  const traces: ShotTrace[] = [];
  let swaps = 0;
  const reloadsDone: WeaponId[] = [];
  const deps: WeaponDeps = {
    phys: opts.phys ?? noPhys,
    enemies: opts.enemies ?? { raycast: (): RayEnemyHit[] => [] },
    cards: {
      shotShape: (w) => ({ pellets: WEAPONS[w].pellets, spreadDeg: WEAPONS[w].spreadDeg, slug: false, pierce: 0 }),
      resolveShot: (t) => {
        traces.push(t);
        return { tracerEnds: [] };
      },
      onReloadComplete: (w) => reloadsDone.push(w),
      onSwap: () => swaps++,
    },
    stats: baseStats,
    world: () => ({} as CombatWorld),
    rng: new Rng('t').fork('spread'),
    emit: (e) => events.push(e),
  };
  const ws = new WeaponSystem(deps, opts.starter ?? 'coil_carbine');
  let time = 0;
  const view = (): WeaponView => ({ eye: { x: 0, y: 1.62, z: 0 }, yaw: 0, pitch: 0, time });
  const tick = (input: Partial<WeaponInput> = {}, n = 1) => {
    for (let i = 0; i < n; i++) {
      time += SIM_DT;
      ws.step(SIM_DT, { ...NO_WEAPON_INPUT, ...input }, view());
    }
  };
  return { ws, events, traces, tick, reloadsDone, swaps: () => swaps, time: () => time };
}
const count = (events: GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type).length;

describe('weapon state machine', () => {
  it('automatic fire honours the fire interval at 60 Hz', () => {
    const { ws, traces, tick } = setup();
    ws.refundReserve('coil_carbine', 200);
    tick({}, 30); // let nothing happen
    const start = ws.magazine();
    tick({ fireHeld: true }, 60 * 3);
    const shots = traces.length;
    const expected = 3 / WEAPONS.coil_carbine.fireInterval;
    expect(shots).toBeGreaterThan(expected - 2);
    expect(shots).toBeLessThan(expected + 2);
    expect(start - ws.magazine()).toBe(shots > start ? start : shots);
  });

  it('semi-auto weapons need a fresh press and respect their interval', () => {
    const { ws, traces, tick } = setup({ starter: 'arc_scattergun' });
    tick({ fireHeld: true }, 120); // held without a press: nothing
    expect(traces.length).toBe(0);
    tick({ fireHeld: true, firePressed: true });
    expect(traces.length).toBe(1);
    tick({ fireHeld: true, firePressed: true }); // too soon: ignored once the buffer lapses
    tick({ fireHeld: true }, Math.ceil(WEAPONS.arc_scattergun.fireInterval / SIM_DT));
    expect(traces.length).toBe(1);
    // A click slightly before the weapon is ready is buffered and fires on time.
    tick({}, 1);
    tick({ firePressed: true });
    tick({}, 20);
    expect(traces.length).toBe(2);
    expect(ws.magazine()).toBe(WEAPONS.arc_scattergun.capacity - 2);
    expect(traces[0]!.pellets.length).toBe(9);
  });

  it('reload completes after reloadTime and moves the right amount', () => {
    const { ws, events, tick, reloadsDone } = setup();
    tick({ fireHeld: true }, 20);
    const mag = ws.magazine();
    const reserveBefore = ws.reserve();
    expect(mag).toBeLessThan(32);
    tick({ reload: true });
    expect(ws.reloading).toBe(true);
    tick({}, Math.ceil(WEAPONS.coil_carbine.reloadTime / SIM_DT) + 1);
    expect(ws.reloading).toBe(false);
    expect(ws.magazine()).toBe(32);
    expect(ws.reserve()).toBe(reserveBefore - (32 - mag));
    expect(count(events, 'reload_done')).toBe(1);
    expect(reloadsDone).toEqual(['coil_carbine']);
  });

  it('reload is limited by reserve and never starts when full or dry', () => {
    const { ws, tick, events } = setup();
    tick({ reload: true });
    expect(ws.reloading).toBe(false); // full
    tick({ fireHeld: true }, 10);
    // drain reserve to 3
    const s = ws as unknown as { st: Record<string, { reserve: number; mag: number }> };
    s.st.coil_carbine!.reserve = 3;
    s.st.coil_carbine!.mag = 10;
    tick({ reload: true });
    tick({}, 100);
    expect(ws.magazine()).toBe(13);
    expect(ws.reserve()).toBe(0);
    tick({ reload: true });
    expect(ws.reloading).toBe(false);
    expect(count(events, 'reload_start')).toBe(1);
  });

  it('swapping cancels the reload; dash/sprint do not', () => {
    const { ws, events, tick } = setup();
    ws.giveMain('arc_scattergun');
    tick({ fireHeld: true }, 10);
    tick({ reload: true });
    tick({}, 20); // mid-reload
    expect(ws.reloading).toBe(true);
    tick({ slot2: true });
    expect(ws.reloading).toBe(false);
    expect(ws.current).toBe('arc_scattergun');
    expect(count(events, 'reload_cancel')).toBe(1);
    expect(count(events, 'reload_done')).toBe(0);
    // Magazine unchanged by the cancelled reload.
    tick({ slot1: true });
    expect(ws.magazine()).toBeLessThan(32);
  });

  it('cannot fire until the swapped-to weapon is raised', () => {
    const { ws, traces, tick } = setup();
    ws.giveMain('arc_scattergun');
    tick({ slot2: true });
    tick({ fireHeld: true, firePressed: true });
    expect(traces.length).toBe(0);
    tick({}, Math.ceil(WEAPONS.arc_scattergun.equipTime / SIM_DT));
    tick({ fireHeld: true, firePressed: true });
    expect(traces.length).toBe(1);
  });

  it('ammo never goes negative; empty trigger emits dry_fire and auto-reloads when possible', () => {
    const { ws, events, tick } = setup();
    const s = ws as unknown as { st: Record<string, { reserve: number; mag: number }> };
    s.st.coil_carbine!.reserve = 0;
    tick({ fireHeld: true }, 60 * 8);
    expect(ws.magazine()).toBe(0);
    expect(count(events, 'dry_fire')).toBeGreaterThan(0);
    expect(ws.reserve()).toBe(0);
    // With reserve: pulling the trigger on an empty mag starts a reload.
    s.st.coil_carbine!.reserve = 50;
    tick({ fireHeld: true }, 2);
    expect(ws.reloading).toBe(true);
    tick({}, 120);
    expect(ws.magazine()).toBe(32);
    expect(ws.reserve()).toBe(18);
  });

  it('service emitter recharges over time and spends charge per shot', () => {
    const { ws, traces, tick } = setup();
    tick({ backup: true });
    tick({}, 30);
    expect(ws.current).toBe('service_emitter');
    for (let i = 0; i < 10; i++) {
      tick({ firePressed: true });
      tick({}, 20);
    }
    expect(traces.length).toBeGreaterThanOrEqual(7);
    const low = ws.charge;
    expect(low).toBeLessThan(10);
    tick({}, 60);
    expect(ws.charge).toBeGreaterThan(low + 1.2);
    expect(ws.charge).toBeLessThanOrEqual(10);
    // Q again returns to the last main.
    tick({ backup: true });
    expect(ws.current).toBe('coil_carbine');
  });

  it('ammo pickups: caps, per-weapon reserves and pact redirection', () => {
    const { ws } = setup();
    expect(ws.addAmmoPickup('arc_charges', 1)).toBeNull(); // arc not owned yet
    const r = ws.addAmmoPickup('coil_cells', 1)!;
    expect(r.weapon).toBe('coil_carbine');
    expect(r.added).toBe(Math.min(AMMO_PICKUP.coil_cells, 256 - 96));
    ws.refundReserve('coil_carbine', 999);
    expect(ws.addAmmoPickup('coil_cells', 1)!.added).toBe(0);
    // Funnel multiplier
    ws.giveMain('arc_scattergun');
    const before = ws.reserve('arc_scattergun');
    expect(ws.addAmmoPickup('arc_charges', 1.5)!.added).toBe(Math.min(12, WEAPONS.arc_scattergun.reserveMax - before));
    // Pact on arc: coil pickups convert at 0.2 into arc reserve.
    ws.applyPact('arc_scattergun');
    expect(ws.current).toBe('arc_scattergun');
    expect(ws.isLocked('coil_carbine')).toBe(true);
    const a0 = ws.reserve('arc_scattergun');
    const conv = ws.addAmmoPickup('coil_cells', 1)!;
    expect(conv.weapon).toBe('arc_scattergun');
    expect(conv.added).toBe(Math.min(8, WEAPONS.arc_scattergun.reserveMax - a0));
    expect(ws.pactWeaponConversion()!.salvage).toBe(15);
  });

  it('refund/transfer helpers respect caps', () => {
    const { ws, tick } = setup();
    tick({ fireHeld: true }, 30);
    const mag = ws.magazine();
    const moved = ws.transferReserveToMagazine('coil_carbine', 100);
    expect(moved).toBe(32 - mag);
    expect(ws.magazine()).toBe(32);
    expect(ws.refundReserve('coil_carbine', 10_000)).toBeGreaterThan(0);
    expect(ws.reserve()).toBe(256);
  });
});

describe('shot tracing and muzzle reconciliation', () => {
  let pw: PhysicsWorld | null = null;
  afterEach(() => {
    pw?.dispose();
    pw = null;
  });

  it('a wall between the eye and the muzzle stops the shot there', async () => {
    // Eye at z=0 facing -Z; muzzle is ~0.78 m ahead. Wall 0.4 m in front of the eye.
    pw = await PhysicsWorld.create(testLevel([{ pos: { x: 0, y: 1.6, z: -0.5 }, size: { x: 10, y: 4, z: 0.2 }, mat: 'concrete' }]));
    const enemyHit: RayEnemyHit = { enemy: 1, dist: 8, point: { x: 0, y: 1.6, z: -8 } };
    const enemiesCalls: number[] = [];
    const { ws, traces, tick } = setup({
      phys: pw,
      enemies: { raycast: (_o, _d, maxDist) => { enemiesCalls.push(maxDist); return maxDist >= 8 ? [enemyHit] : []; } },
    });
    tick({ fireHeld: true });
    expect(traces.length).toBe(1);
    const p = traces[0]!.pellets[0]!;
    expect(p.worldHit).not.toBeNull();
    expect(p.worldHit!.dist).toBeLessThan(0.6);
    expect(p.enemyHits.length).toBe(0);
    expect(ws.magazine()).toBe(31);
  });

  it('with a clear line the shot reaches the enemy and the far wall', async () => {
    pw = await PhysicsWorld.create(testLevel([{ pos: { x: 0, y: 1.6, z: -20 }, size: { x: 10, y: 4, z: 1 }, mat: 'concrete' }]));
    const { traces, tick, events } = setup({
      phys: pw,
      enemies: { raycast: (_o, _d, maxDist) => (maxDist >= 8 ? [{ enemy: 7, dist: 8, point: { x: 0, y: 1.6, z: -8 } }] : []) },
    });
    tick({ fireHeld: true });
    const p = traces[0]!.pellets[0]!;
    expect(p.enemyHits.map((h) => h.enemy)).toEqual([7]);
    expect(p.worldHit!.dist).toBeCloseTo(19.5, 0);
    expect(events.some((e) => e.type === 'shot')).toBe(true);
    // Single enemy hit with pierce 0: no world impact event.
    expect(events.filter((e) => e.type === 'impact').length).toBe(0);
  });

  it('a pillar edge that hides the muzzle but not the eye also blocks the shot', async () => {
    // Thin pillar just right of the aim line: muzzle (x=+0.2) is behind it, eye is not.
    pw = await PhysicsWorld.create(testLevel([{ pos: { x: 0.18, y: 1.6, z: -1.2 }, size: { x: 0.2, y: 4, z: 2.0 }, mat: 'concrete' }]));
    const { traces, tick } = setup({ phys: pw });
    tick({ fireHeld: true });
    const p = traces[0]!.pellets[0]!;
    expect(p.worldHit).not.toBeNull();
    expect(p.worldHit!.dist).toBeLessThan(3);
  });

  it('pellet spread is deterministic for a seed and uses the spread stream only', () => {
    const a = setup({ starter: 'arc_scattergun' });
    const b = setup({ starter: 'arc_scattergun' });
    a.tick({ firePressed: true });
    b.tick({ firePressed: true });
    expect(a.traces[0]!.pellets.map((p) => p.dir)).toEqual(b.traces[0]!.pellets.map((p) => p.dir));
    const maxAngle = Math.max(...a.traces[0]!.pellets.map((p) => Math.acos(-p.dir.z)));
    expect(maxAngle).toBeLessThanOrEqual((13 / 2) * (Math.PI / 180) + 0.02);
  });
});
