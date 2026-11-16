import { describe, expect, it } from 'vitest';
import { CardRuntime, CardState, applyDebugLoadout, computeWeaponStats } from '../src/sim/cards';
import { FakeWorld, straightTrace } from '../src/sim/cards/fakeWorld';
import { WEAPONS } from '../src/content/weapons';
import type { WeaponId } from '../src/sim/types';

function rig(cards: string[] = [], equipped: ('coil_carbine' | 'arc_scattergun')[] = ['coil_carbine', 'arc_scattergun']) {
  const state = new CardState(equipped);
  for (const c of cards) state.add(c);
  const rt = new CardRuntime(state, (w: WeaponId) => computeWeaponStats(WEAPONS[w], state));
  return { state, rt, world: new FakeWorld() };
}
const coilBase = 13;

describe('direct damage pipeline', () => {
  it('sums 9 pellets on one target, checks Ionized once (x1.10)', () => {
    const { rt, world } = rig(['ion_primer']);
    world.add(1, 0, -5, { hp: 1000, maxHp: 1000, ionizedUntil: 99 });
    const pellets = Array.from({ length: 9 }, () => ({ hits: [1] }));
    const out = rt.resolveShot(straightTrace(world, 'arc_scattergun', pellets), world);
    expect(world.damageLog).toHaveLength(1);
    expect(out.damage[0]!.amount).toBeCloseTo(90 * 1.1, 6);
    expect(out.damage[0]!.wasIonized).toBe(true);
    expect(out.tracerEnds).toHaveLength(9);
    // the shot re-tags: next shot is also Ionized (still x1.1, not x1.21)
    const out2 = rt.resolveShot(straightTrace(world, 'arc_scattergun', pellets, { shotId: 2 }), world);
    expect(out2.damage[0]!.amount).toBeCloseTo(99, 6);
  });

  it('first hit of a non-ionized target is not boosted, but tags it', () => {
    const { rt, world } = rig(['ion_primer']);
    world.add(1, 0, -10, { hp: 1000 });
    const out = rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [1] }]), world);
    expect(out.damage[0]!.amount).toBeCloseTo(coilBase, 6);
    expect(world.getEnemy(1)!.ionizedUntil).toBe(world.time + 3);
  });

  it('applies falloff per pellet and nothing beyond rangeMax', () => {
    const { rt, world } = rig();
    world.add(1, 0, -15.5, { hp: 1000 }); // arc: 7..24 linear to 0.15 -> mid
    world.add(2, 0, -30, { hp: 1000 });
    const out = rt.resolveShot(straightTrace(world, 'arc_scattergun', [{ hits: [1] }, { hits: [2] }]), world);
    const mul = 1 + (0.15 - 1) * ((15.5 - 7) / 17);
    expect(out.damage).toHaveLength(1);
    expect(out.damage[0]!.amount).toBeCloseTo(10 * mul, 6);
  });

  it('tracer ends: first enemy hit, world hit, or max range', () => {
    const { rt, world } = rig();
    world.add(1, 0, -10);
    const t = straightTrace(world, 'arc_scattergun', [{ hits: [1] }, { hits: [], worldHitAt: 4 }, { hits: [] }]);
    const out = rt.resolveShot(t, world);
    expect(out.tracerEnds[0]).toEqual({ x: 0, y: 1, z: -10 });
    expect(out.tracerEnds[1]).toEqual({ x: 0, y: 1, z: -4 });
    expect(out.tracerEnds[2]!.z).toBeCloseTo(-24, 6);
  });

  it('Service Emitter resolves as emitter origin with no card effects', () => {
    const { rt, world } = rig(['ion_primer', 'chargeback']);
    world.add(1, 0, -10, { hp: 1 });
    const out = rt.resolveShot(straightTrace(world, 'service_emitter', [{ hits: [1] }]), world);
    expect(out.damage[0]!.origin).toBe('emitter');
    expect(world.refunds).toHaveLength(0);
    expect(world.getEnemy(1)!.ionizedUntil).toBe(0);
  });
});

