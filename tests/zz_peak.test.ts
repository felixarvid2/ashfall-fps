import { it } from 'vitest';
import { REFINERY } from '../src/content/level';
import { Rng } from '../src/core/rng';
import { Director } from '../src/sim/director';
import { EnemyManager, FakePhysics } from '../src/sim/enemies';
it('peak', () => {
  for (const k of [36]) {
    const ev: any[] = [];
    const mgr = new EnemyManager(REFINERY, new FakePhysics(REFINERY), new Rng('A5'), (e) => ev.push(e));
    const dir = new Director(REFINERY, mgr, new Rng('A5').fork('spawns'), (e) => ev.push(e));
    const player = { pos: { x: 0, y: 0, z: -4 }, vel: { x: 0, y: 0, z: 0 }, alive: true, hurt() {} };
    dir.startArena('slag'); let peak = 0, t = 0, clearT = -1;
    for (let i = 0; i < 60 * 400; i++) { t += 1/60; mgr.step(1/60, t, player); dir.step(1/60, t, player.pos); peak = Math.max(peak, mgr.liveCount()); if (i % 300 === 0) console.log('t', t.toFixed(0), 'live', mgr.liveCount(), 'queued', dir.queued(), 'wave', dir.status.wave);
      if (i % k === 0) { const ids = mgr.aliveIds(); if (ids.length) mgr.applyDamage(ids[0], 1e6, {x:0,y:1,z:0}, 'direct'); }
      if (clearT < 0 && ev.some(e=>e.type==='encounter_clear')) { clearT = t; break; } }
    console.log('kill every', k/60, 'peak', peak, 'clear at', clearT.toFixed(0), 'spawned', ev.filter(e=>e.type==='enemy_spawn').length);
  }
});
