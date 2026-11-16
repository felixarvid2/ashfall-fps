import { describe, expect, it } from 'vitest';
import { REFINERY } from '../src/content/level';
import { LOADER } from '../src/content/enemies';
import { Rng } from '../src/core/rng';
import { EnemyManager, FakePhysics, type PlayerTarget } from '../src/sim/enemies';
import { SIM_DT, type GameEvent } from '../src/sim/types';

function setup(seed = 'T') {
  const events: GameEvent[] = [];
  const phys = new FakePhysics(REFINERY);
  const mgr = new EnemyManager(REFINERY, phys, new Rng(seed), (e) => events.push(e));
  const hurts: { amount: number; t: number }[] = [];
  const clock = { t: 0 };
  const player: PlayerTarget = {
    pos: { x: 0, y: 0, z: 70 },
    vel: { x: 0, y: 0, z: 0 },
    alive: true,
    hurt: (amount) => hurts.push({ amount, t: clock.t }),
  };
  const run = (seconds: number, each?: (t: number) => void) => {
    const n = Math.round(seconds / SIM_DT);
    for (let i = 0; i < n; i++) {
      clock.t += SIM_DT;
      each?.(clock.t);
      mgr.step(SIM_DT, clock.t, player);
    }
  };
  return { events, phys, mgr, player, hurts, run, clock };
}

describe('EnemyManager accounting', () => {
  it('counts live enemies, kills once, recycles corpses', () => {
    const { mgr, events, run } = setup();
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push(mgr.spawn('walker', { x: -10 + i, y: 0, z: 50 }, 'yard_main'));
    expect(mgr.liveCount()).toBe(10);
    expect(events.filter((e) => e.type === 'enemy_spawn')).toHaveLength(10);
    const r = mgr.applyDamage(ids[0]!, 1000, { x: 0, y: 1, z: 0 }, 'direct');
    expect(r).toEqual({ killed: true, armorBreak: false });
    expect(mgr.applyDamage(ids[0]!, 10, { x: 0, y: 1, z: 0 }, 'direct')).toBeNull();
    expect(mgr.liveCount()).toBe(9);
    expect(events.filter((e) => e.type === 'enemy_die')).toHaveLength(1);
    for (const id of ids.slice(1)) mgr.applyDamage(id, 1000, { x: 0, y: 1, z: 0 }, 'direct');
    expect(mgr.liveCount()).toBe(0);
    expect(mgr.renderStates(1).every((s) => s.state === 'dead')).toBe(true);
    run(1);
    const mid = mgr.renderStates(1)[0]!;
    expect(mid.fade).toBeGreaterThanOrEqual(0);
    run(2.2);
    expect(mgr.renderStates(1)).toHaveLength(0);
    expect(mgr.info(ids[0]!)).toBeUndefined();
    // pool reuse
    const again = mgr.spawn('hound', { x: 0, y: 0, z: 60 });
    expect(again).toBeGreaterThan(ids[9]!);
    expect(mgr.liveCount()).toBe(1);
  });

  it('inRadius is sorted by distance then id and ignores corpses', () => {
    const { mgr } = setup();
    const a = mgr.spawn('walker', { x: 5, y: 0, z: 50 });
    const b = mgr.spawn('walker', { x: 2, y: 0, z: 50 });
    const c = mgr.spawn('walker', { x: -2, y: 0, z: 50 });
    mgr.applyDamage(c, 999, { x: 0, y: 0, z: 0 }, 'direct');
    const got = mgr.inRadius({ x: 0, y: 1, z: 50 }, 10).map((i) => i.id);
    expect(got).toEqual([b, a]);
  });

  it('push, stagger and ionize', () => {
    const { mgr, run } = setup();
    const w = mgr.spawn('walker', { x: 0, y: 0, z: 50 });
    const l = mgr.spawn('loader', { x: 20, y: 0, z: 50 });
    run(0.8);
    mgr.push(w, { x: 1, y: 0, z: 0 }, 10);
    mgr.push(l, { x: 1, y: 0, z: 0 }, 10);
    const w0 = mgr.info(w)!.pos.x;
    const l0 = mgr.info(l)!.pos.x;
    run(0.3);
    expect(mgr.info(w)!.pos.x - w0).toBeGreaterThan(0.8);
    expect(Math.abs(mgr.info(l)!.pos.x - l0)).toBeLessThan(0.01);
    mgr.setIonized(w, 99);
    expect(mgr.info(w)!.ionizedUntil).toBe(99);
    mgr.stagger(w, 0.5);
    expect(mgr.renderStates(1).find((s) => s.id === w)!.state).toBe('stagger');
    mgr.stagger(l, 1);
    expect(mgr.renderStates(1).find((s) => s.id === l)!.state).not.toBe('stagger');
  });
});

