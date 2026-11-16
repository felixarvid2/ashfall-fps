import { afterEach, describe, expect, it } from 'vitest';
import { REFINERY } from '../src/content/level';
import { Run } from '../src/game/run';
import { DEFAULT_FACTORIES } from '../src/game/factories';
import type { InputSample } from '../src/input/input';
import type { GameEvent } from '../src/sim/types';

const sample = (o: Partial<InputSample> = {}): InputSample => ({
  moveX: 0, moveZ: 0, fireHeld: false, firePressed: false, jump: false, dash: false, reload: false,
  slot1: false, slot2: false, backup: false, interactPressed: false, interactHeld: false, yaw: 0, pitch: 0, ...o,
});

let run: Run | null = null;
afterEach(() => {
  run?.dispose();
  run = null;
});

describe('Run with the real level, enemies and director', () => {
  it('plays the yard: spawns, shooting, no exceptions, clean dispose', async () => {
    run = await Run.create({ level: REFINERY, seed: 'INTEG', starter: 'coil_carbine', skipTo: 'yard' }, DEFAULT_FACTORIES);
    const r = run;
    r.start({ skipDeployment: true });
    const all: GameEvent[] = [];
    // Walk into the yard trigger (z 58..88): start beside the central conveyor.
    r.player.pos = { x: 14, y: 0, z: 96 };
    for (let i = 0; i < 60 * 4; i++) {
      r.step(sample({ moveZ: 1 }));
      all.push(...r.drainEvents());
    }
    expect(r.player.pos.z).toBeLessThan(90);
    // Fight for 40 s turning toward the closest enemy is the enemy module's concern; just hold fire.
    for (let i = 0; i < 60 * 40; i++) {
      r.step(sample({ fireHeld: i % 120 < 90, firePressed: i % 120 === 0, yaw: Math.sin(i / 90) * 1.2, reload: i % 240 === 0 }));
      all.push(...r.drainEvents());
      if (r.draft) break;
    }
    const types = new Set(all.map((e) => e.type));
    expect(types.has('wave_start')).toBe(true);
    expect(types.has('enemy_spawn')).toBe(true);
    expect(types.has('shot')).toBe(true);
    expect(r.weapons.magazine()).toBeGreaterThanOrEqual(0);
    expect(r.weapons.reserve()).toBeGreaterThanOrEqual(0);
    r.dispose();
  });
});
