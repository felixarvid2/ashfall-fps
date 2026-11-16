import type { GameEvent, PlayerStats, Vec3 } from './types';
import { SIM_DT } from './types';
import { clamp } from '../game/math';

/** Movement tuning (meters, seconds). */
export const MOVE = {
  /** Ground acceleration in 1/s (Quake style: accel * wishspeed * dt per tick). */
  groundAccel: 11,
  friction: 9,
  stopSpeed: 3,
  airAccel: 14,
  /** Wish speed cap while airborne: limits how hard the player can bend a jump. */
  airWishCap: 2.6,
  /** Horizontal speed ceiling in the air, as a multiple of moveSpeed. */
  airSpeedCap: 1.12,
  gravity: 24,
  jumpSpeed: 8,
  coyote: 0.1,
  jumpBuffer: 0.1,
  dashDistance: 7,
  dashTime: 0.18,
  /** Fraction of moveSpeed kept when the dash ends. */
  dashExit: 1.1,
  stepLength: 2.2,
  landEventMinSpeed: 3.5,
} as const;

export const PLAYER_START_HEALTH = 100;

/** Movement backend (Rapier character controller in the game; a stub in unit tests). */
export interface CharacterMover {
  moveCharacter(feet: Vec3, desired: Vec3, snap: boolean): { pos: Vec3; grounded: boolean; hitCeiling: boolean };
}

export interface PlayerInput {
  /** Strafe right = +1. */
  moveX: number;
  /** Forward = +1. */
  moveZ: number;
  /** Edge flags: true on the step after the press. */
  jump: boolean;
  dash: boolean;
  yaw: number;
  pitch: number;
}

export const NO_INPUT: PlayerInput = { moveX: 0, moveZ: 0, jump: false, dash: false, yaw: 0, pitch: 0 };

export interface CameraFeel {
  /** Vertical bob offset in meters (before the camera-bob setting). */
  bobY: number;
  bobX: number;
  /** Roll in radians from strafing. */
  roll: number;
  /** Landing dip in meters (negative = down). */
  landDip: number;
  /** Shake amplitude 0..1. */
  shake: number;
}

export class Player {
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  yaw: number;
  pitch = 0;
  grounded = false;
  alive = true;
  health: number;
  stats: PlayerStats;

  dashCooldownLeft = 0;
  dashTimeLeft = 0;
  private dashDir: Vec3 = { x: 0, y: 0, z: -1 };

  private coyote = 0;
  private jumpBuffer = 0;
  private stepDist = 0;
  private bobPhase = 0;
  private prevBobPhase = 0;
  private bobAmp = 0;
  private prevBobAmp = 0;
  private roll = 0;
  private prevRoll = 0;
  private landDip = 0;
  private prevLandDip = 0;
  shake = 0;
  /** Seconds since the last damage (HUD flash). */
  sinceHurt = 99;

  private lastSafe: Vec3;
  private safeTimer = 0;
  /** Simulation time spent grounded without moving; used by nothing but tests. */
  time = 0;

  constructor(
    private mover: CharacterMover,
    stats: PlayerStats,
    start: { pos: Vec3; yaw: number },
    private killY: number,
    private emit: (e: GameEvent) => void,
  ) {
    this.stats = { ...stats };
    this.pos = { ...start.pos };
    this.prevPos = { ...start.pos };
    this.lastSafe = { ...start.pos };
    this.yaw = start.yaw;
    this.health = stats.maxHealth;
  }

  get maxHealth(): number {
    return this.stats.maxHealth;
  }

  /** Cards changed the player stats; max health gains also heal by the difference. */
  setStats(next: PlayerStats): void {
    const diff = next.maxHealth - this.stats.maxHealth;
    this.stats = { ...next };
    if (diff > 0) this.health = Math.min(this.stats.maxHealth, this.health + diff);
    else this.health = Math.min(this.health, this.stats.maxHealth);
  }

