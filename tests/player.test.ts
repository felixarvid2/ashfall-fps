import { afterEach, describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../src/physics/world';
import { Player, MOVE, NO_INPUT, type PlayerInput } from '../src/sim/player';
import { BASE_PLAYER } from '../src/content/weapons';
import { SIM_DT, type GameEvent } from '../src/sim/types';
import { FixedStepper } from '../src/game/loop';
import { testLevel } from './physicsFixtures';

let pw: PhysicsWorld | null = null;
afterEach(() => {
  pw?.dispose();
  pw = null;
});

async function mk(boxes = [] as Parameters<typeof testLevel>[0]) {
  const level = testLevel(boxes);
  pw = await PhysicsWorld.create(level);
  const events: GameEvent[] = [];
  const player = new Player(pw, BASE_PLAYER, level.playerStart, level.killY, (e) => events.push(e));
  return { player, events, pw };
}
const inp = (o: Partial<PlayerInput> = {}): PlayerInput => ({ ...NO_INPUT, ...o });
const run = (p: Player, n: number, i: PlayerInput | ((k: number) => PlayerInput)) => {
  for (let k = 0; k < n; k++) p.step(typeof i === 'function' ? i(k) : i, SIM_DT);
};

describe('player movement', () => {
  it('position after 1 s of strafing is identical at 30, 60 and 144 Hz render rates', async () => {
    const results: string[] = [];
    for (const hz of [30, 60, 144]) {
      const { player } = await mk();
      const stepper = new FixedStepper();
      const frames = hz; // 1 second
      for (let f = 0; f < frames; f++) {
        stepper.advance(1 / hz, () => player.step(inp({ moveX: 1, moveZ: 0.5 }), SIM_DT));
      }
      results.push(`${player.pos.x.toFixed(6)},${player.pos.y.toFixed(6)},${player.pos.z.toFixed(6)}`);
      pw?.dispose();
      pw = null;
    }
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });

  it('reaches full ground speed quickly and stops under friction', async () => {
    const { player } = await mk();
    run(player, 6, inp({ moveZ: 1 }));
    run(player, 20, inp({ moveZ: 1 }));
    expect(player.horizontalSpeed).toBeCloseTo(BASE_PLAYER.moveSpeed, 1);
    expect(player.grounded).toBe(true);
    run(player, 30, inp());
    expect(player.horizontalSpeed).toBeLessThan(0.5);
  });

  it('diagonal input is not faster than straight', async () => {
    const { player } = await mk();
    run(player, 40, inp({ moveX: 1, moveZ: 1 }));
    expect(player.horizontalSpeed).toBeLessThanOrEqual(BASE_PLAYER.moveSpeed + 1e-6);
  });

  it('air control is limited: no friction, bounded steering, capped speed', async () => {
    const { player } = await mk();
    run(player, 30, inp({ moveZ: 1 }));
    run(player, 1, inp({ moveZ: 1, jump: true }));
    expect(player.grounded).toBe(false);
    const sp = player.horizontalSpeed;
    run(player, 10, inp()); // no input in the air: speed preserved
    expect(player.horizontalSpeed).toBeGreaterThan(sp - 0.01);
    run(player, 20, inp({ moveX: 1 })); // steering right in the air
    expect(player.horizontalSpeed).toBeLessThanOrEqual(BASE_PLAYER.moveSpeed * MOVE.airSpeedCap + 1e-6);
    expect(player.vel.x).toBeGreaterThan(0.2); // some control
    expect(player.vel.x).toBeLessThan(4); // but limited
  });

  it('jumps with coyote time and buffered input, and lands with an event', async () => {
    const { player, events } = await mk();
    run(player, 10, inp());
    run(player, 1, inp({ jump: true }));
    expect(events.some((e) => e.type === 'player_jump')).toBe(true);
    expect(player.vel.y).toBeGreaterThan(5);
    let maxY = 0;
    for (let k = 0; k < 120; k++) {
      player.step(inp(), SIM_DT);
      maxY = Math.max(maxY, player.pos.y);
    }
    expect(maxY).toBeGreaterThan(1.0);
    expect(maxY).toBeLessThan(1.6);
    expect(player.grounded).toBe(true);
    expect(events.some((e) => e.type === 'player_land')).toBe(true);

    // Buffered: press 4 steps before landing, jump happens on landing.
    const b = await (async () => {
      pw?.dispose();
      return mk();
    })();
    const p = b.player;
    run(p, 5, inp());
    run(p, 1, inp({ jump: true }));
    // wait until close to the ground on the way down
    let pressed = false;
    let jumpsBefore = b.events.filter((e) => e.type === 'player_jump').length;
    for (let k = 0; k < 120; k++) {
      const nearGround = p.vel.y < 0 && p.pos.y < 0.5 && !pressed;
      if (nearGround) pressed = true;
      p.step(inp({ jump: nearGround }), SIM_DT);
    }
    expect(b.events.filter((e) => e.type === 'player_jump').length).toBe(jumpsBefore + 1);
  });

  it('coyote time lets the player jump just after walking off a ledge', async () => {
    const { player } = await mk([{ pos: { x: 0, y: 0.5, z: -20 }, size: { x: 6, y: 1, z: 10 }, mat: 'concrete' }]);
    // Stand on the box top (y=1) then walk off toward +z.
    player.pos = { x: 0, y: 1, z: -17 };
    player.prevPos = { ...player.pos };
    run(player, 5, inp());
    expect(player.grounded).toBe(true);
    let jumped = false;
    for (let k = 0; k < 60 && !jumped; k++) {
      // walking toward +Z means yaw = PI
      player.step(inp({ moveZ: 1, yaw: Math.PI }), SIM_DT);
      if (!player.grounded && player.pos.y < 1) {
        // just left the ledge -> within coyote window
        player.step(inp({ jump: true, yaw: Math.PI }), SIM_DT);
        jumped = player.vel.y > 4;
      }
    }
    expect(jumped).toBe(true);
  });

  it('dash covers about 7 m and respects its cooldown', async () => {
    const { player, events } = await mk();
    run(player, 5, inp());
    const z0 = player.pos.z;
    run(player, 1, inp({ dash: true })); // forward (-Z)
    run(player, 11, inp());
    const dist = z0 - player.pos.z;
    expect(dist).toBeGreaterThan(6.2);
    expect(dist).toBeLessThan(8.5);
    expect(events.filter((e) => e.type === 'player_dash').length).toBe(1);
    // Second press on cooldown does nothing.
    run(player, 1, inp({ dash: true }));
    expect(events.filter((e) => e.type === 'player_dash').length).toBe(1);
    expect(player.dashReady).toBeLessThan(1);
    run(player, Math.ceil(BASE_PLAYER.dashCooldown / SIM_DT) + 2, inp());
    expect(player.dashReady).toBe(1);
    run(player, 1, inp({ dash: true, moveX: 1 }));
    const d2 = events.filter((e) => e.type === 'player_dash');
    expect(d2.length).toBe(2);
    expect((d2[1] as { dir: { x: number } }).dir.x).toBeGreaterThan(0.9);
  });

  it('dash cooldown follows PlayerStats', async () => {
    const { player } = await mk();
    player.setStats({ ...BASE_PLAYER, dashCooldown: 1 });
    run(player, 1, inp({ dash: true }));
    run(player, 40, inp());
    expect(player.dashReady).toBeLessThan(1);
    run(player, 30, inp());
    expect(player.dashReady).toBe(1);
  });

  it('health, hurt and death', async () => {
    const { player, events } = await mk();
    player.hurt(30, { x: 1, y: 0, z: 0 });
    expect(player.health).toBe(70);
    player.hurt(500, null);
    expect(player.alive).toBe(false);
    expect(player.health).toBe(0);
    expect(events.filter((e) => e.type === 'player_die').length).toBe(1);
    player.hurt(10, null);
    expect(events.filter((e) => e.type === 'player_hurt').length).toBe(2);
  });

  it('recovers to the last safe point when falling out of the world', async () => {
    const { player } = await mk();
    run(player, 30, inp());
    const safe = { ...player.pos };
    player.pos = { x: 300, y: -40, z: 300 };
    run(player, 2, inp());
    expect(Math.hypot(player.pos.x - safe.x, player.pos.z - safe.z)).toBeLessThan(0.5);
    expect(player.pos.y).toBeGreaterThan(-1);
  });

  it('emits footsteps while running', async () => {
    const { player, events } = await mk();
    run(player, 90, inp({ moveZ: 1 }));
    const steps = events.filter((e) => e.type === 'player_step').length;
    expect(steps).toBeGreaterThan(5);
  });
});