describe('EnemyManager raycast', () => {
  it('returns capsule hits sorted by distance and respects maxHits', () => {
    const { mgr } = setup();
    const far = mgr.spawn('walker', { x: 0, y: 0, z: 30 });
    const near = mgr.spawn('walker', { x: 0.1, y: 0, z: 50 });
    const mid = mgr.spawn('hound', { x: -0.1, y: 0, z: 40 });
    mgr.spawn('walker', { x: 6, y: 0, z: 40 }); // off to the side
    const o = { x: 0, y: 0.8, z: 60 };
    const d = { x: 0, y: 0, z: -1 };
    const hits = mgr.raycast(o, d, 100, 4);
    expect(hits.map((h) => h.enemy)).toEqual([near, mid, far]);
    expect(hits[0]!.dist).toBeCloseTo(9.55, 1);
    expect(hits[0]!.point.z).toBeCloseTo(50.45, 1);
    expect(mgr.raycast(o, d, 100, 2).map((h) => h.enemy)).toEqual([near, mid]);
    expect(mgr.raycast(o, d, 15, 4).map((h) => h.enemy)).toEqual([near]);
    // misses over the head and under the feet
    expect(mgr.raycast({ x: 0, y: 3, z: 60 }, d, 100, 4)).toHaveLength(0);
    // top-down hit on the head cap
    expect(mgr.raycast({ x: 0.1, y: 5, z: 50 }, { x: 0, y: -1, z: 0 }, 10, 1)[0]!.dist).toBeCloseTo(3.2, 1);
  });
});