  heal(amount: number): number {
    if (!this.alive) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  hurt(amount: number, from: Vec3 | null): void {
    if (!this.alive || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.sinceHurt = 0;
    this.shake = Math.min(1, this.shake + 0.25 + amount * 0.01);
    this.emit({ type: 'player_hurt', amount, from: from ? { ...from } : null });
    if (this.health <= 0) {
      this.alive = false;
      this.vel.x = this.vel.z = 0;
      this.emit({ type: 'player_die' });
    }
  }

  get dashReady(): number {
    const cd = Math.max(0.0001, this.stats.dashCooldown);
    return this.dashCooldownLeft <= 0 ? 1 : clamp(1 - this.dashCooldownLeft / cd, 0, 1);
  }

  get dashing(): boolean {
    return this.dashTimeLeft > 0;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Unit-ish player target view for enemies. */
  addShake(v: number): void {
    this.shake = Math.min(1, this.shake + v);
  }

  step(input: PlayerInput, dt: number = SIM_DT): void {
    this.time += dt;
    this.prevPos = { ...this.pos };
    this.prevBobPhase = this.bobPhase;
    this.prevBobAmp = this.bobAmp;
    this.prevRoll = this.roll;
    this.prevLandDip = this.landDip;
    this.yaw = input.yaw;
    this.pitch = input.pitch;
    this.sinceHurt += dt;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.landDip *= Math.exp(-dt * 10);
    if (Math.abs(this.landDip) < 1e-5) this.landDip = 0;

    if (!this.alive) {
      this.roll += (0 - this.roll) * Math.min(1, dt * 6);
      return;
    }

    this.dashCooldownLeft = Math.max(0, this.dashCooldownLeft - dt);
    this.jumpBuffer = input.jump ? MOVE.jumpBuffer : Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? MOVE.coyote : Math.max(0, this.coyote - dt);

    // Wish direction from yaw and input.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let mx = input.moveX;
    let mz = input.moveZ;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) {
      mx /= mlen;
      mz /= mlen;
    }
    const inputMag = Math.min(1, mlen);
    let wx = rx * mx + fx * mz;
    let wz = rz * mx + fz * mz;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-6) {
      wx /= wl;
      wz /= wl;
    }
    const wishSpeed = this.stats.moveSpeed * inputMag;

    // Dash.
    if (input.dash && this.dashCooldownLeft <= 0 && this.dashTimeLeft <= 0) {
      if (wl > 1e-6) this.dashDir = { x: wx, y: 0, z: wz };
      else this.dashDir = { x: fx, y: 0, z: fz };
      this.dashTimeLeft = MOVE.dashTime;
      this.dashCooldownLeft = this.stats.dashCooldown;
      this.emit({ type: 'player_dash', dir: { ...this.dashDir } });
    }

    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    let jumped = false;

    if (this.dashTimeLeft > 0) {
      const sp = MOVE.dashDistance / MOVE.dashTime;
      this.vel.x = this.dashDir.x * sp;
      this.vel.z = this.dashDir.z * sp;
      this.vel.y = 0;
      this.dashTimeLeft -= dt;
      if (this.dashTimeLeft <= 1e-9) {
        this.dashTimeLeft = 0;
        const exit = this.stats.moveSpeed * MOVE.dashExit;
        this.vel.x = this.dashDir.x * exit;
        this.vel.z = this.dashDir.z * exit;
      }
    } else {
      if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
        this.vel.y = MOVE.jumpSpeed;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        jumped = true;
        this.emit({ type: 'player_jump' });
      }
      if (this.grounded) {
        this.applyFriction(dt);
        this.accelerate(wx, wz, wishSpeed, MOVE.groundAccel, dt);
      } else {
        if (jumped) {
          // Quake: no friction on the tick of a jump; accelerate on the ground model.
          this.accelerate(wx, wz, wishSpeed, MOVE.groundAccel, dt);
        } else {
          this.accelerate(wx, wz, Math.min(wishSpeed, MOVE.airWishCap), MOVE.airAccel, dt);
        }
        const cap = this.stats.moveSpeed * MOVE.airSpeedCap;
        const hs = this.horizontalSpeed;
        if (hs > cap) {
          const k = cap / hs;
          this.vel.x *= k;
          this.vel.z *= k;
        }
      }
      this.vel.y -= MOVE.gravity * dt;
      if (this.vel.y < -40) this.vel.y = -40;
    }

    // Move through the world.
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    const res = this.mover.moveCharacter(this.pos, desired, this.vel.y <= 0);
    const dx = res.pos.x - this.pos.x;
    const dz = res.pos.z - this.pos.z;
    this.pos = res.pos;
    this.grounded = res.grounded && this.vel.y <= 0.001;

    // Walls: keep only the velocity that actually happened.
    const wantH = Math.hypot(desired.x, desired.z);
    const gotH = Math.hypot(dx, dz);
    if (wantH > 1e-6 && gotH < wantH * 0.98) {
      // Slopes shorten progress along the same direction; walls change it.
      const same = gotH > 1e-6 ? (desired.x * dx + desired.z * dz) / (wantH * gotH) : 0;
      if (same < 0.999) {
        this.vel.x = dx / dt;
        this.vel.z = dz / dt;
      }
    }
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;
    if (this.grounded) {
      if (!wasGrounded && !jumped && fallSpeed > MOVE.landEventMinSpeed) {
        this.landDip = -clamp(fallSpeed * 0.012, 0.02, 0.14);
        this.shake = Math.min(1, this.shake + clamp((fallSpeed - 6) * 0.03, 0, 0.35));
        this.emit({ type: 'player_land', speed: fallSpeed });
      }
      this.vel.y = 0;
    }

    // Footsteps and bob.
    const hs = this.horizontalSpeed;
    if (this.grounded && hs > 2 && this.dashTimeLeft <= 0) {
      this.stepDist += hs * dt;
      if (this.stepDist >= MOVE.stepLength) {
        this.stepDist -= MOVE.stepLength;
        this.emit({ type: 'player_step' });
      }
      this.bobPhase += hs * dt * 2.3;
    } else if (!this.grounded) {
      this.stepDist = MOVE.stepLength * 0.5;
    }
    const targetAmp = this.grounded ? clamp(hs / this.stats.moveSpeed, 0, 1.2) : 0;
    this.bobAmp += (targetAmp - this.bobAmp) * Math.min(1, dt * 10);
    // Strafe roll: velocity along the right axis.
    const side = this.vel.x * rx + this.vel.z * rz;
    const targetRoll = clamp(-side / this.stats.moveSpeed, -1, 1) * 0.022;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);

