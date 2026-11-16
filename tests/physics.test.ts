import { afterEach, describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../src/physics/world';
import { testLevel } from './physicsFixtures';

let pw: PhysicsWorld | null = null;
afterEach(() => {
  pw?.dispose();
  pw = null;
});

describe('physics world', () => {
  it('raycasts static boxes and reports distance and normal', async () => {
    pw = await PhysicsWorld.create(testLevel([{ pos: { x: 0, y: 1, z: -10 }, size: { x: 4, y: 2, z: 1 }, mat: 'concrete' }]));
    const hit = pw.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 50);
    expect(hit).not.toBeNull();
    expect(hit!.dist).toBeCloseTo(9.5, 3);
    expect(hit!.normal.z).toBeCloseTo(1, 3);
    expect(pw.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 5)).toBeNull();
  });

  it('non-blocking boxes stop movement but not shots or line of sight', async () => {
    pw = await PhysicsWorld.create(testLevel([{ pos: { x: 0, y: 1, z: -5 }, size: { x: 4, y: 2, z: 0.2 }, mat: 'metal', blocksShots: false }]));
    const o = { x: 0, y: 1, z: 0 };
    const d = { x: 0, y: 0, z: -1 };
    expect(pw.raycast(o, d, 20)).toBeNull();
    expect(pw.raycast(o, d, 20, { includeNonBlocking: true })).not.toBeNull();
    expect(pw.lineOfSight(o, { x: 0, y: 1, z: -10 })).toBe(true);
    // The player cannot walk through it.
    let pos = { x: 0, y: 0, z: -3 };
    for (let i = 0; i < 90; i++) pos = pw.moveCharacter(pos, { x: 0, y: -0.01, z: -0.1 }, true).pos;
    expect(pos.z).toBeGreaterThan(-5);
  });

  it('lineOfSight is blocked by walls', async () => {
    pw = await PhysicsWorld.create(testLevel([{ pos: { x: 0, y: 2, z: -5 }, size: { x: 6, y: 4, z: 1 }, mat: 'concrete' }]));
    expect(pw.lineOfSight({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 })).toBe(false);
    expect(pw.lineOfSight({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -3 })).toBe(true);
  });

  it('groundHeight follows a ramp', async () => {
    // 10 m long ramp rising toward -Z: pitched box, top surface 0 -> ~3.5 m
    const pitch = Math.atan2(3.5, 10);
    const len = Math.hypot(10, 3.5);
    pw = await PhysicsWorld.create(
      testLevel([{ pos: { x: 0, y: 3.5 / 2 - 0.25 * Math.cos(pitch), z: -5 }, size: { x: 6, y: 0.5, z: len }, pitch, mat: 'metal' }]),
    );
    const h1 = pw.groundHeight(0, -2, 5);
    const h2 = pw.groundHeight(0, -8, 5);
    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();
    expect(h2!).toBeGreaterThan(h1! + 1.5);
    // Slope matches: dh/dz ~ 0.35
    expect((h2! - h1!) / 6).toBeCloseTo(0.35, 1);
    expect(pw.groundHeight(50, 50, 2)).toBeCloseTo(0, 3);
  });

  it('gates block until opened', async () => {
    pw = await PhysicsWorld.create(testLevel([{ id: 'g1', pos: { x: 0, y: 2, z: -5 }, size: { x: 6, y: 4, z: 0.5 }, mat: 'metal', gateOpensAfter: 'yard' }]));
    const o = { x: 0, y: 1, z: 0 };
    const d = { x: 0, y: 0, z: -1 };
    expect(pw.raycast(o, d, 20)).not.toBeNull();
    pw.setGateOpen('g1', true);
    expect(pw.raycast(o, d, 20)).toBeNull();
    pw.setGateOpen('g1', false);
    expect(pw.raycast(o, d, 20)).not.toBeNull();
    expect(pw.gates.map((g) => g.key)).toEqual(['g1']);
  });

  it('character walks up a ramp, steps small ledges and stays on the floor', async () => {
    const pitch = Math.atan2(2, 10);
    const len = Math.hypot(10, 2);
    pw = await PhysicsWorld.create(
      testLevel([
        { pos: { x: 0, y: 1 - 0.25 * Math.cos(pitch), z: -5 }, size: { x: 6, y: 0.5, z: len }, pitch, mat: 'metal' },
        { pos: { x: 12, y: 0.2, z: 0 }, size: { x: 2, y: 0.4, z: 2 }, mat: 'concrete' },
      ]),
    );
    let pos = { x: 0, y: 0, z: 0 };
    let grounded = false;
    for (let i = 0; i < 52; i++) {
      const r = pw.moveCharacter(pos, { x: 0, y: -0.4 * (1 / 60), z: -9.5 / 60 }, true);
      pos = r.pos;
      grounded = r.grounded;
    }
    expect(pos.z).toBeLessThan(-7);
    expect(pos.y).toBeGreaterThan(1.2);
    expect(grounded).toBe(true);
    // Step over a 0.4 m ledge (autostep).
    let p2 = { x: 8, y: 0, z: 0 };
    for (let i = 0; i < 60; i++) p2 = pw.moveCharacter(p2, { x: 9.5 / 60, y: -0.4 / 60, z: 0 }, true).pos;
    expect(p2.x).toBeGreaterThan(12);
  });
});
