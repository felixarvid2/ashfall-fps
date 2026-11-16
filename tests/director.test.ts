import { describe, expect, it } from 'vitest';
import { ENCOUNTERS, waveMaxCost } from '../src/content/encounters';
import { REFINERY } from '../src/content/level';
import { LOADER } from '../src/content/enemies';
import { Rng } from '../src/core/rng';
import { Director } from '../src/sim/director';
import { EnemyManager, FakePhysics, type PlayerTarget } from '../src/sim/enemies';
import { SIM_DT, type GameEvent, type Vec3 } from '../src/sim/types';

function setup(seed: string, playerPos: Vec3 = { x: 0, y: 0, z: 70 }) {
  const events: GameEvent[] = [];
  const emit = (e: GameEvent) => events.push(e);
  const phys = new FakePhysics(REFINERY);
  const root = new Rng(seed);
  const mgr = new EnemyManager(REFINERY, phys, root, emit);
  const dir = new Director(REFINERY, mgr, root.fork('spawns'), emit);
  const hurts: number[] = [];
  const player: PlayerTarget = { pos: { ...playerPos }, vel: { x: 0, y: 0, z: 0 }, alive: true, hurt: (a) => hurts.push(a) };
  let t = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      t += SIM_DT;
      mgr.step(SIM_DT, t, player);
      dir.step(SIM_DT, t, player.pos);
    }
  };
  /** Kills everything alive (godlike player). */
  const killAll = () => {
    for (const id of mgr.aliveIds()) mgr.applyDamage(id, 1e6, { x: 0, y: 1, z: 0 }, 'direct');
  };
  return { events, mgr, dir, player, step, killAll, time: () => t, hurts };
}

describe('encounter templates', () => {
  it('wave budgets cover their rolled counts and caps are sane', () => {
    for (const tpl of Object.values(ENCOUNTERS)) {
      for (const w of tpl.waves) {
        expect(waveMaxCost(w)).toBeLessThanOrEqual(w.budget);
        expect(w.liveCap).toBeGreaterThan(0);
        expect(w.warn).toBeGreaterThanOrEqual(2);
        for (const g of w.groups) {
          const arena = REFINERY.arenas.find((a) => a.id === tpl.arena)!;
          for (const l of g.lanes) expect(arena.lanes.some((x) => x.id === l)).toBe(true);
          if (g.kind === 'drone') for (const l of g.lanes) expect(arena.lanes.find((x) => x.id === l)!.air).toBe(true);
        }
      }
    }
  });
});

