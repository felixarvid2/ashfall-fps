import { describe, expect, it } from 'vitest';
import { ASSETS } from '../src/content/assets';
import { ENCOUNTERS } from '../src/content/encounters';
import { REFINERY } from '../src/content/level';
import type { Vec3 } from '../src/content/../sim/types';
import { buildObstacles, ObstacleGrid } from '../src/sim/enemies/geometry';
import { FakePhysics } from '../src/sim/enemies/fakePhysics';

const L = REFINERY;
const inside = (p: Vec3, b: { min: Vec3; max: Vec3 }) =>
  p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;

function grid(openGates: string[] = []) {
  const obs = buildObstacles(L);
  for (const o of obs) if (o.gateArena && openGates.includes(o.gateArena)) o.active = false;
  return new ObstacleGrid(obs, L.bounds.min.x, L.bounds.min.z, L.bounds.max.x, L.bounds.max.z);
}

/** 4-connected flood fill on a 1 m grid for a 0.45 m walker standing at height y. */
function flood(g: ObstacleGrid, from: Vec3, y: number): Set<string> {
  const seen = new Set<string>();
  const key = (x: number, z: number) => `${x},${z}`;
  const q: [number, number][] = [[Math.round(from.x), Math.round(from.z)]];
  seen.add(key(q[0]![0], q[0]![1]));
  while (q.length) {
    const [x, z] = q.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < L.bounds.min.x || nx > L.bounds.max.x || nz < L.bounds.min.z || nz > L.bounds.max.z) continue;
      const k = key(nx, nz);
      if (seen.has(k)) continue;
      if (g.blocked(nx, nz, 0.45, y, 1.8)) continue;
      seen.add(k);
      q.push([nx, nz]);
    }
  }
  return seen;
}
const reach = (s: Set<string>, p: Vec3) => s.has(`${Math.round(p.x)},${Math.round(p.z)}`);

