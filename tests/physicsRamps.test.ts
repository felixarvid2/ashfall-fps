import { describe, expect, it } from 'vitest';
import { REFINERY } from '../src/content/level';
import { PhysicsWorld } from '../src/physics/world';
import { Player, NO_INPUT } from '../src/sim/player';
import { BASE_PLAYER } from '../src/content/weapons';
import { SIM_DT } from '../src/sim/types';

describe('REFINERY ramps with real physics', () => {
  const ramps = REFINERY.boxes.filter((b) => b.id?.startsWith('ramp'));
  it('has ramps', () => expect(ramps.length).toBeGreaterThanOrEqual(4));

  for (const r of ramps) {
    it(`player walks up ${r.id}`, async () => {
      const pw = await PhysicsWorld.create(REFINERY);
      for (const g of pw.gates) pw.setGateOpen(g.key, true);
      // A descending ramp is walked in the opposite direction (uphill).
      const down = (r.pitch ?? 0) < 0;
      const yaw = (r.yaw ?? 0) + (down ? Math.PI : 0);
      const pitch = Math.abs(r.pitch ?? 0);
      const dir = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const len = r.size.z;
      const run = len * Math.cos(pitch);
      const rise = len * Math.sin(pitch);
      // Top-surface centre is the box centre shifted along the normal by half the thickness.
      const sgn = down ? -1 : 1;
      const nx = -sgn * dir.x * Math.sin(pitch) * (down ? -1 : 1);
      const ny = Math.cos(pitch);
      const nz = -sgn * dir.z * Math.sin(pitch) * (down ? -1 : 1);
      const c = { x: r.pos.x + (nx * r.size.y) / 2, y: r.pos.y + (ny * r.size.y) / 2, z: r.pos.z + (nz * r.size.y) / 2 };
      const low = { x: c.x - dir.x * run / 2, y: c.y - rise / 2, z: c.z - dir.z * run / 2 };
      const high = { x: c.x + dir.x * run / 2, y: c.y + rise / 2, z: c.z + dir.z * run / 2 };
      expect(rise).toBeGreaterThan(0.5);
      // groundHeight agrees with the geometry at both ends (convention check).
      const gl = pw.groundHeight(low.x + dir.x * 0.5, low.z + dir.z * 0.5, high.y + 0.5);
      const gh = pw.groundHeight(high.x - dir.x * 0.5, high.z - dir.z * 0.5, high.y + 0.5);
      expect(Math.abs(gh! - (high.y - 0.5 * Math.tan(pitch)))).toBeLessThan(0.15);
      expect(gh!).toBeGreaterThan(gl! + rise * 0.7);

      const start = { x: low.x - dir.x * 2.5, y: low.y, z: low.z - dir.z * 2.5 };
      const player = new Player(pw, BASE_PLAYER, { pos: start, yaw }, -50, () => {});
      for (let i = 0; i < 60 * 2; i++) player.step({ ...NO_INPUT, yaw }, SIM_DT); // settle
      const steps = Math.ceil(((run + 5) / BASE_PLAYER.moveSpeed) * 60);
      for (let i = 0; i < steps; i++) player.step({ ...NO_INPUT, moveZ: 1, yaw }, SIM_DT);
      expect(player.pos.y).toBeGreaterThan(high.y - 0.4);
      expect(player.grounded).toBe(true);
      pw.dispose();
    });
  }
});