describe('Mass Driver', () => {
  it('pierces one enemy for 60% and not a third; world stops it', () => {
    const { rt, world } = rig(['coil_covenant', 'mass_driver']);
    world.add(1, 0, -10, { hp: 1000 });
    world.add(2, 0, -12, { hp: 1000 });
    world.add(3, 0, -14, { hp: 1000 });
    expect(rt.shotShape('coil_carbine').pierce).toBe(1);
    const out = rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [1, 2, 3] }]), world);
    const b = coilBase * 1.1;
    expect(out.damage.map((d) => d.target)).toEqual([1, 2]);
    expect(out.damage[0]!.amount).toBeCloseTo(b, 6);
    expect(out.damage[1]!.amount).toBeCloseTo(b * 0.6, 6);
    const blocked = rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [1, 2], worldHitAt: 11 }], { shotId: 2 }), world);
    expect(blocked.damage.map((d) => d.target)).toEqual([1]);
  });
});

describe('Chargeback / Ground Loop / cooldowns', () => {
  it('refunds once per 1.5 s across weapons, once per shot even with many kills', () => {
    const { rt, world } = rig(['chargeback']);
    world.add(1, 0, -5, { hp: 1 });
    world.add(2, 0.5, -6, { hp: 1 });
    rt.resolveShot(straightTrace(world, 'arc_scattergun', [{ hits: [1] }, { hits: [2] }]), world);
    expect(world.refunds).toEqual([{ weapon: 'arc_scattergun', amount: 1 }]);
    world.add(3, 0, -5, { hp: 1 });
    world.time += 1.0;
    rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [3] }], { shotId: 2 }), world);
    expect(world.refunds).toHaveLength(1);
    world.add(4, 0, -5, { hp: 1 });
    world.time += 0.6;
    rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [4] }], { shotId: 3 }), world);
    expect(world.refunds).toHaveLength(2);
    expect(world.refunds[1]!.weapon).toBe('coil_carbine');
  });

  it('Ground Loop needs movement, a coil kill and a 0.75 s gap', () => {
    const { rt, world } = rig(['coil_covenant', 'ground_loop']);
    const kill = (id: number, shotId: number) => {
      world.add(id, 0, -5, { hp: 1 });
      rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [id] }], { shotId }), world);
    };
    world.moving = false;
    kill(1, 1);
    expect(world.transfers).toHaveLength(0);
    world.moving = true;
    kill(2, 2);
    expect(world.transfers).toEqual([{ weapon: 'coil_carbine', amount: 2 }]);
    world.time += 0.5;
    kill(3, 3);
    expect(world.transfers).toHaveLength(1);
    world.time += 0.3;
    kill(4, 4);
    expect(world.transfers).toHaveLength(2);
  });
});

describe('Breaker Fuse', () => {
  it('bursts once per shot for a pre-Ionized direct kill; max 4 targets in LOS', () => {
    const { rt, world } = rig(['ion_primer', 'breaker_fuse']);
    world.add(1, 0, -10, { hp: 1, ionizedUntil: 99 });
    world.add(2, 0.5, -10, { hp: 1, ionizedUntil: 99 });
    for (let i = 0; i < 6; i++) world.add(10 + i, 1 + i * 0.3, -10, { hp: 1000 });
    world.blockedLos.add('0,-10>2.5,-10'); // blocks one candidate (id 15 at x=2.5)
    const out = rt.resolveShot(straightTrace(world, 'arc_scattergun', [{ hits: [1] }, { hits: [2] }]), world);
    const bursts = world.events.filter((e) => e.type === 'burst');
    expect(bursts).toHaveLength(1);
    const burstDmg = out.damage.filter((d) => d.origin === 'burst');
    expect(burstDmg).toHaveLength(4);
    expect(burstDmg[0]!.amount).toBeCloseTo(0.3 * 90, 6);
    expect(burstDmg.every((d) => d.target !== 1)).toBe(true);
  });

  it('does not burst when the target was not Ionized before the shot', () => {
    const { rt, world } = rig(['ion_primer', 'breaker_fuse']);
    world.add(1, 0, -10, { hp: 1 });
    world.add(2, 1, -10, { hp: 1000 });
    rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [1] }]), world);
    expect(world.events.filter((e) => e.type === 'burst')).toHaveLength(0);
  });

  it('a kill by secondary damage never triggers direct-kill effects', () => {
    const { rt, world } = rig(['ion_primer', 'breaker_fuse', 'chargeback']);
    world.add(1, 0, -10, { hp: 1, ionizedUntil: 99 }); // killed by direct -> burst
    world.add(2, 1, -10, { hp: 1, ionizedUntil: 99 }); // killed by the burst (secondary)
    world.add(3, 2, -10, { hp: 1000 });
    const out = rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [1] }]), world);
    expect(out.kills).toBe(2);
    expect(world.events.filter((e) => e.type === 'burst')).toHaveLength(1); // no chain burst from enemy 2
    expect(world.refunds).toHaveLength(1);
  });
});

