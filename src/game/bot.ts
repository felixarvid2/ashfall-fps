import type { InputSample } from '../input/input';
import type { DraftOffer, Vec3 } from '../sim/types';
import { getCard } from '../content/cards';
import { WEAPONS } from '../content/weapons';
import { forwardOf } from './math';
import type { Run } from './run';

/**
 * Dev/test autoplayer. Aims at the nearest visible enemy, strafes, follows a
 * hand-authored route through REFINERY, uses caches/rack/relay and extracts.
 * Used by tests/runAutoplay.test.ts and `window.__ashfall.bot` in the browser.
 */
export type PactPolicy = 'none' | 'coil' | 'arc';

interface Waypoint {
  x: number;
  z: number;
  /** Interaction at this waypoint. */
  act?: 'rack' | 'cache' | 'relay';
  /** Arena whose clearing must complete before moving on (e.g. fight at a cache). */
  after?: string;
}

const ROUTE: Waypoint[] = [
  { x: 0, z: 108 },
  { x: -4, z: 101 },
  { x: -12, z: 98, act: 'rack' },
  { x: -6, z: 90 },
  { x: -10, z: 66 }, // enters the yard arena
  { x: -10, z: 50, after: 'yard' },
  { x: -8, z: 35 },
  { x: 11, z: 36, act: 'cache' },
  { x: 0, z: 33 },
  { x: 0, z: 20 },
  { x: 0, z: 6 },
  { x: 0, z: -10 }, // slag trigger
  { x: 0, z: -45, after: 'slag' },
  { x: 0, z: -83, act: 'cache' },
  { x: 0, z: -100 },
  { x: 0, z: -118 },
  { x: -8, z: -130 }, // approach trigger
  { x: -8, z: -150, after: 'approach' },
  { x: 0, z: -156, act: 'cache' },
  { x: 0, z: -168 },
  { x: 0, z: -180 }, // relay trigger
  { x: 0, z: -215, after: 'relay' },
  { x: 0, z: -224, act: 'relay' },
  { x: 3, z: -229 },
  { x: 3, z: -234 },
  { x: 0, z: -241 },
  { x: 0, z: -258 },
];

const dist2 = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);

export class Bot {
  private wp = 0;
  private stuckT = 0;
  private lastPos: Vec3 = { x: 0, y: 0, z: 0 };
  private unstick = 0;
  private unstickDir = 1;
  private strafeT = 0;
  private strafeDir = 1;
  private fireToggle = 0;
  private tick = 0;
  private swapCd = 0;
  private noLos = 0;
  private chase = { key: '', t: 0 };
  private ignored = new Set<string>();
  /** Free medkits / ammo crates standing in for a human's better play (dev + autoplay tests). */
  assistOn = false;
  private medkits = 12;
  private crates = 14;
  yaw = 0;
  pitch = 0;

  constructor(public policy: PactPolicy = 'none', startYaw = 0) {
    this.yaw = startYaw;
  }

  /** Align the route index with where the run starts (for skipTo). */
  syncTo(run: Run): void {
    let best = 0;
    let bd = Infinity;
    const p = run.player.pos;
    ROUTE.forEach((w, i) => {
      const d = dist2(p.x, p.z, w.x, w.z);
      // Prefer waypoints ahead (lower z) of the player.
      if (w.z <= p.z + 6 && d < bd) {
        bd = d;
        best = i;
      }
    });
    this.wp = best;
  }

