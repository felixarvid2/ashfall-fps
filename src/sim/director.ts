import { ENCOUNTERS, STRESS_MIX, type EncounterTemplate, type SpawnGroup, type WaveTemplate } from '../content/encounters';
import { ENEMIES } from '../content/enemies';
import type { ArenaDef, LaneDef, LevelDef } from '../content/levelTypes';
import type { Rng } from '../core/rng';
import type { EnemyManager } from './enemies';
import type { EnemyKind, GameEvent, Vec3 } from './types';

/** A directed group of enemies from one lane: warned first, then trickled in. */
interface Burst {
  kind: EnemyKind;
  remaining: number;
  /** Planned lane (may be swapped by the fallback logic). */
  laneId: string;
  lane: LaneDef | null;
  spawn: Vec3 | null;
  warnAt: number;
  dueAt: number;
  nextAt: number;
  warned: boolean;
  started: boolean;
  retries: number;
  chargeChance: number;
  liveCap: number;
  warnLead: number;
  label: string;
  spawnedIdx: number;
}

export interface DirectorStatus {
  arena: string | null;
  wave: number;
  waves: number;
  live: number;
  queued: number;
  cleared: string[];
}

/** Spawn points closer than this to the player are unusable. */
const MIN_SPAWN_DIST = 12;
/** Inside this range a spawn point in direct view of the player is also unusable. */
const VIEW_RANGE = 16;
const BURST_SPACING = 0.35;

export class Director {
  private level: LevelDef;
  private enemies: EnemyManager;
  private rng: Rng;
  private emit: (e: GameEvent) => void;
  private arenaById = new Map<string, ArenaDef>();
  private cleared: string[] = [];
  private active: { arena: ArenaDef; tpl: EncounterTemplate } | null = null;
  private waveIdx = -1;
  private waveStart = 0;
  private readyAt = -1;
  private bursts: Burst[] = [];
  private time = 0;
  private stress = false;
  private player: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(level: LevelDef, enemies: EnemyManager, rng: Rng, emit: (e: GameEvent) => void) {
    this.level = level;
    this.enemies = enemies;
    this.rng = rng;
    this.emit = emit;
    for (const a of level.arenas) this.arenaById.set(a.id, a);
  }

  get status(): DirectorStatus {
    return {
      arena: this.stress ? 'stress' : this.active?.arena.id ?? null,
      wave: this.stress ? 1 : Math.max(0, this.waveIdx + 1),
      waves: this.stress ? 1 : this.active?.tpl.waves.length ?? 0,
      live: this.enemies.liveCount(),
      queued: this.queued(),
      cleared: this.cleared.slice(),
    };
  }

  isCleared(id: string): boolean {
    return this.cleared.includes(id);
  }

  reset(): void {
    this.cleared = [];
    this.active = null;
    this.waveIdx = -1;
    this.bursts = [];
    this.readyAt = -1;
    this.stress = false;
  }

  /** Pending (not yet spawned) enemies across all bursts. */
  queued(): number {
    let n = 0;
    for (const b of this.bursts) n += b.remaining;
    return n;
  }

  startArena(id: string): void {
    if (this.active || this.stress || this.isCleared(id)) return;
    const arena = this.arenaById.get(id);
    const tpl = ENCOUNTERS[id];
    if (!arena || !tpl) return;
    this.active = { arena, tpl };
    this.waveIdx = -1;
    this.bursts = [];
    this.readyAt = -1;
    this.beginWave(this.time);
  }

  /** Spawns `count` mixed enemies at once across the Slag Fields lanes for profiling. */
  startStress(count = 120): void {
    this.reset();
    this.stress = true;
    const arena = this.arenaById.get('slag') ?? this.level.arenas[0]!;
    const ground = arena.lanes.filter((l) => !l.air);
    const air = arena.lanes.filter((l) => l.air);
    const weights = STRESS_MIX.map((m) => m.weight);
    for (let i = 0; i < count; i++) {
      const kind = STRESS_MIX[this.rng.weightedIndex(weights)]!.kind;
      const pool = kind === 'drone' && air.length ? air : ground;
      const lane = pool[i % pool.length]!;
      const sp = lane.spawns[i % lane.spawns.length]!;
      const pos = { x: sp.x + this.rng.range(-5, 5), y: sp.y, z: sp.z + this.rng.range(-4, 4) };
      this.enemies.spawn(kind, pos, lane.id, kind === 'walker' && this.rng.chance(0.4) ? { charge: true } : undefined);
    }
  }