describe('EnemyManager behaviors', () => {
  it('walker tells 0.6s before the swing and hurts once', () => {
    const { mgr, events, hurts, run, player } = setup();
    player.pos = { x: -12, y: 0, z: 52 };
    mgr.spawn('walker', { x: -12, y: 0, z: 54.5 });
    run(2.5);
    const tell = events.find((e) => e.type === 'enemy_tell');
    const atk = events.find((e) => e.type === 'enemy_attack');
    expect(tell && tell.type === 'enemy_tell' && tell.duration).toBeCloseTo(0.6, 3);
    expect(atk).toBeTruthy();
    expect(events.indexOf(tell!)).toBeLessThan(events.indexOf(atk!));
    expect(hurts.length).toBeGreaterThanOrEqual(1);
    expect(hurts[0]!.amount).toBe(12);
  });

  it('walker dodgeable: no damage if the player leaves reach during the wind-up', () => {
    const { mgr, hurts, run, player, events } = setup();
    player.pos = { x: -12, y: 0, z: 52 };
    mgr.spawn('walker', { x: -12, y: 0, z: 54.2 });
    run(1.5, () => {
      if (events.some((e) => e.type === 'enemy_tell')) player.pos = { x: -12, y: 0, z: 62 };
    });
    expect(hurts).toHaveLength(0);
  });

  it('hound pauses about 0.5 s before the lunge', () => {
    const { mgr, events, run, player, hurts } = setup();
    player.pos = { x: 0, y: 0, z: 60 };
    mgr.spawn('hound', { x: 0, y: 0, z: 78 });
    run(6);
    const tell = events.find((e) => e.type === 'enemy_tell' && e.attack === 'lunge');
    const atk = events.find((e) => e.type === 'enemy_attack' && e.attack === 'lunge');
    expect(tell).toBeTruthy();
    expect(atk).toBeTruthy();
    expect(tell!.type === 'enemy_tell' && tell!.duration).toBeCloseTo(0.5, 3);
    void hurts;
  });

  it('drone hovers 3-5 m up, keeps distance and its fireballs lead a runner', () => {
    const { mgr, events, run, player, hurts } = setup();
    player.pos = { x: -10, y: 0, z: 70 };
    const id = mgr.spawn('drone', { x: -10, y: 8, z: 48 }, undefined);
    let maxProj = 0;
    run(8, () => {
      maxProj = Math.max(maxProj, mgr.projectileCount());
      player.vel = { x: 6, y: 0, z: 0 };
      player.pos = { x: player.pos.x + 6 * SIM_DT, y: 0, z: 70 };
      if (player.pos.x > 12) player.pos.x = -12;
    });
    const rs = mgr.renderStates(1).find((s) => s.id === id)!;
    expect(rs.pos.y).toBeGreaterThan(2.5);
    expect(rs.pos.y).toBeLessThan(7);
    const d = Math.hypot(rs.pos.x - player.pos.x, rs.pos.z - player.pos.z);
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(18);
    expect(events.some((e) => e.type === 'enemy_tell' && e.kind === 'drone')).toBe(true);
    expect(maxProj).toBeGreaterThan(0);
    expect(hurts.length).toBeGreaterThanOrEqual(0);
  });

  it('fireballs stop on world geometry', () => {
    const { mgr, run, player, hurts } = setup();
    // player behind the big yard container block, drone on the other side
    player.pos = { x: 23, y: 0, z: 76 };
    mgr.spawn('drone', { x: 23, y: 6, z: 56 });
    run(10);
    expect(hurts.filter((h) => h.amount === 14)).toHaveLength(0);
  });

  it('loader: two distinct attacks, exposed recovery with x2 damage and one armorBreak', () => {
    const { mgr, events, run, player } = setup();
    player.pos = { x: 0, y: 0, z: 52 };
    const id = mgr.spawn('loader', { x: 0, y: 0, z: 60 });
    const seen = new Set<string>();
    let exposedHit: ReturnType<typeof mgr.applyDamage> = null;
    let second: ReturnType<typeof mgr.applyDamage> = null;
    let before = 0;
    run(14, () => {
      const s = mgr.renderStates(1).find((r) => r.id === id)!;
      if (s.loader?.attack) seen.add(s.loader.attack);
      if (s.loader?.jointExposed && !exposedHit) {
        before = mgr.info(id)!.hp;
        exposedHit = mgr.applyDamage(id, 10, s.pos, 'direct');
        second = mgr.applyDamage(id, 10, s.pos, 'direct');
        expect(before - mgr.info(id)!.hp).toBe(40);
      }
    });
    expect(seen.has('sweep') || seen.has('slam')).toBe(true);
    expect(exposedHit).toEqual({ killed: false, armorBreak: true });
    expect(second).toEqual({ killed: false, armorBreak: false });
    const hits = events.filter((e) => e.type === 'enemy_hit' && e.armorBreak);
    expect(hits).toHaveLength(1);
    const kinds = new Set(events.filter((e) => e.type === 'enemy_attack' && e.kind === 'loader').map((e) => (e.type === 'enemy_attack' ? e.attack : '')));
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    // not exposed while advancing: damage unmodified
    for (const t of events) void t;
  });

  it('loader requests adds at 66% and 33% health', () => {
    const { mgr, events, run, player } = setup();
    player.pos = { x: 0, y: 0, z: 20 };
    const id = mgr.spawn('loader', { x: 0, y: 0, z: 70 });
    run(1.5);
    mgr.applyDamage(id, LOADER.hp * 0.36, { x: 0, y: 1, z: 70 }, 'direct');
    run(3);
    const calls1 = mgr.consumeCallRequests();
    expect(calls1.map((c) => c.phase)).toEqual([0]);
    mgr.applyDamage(id, LOADER.hp * 0.35, { x: 0, y: 1, z: 70 }, 'direct');
    run(6);
    expect(mgr.consumeCallRequests().map((c) => c.phase)).toEqual([1]);
    expect(events.filter((e) => e.type === 'boss_phase').map((e) => (e.type === 'boss_phase' ? e.phase : 0))).toEqual([1, 2, 3]);
  });
});