  /** Choose a draft option index per policy. */
  pickDraft(offer: DraftOffer): { action: 'pick'; index: number } | { action: 'skip' } {
    const opts = offer.options;
    const cardOf = (i: number) => (opts[i]!.kind === 'card' ? getCard(opts[i]!.id) : undefined);
    const isPact = (i: number) => !!cardOf(i)?.pactWeapon;
    if (this.policy !== 'none') {
      const want = this.policy === 'coil' ? 'coil_carbine' : 'arc_scattergun';
      for (let i = 0; i < opts.length; i++) if (cardOf(i)?.pactWeapon === want) return { action: 'pick', index: i };
      // Pact upgrades next.
      for (let i = 0; i < opts.length; i++) if (cardOf(i)?.requiresPact) return { action: 'pick', index: i };
    } else {
      // No pact: take the first non-pact card; never pledge.
      for (let i = 0; i < opts.length; i++) if (opts[i]!.kind === 'card' && !isPact(i)) return { action: 'pick', index: i };
      return { action: 'skip' };
    }
    for (let i = 0; i < opts.length; i++) if (opts[i]!.kind === 'card') return { action: 'pick', index: i };
    return { action: 'pick', index: 0 };
  }

  private applyAssist(run: Run): void {
    const w = run.weapons;
    if (run.player.alive && run.player.health < 35 && this.medkits > 0) {
      this.medkits--;
      run.player.heal(70);
    }
    for (const id of ['coil_carbine', 'arc_scattergun'] as const) {
      if (w.owns(id) && !w.isLocked(id) && w.reserve(id) + w.magazine(id) < 12 && this.crates > 0) {
        this.crates--;
        w.refundReserve(id, id === 'coil_carbine' ? 90 : 16);
      }
    }
  }

  step(run: Run): Partial<InputSample> & { yaw: number; pitch: number } {
    this.tick++;
    if (this.assistOn) this.applyAssist(run);
    const p = run.player.pos;
    const eye = run.player.eyePos(1);
    const out: Partial<InputSample> & { yaw: number; pitch: number } = { yaw: this.yaw, pitch: this.pitch };

    // Find a target.
    let target: { x: number; y: number; z: number; d: number; los: boolean } | null = null;
    for (const e of run.enemies.renderStates(1)) {
      if (e.state === 'dead' || e.state === 'spawning') continue;
      const info = run.enemies.info(e.id);
      if (!info || !info.alive) continue;
      const c = info.center;
      const d = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z);
      const los = run.phys.lineOfSight(eye, c);
      const score = d + (los ? 0 : 1000);
      if (!target || score < target.d + (target.los ? 0 : 1000)) target = { x: c.x, y: c.y, z: c.z, d, los };
    }

    // Weapon selection with hysteresis (no swap flapping).
    const w = run.weapons;
    const has = (id: 'coil_carbine' | 'arc_scattergun') => w.owns(id) && !w.isLocked(id) && w.magazine(id) + w.reserve(id) > 0;
    const coil = has('coil_carbine');
    const arc = has('arc_scattergun');
    let desired: 'coil_carbine' | 'arc_scattergun' | 'service_emitter';
    if (arc && (!coil || (target !== null && target.d < (w.current === 'arc_scattergun' ? 18 : 13)))) desired = 'arc_scattergun';
    else if (coil) desired = 'coil_carbine';
    else desired = 'service_emitter';
    this.swapCd = Math.max(0, this.swapCd - 1 / 60);
    if (desired !== w.current && this.swapCd <= 0 && (target !== null || w.current === 'service_emitter')) {
      this.swapCd = 1.2;
      if (desired === 'service_emitter') out.backup = true;
      else if (w.mains[0] === desired) out.slot1 = true;
      else out.slot2 = true;
    }

    const st = run.director.status;
    const fighting = st.arena !== null && !st.cleared.includes(st.arena) && (st.live > 0 || st.queued > 0);

