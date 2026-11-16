/**
 * Keyboard / mouse / pointer-lock input.
 *
 * - Mouse deltas change yaw/pitch immediately, per event (frame-rate independent).
 * - The simulation calls `sample()` once per fixed step; edge actions accumulate
 *   between samples so a quick press is never lost.
 * - While `enabled` is false (menus, drafts, pause) every held input is cleared
 *   and nothing is recorded. Re-enabling starts from a clean slate, so the click
 *   that confirmed a UI choice can never become a shot: firing needs a fresh press.
 */

export interface InputSample {
  /** -1..1, right positive. */
  moveX: number;
  /** -1..1, forward positive. */
  moveZ: number;
  fireHeld: boolean;
  /** Fresh press since the last sample. */
  firePressed: boolean;
  jump: boolean;
  dash: boolean;
  reload: boolean;
  slot1: boolean;
  slot2: boolean;
  backup: boolean;
  interactPressed: boolean;
  interactHeld: boolean;
  yaw: number;
  pitch: number;
}

export interface InputHooks {
  /** Pointer lock was lost (Esc, alt-tab, browser) while gameplay was enabled. */
  onLockLost?(): void;
  onLockGained?(): void;
  onLockError?(): void;
  /** Esc pressed while no pointer lock is held (the browser eats Esc during lock). */
  onEscape?(): void;
  onInspect?(): void;
  onToggleDebug?(): void;
  /** Window blur / tab hidden. */
  onBlur?(): void;
}

export const DEFAULT_BINDINGS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  dash: 'ShiftLeft',
  reload: 'KeyR',
  slot1: 'Digit1',
  slot2: 'Digit2',
  backup: 'KeyQ',
  interact: 'KeyE',
  inspect: 'Tab',
  pause: 'Escape',
  debug: 'F3',
} as const;

export type Bindings = { [K in keyof typeof DEFAULT_BINDINGS]: string };

const BASE_RADIANS_PER_PIXEL = 0.0022;
const PITCH_LIMIT = (89 * Math.PI) / 180;

export class Input {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  invertY = false;
  bindings: Bindings = { ...DEFAULT_BINDINGS };

  private enabled = false;
  private keys = new Set<string>();
  private mouseDown = false;
  private pressed = new Set<string>();
  private firePressed = false;
  private lookDX = 0;
  private lookDY = 0;
  private lockPending = false;
  /** Automation: report pointer lock as granted without the browser. */
  fakeLock = false;
  /** Automation: values merged into every sample (edge flags are consumed after one sample). */
  override: Partial<InputSample> | null = null;
  private disposed = false;

  constructor(private canvas: HTMLElement, private hooks: InputHooks = {}) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockErr);
  }

  setHooks(h: InputHooks): void {
    this.hooks = h;
  }

  configure(s: { mouseSensitivity: number; invertY: boolean }): void {
    this.sensitivity = s.mouseSensitivity;
    this.invertY = s.invertY;
  }

  setView(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  // -- pointer lock --------------------------------------------------------

  get locked(): boolean {
    return this.fakeLock || document.pointerLockElement === this.canvas;
  }

  /** Must be called from a user gesture handler. Resolves once the lock state is known. */
  requestLock(): Promise<boolean> {
    if (this.locked) return Promise.resolve(true);
    this.lockPending = true;
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean): void => {
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        this.lockPending = false;
        resolve(ok);
      };
      const onChange = (): void => done(this.locked);
      const onError = (): void => done(false);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      try {
        const r = (this.canvas as HTMLCanvasElement).requestPointerLock() as unknown;
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => done(false));
      } catch {
        done(false);
      }
      // Some browsers never fire either event (e.g. cooldown after Esc).
      setTimeout(() => this.lockPending && done(this.locked), 1500);
    });
  }

  exitLock(): void {
    if (!this.fakeLock && this.locked) {
      try {
        document.exitPointerLock();
      } catch {
        /* ignore */
      }
    }
  }

  // -- gameplay gating -----------------------------------------------------

  /** Gameplay on/off. Both transitions clear every held input and pending edge. */
  setEnabled(on: boolean): void {
    if (this.enabled === on) {
      if (!on) this.clearAll();
      return;
    }
    this.enabled = on;
    this.clearAll();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  clearAll(): void {
    this.keys.clear();
    this.pressed.clear();
    this.mouseDown = false;
    this.firePressed = false;
    this.lookDX = 0;
    this.lookDY = 0;
  }

  /** Mouse movement this frame in radians (viewmodel sway); resets on read. */
  takeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  /** Read once per fixed step. */
  sample(): InputSample {
    const k = this.keys;
    const b = this.bindings;
    const axis = (pos: string, neg: string): number => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
    const edge = (code: string): boolean => this.pressed.has(code);
    const s: InputSample = {
      moveX: axis(b.right, b.left),
      moveZ: axis(b.forward, b.back),
      fireHeld: this.mouseDown,
      firePressed: this.firePressed,
      jump: edge(b.jump),
      dash: edge(b.dash),
      reload: edge(b.reload),
      slot1: edge(b.slot1),
      slot2: edge(b.slot2),
      backup: edge(b.backup),
      interactPressed: edge(b.interact),
      interactHeld: k.has(b.interact),
      yaw: this.yaw,
      pitch: this.pitch,
    };
    if (this.override) {
      const o = this.override;
      Object.assign(s, o);
      if (o.yaw !== undefined) this.yaw = o.yaw;
      if (o.pitch !== undefined) this.pitch = o.pitch;
      for (const k of ['jump', 'dash', 'reload', 'slot1', 'slot2', 'backup', 'interactPressed', 'firePressed'] as const) delete this.override[k];
    }
    this.pressed.clear();
    this.firePressed = false;
    return s;
  }

  // -- events --------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    const b = this.bindings;
    if (code === b.debug) {
      e.preventDefault();
      if (!e.repeat) this.hooks.onToggleDebug?.();
      return;
    }
    if (code === b.pause) {
      if (!e.repeat && this.enabled) this.hooks.onEscape?.();
      return;
    }
    if (code === b.inspect) {
      e.preventDefault();
      if (!e.repeat && this.enabled) this.hooks.onInspect?.();
      return;
    }
    if (!this.enabled) return;
    if (code === b.jump || code === b.dash) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(code);
    this.pressed.add(code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled || e.button !== 0 || !this.locked) return;
    this.mouseDown = true;
    this.firePressed = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled || !this.locked) return;
    let dx = e.movementX || 0;
    let dy = e.movementY || 0;
    // Guard against the occasional huge spike some browsers report on lock changes.
    if (Math.abs(dx) > 600 || Math.abs(dy) > 600) return;
    const k = BASE_RADIANS_PER_PIXEL * this.sensitivity;
    dx *= k;
    dy *= k * (this.invertY ? -1 : 1);
    this.yaw -= dx;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy));
    this.lookDX += dx;
    this.lookDY += dy;
  };

  private onContextMenu = (e: Event): void => {
    if (this.enabled) e.preventDefault();
  };

  private onBlur = (): void => {
    this.clearAll();
    this.hooks.onBlur?.();
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      this.clearAll();
      this.hooks.onBlur?.();
    }
  };

  private onLockChange = (): void => {
    if (this.locked) {
      this.hooks.onLockGained?.();
    } else {
      this.clearAll();
      if (this.enabled && !this.lockPending) this.hooks.onLockLost?.();
    }
  };

  private onLockErr = (): void => {
    this.hooks.onLockError?.();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockErr);
    this.exitLock();
  }
}