  step(dt: number, time: number, playerPos: Vec3): void {
    void dt;
    this.time = time;
    this.player = playerPos;
    if (this.stress) {
      if (this.enemies.liveCount() === 0) {
        this.stress = false;
        this.emit({ type: 'encounter_clear', encounter: 'stress', salvage: 0 });
      }
      return;
    }
    const act = this.active;
    if (!act) return;
    // Boss add requests.
    const calls = this.enemies.consumeCallRequests();
    for (const c of calls) this.planCall(act, c.phase);
    this.pumpBursts();
    const wave = act.tpl.waves[this.waveIdx]!;
    const live = this.enemies.liveCount();
    const queued = this.queued();
    const lastWave = this.waveIdx >= act.tpl.waves.length - 1;
    if (queued === 0) {
      if (lastWave) {
        if (live === 0) this.finish(act);
        return;
      }
      const forced = time - this.waveStart > wave.maxTime;
      if (live <= wave.advanceAt || forced) {
        if (this.readyAt < 0) this.readyAt = time + (forced && live > wave.advanceAt ? 0 : wave.cooldown);
        if (time >= this.readyAt) this.beginWave(time);
      } else this.readyAt = -1;
    }
  }

  // -------------------------------------------------------------------------

  private finish(act: { arena: ArenaDef; tpl: EncounterTemplate }): void {
    this.cleared.push(act.arena.id);
    this.enemies.setGateOpen(act.arena.id, true);
    this.active = null;
    this.waveIdx = -1;
    this.readyAt = -1;
    this.emit({ type: 'encounter_clear', encounter: act.arena.id, salvage: act.tpl.salvage });
  }

  private beginWave(time: number): void {
    const act = this.active!;
    this.waveIdx++;
    this.waveStart = time;
    this.readyAt = -1;
    const wave = act.tpl.waves[this.waveIdx]!;
    this.planWave(act.arena, wave, time);
    this.emit({ type: 'wave_start', encounter: act.arena.id, wave: this.waveIdx + 1, total: act.tpl.waves.length });
  }

  private roll(g: SpawnGroup): number {
    return typeof g.count === 'number' ? g.count : this.rng.int(g.count[0], g.count[1]);
  }

  /** Rolls a wave's groups into bursts, truncated to the wave budget. */
  private planWave(arena: ArenaDef, wave: WaveTemplate, start: number): void {
    const planned: Burst[] = [];
    for (const g of wave.groups) {
      if (g.chance !== undefined && !this.rng.chance(g.chance)) continue;
      const n = this.roll(g);
      let cycle = this.rng.int(0, g.lanes.length - 1);
      let left = n;
      for (let i = 0; left > 0; i++) {
        const take = Math.min(g.burst, left);
        left -= take;
        let laneId: string;
        if (g.pick === 'cycle') laneId = g.lanes[cycle++ % g.lanes.length]!;
        else laneId = this.rng.pick(g.lanes);
        const warnAt = start + (g.delay ?? 0) + i * g.gap;
        planned.push(this.makeBurst(g.kind, take, laneId, warnAt, wave.warn, g.charge ?? 0, wave.liveCap, arena));
      }
    }
    planned.sort((a, b) => a.warnAt - b.warnAt);
    let budget = wave.budget;
    for (const b of planned) {
      const cost = ENEMIES[b.kind].cost;
      const afford = Math.floor(budget / cost);
      b.remaining = Math.min(b.remaining, afford);
      budget -= b.remaining * cost;
      if (b.remaining > 0) this.bursts.push(b);
    }
  }

  private planCall(act: { arena: ArenaDef; tpl: EncounterTemplate }, phase: number): void {
    const g = act.tpl.calls?.[Math.min(phase, (act.tpl.calls?.length ?? 1) - 1)];
    if (!g) return;
    const n = this.roll(g);
    let cycle = this.rng.int(0, g.lanes.length - 1);
    let left = n;
    const lead = ENEMIES.loader.call.windup + 0.3;
    for (let i = 0; left > 0; i++) {
      const take = Math.min(g.burst, left);
      left -= take;
      const laneId = g.lanes[cycle++ % g.lanes.length]!;
      const b = this.makeBurst(g.kind, take, laneId, this.time + i * g.gap, lead, g.charge ?? 0, 9999, act.arena);
      this.bursts.push(b);
    }
  }

