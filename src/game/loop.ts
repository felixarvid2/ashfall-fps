import { SIM_DT } from '../sim/types';

/** Fixed-step accumulator: at most `maxSteps` catch-up steps per frame. */
export class FixedStepper {
  private acc = 0;
  /** Steps dropped by the catch-up cap (diagnostics). */
  dropped = 0;

  constructor(private dt = SIM_DT, private maxSteps = 5) {}

  /** Adds frame time and runs `step` 0..maxSteps times. Returns the render alpha. */
  advance(frameDt: number, step: () => void): number {
    this.acc += Math.min(frameDt, 0.25);
    let n = 0;
    // Tiny epsilon so 60 frames of 1/60 s are exactly 60 steps despite float error.
    while (this.acc >= this.dt - 1e-9 && n < this.maxSteps) {
      this.acc -= this.dt;
      step();
      n++;
    }
    if (this.acc >= this.dt - 1e-9) {
      this.dropped += Math.floor(this.acc / this.dt);
      this.acc = 0;
    }
    if (this.acc < 0) this.acc = 0;
    return Math.min(1, this.acc / this.dt);
  }

  reset(): void {
    this.acc = 0;
  }
}

/** Rolling frame-time window with percentiles. */
export class FrameStats {
  private buf: number[] = [];
  constructor(private size = 300) {}
  push(ms: number): void {
    this.buf.push(ms);
    if (this.buf.length > this.size) this.buf.shift();
  }
  clear(): void {
    this.buf.length = 0;
  }
  get last(): number {
    return this.buf.length ? this.buf[this.buf.length - 1]! : 0;
  }
  percentile(p: number): number {
    if (!this.buf.length) return 0;
    const s = [...this.buf].sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
    return s[i]!;
  }
}