    // Mid-fight scavenging: grab nearby wanted drops when nothing is on top of us.
    const loot = fighting && (!target || target.d > 6) ? this.wantedPickup(run, 14, true) : null;
    if (loot) {
      this.steerTo(run, out, loot.x, loot.z, 1);
      if (target && target.los && target.d < 30) out.fireHeld = false;
      this.yaw = out.yaw;
      this.pitch = out.pitch;
      return out;
    }
    if (target && target.los) {
      this.noLos = 0;
      // Aim (turn-rate limited so the bot is not an aimbot).
      const dx = target.x - eye.x;
      const dz = target.z - eye.z;
      const dy = target.y - eye.y;
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      this.yaw += clampAbs(wrap(wantYaw - this.yaw), 0.4);
      this.pitch += clampAbs(wantPitch - this.pitch, 0.3);
      out.yaw = this.yaw;
      out.pitch = this.pitch;
      const aimed = Math.abs(wrap(wantYaw - this.yaw)) < 0.04 && Math.abs(wantPitch - this.pitch) < 0.04;
      const range = w.current === 'arc_scattergun' ? 15 : w.current === 'service_emitter' ? 25 : 55;
      const shooting = target.los && aimed && target.d < range;
      // Pulse the trigger so semi-auto weapons see fresh presses.
      this.fireToggle++;
      out.fireHeld = shooting;
      out.firePressed = shooting && this.fireToggle % 6 === 0;
      if (shooting && w.current !== 'service_emitter' && w.magazine() === 0) out.reload = true;
      // Movement: circle-strafe, keep distance.
      this.strafeT -= 1 / 60;
      if (this.strafeT <= 0) {
        this.strafeT = 0.8 + ((this.tick * 7) % 11) / 10;
        this.strafeDir = -this.strafeDir;
      }
      out.moveX = this.strafeDir;
      const pref = w.current === 'arc_scattergun' ? 5 : 14;
      out.moveZ = target.d < pref - 3 ? -1 : target.d > pref + 6 ? 1 : 0;
      if (run.player.dashReady >= 1 && target.d < 5) out.dash = true;
    } else {
      // Reload while idle.
      if (w.current !== 'service_emitter' && w.magazine() < w.capacityOf(w.current) * 0.6 && w.reserve() > 0) out.reload = true;
      if (!fighting) this.travel(run, out);
      else {
        // Hold at the arena's route waypoint while enemies are still arriving;
        // hunt the nearest enemy when nothing has been visible for a while.
        this.noLos += 1 / 60;
        const hold = ROUTE[Math.min(this.wp, ROUTE.length - 1)]!;
        if (this.noLos > 6 && target) this.steerTo(run, out, target.x, target.z, 0.9);
        else if (dist2(p.x, p.z, hold.x, hold.z) > 4) this.steerTo(run, out, hold.x, hold.z, 0.7);
        else {
          out.moveX = 0;
          out.moveZ = 0;
          this.pitch *= 0.9;
          out.pitch = this.pitch;
        }
      }
    }
    this.yaw = out.yaw;
    this.pitch = out.pitch;
    return out;
  }

  /** Nearest useful pickup within range (ammo when low, health when hurt), else null. */
  private wantedPickup(run: Run, maxD = 30, fight = false): { x: number; z: number; id: string } | null {
    const p = run.player.pos;
    const w = run.weapons;
    const coilUsable = w.owns('coil_carbine') && !w.isLocked('coil_carbine');
    const arcUsable = w.owns('arc_scattergun') && !w.isLocked('arc_scattergun');
    const lowCoil = coilUsable && w.reserve('coil_carbine') < WEAPONS.coil_carbine.reserveMax * (fight ? 0.4 : 0.7);
    const lowArc = arcUsable && w.reserve('arc_scattergun') < WEAPONS.arc_scattergun.reserveMax * (fight ? 0.4 : 0.7);
    const hurt = run.player.health < run.player.maxHealth * (fight ? 0.55 : 0.7);
    let best: { x: number; z: number; id: string } | null = null;
    let bd = maxD;
    for (const k of run.renderPickups()) {
      if (k.id === 0) continue;
      const want = (k.kind === 'ammo_coil' && lowCoil) || (k.kind === 'ammo_arc' && lowArc) || (k.kind === 'health' && hurt) || (k.kind === 'salvage' && !fight) || (k.kind === 'armor' && hurt);
      if (!want || this.ignored.has(`${k.id}`)) continue;
      const d = dist2(p.x, p.z, k.pos.x, k.pos.z);
      if (d < bd && Math.abs(k.pos.y - p.y) < 2 && run.phys.lineOfSight({ x: p.x, y: p.y + 1, z: p.z }, { x: k.pos.x, y: k.pos.y + 1, z: k.pos.z })) {
        bd = d;
        best = { x: k.pos.x, z: k.pos.z, id: `${k.id}` };
      }
    }
    return best;
  }

  private travel(run: Run, out: Partial<InputSample> & { yaw: number; pitch: number }): void {
    const p = run.player.pos;
    const pk = this.wantedPickup(run);
    if (pk) {
      if (this.chase.key === pk.id) this.chase.t += 1 / 60;
      else this.chase = { key: pk.id, t: 0 };
      if (this.chase.t > 7) this.ignored.add(pk.id);
      this.steerTo(run, out, pk.x, pk.z, 1);
      return;
    }
    const wpt = ROUTE[Math.min(this.wp, ROUTE.length - 1)]!;
    const d = dist2(p.x, p.z, wpt.x, wpt.z);
    this.pitch *= 0.9;
    out.pitch = this.pitch;
    const arrive = wpt.act ? 1.6 : 2.5;
    if (d < arrive) {
      let done = true;
      if (wpt.act === 'rack') {
        out.interactPressed = run.rackHasWeapon;
        done = !run.rackHasWeapon || this.tick % 3 === 0;
        if (run.rackHasWeapon) done = false;
      } else if (wpt.act === 'cache') {
        const c = run.caches.find((x) => x.available && !x.open && dist2(x.arena.cache.x, x.arena.cache.z, p.x, p.z) < 3.2);
        if (c) {
          out.interactPressed = true;
          done = false;
        } else {
          // Cache already used, or not yet available (arena not cleared).
          const near = run.caches.find((x) => dist2(x.arena.cache.x, x.arena.cache.z, p.x, p.z) < 5);
          done = !near || near.open;
        }
      } else if (wpt.act === 'relay') {
        if (run.relay.active && !run.relay.done) {
          out.interactHeld = true;
          out.moveX = out.moveZ = 0;
          done = false;
        } else done = run.relay.done;
      }
      if (wpt.after && !run.director.isCleared(wpt.after)) done = false;
      if (done) this.wp = Math.min(this.wp + 1, ROUTE.length - 1);
      if (!done) {
        out.moveX = out.moveX ?? 0;
        out.moveZ = out.moveZ ?? 0;
        return;
      }
    }
    // Do not leave a sector before its fight starts/finishes: wait if `after` arena unfinished at its waypoint.
    this.steerTo(run, out, wpt.x, wpt.z, 1);
  }

  private steerTo(run: Run, out: Partial<InputSample> & { yaw: number; pitch: number }, tx: number, tz: number, speed: number): void {
    const p = run.player.pos;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const wantYaw = Math.atan2(-dx, -dz);
    this.yaw += clampAbs(wrap(wantYaw - this.yaw), 0.25);
    out.yaw = this.yaw;
    // Stuck detection.
    const moved = dist2(p.x, p.z, this.lastPos.x, this.lastPos.z);
    this.lastPos = { ...p };
    if (moved < 0.02) this.stuckT += 1 / 60;
    else this.stuckT = Math.max(0, this.stuckT - 1 / 30);
    if (this.stuckT > 0.5 && this.unstick <= 0) {
      this.unstick = 0.9;
      this.unstickDir = this.unstickDir > 0 ? -1 : 1;
      this.stuckT = 0;
    }
    if (Math.abs(wrap(wantYaw - this.yaw)) > 0.6) {
      out.moveZ = 0.2;
      out.moveX = 0;
      return;
    }
    out.moveZ = speed;
    out.moveX = 0;
    if (this.unstick > 0) {
      this.unstick -= 1 / 60;
      out.moveX = this.unstickDir;
      out.moveZ = 0.3;
      if (this.tick % 20 === 0) out.jump = true;
    }
    void forwardOf;
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const clampAbs = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