describe('Director', () => {
  it('only reports a clear when spawned + pending + active are all zero', () => {
    const { dir, step, events, mgr, killAll } = setup('A1');
    dir.startArena('yard');
    step(60 * 25); // nobody is killed: the fight must not end
    expect(events.some((e) => e.type === 'encounter_clear')).toBe(false);
    expect(mgr.liveCount()).toBeGreaterThan(0);
    expect(dir.status.arena).toBe('yard');
    // Kill continuously: it must still wait for every queued spawn.
    let guard = 0;
    while (!events.some((e) => e.type === 'encounter_clear') && guard++ < 60 * 400) {
      step();
      if (guard % 20 === 0) killAll();
      const clear = events.find((e) => e.type === 'encounter_clear');
      if (clear) {
        expect(mgr.liveCount()).toBe(0);
        expect(dir.queued()).toBe(0);
      }
    }
    const clears = events.filter((e) => e.type === 'encounter_clear');
    expect(clears).toHaveLength(1);
    expect(clears[0]).toMatchObject({ encounter: 'yard', salvage: ENCOUNTERS.yard!.salvage });
    expect(dir.isCleared('yard')).toBe(true);
    expect(dir.status.arena).toBeNull();
    expect(dir.status.cleared).toEqual(['yard']);
    const waves = events.filter((e) => e.type === 'wave_start');
    expect(waves).toHaveLength(ENCOUNTERS.yard!.waves.length);
    expect(waves.map((w) => (w.type === 'wave_start' ? w.wave : 0))).toEqual([1, 2, 3, 4]);
    const spawned = events.filter((e) => e.type === 'enemy_spawn').length;
    expect(spawned).toBeGreaterThan(25);
    expect(spawned).toBeLessThan(55);
    // starting a cleared arena again is a no-op
    dir.startArena('yard');
    expect(dir.status.arena).toBeNull();
  });

  it('respects the live cap and counts queued spawns', () => {
    const { dir, step, mgr } = setup('A2');
    dir.startArena('yard');
    let maxLive = 0;
    let sawQueued = false;
    for (let i = 0; i < 60 * 40; i++) {
      step();
      maxLive = Math.max(maxLive, mgr.liveCount());
      if (dir.status.queued > 0) sawQueued = true;
    }
    expect(maxLive).toBeLessThanOrEqual(16);
    expect(sawQueued).toBe(true);
  });

  it('is deterministic for the same seed and differs for another', () => {
    const run = (seed: string) => {
      const s = setup(seed);
      s.dir.startArena('slag');
      for (let i = 0; i < 60 * 40; i++) {
        s.step();
        if (i % 90 === 0) s.killAll();
      }
      return JSON.stringify(s.events.filter((e) => e.type === 'enemy_spawn' || e.type === 'wave_warn' || e.type === 'wave_start'));
    };
    expect(run('SEED-1')).toBe(run('SEED-1'));
    expect(run('SEED-1')).not.toBe(run('SEED-2'));
  });

  it('warns a couple of seconds before contact, with lane label and position', () => {
    const { dir, step, events, time } = setup('A3');
    dir.startArena('yard');
    step(60 * 8);
    const warns = events.filter((e) => e.type === 'wave_warn');
    expect(warns.length).toBeGreaterThan(0);
    const w0 = warns[0]!;
    expect(w0.type === 'wave_warn' && w0.label).toBe('MAIN GATE');
    expect(w0.type === 'wave_warn' && w0.lane).toBe('yard_main');
    const warnIdx = events.indexOf(w0);
    const spawnIdx = events.findIndex((e, i) => i > warnIdx && e.type === 'enemy_spawn');
    expect(spawnIdx).toBeGreaterThan(warnIdx);
    expect(time()).toBeGreaterThan(5);
  });

  it('falls back to alternate lanes when the planned spawn is too close to the player', () => {
    // Player stands in the main gate corridor; wave 1 plans yard_main only.
    const { dir, step, events, player } = setup('A4', { x: -15, y: 0, z: 18 });
    dir.startArena('yard');
    step(60 * 8);
    const warns = events.filter((e) => e.type === 'wave_warn');
    expect(warns.length).toBeGreaterThan(0);
    for (const w of warns) {
      if (w.type !== 'wave_warn') continue;
      expect(Math.hypot(w.pos.x - player.pos.x, w.pos.z - player.pos.z)).toBeGreaterThanOrEqual(12);
    }
    const first = warns[0]!;
    expect(first.type === 'wave_warn' && first.lane).not.toBe('yard_main');
  });

  it('runs the slag fight to 60-80 simultaneous enemies when the player does not keep up', () => {
    const { dir, step, mgr, killAll } = setup('A5', { x: 0, y: 0, z: -4 });
    dir.startArena('slag');
    let peak = 0;
    for (let i = 0; i < 60 * 170; i++) {
      step();
      peak = Math.max(peak, mgr.liveCount());
      // a mediocre player kills ~1 enemy / 0.9 s
      if (i % 54 === 0) {
        const ids = mgr.aliveIds();
        if (ids.length) mgr.applyDamage(ids[0]!, 1e6, { x: 0, y: 1, z: 0 }, 'direct');
      }
    }
    expect(peak).toBeGreaterThanOrEqual(55);
    expect(peak).toBeLessThanOrEqual(80);
    killAll();
  });

  it('relay: Cargo Loader calls limited walkers at 66% and 33%; clear needs all of them dead', () => {
    const { dir, step, events, mgr, killAll } = setup('A6', { x: 0, y: 3, z: -190 });
    dir.startArena('relay');
    step(60 * 8);
    const loaderEv = events.find((e) => e.type === 'enemy_spawn' && e.kind === 'loader');
    expect(loaderEv).toBeTruthy();
    const lid = loaderEv!.type === 'enemy_spawn' ? loaderEv!.id : -1;
    const walkersBefore = () => events.filter((e) => e.type === 'enemy_spawn' && e.kind === 'walker').length;
    expect(walkersBefore()).toBe(0);
    mgr.applyDamage(lid, LOADER.hp * 0.36, { x: 0, y: 4, z: -200 }, 'direct');
    step(60 * 12);
    expect(walkersBefore()).toBe(LOADER.call.adds[0]);
    mgr.applyDamage(lid, LOADER.hp * 0.35, { x: 0, y: 4, z: -200 }, 'direct');
    step(60 * 14);
    expect(walkersBefore()).toBe(LOADER.call.adds[0]! + LOADER.call.adds[1]!);
    // kill the loader but leave adds: no clear
    mgr.applyDamage(lid, 1e6, { x: 0, y: 4, z: -200 }, 'direct');
    step(60);
    expect(events.some((e) => e.type === 'encounter_clear')).toBe(false);
    killAll();
    step(5);
    expect(events.filter((e) => e.type === 'encounter_clear')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'boss_phase').length).toBe(3);
  });

  it('opens the exit gate for enemy navigation when an arena clears', () => {
    const { dir, step, killAll, events } = setup('A7');
    dir.startArena('yard');
    let guard = 0;
    while (!events.some((e) => e.type === 'encounter_clear') && guard++ < 60 * 400) {
      step();
      if (guard % 20 === 0) killAll();
    }
    expect(dir.isCleared('yard')).toBe(true);
  });

  it('stress template spawns N enemies at once and clears at zero', () => {
    const { dir, step, mgr, killAll, events } = setup('S1', { x: 0, y: 0, z: -40 });
    dir.startStress(120);
    expect(mgr.liveCount()).toBe(120);
    expect(dir.status.arena).toBe('stress');
    step(60 * 3);
    expect(events.some((e) => e.type === 'encounter_clear')).toBe(false);
    killAll();
    step(2);
    expect(events.filter((e) => e.type === 'encounter_clear')).toHaveLength(1);
  });

  it('reset clears progress', () => {
    const s = setup('R1');
    s.dir.startArena('yard');
    s.step(10);
    s.dir.reset();
    expect(s.dir.status).toMatchObject({ arena: null, wave: 0, queued: 0, cleared: [] });
  });
});