describe('Cascade Bus + Rupture Relay', () => {
  const fire = (rt: CardRuntime, world: FakeWorld, id: number, shotId: number) =>
    rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [id] }], { shotId }), world);

  it('counter advances only on direct damage, fires on the 6th, consumed without a target', () => {
    const { rt, world } = rig(['coil_covenant', 'cascade_bus']);
    world.add(1, 0, -10, { hp: 1e6 });
    expect(rt.cascadeCounter()).toEqual({ count: 0, of: 6 });
    rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [] }]), world); // miss
    expect(rt.cascadeCounter()!.count).toBe(0);
    for (let i = 1; i <= 5; i++) fire(rt, world, 1, i);
    expect(rt.cascadeCounter()!.count).toBe(5);
    const out = fire(rt, world, 1, 6); // no other enemy
    expect(rt.cascadeCounter()!.count).toBe(0);
    expect(out.damage.filter((d) => d.origin === 'cascade')).toHaveLength(0);
    // next cycle with a target
    world.add(2, 3, -10, { hp: 1e6 });
    for (let i = 7; i <= 11; i++) fire(rt, world, 1, i);
    const arc = fire(rt, world, 1, 12);
    const c = arc.damage.filter((d) => d.origin === 'cascade');
    expect(c).toHaveLength(1);
    expect(c[0]!.target).toBe(2);
    expect(c[0]!.amount).toBeCloseTo(0.4 * coilBase * 1.1, 6);
    expect(world.events.filter((e) => e.type === 'arc')).toHaveLength(1);
  });

  it('arc picks nearest visible enemy within 6 m, stable by id on ties', () => {
    const { rt, world } = rig(['coil_covenant', 'cascade_bus']);
    world.add(1, 0, -10, { hp: 1e6 });
    world.add(9, 2, -10, { hp: 1e6 });
    world.add(5, -2, -10, { hp: 1e6 });
    world.add(7, 1, -10, { hp: 1e6 });
    world.blockedLos.add('0,-10>1,-10');
    world.add(8, 7, -10, { hp: 1e6 }); // out of range
    for (let i = 1; i <= 6; i++) fire(rt, world, 1, i);
    const hit = world.damageLog.filter((d) => d.origin === 'cascade');
    expect(hit.map((h) => h.id)).toEqual([5]); // 7 is blocked; 5 and 9 tie at 2 m -> lower id
  });

  it('Rupture Relay chains once to a third enemy at half damage only if recipient Ionized', () => {
    const { state, rt, world } = rig([]);
    applyDebugLoadout(state, 'coil-cascade');
    world.add(1, 0, -10, { hp: 1e6 });
    world.add(2, 3, -10, { hp: 1e6, ionizedUntil: 99 });
    world.add(3, 3, -14, { hp: 1, maxHp: 1 });
    world.add(4, 3, -15, { hp: 1e6 });
    for (let i = 1; i <= 6; i++) fire(rt, world, 1, i);
    const arcs = world.damageLog.filter((d) => d.origin === 'cascade' || d.origin === 'rupture');
    expect(arcs.map((a) => [a.id, a.origin])).toEqual([[2, 'cascade'], [3, 'rupture']]);
    expect(arcs[1]!.amount).toBeCloseTo(arcs[0]!.amount / 2, 6);
    expect(world.getEnemy(3)!.alive).toBe(false); // killed by secondary, no direct-kill procs
    expect(world.events.filter((e) => e.type === 'arc')).toHaveLength(2);
  });

  it('Rupture Relay does nothing when the recipient is not Ionized', () => {
    const { state, rt, world } = rig([]);
    applyDebugLoadout(state, 'coil-cascade');
    world.add(1, 0, -10, { hp: 1e6 });
    world.add(2, 3, -10, { hp: 1e6 });
    world.add(3, 3, -14, { hp: 1e6 });
    for (let i = 1; i <= 6; i++) fire(rt, world, 1, i);
    expect(world.damageLog.filter((d) => d.origin === 'rupture')).toHaveLength(0);
  });
});

