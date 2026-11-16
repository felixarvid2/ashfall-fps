import { afterEach, describe, expect, it } from 'vitest';
import { Run, type DirectorApi, type EnemyManagerApi, type RunFactories, type RunOptions } from '../src/game/run';
import type { InputSample } from '../src/input/input';
import type { GameEvent, EnemyInfo } from '../src/sim/types';
import type { BoxDef, LevelDef } from '../src/content/levelTypes';
import { testLevel } from './physicsFixtures';

const sample = (o: Partial<InputSample> = {}): InputSample => ({
  moveX: 0, moveZ: 0, fireHeld: false, firePressed: false, jump: false, dash: false, reload: false,
  slot1: false, slot2: false, backup: false, interactPressed: false, interactHeld: false, yaw: 0, pitch: 0, ...o,
});

class FakeEnemies implements EnemyManagerApi {
  gates: Record<string, boolean> = {};
  steps = 0;
  cleared = false;
  spawn() { return 1; }
  step() { this.steps++; }
  info(): EnemyInfo | undefined { return undefined; }
  inRadius() { return []; }
  applyDamage() { return null; }
  push() {}
  stagger() {}
  setIonized() {}
  raycast() { return []; }
  liveCount() { return 0; }
  renderStates() { return []; }
  projectiles() { return []; }
  projectileCount() { return 0; }
  setGateOpen(id: string, open: boolean) { this.gates[id] = open; }
  clear() { this.cleared = true; }
}
class FakeDirector implements DirectorApi {
  started: string[] = [];
  status = { arena: null as string | null, wave: 0, waves: 0, live: 0, queued: 0, cleared: [] as string[] };
  startArena(id: string) { this.started.push(id); this.status.arena = id; }
  step() {}
  isCleared(id: string) { return this.status.cleared.includes(id); }
  reset() { this.status.cleared = []; }
}

let lastEnemies: FakeEnemies;
let lastDirector: FakeDirector;
const factories: RunFactories = {
  createEnemies: () => (lastEnemies = new FakeEnemies()),
  createDirector: () => (lastDirector = new FakeDirector()),
};

function level(): LevelDef {
  const boxes: BoxDef[] = [{ id: 'gate_a', pos: { x: 0, y: 2, z: -10 }, size: { x: 6, y: 4, z: 1 }, mat: 'metal', gateOpensAfter: 'yard' }];
  const l = testLevel(boxes);
  l.playerStart = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
  l.arenas = [
    { id: 'yard', name: 'A', trigger: { min: { x: -5, y: 0, z: -5 }, max: { x: 5, y: 5, z: -2 } }, bounds: { min: { x: -20, y: -5, z: -20 }, max: { x: 20, y: 20, z: 0 } }, lanes: [], cache: { x: 3, y: 0, z: 3 }, objective: 'Clear A' },
    { id: 'relay', name: 'R', trigger: { min: { x: 30, y: 0, z: 30 }, max: { x: 31, y: 5, z: 31 } }, bounds: { min: { x: 20, y: -5, z: 20 }, max: { x: 40, y: 20, z: 40 } }, lanes: [], cache: { x: 35, y: 0, z: 35 }, objective: 'R' },
  ];
  l.pickups = [
    { kind: 'health', pos: { x: 8, y: 0, z: 0 }, amount: 25 },
    { kind: 'ammo_coil', pos: { x: -8, y: 0, z: 0 }, amount: 20, afterArena: 'yard' },
  ];
  l.weaponRack = { pos: { x: -3, y: 0, z: 0 }, yaw: 0, weapon: 'arc_scattergun' };
  l.relay = { pos: { x: 0, y: 0, z: 10 }, interactRadius: 3, shutdownTime: 2, arena: 'relay' };
  l.extraction = { pos: { x: 0, y: 0, z: 20 }, radius: 3 };
  return l;
}

let run: Run | null = null;
afterEach(() => {
  run?.dispose();
  run = null;
});
async function mk(extra: Partial<RunOptions> = {}): Promise<Run> {
  run = await Run.create({ level: level(), seed: 'TESTSEED', starter: 'coil_carbine', ...extra }, factories);
  return run;
}
const steps = (r: Run, n: number, s: Partial<InputSample> = {}) => {
  for (let i = 0; i < n; i++) r.step(sample(s));
};
const evs = (r: Run, t: GameEvent['type']) => r.drainEvents().filter((e) => e.type === t);

