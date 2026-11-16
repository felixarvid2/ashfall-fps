import { CORPSE_FADE_START, CORPSE_TIME, DRONE, HOUND, LOADER, OUT_OF_BOUNDS_TIME, WALKER } from '../../content/enemies';
import type { ArenaDef, LaneDef, LevelDef } from '../../content/levelTypes';
import type { PhysicsQueries } from '../../physics/types';
import type { EnemyRenderState, ProjectileRenderState } from '../../render/types';
import type { Rng } from '../../core/rng';
import type { DamageOrigin, EnemyInfo, EnemyKind, EnemyState, GameEvent, RayEnemyHit, Vec3 } from '../types';
import { buildObstacles, buildRamps, ObstacleGrid, rayVerticalCapsule, type Ramp } from './geometry';

export interface PlayerTarget {
  pos: Vec3;
  vel: Vec3;
  alive: boolean;
  hurt(amount: number, from: Vec3): void;
}

export interface SpawnOpts {
  /** Walkers: run instead of walk. */
  charge?: boolean;
}

export interface CallRequest {
  loader: number;
  /** 0-based call index (0 = 66%, 1 = 33%). */
  phase: number;
}

type LoaderAttack = 'sweep' | 'slam' | 'call';

class Enemy {
  id = 0;
  slot = 0;
  kind: EnemyKind = 'walker';
  inUse = false;
  dead = false;
  state: EnemyState = 'spawning';
  stateT = 0;
  stateDur = 0;
  x = 0; y = 0; z = 0;
  px = 0; py = 0; pz = 0;
  yaw = 0; pyaw = 0;
  vx = 0; vz = 0;
  kx = 0; kz = 0;
  hp = 1; maxHp = 1;
  radius = 0.5; height = 1.8;
  heavy = false;
  air = false;
  laneId: string | null = null;
  path: Vec3[] | null = null;
  pathI = 0;
  arena: ArenaDef | null = null;
  lane: LaneDef | null = null;
  ionizedUntil = 0;
  lastHit = -99;
  gy = 0;
  gNext = 0;
  decideT = 0;
  dirx = 0; dirz = 1;
  side = 1;
  charge = false;
  cd = 0;
  // attack data
  ax = 0; az = 0; ayaw = 0;
  hitDone = false;
  attack: string | null = null;
  // death / recovery
  deadT = 0;
  outsideT = 0;
  checkT = 0;
  stuckT = 0;
  sx = 0; sz = 0;
  // hound
  flankT = 0;
  flankR = 10;
  flankCycles = 0;
  // drone
  hover = 4;
  phase = 0;
  los = true;
  losT = 0;
  attackAt = 0;
  // loader
  callsDone = 0;
  exposed = false;
  armorBroken = false;
  lastAtk: LoaderAttack | null = null;
  clawYaw = 0;
  // ramp routing
  via: Ramp | null = null;
  viaStage = 0;
}

interface Projectile {
  id: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  damage: number;
  radius: number;
}