describe('Arc pact cards', () => {
  it('Cold Chamber: slug only after a completed reload; consumes; 80% then 45%', () => {
    const { rt, world } = rig(['arc_covenant', 'cold_chamber']);
    expect(rt.coldChamberReady()).toBe(false);
    expect(rt.shotShape('arc_scattergun').slug).toBe(false);
    rt.onReloadComplete('coil_carbine');
    expect(rt.coldChamberReady()).toBe(false);
    rt.onReloadComplete('arc_scattergun');
    const shape = rt.shotShape('arc_scattergun');
    expect(shape).toEqual({ pellets: 1, spreadDeg: 0, slug: true, pierce: 1 });
    expect(rt.shotShape('arc_scattergun').slug).toBe(true); // asking is pure
    world.add(1, 0, -5, { hp: 1000 });
    world.add(2, 0, -6, { hp: 1000 });
    const out = rt.resolveShot(straightTrace(world, 'arc_scattergun', [{ hits: [1, 2] }], { slug: true }), world);
    const base = 90 * 1.1;
    expect(out.damage.map((d) => d.amount)).toEqual([base * 0.8, base * 0.45].map((x) => expect.closeTo(x, 6)));
    expect(rt.coldChamberReady()).toBe(false);
    expect(rt.shotShape('arc_scattergun').slug).toBe(false);
  });

  it('Ion Fan changes the standard shape', () => {
    const { rt } = rig(['arc_covenant', 'ion_fan']);
    expect(rt.shotShape('arc_scattergun')).toMatchObject({ pellets: 11, slug: false });
    expect(rt.shotShape('arc_scattergun').spreadDeg).toBeCloseTo(16.25, 6);
  });

  it('Repulsion pushes light enemies within 7 m once per enemy; heavies resist with feedback', () => {
    const { rt, world } = rig(['arc_covenant', 'repulsion_chamber']);
    world.add(1, 0, -5, { hp: 1000 });
    world.add(2, 0, -6, { hp: 1000, heavy: true, kind: 'loader' });
    world.add(3, 0, -9, { hp: 1000 });
    rt.resolveShot(straightTrace(world, 'arc_scattergun', [{ hits: [1] }, { hits: [1] }, { hits: [2] }, { hits: [3] }]), world);
    expect(world.pushes.map((p) => p.id)).toEqual([1]);
    const fb = world.events.filter((e) => e.type === 'enemy_hit');
    expect(fb).toHaveLength(1);
  });

  it('Backwash needs >=3 distinct enemies, caps at 5, 1 s cooldown', () => {
    const { rt, world } = rig(['arc_covenant', 'ion_fan', 'backwash']);
    for (let i = 1; i <= 7; i++) world.add(i, (i - 4) * 0.4, -4, { hp: 1000 });
    const pel = (ids: number[]) => ids.map((id) => ({ hits: [id] }));
    rt.resolveShot(straightTrace(world, 'arc_scattergun', pel([1, 2])), world);
    expect(world.staggers).toHaveLength(0);
    rt.resolveShot(straightTrace(world, 'arc_scattergun', pel([1, 2, 3, 3]), { shotId: 2 }), world);
    expect(world.staggers).toHaveLength(5);
    expect(world.events.filter((e) => e.type === 'cone')).toHaveLength(1);
    world.time += 0.5;
    rt.resolveShot(straightTrace(world, 'arc_scattergun', pel([1, 2, 3]), { shotId: 3 }), world);
    expect(world.staggers).toHaveLength(5);
    world.time += 0.6;
    rt.resolveShot(straightTrace(world, 'arc_scattergun', pel([1, 2, 3]), { shotId: 4 }), world);
    expect(world.staggers).toHaveLength(10);
  });

  it('surrendered-weapon procs do not fire (cards inactive)', () => {
    const { rt, world } = rig(['coil_covenant']);
    world.add(1, 0, -5, { hp: 1 });
    const out = rt.resolveShot(straightTrace(world, 'coil_carbine', [{ hits: [1] }]), world);
    expect(out.kills).toBe(1);
  });
});