  private makeBurst(kind: EnemyKind, n: number, laneId: string, warnAt: number, warn: number, charge: number, cap: number, arena: ArenaDef): Burst {
    const lane = arena.lanes.find((l) => l.id === laneId) ?? null;
    return {
      kind, remaining: n, laneId, lane, spawn: null,
      warnAt, dueAt: warnAt + warn, nextAt: 0, warned: false, started: false, retries: 0,
      chargeChance: charge, liveCap: cap, warnLead: warn, label: lane?.label ?? laneId, spawnedIdx: 0,
    };
  }

  private spawnOk(p: Vec3): boolean {
    const dx = p.x - this.player.x;
    const dz = p.z - this.player.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < MIN_SPAWN_DIST) return false;
    if (d < VIEW_RANGE && this.enemies.canSee({ x: p.x, y: p.y + 1.2, z: p.z }, { x: this.player.x, y: this.player.y + 1.4, z: this.player.z })) return false;
    return true;
  }

  /** Picks a usable spawn point: planned lane first, then alternates of the same kind (air/ground). */
  private resolve(b: Burst): void {
    const arena = this.active?.arena;
    if (!arena) return;
    const air = !!b.lane?.air || ENEMIES[b.kind].kind === 'drone';
    const tryLane = (l: LaneDef): Vec3 | null => {
      const n = l.spawns.length;
      const start = this.rng.int(0, n - 1);
      for (let i = 0; i < n; i++) {
        const s = l.spawns[(start + i) % n]!;
        if (this.spawnOk(s)) return s;
      }
      return null;
    };
    const planned = b.lane;
    if (planned) {
      const s = tryLane(planned);
      if (s) {
        b.spawn = s;
        return;
      }
    }
    const alts = arena.lanes.filter((l) => l !== planned && !!l.air === air);
    this.rng.shuffle(alts);
    for (const l of alts) {
      const s = tryLane(l);
      if (s) {
        b.lane = l;
        b.laneId = l.id;
        b.label = l.label;
        b.spawn = s;
        return;
      }
    }
    // Nothing usable: farthest spawn point of any matching lane.
    let far = -1;
    for (const l of [planned, ...alts]) {
      if (!l) continue;
      for (const s of l.spawns) {
        const d = Math.hypot(s.x - this.player.x, s.z - this.player.z);
        if (d > far) {
          far = d;
          b.spawn = s;
          b.lane = l;
          b.laneId = l.id;
          b.label = l.label;
        }
      }
    }
  }

  private warn(b: Burst): void {
    this.resolve(b);
    if (!b.spawn) return;
    this.emit({ type: 'wave_warn', label: b.label, lane: b.laneId, pos: { x: b.spawn.x, y: b.spawn.y, z: b.spawn.z } });
    b.warned = true;
  }

  private pumpBursts(): void {
    const t = this.time;
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i]!;
      if (!b.warned && t >= b.warnAt) this.warn(b);
      if (!b.warned || t < b.dueAt || t < b.nextAt) continue;
      if (this.enemies.liveCount() >= b.liveCap) continue;
      if (!b.started) {
        // Re-validate: the player may have walked next to the planned point.
        if (b.spawn && !this.spawnOk(b.spawn) && b.retries < 3) {
          b.retries++;
          this.resolve(b);
          if (b.spawn) {
            this.emit({ type: 'wave_warn', label: b.label, lane: b.laneId, pos: { x: b.spawn.x, y: b.spawn.y, z: b.spawn.z } });
            b.dueAt = t + 1.2;
          }
          continue;
        }
        b.started = true;
      }
      if (!b.spawn || !b.lane) continue;
      const k = b.spawnedIdx++;
      const ang = k * 2.4;
      const r = 0.8 * Math.sqrt(k);
      const pos = { x: b.spawn.x + Math.cos(ang) * r, y: b.spawn.y, z: b.spawn.z + Math.sin(ang) * r };
      const charge = b.kind === 'walker' && b.chargeChance > 0 && this.rng.chance(b.chargeChance);
      this.enemies.spawn(b.kind, pos, b.lane.id, charge ? { charge: true } : undefined);
      b.remaining--;
      b.nextAt = t + BURST_SPACING;
    }
    // Drop empty bursts.
    let w = 0;
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i]!;
      if (b.remaining > 0) this.bursts[w++] = b;
    }
    this.bursts.length = w;
  }
}