describe('Run', () => {
  it('opens the deployment draft and freezes the sim until it is resolved', async () => {
    const r = await mk();
    r.start();
    expect(r.draft).not.toBeNull();
    steps(r, 30);
    expect(r.time).toBe(0);
    expect(lastEnemies.steps).toBe(0);
    const res = r.draftPick(r.draft!.offer.offerId, 0);
    expect(res.ok).toBe(true);
    expect(r.draft).toBeNull();
    steps(r, 30);
    expect(r.time).toBeCloseTo(0.5, 5);
  });

  it('same seed gives the same offers; draft RNG ignores gameplay', async () => {
    const a = await mk();
    a.start();
    const idsA = a.draft!.offer.options.map((o) => o.id);
    a.dispose();
    const b = await mk();
    b.start();
    expect(b.draft!.offer.options.map((o) => o.id)).toEqual(idsA);
    const c = await mk({ seed: 'OTHER' });
    c.start();
    expect(c.draft!.offer.options.map((o) => o.id)).not.toEqual(idsA);
  });

  it('arena trigger starts the director; clearing opens gates, shows pickups and the cache', async () => {
    const r = await mk();
    r.start({ skipDeployment: true });
    r.player.pos = { x: 0, y: 0, z: -3 };
    steps(r, 2);
    expect(lastDirector.started).toEqual(['yard']);
    expect(r.phys.isGateOpen('gate_a')).toBe(false);
    expect(r.renderPickups().some((p) => p.kind === 'ammo_coil')).toBe(false);
    r.emit({ type: 'encounter_clear', encounter: 'yard', salvage: 30 });
    expect(r.phys.isGateOpen('gate_a')).toBe(true);
    expect(lastEnemies.gates['gate_a']).toBe(true);
    expect(r.salvage).toBe(30);
    expect(r.renderPickups().some((p) => p.kind === 'ammo_coil')).toBe(true);
    // Cache: stand next to it, press E -> reward 1 draft.
    r.player.pos = { x: 3, y: 0, z: 2 };
    steps(r, 2);
    expect(r.interactPrompt).toContain('SUPPLY');
    steps(r, 1, { interactPressed: true });
    expect(r.draft?.offer.rewardIndex).toBe(1);
    const view = r.draftView()!;
    expect(view.cards.length).toBe(3);
    expect(r.draftSkip(view.offer.offerId).ok).toBe(true);
    expect(r.salvage).toBe(40);
    // Cache is single use.
    steps(r, 2);
    expect(r.interactPrompt).toBeNull();
  });

  it('weapon rack gives the second main; pickups respect caps', async () => {
    const r = await mk();
    r.start({ skipDeployment: true });
    r.player.pos = { x: -3, y: 0, z: 1 };
    steps(r, 2);
    expect(r.interactPrompt).toContain('ARC');
    steps(r, 1, { interactPressed: true });
    expect(r.weapons.owns('arc_scattergun')).toBe(true);
    expect(r.cards.equipped).toContain('arc_scattergun');
    expect(r.rackHasWeapon).toBe(false);
    // Health pickup is left alone at full health, taken when hurt.
    r.player.pos = { x: 8, y: 0, z: 0 };
    steps(r, 3);
    expect(r.renderPickups().some((p) => p.kind === 'health')).toBe(true);
    r.player.hurt(40, null);
    steps(r, 3);
    expect(r.player.health).toBe(85);
    expect(r.renderPickups().some((p) => p.kind === 'health')).toBe(false);
  });

  it('relay shutdown by holding E, then extraction ends the run', async () => {
    const r = await mk();
    r.start({ skipDeployment: true });
    r.emit({ type: 'encounter_clear', encounter: 'relay', salvage: 0 });
    r.player.pos = { x: 0, y: 0, z: 9 };
    steps(r, 2);
    expect(r.interactPrompt).toContain('UPLINK');
    steps(r, 60, { interactHeld: true });
    expect(r.relay.progress).toBeLessThan(1);
    steps(r, 70, { interactHeld: true });
    expect(r.relay.done).toBe(true);
    expect(r.extractionActive).toBe(true);
    r.player.pos = { x: 0, y: 0, z: 19 };
    steps(r, 1);
    expect(r.outcome).toBe('extracted');
    steps(r, 60);
    expect(r.finished).toBe(true);
    expect(evs(r, 'run_end').length).toBe(1);
  });

  it('player death ends the run after a delay; dispose is idempotent and frees the world', async () => {
    const r = await mk();
    r.start({ skipDeployment: true });
    r.player.hurt(1000, null);
    expect(r.outcome).toBe('dead');
    steps(r, 120);
    expect(r.finished).toBe(true);
    r.dispose();
    r.dispose();
    expect(lastEnemies.cleared).toBe(true);
  });

  it('vent hazards cycle and hurt only inside the radius while active', async () => {
    const l = level();
    l.hazards = [{ id: 'v', kind: 'vent', pos: { x: 12, y: 0, z: 12 }, radius: 3, period: 4, warn: 1, active: 1, offset: 0, damagePerSec: 20 }];
    run = await Run.create({ level: l, seed: 'H', starter: 'coil_carbine' }, factories);
    const r = run;
    r.start({ skipDeployment: true });
    r.player.pos = { x: 12, y: 0, z: 12 };
    steps(r, 60 * 4);
    const lost = 100 - r.player.health;
    expect(lost).toBeGreaterThan(10);
    expect(lost).toBeLessThan(30);
    expect(r.drainEvents().some((e) => e.type === 'hazard_warn')).toBe(true);
  });

  it('debug loadout + skipTo set up a mid-run state', async () => {
    const r = await mk({ loadout: 'coil-cascade', skipTo: 'relay' });
    expect(r.cards.pact).toBe('coil_carbine');
    expect(r.weapons.pact).toBe('coil_carbine');
    expect(r.phys.isGateOpen('gate_a')).toBe(true);
  });
});