    // Safe point + out-of-world recovery.
    if (this.grounded) {
      this.safeTimer += dt;
      if (this.safeTimer >= 0.25) {
        this.safeTimer = 0;
        this.lastSafe = { ...this.pos };
      }
    }
    if (this.pos.y < this.killY) this.recoverToSafe();
  }

  private recoverToSafe(): void {
    this.pos = { ...this.lastSafe };
    this.prevPos = { ...this.lastSafe };
    this.vel = { x: 0, y: 0, z: 0 };
    this.dashTimeLeft = 0;
    this.grounded = false;
  }

  private applyFriction(dt: number): void {
    const sp = this.horizontalSpeed;
    if (sp < 1e-6) {
      this.vel.x = this.vel.z = 0;
      return;
    }
    const drop = Math.max(sp, MOVE.stopSpeed) * MOVE.friction * dt;
    const k = Math.max(0, sp - drop) / sp;
    this.vel.x *= k;
    this.vel.z *= k;
  }

  private accelerate(wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
    if (wishSpeed <= 1e-6) return;
    const current = this.vel.x * wx + this.vel.z * wz;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const a = Math.min(add, accel * wishSpeed * dt);
    this.vel.x += wx * a;
    this.vel.z += wz * a;
  }

  /** Eye position (alpha = interpolation between the last two sim steps). */
  eyePos(alpha: number): Vec3 {
    const a = clamp(alpha, 0, 1);
    return {
      x: this.prevPos.x + (this.pos.x - this.prevPos.x) * a,
      y: this.prevPos.y + (this.pos.y - this.prevPos.y) * a + 1.62,
      z: this.prevPos.z + (this.pos.z - this.prevPos.z) * a,
    };
  }

  feel(alpha: number): CameraFeel {
    const a = clamp(alpha, 0, 1);
    const ph = this.prevBobPhase + (this.bobPhase - this.prevBobPhase) * a;
    const amp = this.prevBobAmp + (this.bobAmp - this.prevBobAmp) * a;
    return {
      bobY: Math.abs(Math.sin(ph)) * 0.045 * amp - 0.02 * amp,
      bobX: Math.cos(ph) * 0.02 * amp,
      roll: this.prevRoll + (this.roll - this.prevRoll) * a,
      landDip: this.prevLandDip + (this.landDip - this.prevLandDip) * a,
      shake: this.shake,
    };
  }
}