describe('level data', () => {
  it('has the expected beats and ids', () => {
    expect(L.arenas.map((a) => a.id)).toEqual(['yard', 'slag', 'approach', 'relay']);
    expect(L.relay.arena).toBe('relay');
    for (const a of L.arenas) expect(ENCOUNTERS[a.id]).toBeTruthy();
  });

  it('gates and afterArena references point at real arenas', () => {
    const ids = new Set(L.arenas.map((a) => a.id));
    const gates = L.boxes.filter((b) => b.gateOpensAfter);
    expect(gates.length).toBeGreaterThanOrEqual(3);
    for (const b of gates) expect(ids.has(b.gateOpensAfter!)).toBe(true);
    for (const p of L.pickups) if (p.afterArena) expect(ids.has(p.afterArena)).toBe(true);
    for (const b of L.boxes) if (b.gateClosesOn) expect(ids.has(b.gateClosesOn)).toBe(true);
  });

  it('ramps are pitched <= 30 degrees and meet their decks', () => {
    const ramps = L.boxes.filter((b) => b.id?.startsWith('ramp'));
    expect(ramps.length).toBeGreaterThanOrEqual(4);
    for (const r of ramps) {
      expect(Math.abs(r.pitch!)).toBeLessThanOrEqual((30 * Math.PI) / 180 + 1e-9);
      expect(Math.abs(r.pitch!)).toBeGreaterThan(0.1);
    }
    const phys = new FakePhysics(L);
    // yard catwalk: ground rises monotonically from the floor to the deck and stays walkable
    let prev = 0;
    for (let z = 90; z >= 76; z -= 0.25) {
      const h = phys.groundHeight(8, z, prev)!;
      expect(h).not.toBeNull();
      expect(h - prev).toBeLessThan(0.3);
      expect(h).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = h;
    }
    expect(prev).toBeCloseTo(3.2, 1);
    expect(phys.groundHeight(8, 64, 3.2)).toBeCloseTo(3.2, 2);
    // relay ramp
    prev = 0;
    for (let z = -164; z >= -176; z -= 0.25) {
      const h = phys.groundHeight(0, z, prev)!;
      expect(h - prev).toBeLessThan(0.3);
      prev = Math.max(prev, h);
    }
    expect(prev).toBeCloseTo(3, 1);
    // extraction ramp down
    prev = 3;
    for (let z = -234; z >= -246; z -= 0.25) {
      const h = phys.groundHeight(0, z, prev)!;
      expect(prev - h).toBeLessThan(0.3);
      prev = h;
    }
    expect(prev).toBeCloseTo(0, 1);
  });

  it('all lane spawns and paths are inside the level and their own arena, off obstacles', () => {
    const g = grid();
    for (const a of L.arenas) {
      expect(inside(a.trigger.min, L.bounds) && inside(a.trigger.max, L.bounds)).toBe(true);
      expect(inside(a.cache, L.bounds)).toBe(true);
      expect(a.lanes.length).toBeGreaterThanOrEqual(4);
      expect(a.lanes.some((l) => l.air)).toBe(true);
      for (const l of a.lanes) {
        expect(l.spawns.length).toBeGreaterThan(0);
        for (const p of [...l.spawns, ...l.path]) {
          expect(inside(p, L.bounds), `${a.id}/${l.id} ${JSON.stringify(p)}`).toBe(true);
          expect(inside(p, a.bounds), `${a.id}/${l.id} arena ${JSON.stringify(p)}`).toBe(true);
          if (!l.air) expect(g.blocked(p.x, p.z, 0.5, p.y, 1.8), `${a.id}/${l.id} blocked ${JSON.stringify(p)}`).toBe(false);
        }
      }
    }
  });

  it('spawn points have floor underneath and the player start is safe', () => {
    const phys = new FakePhysics(L);
    for (const a of L.arenas) {
      for (const l of a.lanes) {
        if (l.air) continue;
        for (const s of l.spawns) expect(phys.groundHeight(s.x, s.z, s.y)).toBeCloseTo(s.y, 1);
      }
    }
    expect(phys.groundHeight(L.playerStart.pos.x, L.playerStart.pos.z, 1)).toBeCloseTo(0, 2);
    expect(inside(L.playerStart.pos, L.bounds)).toBe(true);
  });

  it('arenas connect: start -> yard -> slag -> approach -> relay -> extraction', () => {
    // Everything open: ground plane reaches each arena and the ramp feet.
    const g = grid(['yard', 'slag', 'approach', 'relay']);
    const f0 = flood(g, L.playerStart.pos, 0);
    const center = (a: (typeof L.arenas)[number]) => ({ x: (a.trigger.min.x + a.trigger.max.x) / 2 - (a.id === 'yard' ? 12 : 0), y: 0, z: (a.trigger.min.z + a.trigger.max.z) / 2 });
    for (const id of ['yard', 'slag', 'approach']) expect(reach(f0, center(L.arenas.find((a) => a.id === id)!)), id).toBe(true);
    expect(reach(f0, { x: 0, y: 0, z: -165 })).toBe(true); // foot of the relay ramp
    // Deck plane: from the top of the relay ramp to the relay and the extraction ramp.
    const f3 = flood(g, { x: 0, y: 3, z: -176 }, 3);
    expect(reach(f3, { x: L.relay.pos.x, y: 3, z: L.relay.pos.z })).toBe(true);
    expect(reach(f3, { x: 0, y: 3, z: -236 })).toBe(true);
    for (const a of L.arenas.filter((x) => x.id === 'relay')) expect(reach(f3, { x: a.cache.x, y: 3, z: a.cache.z })).toBe(true);
    // Back on the ground below the extraction ramp.
    const fx = flood(g, { x: 0, y: 0, z: -246 }, 0);
    expect(reach(fx, L.extraction.pos)).toBe(true);
  });

  it('closed gates actually block the route', () => {
    const closed = flood(grid(), L.playerStart.pos, 0);
    expect(reach(closed, { x: 10, y: 0, z: 36 })).toBe(true);
    expect(reach(closed, { x: 0, y: 0, z: 10 })).toBe(false); // behind the yard gate
    const afterYard = flood(grid(['yard']), L.playerStart.pos, 0);
    expect(reach(afterYard, { x: 0, y: 0, z: -10 })).toBe(true);
    expect(reach(afterYard, { x: 0, y: 0, z: -110 })).toBe(false); // behind the slag gate
    const afterSlag = flood(grid(['yard', 'slag']), L.playerStart.pos, 0);
    expect(reach(afterSlag, { x: 0, y: 0, z: -130 })).toBe(true);
    expect(reach(afterSlag, { x: 0, y: 0, z: -170 })).toBe(false);
  });

  it('weapon rack is visible before the first fight starts', () => {
    const yard = L.arenas[0]!;
    expect(L.weaponRack.weapon).toBe('arc_scattergun');
    expect(L.weaponRack.pos.z).toBeGreaterThan(yard.trigger.max.z);
    expect(inside(L.weaponRack.pos, { min: { x: -35, y: -1, z: 30 }, max: { x: 35, y: 5, z: 100 } })).toBe(true);
    expect(L.playerStart.pos.z - L.weaponRack.pos.z).toBeLessThan(40);
  });

  it('landmarks, props and pickups are sane', () => {
    const pillar = L.landmarks.find((p) => p.asset === 'prop.the_pillar')!;
    expect(pillar.height).toBe(70);
    expect(pillar.pos.z).toBeLessThan(-250);
    expect(L.landmarks.some((p) => p.asset === 'prop.giant_crane')).toBe(true);
    expect(L.landmarks.filter((p) => p.asset === 'env.smokestack').length).toBeGreaterThanOrEqual(6);
    expect(L.landmarks.some((p) => p.asset === 'prop.refinery_silhouette')).toBe(true);
    for (const p of [...L.props, ...L.landmarks]) expect(ASSETS[p.asset], p.asset).toBeTruthy();
    for (const p of L.landmarks) expect(p.collider ?? null).toBeNull();
    for (const p of L.pickups) expect(inside(p.pos, L.bounds)).toBe(true);
    expect(L.props.filter((p) => p.collider).length).toBeGreaterThan(15);
    expect(L.hazards.length).toBeGreaterThanOrEqual(2);
    expect(L.signs.length).toBeGreaterThanOrEqual(8);
    expect(L.radio.length).toBeGreaterThanOrEqual(4);
    expect(L.killY).toBeLessThan(L.bounds.min.y + 15);
  });

  it('yard and slag sizes match the brief', () => {
    const floor = (id: string) => L.boxes.find((b) => b.id === `floor_${id}`)!;
    expect(floor('yard').size.x).toBe(70);
    expect(floor('yard').size.z).toBe(70);
    expect(floor('slag').size.x).toBeGreaterThanOrEqual(110);
    expect(floor('slag').size.z).toBeGreaterThanOrEqual(90);
    expect(floor('slag').size.x * floor('slag').size.z).toBeGreaterThan(floor('yard').size.x * floor('yard').size.z);
  });
});