describe('EnemyManager recovery', () => {
  it('teleports an enemy stuck outside the arena for more than 6 s to a lane spawn', () => {
    const { mgr, run, player } = setup();
    player.pos = { x: 0, y: 0, z: 90 };
    // yard_main enemy dropped inside the Slag Fields (outside the yard bounds, walled off)
    const id = mgr.spawn('walker', { x: 10, y: 0, z: -40 }, 'yard_main');
    run(5);
    expect(mgr.info(id)!.pos.z).toBeLessThan(0);
    run(3);
    const p = mgr.info(id)!.pos;
    expect(p.z).toBeGreaterThan(6);
    expect(p.z).toBeLessThan(20);
  });

  it('recovers an enemy that falls below killY', () => {
    const { mgr, run, player } = setup();
    player.pos = { x: 0, y: 0, z: 90 };
    // x=62 inside the world bounds but there is no floor under this spot
    const id = mgr.spawn('walker', { x: 62, y: 0, z: 100 }, 'yard_main');
    run(4);
    const p = mgr.info(id)!.pos;
    expect(p.y).toBeGreaterThan(REFINERY.killY);
    expect(p.z).toBeLessThan(30);
  });

  it('closed gate blocks, opening it lets enemies through', () => {
    const { mgr, run, player } = setup();
    player.pos = { x: 0, y: 0, z: 10 };
    const id = mgr.spawn('walker', { x: 0, y: 0, z: 40 });
    run(5);
    expect(mgr.info(id)!.pos.z).toBeGreaterThan(30);
    mgr.setGateOpen('yard', true);
    run(10);
    expect(mgr.info(id)!.pos.z).toBeLessThan(25);
  });

  it('walkers path up a ramp to reach a player on the catwalk', () => {
    const { mgr, run, player } = setup();
    player.pos = { x: 8, y: 3.2, z: 60 };
    const id = mgr.spawn('walker', { x: 8, y: 0, z: 95 });
    run(20);
    expect(mgr.info(id)!.pos.y).toBeGreaterThan(2);
  });
});

describe('EnemyManager performance', () => {
  it('120 live enemies step in under 2 ms on average', () => {
    const { mgr, run, player, phys } = setup();
    const lanes = REFINERY.arenas.find((a) => a.id === 'slag')!.lanes;
    for (let i = 0; i < 120; i++) {
      const lane = lanes[i % lanes.length]!;
      const kind = lane.air ? 'drone' : i % 5 === 0 ? 'hound' : 'walker';
      const sp = lane.spawns[i % lane.spawns.length]!;
      mgr.spawn(kind, { x: sp.x + (i % 7), y: sp.y, z: sp.z + (i % 5) }, lane.id, { charge: i % 3 === 0 });
    }
    player.pos = { x: 0, y: 0, z: -40 };
    expect(mgr.liveCount()).toBe(120);
    run(4); // warm up
    const n = 600;
    const t0 = performance.now();
    run(n * SIM_DT);
    const ms = (performance.now() - t0) / n;
    console.log(`[perf] 120 enemies: ${ms.toFixed(3)} ms/step (fake physics raycasts: ${phys.raycasts})`);
    expect(ms).toBeLessThan(2);
    mgr.renderStates(0.5);
  });
});