const TAU = Math.PI * 2;
function wrap(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

const GRID_CELL = 3;

export class EnemyManager {
  private level: LevelDef;
  private phys: PhysicsQueries;
  private rng: Rng;
  private emit: (e: GameEvent) => void;
  private obstacles: ObstacleGrid;
  private ramps: Ramp[];
  private pool: Enemy[] = [];
  private free: number[] = [];
  private active: Enemy[] = [];
  private byId = new Map<number, Enemy>();
  private nextId = 1;
  private live = 0;
  private time = 0;
  private frame = 0;
  private projs: Projectile[] = [];
  private nextProj = 1;
  private lanes = new Map<string, { lane: LaneDef; arena: ArenaDef }>();
  private calls: CallRequest[] = [];
  // spatial hash
  private gOx: number;
  private gOz: number;
  private gW: number;
  private gH: number;
  private gHead: Int32Array;
  private gNext: Int32Array;
  // scratch
  private tx = 0;
  private tz = 0;
  private pDir = { x: 0, y: 0, z: 0 };

  constructor(level: LevelDef, phys: PhysicsQueries, rng: Rng, emit: (e: GameEvent) => void) {
    this.level = level;
    this.phys = phys;
    this.rng = rng.fork('enemies');
    this.emit = emit;
    const b = level.bounds;
    this.obstacles = new ObstacleGrid(buildObstacles(level), b.min.x, b.min.z, b.max.x, b.max.z);
    this.ramps = buildRamps(level);
    for (const a of level.arenas) for (const l of a.lanes) this.lanes.set(l.id, { lane: l, arena: a });
    this.gOx = b.min.x;
    this.gOz = b.min.z;
    this.gW = Math.ceil((b.max.x - b.min.x) / GRID_CELL) + 2;
    this.gH = Math.ceil((b.max.z - b.min.z) / GRID_CELL) + 2;
    this.gHead = new Int32Array(this.gW * this.gH).fill(-1);
    this.gNext = new Int32Array(256).fill(-1);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  spawn(kind: EnemyKind, pos: Vec3, laneId?: string, opts?: SpawnOpts): number {
    let e: Enemy;
    const slot = this.free.pop();
    if (slot !== undefined) e = this.pool[slot]!;
    else {
      e = new Enemy();
      e.slot = this.pool.length;
      this.pool.push(e);
      if (this.pool.length > this.gNext.length) {
        const n = new Int32Array(this.gNext.length * 2).fill(-1);
        this.gNext = n;
      }
    }
    const prof = kind === 'walker' ? WALKER : kind === 'hound' ? HOUND : kind === 'drone' ? DRONE : LOADER;
    const slotKeep = e.slot;
    Object.assign(e, new Enemy());
    e.slot = slotKeep;
    e.id = this.nextId++;
    e.kind = kind;
    e.inUse = true;
    e.hp = e.maxHp = prof.hp;
    e.radius = prof.radius;
    e.height = prof.height;
    e.heavy = prof.heavy;
    e.air = kind === 'drone';
    e.x = e.px = pos.x;
    e.y = e.py = pos.y;
    e.z = e.pz = pos.z;
    e.gy = pos.y;
    e.state = 'spawning';
    e.stateDur = prof.spawnTime;
    e.side = this.rng.chance(0.5) ? 1 : -1;
    e.charge = !!opts?.charge;
    e.decideT = this.time + (e.id % 7) * 0.02;
    e.gNext = this.frame + (e.id % 5);
    e.checkT = this.time + 0.5 + (e.id % 10) * 0.05;
    e.sx = pos.x;
    e.sz = pos.z;
    if (kind === 'drone') {
      e.hover = this.rng.range(DRONE.hoverMin, DRONE.hoverMax);
      e.phase = this.rng.range(0, TAU);
      e.attackAt = this.time + this.rng.range(2, 4);
    }
    if (kind === 'hound') e.flankR = this.rng.range(HOUND.flankRadius[0], HOUND.flankRadius[1]);
    if (laneId) {
      const rec = this.lanes.get(laneId);
      if (rec) {
        e.laneId = laneId;
        e.lane = rec.lane;
        e.arena = rec.arena;
        e.path = rec.lane.path;
      }
    }
    if (!e.arena) e.arena = this.arenaAt(pos.x, pos.z);
    // face along the first path leg / toward arena
    if (e.path && e.path.length) e.yaw = e.pyaw = Math.atan2(-(e.path[0]!.x - pos.x), -(e.path[0]!.z - pos.z));
    this.active.push(e);
    this.byId.set(e.id, e);
    this.live++;
    this.emit({ type: 'enemy_spawn', id: e.id, kind, pos: { x: pos.x, y: pos.y, z: pos.z } });
    return e.id;
  }

  liveCount(): number {
    return this.live;
  }

  /** Pending corpses are not live. */
  totalTracked(): number {
    return this.active.length;
  }

  info(id: number): EnemyInfo | undefined {
    const e = this.byId.get(id);
    return e ? this.toInfo(e) : undefined;
  }

  inRadius(center: Vec3, r: number): EnemyInfo[] {
    const out: { e: Enemy; d: number }[] = [];
    for (const e of this.active) {
      if (e.dead) continue;
      const cy = e.y + e.height * 0.5;
      const dx = e.x - center.x;
      const dy = cy - center.y;
      const dz = e.z - center.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= r) out.push({ e, d });
    }
    out.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
    return out.map((o) => this.toInfo(o.e));
  }

  /** Alive enemy ids (insertion order). */
  aliveIds(): number[] {
    const out: number[] = [];
    for (const e of this.active) if (!e.dead) out.push(e.id);
    return out;
  }

  canSee(a: Vec3, b: Vec3): boolean {
    return this.phys.lineOfSight(a, b);
  }

  applyDamage(id: number, amount: number, point: Vec3, origin: DamageOrigin): { killed: boolean; armorBreak: boolean } | null {
    const e = this.byId.get(id);
    if (!e || e.dead) return null;
    let dmg = amount;
    let armorBreak = false;
    if (e.kind === 'loader' && e.exposed) {
      dmg *= LOADER.jointMul;
      if (!e.armorBroken) {
        e.armorBroken = true;
        armorBreak = true;
      }
    }
    e.hp -= dmg;
    e.lastHit = this.time;
    const ev: GameEvent = { type: 'enemy_hit', id: e.id, kind: e.kind, amount: dmg, point: { x: point.x, y: point.y, z: point.z }, origin };
    if (armorBreak) (ev as { armorBreak?: boolean }).armorBreak = true;
    this.emit(ev);
    if (e.hp <= 0) {
      e.hp = 0;
      this.kill(e, origin);
      return { killed: true, armorBreak };
    }
    return { killed: false, armorBreak };
  }

  push(id: number, dir: Vec3, strength: number): void {
    const e = this.byId.get(id);
    if (!e || e.dead) return;
    const prof = this.prof(e);
    if (prof.pushResist <= 0) return;
    const l = Math.hypot(dir.x, dir.z);
    if (l < 1e-6) return;
    const s = Math.min(14, strength * prof.pushResist);
    e.kx += (dir.x / l) * s;
    e.kz += (dir.z / l) * s;
    const m = Math.hypot(e.kx, e.kz);
    if (m > 14) {
      e.kx *= 14 / m;
      e.kz *= 14 / m;
    }
  }

  stagger(id: number, seconds: number): void {
    const e = this.byId.get(id);
    if (!e || e.dead || e.heavy || e.state === 'spawning') return;
    if (e.state === 'stagger') {
      e.stateDur = Math.max(e.stateDur, e.stateT + seconds);
      return;
    }
    this.setState(e, 'stagger', seconds);
    e.attack = null;
  }

  setIonized(id: number, until: number): void {
    const e = this.byId.get(id);
    if (e && !e.dead) e.ionizedUntil = Math.max(e.ionizedUntil, until);
  }

  /** Capsule raycast against alive enemies; `dir` must be normalized. Sorted by distance. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, maxHits: number): RayEnemyHit[] {
    const hits: RayEnemyHit[] = [];
    for (const e of this.active) {
      if (e.dead) continue;
      // bounding sphere reject
      const cy = e.y + e.height * 0.5;
      const rx = e.x - origin.x;
      const ry = cy - origin.y;
      const rz = e.z - origin.z;
      const along = rx * dir.x + ry * dir.y + rz * dir.z;
      const br = e.height * 0.5 + e.radius;
      if (along < -br || along > maxDist + br) continue;
      const px = rx - dir.x * along;
      const py = ry - dir.y * along;
      const pz = rz - dir.z * along;
      if (px * px + py * py + pz * pz > br * br) continue;
      const ya = e.y + Math.min(e.radius, e.height / 2);
      const yb = Math.max(ya, e.y + e.height - e.radius);
      const t = rayVerticalCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, e.x, e.z, ya, yb, e.radius, maxDist);
      if (t >= 0) hits.push({ enemy: e.id, dist: t, point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t } });
    }
    hits.sort((a, b) => a.dist - b.dist || a.enemy - b.enemy);
    if (hits.length > maxHits) hits.length = maxHits;
    return hits;
  }

  setGateOpen(id: string, open: boolean): void {
    for (const o of this.obstacles.list) if (o.gateId === id || o.gateArena === id) o.active = !open;
  }

  clear(): void {
    for (const e of this.active) {
      e.inUse = false;
      this.free.push(e.slot);
    }
    this.active.length = 0;
    this.byId.clear();
    this.projs.length = 0;
    this.calls.length = 0;
    this.live = 0;
  }

  /** Pending Cargo Loader add requests (drained by the director). */
  consumeCallRequests(): CallRequest[] {
    if (!this.calls.length) return this.calls;
    const out = this.calls;
    this.calls = [];
    return out;
  }

  projectiles(): ProjectileRenderState[] {
    return this.projs.map((p) => ({ id: p.id, kind: 'fireball' as const, pos: { x: p.x, y: p.y, z: p.z }, vel: { x: p.vx, y: p.vy, z: p.vz } }));
  }

  projectileCount(): number {
    return this.projs.length;
  }

  renderStates(alpha: number): EnemyRenderState[] {
    const out: EnemyRenderState[] = [];
    for (const e of this.active) {
      const a = e.dead ? 1 : alpha;
      const dur = e.state === 'dead' ? CORPSE_TIME : e.stateDur;
      const rs: EnemyRenderState = {
        id: e.id,
        kind: e.kind,
        pos: { x: e.px + (e.x - e.px) * a, y: e.py + (e.y - e.py) * a, z: e.pz + (e.z - e.pz) * a },
        yaw: e.pyaw + wrap(e.yaw - e.pyaw) * a,
        state: e.state,
        stateTime: e.state === 'dead' ? e.deadT : e.stateT,
        stateDuration: dur,
        hpFrac: e.maxHp > 0 ? Math.max(0, e.hp / e.maxHp) : 0,
        ionized: !e.dead && this.time < e.ionizedUntil,
        sinceHit: Math.max(0, this.time - e.lastHit),
        fade: e.dead ? Math.min(1, Math.max(0, (e.deadT - CORPSE_FADE_START) / (CORPSE_TIME - CORPSE_FADE_START))) : 0,
      };
      if (e.kind === 'loader') {
        const atk = e.attack === 'sweep' || e.attack === 'slam' || e.attack === 'call' ? e.attack : null;
        rs.loader = { attack: atk, jointExposed: e.exposed, clawYaw: e.clawYaw };
      }
      out.push(rs);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Step
  // -------------------------------------------------------------------------

  step(dt: number, time: number, player: PlayerTarget): void {
    this.time = time;
    this.frame++;
    // Rebuild spatial hash of alive enemies.
    this.gHead.fill(-1);
    for (let i = 0; i < this.active.length; i++) {
      const e = this.active[i]!;
      e.px = e.x;
      e.py = e.y;
      e.pz = e.z;
      e.pyaw = e.yaw;
      if (e.dead) continue;
      const ci = this.cellIndex(e.x, e.z);
      this.gNext[e.slot] = this.gHead[ci]!;
      this.gHead[ci] = e.slot;
    }
    const pl = player;
    for (let i = 0; i < this.active.length; i++) {
      const e = this.active[i]!;
      if (e.dead) {
        e.deadT += dt;
        continue;
      }
      this.updateEnemy(e, dt, pl);
    }
    this.separate();
    for (let i = 0; i < this.active.length; i++) {
      const e = this.active[i]!;
      if (e.dead) continue;
      this.finishMove(e, dt, pl);
    }
    this.stepProjectiles(dt, pl);
    // Recycle corpses.
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i]!;
      if (e.dead && e.deadT >= CORPSE_TIME) {
        e.inUse = false;
        this.free.push(e.slot);
        this.byId.delete(e.id);
        const last = this.active.pop()!;
        if (last !== e) this.active[i] = last;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private prof(e: Enemy) {
    return e.kind === 'walker' ? WALKER : e.kind === 'hound' ? HOUND : e.kind === 'drone' ? DRONE : LOADER;
  }

  private toInfo(e: Enemy): EnemyInfo {
    return {
      id: e.id,
      kind: e.kind,
      pos: { x: e.x, y: e.y, z: e.z },
      center: { x: e.x, y: e.y + e.height * 0.5, z: e.z },
      hp: e.hp,
      maxHp: e.maxHp,
      heavy: e.heavy,
      alive: !e.dead,
      ionizedUntil: e.ionizedUntil,
    };
  }

  private cellIndex(x: number, z: number): number {
    let cx = Math.floor((x - this.gOx) / GRID_CELL);
    let cz = Math.floor((z - this.gOz) / GRID_CELL);
    if (cx < 0) cx = 0;
    else if (cx >= this.gW) cx = this.gW - 1;
    if (cz < 0) cz = 0;
    else if (cz >= this.gH) cz = this.gH - 1;
    return cz * this.gW + cx;
  }

  private arenaAt(x: number, z: number): ArenaDef | null {
    for (const a of this.level.arenas) {
      if (x >= a.bounds.min.x && x <= a.bounds.max.x && z >= a.bounds.min.z && z <= a.bounds.max.z) return a;
    }
    return null;
  }

  private setState(e: Enemy, s: EnemyState, dur: number): void {
    e.state = s;
    e.stateT = 0;
    e.stateDur = dur;
  }

  private kill(e: Enemy, origin: DamageOrigin): void {
    e.dead = true;
    e.state = 'dead';
    e.stateT = 0;
    e.stateDur = CORPSE_TIME;
    e.deadT = 0;
    e.attack = null;
    e.exposed = false;
    e.vx = e.vz = 0;
    this.live--;
    this.emit({ type: 'enemy_die', id: e.id, kind: e.kind, pos: { x: e.x, y: e.y, z: e.z }, origin });
  }

  private tell(e: Enemy, attack: string, duration: number): void {
    e.attack = attack;
    this.emit({ type: 'enemy_tell', id: e.id, kind: e.kind, attack, pos: { x: e.x, y: e.y, z: e.z }, duration });
  }

  private release(e: Enemy, attack: string, pos?: Vec3): void {
    this.emit({ type: 'enemy_attack', id: e.id, kind: e.kind, attack, pos: pos ?? { x: e.x, y: e.y, z: e.z } });
  }

  private faceToward(e: Enemy, dx: number, dz: number, rate: number, dt: number): void {
    if (dx * dx + dz * dz < 1e-6) return;
    const target = Math.atan2(-dx, -dz);
    const d = wrap(target - e.yaw);
    const step = rate * dt;
    e.yaw = wrap(e.yaw + (d > step ? step : d < -step ? -step : d));
  }

  /** Smooth velocity toward (dirx,dirz)*speed and integrate with knockback. */
  private move(e: Enemy, dirx: number, dirz: number, speed: number, dt: number, accel: number): void {
    const a = Math.min(1, accel * dt);
    e.vx += (dirx * speed - e.vx) * a;
    e.vz += (dirz * speed - e.vz) * a;
    e.x += (e.vx + e.kx) * dt;
    e.z += (e.vz + e.kz) * dt;
    const k = Math.exp(-7 * dt);
    e.kx *= k;
    e.kz *= k;
    if (e.kx * e.kx + e.kz * e.kz < 0.0004) e.kx = e.kz = 0;
  }

  /** Probe ahead; rotate heading around obstacles. Writes e.dirx/e.dirz. */
  private steer(e: Enemy, dx: number, dz: number): void {
    const l = Math.hypot(dx, dz);
    if (l < 1e-5) {
      e.dirx = e.dirz = 0;
      return;
    }
    dx /= l;
    dz /= l;
    if (e.air) {
      e.dirx = dx;
      e.dirz = dz;
      return;
    }
    const look = 1.4 + e.radius * 2;
    const r = e.radius * 0.9;
    const og = this.obstacles;
    if (!og.blocked(e.x + dx * look, e.z + dz * look, r, e.y, e.height) && !og.blocked(e.x + dx * look * 0.5, e.z + dz * look * 0.5, r, e.y, e.height)) {
      e.dirx = dx;
      e.dirz = dz;
      return;
    }
    const angles = [0.55, 1.1, 1.7, 2.4];
    for (let i = 0; i < angles.length; i++) {
      for (let s = 0; s < 2; s++) {
        const sg = (s === 0 ? e.side : -e.side) * angles[i]!;
        const c = Math.cos(sg);
        const sn = Math.sin(sg);
        const nx = dx * c - dz * sn;
        const nz = dx * sn + dz * c;
        if (!og.blocked(e.x + nx * look, e.z + nz * look, r, e.y, e.height)) {
          e.dirx = nx;
          e.dirz = nz;
          if (s === 1) e.side = -e.side;
          return;
        }
      }
    }
    e.dirx = dx;
    e.dirz = dz;
    e.side = -e.side;
  }

  /** Chooses the movement target (path waypoint, ramp, or player) into this.tx/tz. */
  private pickTarget(e: Enemy, pl: PlayerTarget): void {
    const p = pl.pos;
    if (e.path) {
      while (e.pathI < e.path.length) {
        const w = e.path[e.pathI]!;
        const dx = w.x - e.x;
        const dz = w.z - e.z;
        if (dx * dx + dz * dz < 9) e.pathI++;
        else break;
      }
      if (e.pathI >= e.path.length) e.path = null;
      else {
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        if (!pl.alive || dx * dx + dz * dz > 100) {
          const w = e.path[e.pathI]!;
          this.tx = w.x;
          this.tz = w.z;
          return;
        }
        e.path = null; // close to the player: pursue directly
      }
    }
    if (!e.air && pl.alive && Math.abs(p.y - e.y) > 1.8 && this.ramps.length) {
      if (this.rampTarget(e, p.y)) return;
    } else {
      e.via = null;
    }
    this.tx = p.x;
    this.tz = p.z;
  }

  private rampTarget(e: Enemy, py: number): boolean {
    if (!e.via) {
      let best = Infinity;
      let pick: Ramp | null = null;
      const up = py > e.y;
      for (const r of this.ramps) {
        const fromY = up ? r.lowY : r.highY;
        const toY = up ? r.highY : r.lowY;
        if (Math.abs(fromY - e.y) > 1.6) continue;
        if (Math.abs(toY - py) > 2.4) continue;
        const fx = up ? r.lowX : r.highX;
        const fz = up ? r.lowZ : r.highZ;
        const d = Math.hypot(fx - e.x, fz - e.z) + Math.abs(toY - py) * 3;
        if (d < best) {
          best = d;
          pick = r;
        }
      }
      if (!pick) return false;
      e.via = pick;
      e.viaStage = 0;
    }
    const r = e.via;
    const up = py > e.y || e.viaStage === 1;
    const sx = e.viaStage === 0 ? (up ? r.lowX : r.highX) : up ? r.highX : r.lowX;
    const sz = e.viaStage === 0 ? (up ? r.lowZ : r.highZ) : up ? r.highZ : r.lowZ;
    if (e.viaStage === 0 && (sx - e.x) ** 2 + (sz - e.z) ** 2 < 4) e.viaStage = 1;
    if (e.viaStage === 1) {
      const goingUp = r.highY > e.y - 0.2 && py > r.lowY + 1;
      const ex = goingUp ? r.highX : r.lowX;
      const ez = goingUp ? r.highZ : r.lowZ;
      this.tx = ex;
      this.tz = ez;
      if ((ex - e.x) ** 2 + (ez - e.z) ** 2 < 2.5) e.via = null;
      return true;
    }
    this.tx = sx;
    this.tz = sz;
    return true;
  }

  private updateEnemy(e: Enemy, dt: number, pl: PlayerTarget): void {
    e.stateT += dt;
    switch (e.kind) {
      case 'walker':
        this.updateWalker(e, dt, pl);
        break;
      case 'hound':
        this.updateHound(e, dt, pl);
        break;
      case 'drone':
        this.updateDrone(e, dt, pl);
        break;
      case 'loader':
        this.updateLoader(e, dt, pl);
        break;
    }
  }

  /** Common ground pursuit: decide on a stagger, move along e.dirx/e.dirz. */
  private pursue(e: Enemy, dt: number, pl: PlayerTarget, speed: number, near: number): void {
    const dxp = pl.pos.x - e.x;
    const dzp = pl.pos.z - e.z;
    const d2 = dxp * dxp + dzp * dzp;
    if (this.time >= e.decideT || d2 < near * near) {
      e.decideT = this.time + 0.14 + (e.id % 4) * 0.01;
      this.pickTarget(e, pl);
      this.steer(e, this.tx - e.x, this.tz - e.z);
    }
    this.move(e, e.dirx, e.dirz, speed, dt, 9);
    this.faceToward(e, e.dirx, e.dirz, 9, dt);
  }

  // ---- Walker -------------------------------------------------------------

  private updateWalker(e: Enemy, dt: number, pl: PlayerTarget): void {
    const P = WALKER;
    const dx = pl.pos.x - e.x;
    const dz = pl.pos.z - e.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const dy = Math.abs(pl.pos.y - e.y);
    switch (e.state) {
      case 'spawning':
        this.move(e, 0, 0, 0, dt, 10);
        if (e.stateT >= e.stateDur) this.setState(e, 'advance', 0);
        break;
      case 'advance':
      case 'flank':
        if (e.state === 'flank') e.state = 'advance';
        if (pl.alive && d < P.attackRange && dy < 2.2 && this.time >= e.cd) {
          this.setState(e, 'windup', P.windup);
          this.tell(e, 'swing', P.windup);
          break;
        }
        this.pursue(e, dt, pl, e.charge ? P.chargeSpeed : P.walkSpeed, 4);
        break;
      case 'windup':
        this.move(e, 0, 0, 0, dt, 14);
        this.faceToward(e, dx, dz, 4, dt);
        if (e.stateT >= e.stateDur) {
          this.setState(e, 'attack', P.swing);
          this.release(e, 'swing');
          if (pl.alive && d <= P.reach && dy < 2.4) {
            const fx = -Math.sin(e.yaw);
            const fz = -Math.cos(e.yaw);
            const dot = d > 1e-4 ? (dx * fx + dz * fz) / d : 1;
            if (dot > 0.2) pl.hurt(P.damage, { x: e.x, y: e.y + 1, z: e.z });
          }
        }
        break;
      case 'attack':
        this.move(e, 0, 0, 0, dt, 14);
        if (e.stateT >= e.stateDur) {
          this.setState(e, 'recover', P.recover);
          e.attack = null;
        }
        break;
      case 'recover':
        this.move(e, 0, 0, 0, dt, 10);
        if (e.stateT >= e.stateDur) {
          this.setState(e, 'advance', 0);
          e.cd = this.time + 0.2;
        }
        break;
      case 'stagger':
        this.move(e, 0, 0, 0, dt, 12);
        if (e.stateT >= e.stateDur) this.setState(e, 'advance', 0);
        break;
      default:
        break;
    }
  }

  // ---- Hound --------------------------------------------------------------

  private updateHound(e: Enemy, dt: number, pl: PlayerTarget): void {
    const P = HOUND;
    const dx = pl.pos.x - e.x;
    const dz = pl.pos.z - e.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const dy = Math.abs(pl.pos.y - e.y);
    switch (e.state) {
      case 'spawning':
        this.move(e, 0, 0, 0, dt, 10);
        if (e.stateT >= e.stateDur) this.setState(e, 'advance', 0);
        break;
      case 'advance':
        if (pl.alive && !e.path && d < P.flankRange && dy < 3 && this.time >= e.cd) {
          this.setState(e, 'flank', 0);
          e.flankT = this.rng.range(P.flankTime[0], P.flankTime[1]);
          e.flankCycles = 0;
          break;
        }
        this.pursue(e, dt, pl, P.runSpeed, 5);
        break;
      case 'flank': {
        if (!pl.alive) {
          this.setState(e, 'advance', 0);
          break;
        }
        // Circle the player at flankR, drifting inward each cycle.
        const r = Math.max(5.5, e.flankR - e.flankCycles * 2.5);
        const rx = -dx / (d || 1);
        const rz = -dz / (d || 1);
        const tx = -rz * e.side;
        const tz = rx * e.side;
        const radial = (d - r) * 0.5;
        let hx = tx * 1.0 - rx * radial;
        let hz = tz * 1.0 - rz * radial;
        const hl = Math.hypot(hx, hz) || 1;
        hx /= hl;
        hz /= hl;
        if (this.time >= e.decideT) {
          e.decideT = this.time + 0.12;
          this.steer(e, hx, hz);
        }
        this.move(e, e.dirx, e.dirz, P.runSpeed * 0.95, dt, 11);
        this.faceToward(e, dx, dz, 10, dt);
        if (e.stateT >= e.flankT) {
          e.flankCycles++;
          if (d <= 9 && dy < 2.5) {
            this.setState(e, 'windup', P.windup);
            this.tell(e, 'lunge', P.windup);
          } else {
            // lane change: switch side, restart a shorter circle
            e.side = -e.side;
            e.stateT = 0;
            e.flankT = this.rng.range(P.flankTime[0], P.flankTime[1]) * 0.8;
          }
        }
        break;
      }
      case 'windup':
        this.move(e, 0, 0, 0, dt, 16);
        this.faceToward(e, dx, dz, 14, dt);
        if (e.stateT >= e.stateDur) {
          const l = d || 1;
          e.ax = dx / l;
          e.az = dz / l;
          e.hitDone = false;
          this.setState(e, 'attack', P.lungeTime);
          this.release(e, 'lunge');
        }
        break;
      case 'attack': {
        e.vx = e.ax * P.lungeSpeed;
        e.vz = e.az * P.lungeSpeed;
        e.x += e.vx * dt;
        e.z += e.vz * dt;
        e.yaw = Math.atan2(-e.ax, -e.az);
        if (!e.hitDone && pl.alive && d < P.lungeReach && dy < 1.9) {
          e.hitDone = true;
          pl.hurt(P.damage, { x: e.x, y: e.y + 0.5, z: e.z });
        }
        if (e.stateT >= e.stateDur) {
          this.setState(e, 'recover', P.recover);
          e.attack = null;
        }
        break;
      }
      case 'recover':
        this.move(e, 0, 0, 0, dt, 6);
        if (e.stateT >= e.stateDur) {
          this.setState(e, 'advance', 0);
          e.cd = this.time + this.rng.range(0.3, 1.0);
          e.side = this.rng.chance(0.5) ? 1 : -1;
          e.flankR = this.rng.range(P.flankRadius[0], P.flankRadius[1]);
        }
        break;
      case 'stagger':
        this.move(e, 0, 0, 0, dt, 12);
        if (e.stateT >= e.stateDur) this.setState(e, 'advance', 0);
        break;
      default:
        break;
    }
  }

  // ---- Drone --------------------------------------------------------------

  private updateDrone(e: Enemy, dt: number, pl: PlayerTarget): void {
    const P = DRONE;
    const dx = pl.pos.x - e.x;
    const dz = pl.pos.z - e.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 0.001;
    switch (e.state) {
      case 'spawning':
        this.move(e, 0, 0, 0, dt, 10);
        if (e.stateT >= e.stateDur) this.setState(e, 'advance', 0);
        return;
      case 'windup':
        this.move(e, 0, 0, 0, dt, 5);
        this.faceToward(e, dx, dz, 6, dt);
        if (e.stateT >= e.stateDur) {
          if (e.attack === 'fireball') this.launchFireball(e, pl);
          else {
            e.hitDone = false;
            e.ayaw = Math.atan2(-dx, -dz);
            this.release(e, 'flame');
            this.setState(e, 'attack', P.flame.duration);
            return;
          }
          this.release(e, 'fireball');
          this.setState(e, 'recover', P.recover);
          e.attack = null;
        }
        return;
      case 'attack': {
        // Flame sweep: beam angle sweeps across the arc; one hit when it crosses the player.
        this.move(e, 0, 0, 0, dt, 5);
        const f = Math.min(1, e.stateT / e.stateDur);
        const half = (P.flame.arcDeg * Math.PI) / 360;
        const beam = e.ayaw + (-half + 2 * half * f);
        e.yaw = beam;
        if (!e.hitDone && pl.alive) {
          const bearing = Math.atan2(-dx, -dz);
          const dist3 = Math.hypot(dx, dz, pl.pos.y + 1 - (e.y + 0.5));
          if (dist3 <= P.flame.range && Math.abs(wrap(bearing - beam)) <= (P.flame.hitHalfArcDeg * Math.PI) / 180) {
            e.hitDone = true;
            pl.hurt(P.flame.damage, { x: e.x, y: e.y + 0.5, z: e.z });
          }
        }
        if (e.stateT >= e.stateDur) {
          this.setState(e, 'recover', P.recover);
          e.attack = null;
        }
        return;
      }
      case 'stagger':
        this.move(e, 0, 0, 0, dt, 8);
        if (e.stateT >= e.stateDur) this.setState(e, 'advance', 0);
        return;
      default:
        break;
    }
    // advance / recover / flank: reposition.
    let hx = 0;
    let hz = 0;
    let speed = P.speed;
    if (e.path && pl.alive && d > 20) {
      this.pickTarget(e, pl);
      const w = e.path ? e.path[e.pathI]! : null;
      if (w) {
        hx = w.x - e.x;
        hz = w.z - e.z;
        const l = Math.hypot(hx, hz) || 1;
        hx /= l;
        hz /= l;
      } else {
        hx = dx / d;
        hz = dz / d;
      }
      speed = P.speed * 1.3;
    } else {
      e.path = null;
      const ux = dx / d;
      const uz = dz / d;
      const mid = (P.keepMin + P.keepMax) * 0.5;
      const radial = d > P.keepMax ? 1 : d < P.keepMin ? -1.3 : (d - mid) * 0.15;
      const tang = e.state === 'recover' ? 0.9 : 0.5;
      hx = ux * radial + -uz * e.side * tang;
      hz = uz * radial + ux * e.side * tang;
      const l = Math.hypot(hx, hz) || 1;
      hx /= l;
      hz /= l;
      if (this.time >= e.decideT) {
        e.decideT = this.time + 0.6 + (e.id % 5) * 0.05;
        if (this.rng.chance(0.25)) e.side = -e.side;
      }
      if (e.state === 'recover') {
        speed = P.speed * 1.15;
        if (e.stateT >= e.stateDur) {
          this.setState(e, 'advance', 0);
          e.attackAt = this.time + this.rng.range(P.cooldown[0], P.cooldown[1]);
        }
      } else {
        if (e.state === 'flank') e.state = 'advance';
        // LOS check, staggered.
        if (this.time >= e.losT) {
          e.losT = this.time + 0.3 + (e.id % 3) * 0.05;
          e.los = this.phys.lineOfSight({ x: e.x, y: e.y + 0.5, z: e.z }, { x: pl.pos.x, y: pl.pos.y + 1.2, z: pl.pos.z });
        }
        if (pl.alive && this.time >= e.attackAt && d <= P.keepMax + 2 && e.los) {
          const flame = d <= P.flame.range - 0.5 && this.rng.chance(0.4);
          const atk = flame ? 'flame' : 'fireball';
          const wind = flame ? P.flame.windup : P.fireball.windup;
          this.setState(e, 'windup', wind);
          this.tell(e, atk, wind);
        }
      }
    }
    // Keep inside the arena envelope.
    if (e.arena) {
      const b = e.arena.bounds;
      if (e.x < b.min.x + 1 && hx < 0) hx = 0;
      if (e.x > b.max.x - 1 && hx > 0) hx = 0;
      if (e.z < b.min.z + 1 && hz < 0) hz = 0;
      if (e.z > b.max.z - 1 && hz > 0) hz = 0;
    }
    this.move(e, hx, hz, speed, dt, 4);
    this.faceToward(e, dx, dz, 5, dt);
  }

  private launchFireball(e: Enemy, pl: PlayerTarget): void {
    const F = DRONE.fireball;
    const ox = e.x;
    const oy = e.y + 0.4;
    const oz = e.z;
    let tx = pl.pos.x;
    let ty = pl.pos.y + 1.0;
    let tz = pl.pos.z;
    for (let i = 0; i < 2; i++) {
      const t = Math.hypot(tx - ox, ty - oy, tz - oz) / F.speed;
      tx = pl.pos.x + pl.vel.x * t * F.lead;
      ty = pl.pos.y + 1.0 + Math.max(0, pl.vel.y) * t * 0.3;
      tz = pl.pos.z + pl.vel.z * t * F.lead;
    }
    const dx = tx - ox;
    const dy = ty - oy;
    const dz = tz - oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.projs.push({
      id: this.nextProj++,
      x: ox, y: oy, z: oz,
      vx: (dx / l) * F.speed, vy: (dy / l) * F.speed, vz: (dz / l) * F.speed,
      life: F.life, damage: F.damage, radius: F.radius,
    });
  }

  // ---- Loader -------------------------------------------------------------

  private updateLoader(e: Enemy, dt: number, pl: PlayerTarget): void {
    const P = LOADER;
    const dx = pl.pos.x - e.x;
    const dz = pl.pos.z - e.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 0.001;
    const frac = e.hp / e.maxHp;
    switch (e.state) {
      case 'spawning':
        this.move(e, 0, 0, 0, dt, 10);
        if (e.stateT >= e.stateDur) {
          this.setState(e, 'advance', 0);
          e.cd = this.time + 1.0;
          this.emit({ type: 'boss_phase', phase: 1 });
        }
        break;
      case 'advance': {
        e.exposed = false;
        if (pl.alive && this.time >= e.cd) {
          if (e.callsDone < P.call.thresholds.length && frac <= P.call.thresholds[e.callsDone]!) {
            this.setState(e, 'windup', P.call.windup);
            this.tell(e, 'call', P.call.windup);
            this.calls.push({ loader: e.id, phase: e.callsDone });
            this.emit({ type: 'boss_phase', phase: e.callsDone + 2 });
            e.callsDone++;
            break;
          }
          if (d <= P.slam.range && Math.abs(pl.pos.y - e.y) < 3) {
            // Prefer the attack not used last; slam when the player is beyond sweep reach.
            let atk: LoaderAttack = d > P.sweep.range - 1 ? 'slam' : e.lastAtk === 'sweep' ? 'slam' : 'sweep';
            if (d > P.sweep.range - 1) atk = 'slam';
            e.lastAtk = atk;
            const dur = atk === 'sweep' ? P.sweep.windup : P.slam.windup;
            this.setState(e, 'windup', dur);
            this.tell(e, atk, dur);
            e.ayaw = Math.atan2(-dx, -dz);
            e.clawYaw = e.ayaw;
            break;
          }
        }
        this.pursue(e, dt, pl, P.walkSpeed, 6);
        break;
      }
      case 'windup': {
        this.move(e, 0, 0, 0, dt, 8);
        if (e.attack === 'call') {
          if (e.stateT >= e.stateDur) {
            this.release(e, 'call');
            this.setState(e, 'recover', P.call.recover);
          }
          break;
        }
        const lockAt = e.stateDur * 0.65;
        if (e.stateT < lockAt) {
          this.faceToward(e, dx, dz, 3, dt);
          e.ayaw = Math.atan2(-dx, -dz);
          e.ax = pl.pos.x;
          e.az = pl.pos.z;
        }
        e.clawYaw = e.yaw;
        if (e.stateT >= e.stateDur) {
          e.hitDone = false;
          if (e.attack === 'sweep') {
            e.ayaw = e.yaw;
            this.setState(e, 'attack', P.sweep.duration);
            this.release(e, 'sweep');
          } else {
            // Slam: ground impact at the player's locked position, limited to slam range.
            let ix = e.ax;
            let iz = e.az;
            const ld = Math.hypot(ix - e.x, iz - e.z);
            const maxR = P.slam.range;
            if (ld > maxR) {
              ix = e.x + ((ix - e.x) / ld) * maxR;
              iz = e.z + ((iz - e.z) / ld) * maxR;
            }
            e.ax = ix;
            e.az = iz;
            this.setState(e, 'attack', P.slam.duration);
            this.release(e, 'slam', { x: ix, y: e.y, z: iz });
            if (pl.alive) {
              const pd = Math.hypot(pl.pos.x - ix, pl.pos.z - iz);
              if (pd <= P.slam.radius && Math.abs(pl.pos.y - e.y) < 2.5) {
                const falloff = 1 - 0.4 * (pd / P.slam.radius);
                pl.hurt(P.slam.damage * falloff, { x: ix, y: e.y, z: iz });
                e.hitDone = true;
              }
            }
          }
        }
        break;
      }
      case 'attack': {
        this.move(e, 0, 0, 0, dt, 10);
        if (e.attack === 'sweep') {
          const f = Math.min(1, e.stateT / e.stateDur);
          const half = (P.sweep.arcDeg * Math.PI) / 360;
          const claw = e.ayaw + (half - 2 * half * f);
          e.clawYaw = claw;
          if (!e.hitDone && pl.alive) {
            const bearing = Math.atan2(-dx, -dz);
            if (d <= P.sweep.range + 0.4 && Math.abs(wrap(bearing - claw)) <= (P.sweep.hitHalfArcDeg * Math.PI) / 180 && Math.abs(pl.pos.y - e.y) < 2.6) {
              e.hitDone = true;
              pl.hurt(P.sweep.damage, { x: e.x, y: e.y + 1.5, z: e.z });
            }
          }
          if (e.stateT >= e.stateDur) {
            this.setState(e, 'recover', P.sweep.recover);
            e.exposed = true;
            e.armorBroken = false;
          }
        } else if (e.stateT >= e.stateDur) {
          this.setState(e, 'recover', P.slam.recover);
          e.exposed = true;
          e.armorBroken = false;
        }
        break;
      }
      case 'recover':
        this.move(e, 0, 0, 0, dt, 6);
        if (e.stateT >= e.stateDur) {
          this.setState(e, 'advance', 0);
          e.exposed = false;
          e.attack = null;
          e.cd = this.time + P.attackDelay;
        }
        break;
      default:
        break;
    }
    if (e.state !== 'recover' && e.state !== 'advance' && e.attack === null) e.exposed = false;
  }

  // ---- Separation + final movement ---------------------------------------

  private separate(): void {
    const gW = this.gW;
    for (let i = 0; i < this.active.length; i++) {
      const e = this.active[i]!;
      if (e.dead || e.state === 'attack' && e.kind === 'hound') continue;
      const cx = Math.floor((e.x - this.gOx) / GRID_CELL);
      const cz = Math.floor((e.z - this.gOz) / GRID_CELL);
      for (let oz = -1; oz <= 1; oz++) {
        const zz = cz + oz;
        if (zz < 0 || zz >= this.gH) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = cx + ox;
          if (xx < 0 || xx >= gW) continue;
          let j = this.gHead[zz * gW + xx]!;
          while (j >= 0) {
            if (j > e.slot) {
              const o = this.pool[j]!;
              if (o.air === e.air && !(o.state === 'attack' && o.kind === 'hound')) {
                const dx = o.x - e.x;
                const dz = o.z - e.z;
                const min = (e.radius + o.radius) * 0.95;
                const d2 = dx * dx + dz * dz;
                if (d2 < min * min && Math.abs(o.y - e.y) < 2.5) {
                  const d = Math.sqrt(d2);
                  let nx: number;
                  let nz: number;
                  if (d < 1e-4) {
                    nx = ((e.id * 7) % 5) - 2 + 0.1;
                    nz = ((e.id * 3) % 5) - 2 + 0.2;
                    const l = Math.hypot(nx, nz);
                    nx /= l;
                    nz /= l;
                  } else {
                    nx = dx / d;
                    nz = dz / d;
                  }
                  const overlap = (min - d) * 0.5;
                  const me = e.heavy ? 6 : 1;
                  const mo = o.heavy ? 6 : 1;
                  const se = (overlap * 2 * mo) / (me + mo);
                  const so = (overlap * 2 * me) / (me + mo);
                  e.x -= nx * se;
                  e.z -= nz * se;
                  o.x += nx * so;
                  o.z += nz * so;
                }
              }
            }
            j = this.gNext[j]!;
          }
        }
      }
    }
  }

  private finishMove(e: Enemy, dt: number, pl: PlayerTarget): void {
    if (!e.air) this.obstacles.resolve(e.x, e.z, e.radius, e.y, e.height) && this.applyResolved(e);
    // Ground height (staggered).
    if (this.frame >= e.gNext) {
      e.gNext = this.frame + 5 + (e.id % 3);
      const g = this.phys.groundHeight(e.x, e.z, e.y + (e.air ? 0 : 0.2));
      if (g !== null) e.gy = g;
      else e.gy = Number.NEGATIVE_INFINITY;
    }
    if (e.air) {
      const bob = Math.sin(this.time * 1.7 + e.phase) * 0.35;
      const base = Number.isFinite(e.gy) ? e.gy : e.y - e.hover;
      const target = base + e.hover + bob;
      const dyv = target - e.y;
      const step = 3.5 * dt;
      e.y += dyv > step ? step : dyv < -step ? -step : dyv;
    } else if (Number.isFinite(e.gy)) {
      const dyv = e.gy - e.y;
      const up = 12 * dt;
      const down = 25 * dt;
      e.y += dyv > up ? up : dyv < -down ? -down : dyv;
    } else {
      e.y -= 15 * dt; // over the void
    }
    // Recovery checks (staggered, 2 Hz).
    if (this.time >= e.checkT) {
      e.checkT = this.time + 0.5;
      this.recoveryCheck(e, pl);
    }
  }

  private applyResolved(e: Enemy): void {
    e.x = this.obstacles.outX;
    e.z = this.obstacles.outZ;
  }

  private recoveryCheck(e: Enemy, pl: PlayerTarget): void {
    if (e.y < this.level.killY || !Number.isFinite(e.x + e.y + e.z)) {
      this.teleport(e, pl);
      return;
    }
    const a = e.arena;
    if (a) {
      const b = a.bounds;
      const out = e.x < b.min.x - 1 || e.x > b.max.x + 1 || e.z < b.min.z - 1 || e.z > b.max.z + 1;
      if (out) {
        e.outsideT += 0.5;
        if (e.outsideT > OUT_OF_BOUNDS_TIME) {
          this.teleport(e, pl);
          return;
        }
      } else e.outsideT = 0;
    }
    // Stuck: trying to move but not getting anywhere.
    const moving = e.state === 'advance' || e.state === 'flank';
    if (moving && !e.air) {
      const mx = e.x - e.sx;
      const mz = e.z - e.sz;
      e.sx = e.x;
      e.sz = e.z;
      const dpx = pl.pos.x - e.x;
      const dpz = pl.pos.z - e.z;
      const dp = Math.hypot(dpx, dpz);
      if (mx * mx + mz * mz < 0.04 * 0.25 && dp > 4) {
        e.stuckT += 0.5;
        if (e.stuckT >= 2 && e.stuckT < 2.6) {
          e.side = -e.side;
          e.kx += (this.rng.next() - 0.5) * 6;
          e.kz += (this.rng.next() - 0.5) * 6;
        }
        if (e.stuckT >= 10 && dp > 14) this.teleport(e, pl);
      } else e.stuckT = 0;
    } else {
      e.sx = e.x;
      e.sz = e.z;
    }
  }

  /** Moves a stuck / lost enemy to a lane spawn that is at least 12 m from the player. */
  private teleport(e: Enemy, pl: PlayerTarget): void {
    const arena = e.arena ?? this.arenaAt(e.x, e.z) ?? this.level.arenas[0]!;
    const lanes = arena.lanes.filter((l) => !!l.air === e.air);
    const pool = e.lane && !!e.lane.air === e.air ? [e.lane, ...lanes.filter((l) => l !== e.lane)] : lanes;
    let pick: Vec3 | null = null;
    let pickLane: LaneDef | null = null;
    let far = -1;
    let farPos: Vec3 | null = null;
    let farLane: LaneDef | null = null;
    for (const l of pool) {
      for (const s of l.spawns) {
        const d = Math.hypot(s.x - pl.pos.x, s.z - pl.pos.z);
        if (d > far) {
          far = d;
          farPos = s;
          farLane = l;
        }
        if (!pick && d >= 12) {
          pick = s;
          pickLane = l;
        }
      }
      if (pick) break;
    }
    const to = pick ?? farPos;
    const lane = pick ? pickLane : farLane;
    if (!to) return;
    e.x = e.px = to.x;
    e.y = e.py = to.y;
    e.z = e.pz = to.z;
    e.gy = to.y;
    e.vx = e.vz = e.kx = e.kz = 0;
    e.outsideT = 0;
    e.stuckT = 0;
    e.sx = to.x;
    e.sz = to.z;
    e.via = null;
    if (lane) {
      e.lane = lane;
      e.laneId = lane.id;
      e.path = lane.path;
      e.pathI = 0;
    }
    e.state = 'advance';
    e.stateT = 0;
    e.attack = null;
  }

  // ---- Projectiles --------------------------------------------------------

  private stepProjectiles(dt: number, pl: PlayerTarget): void {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i]!;
      p.life -= dt;
      const mx = p.vx * dt;
      const my = p.vy * dt;
      const mz = p.vz * dt;
      const len = Math.hypot(mx, my, mz);
      let dead = p.life <= 0;
      if (!dead && len > 1e-6) {
        this.pDir.x = mx / len;
        this.pDir.y = my / len;
        this.pDir.z = mz / len;
        const hit = this.phys.raycast({ x: p.x, y: p.y, z: p.z }, this.pDir, len + p.radius * 0.3);
        if (hit) dead = true;
      }
      if (!dead && pl.alive) {
        // closest point on segment p -> p+m to player's aim point
        const cx = pl.pos.x;
        const cy = pl.pos.y + 1.0;
        const cz = pl.pos.z;
        const l2 = mx * mx + my * my + mz * mz;
        let t = l2 > 1e-9 ? ((cx - p.x) * mx + (cy - p.y) * my + (cz - p.z) * mz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = p.x + mx * t - cx;
        const qy = p.y + my * t - cy;
        const qz = p.z + mz * t - cz;
        if (qx * qx + qy * qy + qz * qz <= (p.radius + 0.4) * (p.radius + 0.4)) {
          pl.hurt(p.damage, { x: p.x, y: p.y, z: p.z });
          dead = true;
        }
      }
      if (dead) {
        this.projs[i] = this.projs[this.projs.length - 1]!;
        this.projs.pop();
      } else {
        p.x += mx;
        p.y += my;
        p.z += mz;
      }
    }
  }
}
