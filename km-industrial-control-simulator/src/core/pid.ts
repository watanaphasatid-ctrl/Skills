/**
 * Parallel-form PID controller (position algorithm).
 *
 *   u = Kp*e + I + D          e = SP - PV
 *   I += Ki*e*dt               (Ki in output-% per (%·s), i.e. 1/s when units match)
 *   D  = -Kd * d(PV_filtered)/dt   (derivative on measurement, first-order filtered)
 *
 * Features: output clamping, conditional-integration anti-windup, hold (freeze) input,
 * bumpless transfer via trackOutput(), derivative-kick avoidance, input validation.
 * Pure logic - no DOM, no timers, deterministic for a given input sequence.
 */

export interface PidTunings {
  kp: number;
  ki: number;
  kd: number;
}

export interface PidConfig extends PidTunings {
  outMin: number;
  outMax: number;
  /** Time constant (s) of the first-order filter on the derivative term. Must be > 0. */
  derivativeFilterTime: number;
}

export interface PidTerms {
  p: number;
  i: number;
  d: number;
}

export interface PidUpdateOptions {
  /** Freeze integration (e.g. actuator inhibited by an interlock/permissive). */
  hold?: boolean;
}

function assertTunings({ kp, ki, kd }: PidTunings): void {
  for (const [name, v] of [['kp', kp], ['ki', ki], ['kd', kd]] as const) {
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError(`PID ${name} must be a finite number >= 0 (got ${String(v)})`);
    }
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class PidController {
  private kp: number;
  private ki: number;
  private kd: number;
  private readonly outMin: number;
  private readonly outMax: number;
  private readonly tf: number;

  private integralTerm = 0;
  private lastOutput = 0;
  private prevPv: number | null = null;
  private dFiltered = 0; // filtered dPV/dt
  private lastTerms: PidTerms = { p: 0, i: 0, d: 0 };

  constructor(config: PidConfig) {
    assertTunings(config);
    if (!(config.outMax > config.outMin)) throw new RangeError('PID outMax must be > outMin');
    if (!(config.derivativeFilterTime > 0)) throw new RangeError('PID derivativeFilterTime must be > 0');
    this.kp = config.kp;
    this.ki = config.ki;
    this.kd = config.kd;
    this.outMin = config.outMin;
    this.outMax = config.outMax;
    this.tf = config.derivativeFilterTime;
  }

  get tunings(): PidTunings {
    return { kp: this.kp, ki: this.ki, kd: this.kd };
  }
  get integral(): number {
    return this.integralTerm;
  }
  get output(): number {
    return this.lastOutput;
  }
  get terms(): PidTerms {
    return { ...this.lastTerms };
  }

  setTunings(t: PidTunings): void {
    assertTunings(t);
    this.kp = t.kp;
    this.ki = t.ki;
    this.kd = t.kd;
  }

  reset(): void {
    this.integralTerm = 0;
    this.lastOutput = 0;
    this.prevPv = null;
    this.dFiltered = 0;
    this.lastTerms = { p: 0, i: 0, d: 0 };
  }

  /**
   * Bumpless transfer: make the next update() continue from `output`
   * (call every scan while in Manual so Manual->Auto causes no bump).
   */
  trackOutput(output: number, sp: number, pv: number): void {
    const u = clamp(output, this.outMin, this.outMax);
    this.integralTerm = u - this.kp * (sp - pv);
    this.lastOutput = u;
    this.prevPv = Number.isFinite(pv) ? pv : null;
    this.dFiltered = 0;
    this.lastTerms = { p: this.kp * (sp - pv), i: this.integralTerm, d: 0 };
  }

  update(sp: number, pv: number, dt: number, opts: PidUpdateOptions = {}): number {
    if (!Number.isFinite(dt) || dt <= 0) throw new RangeError(`PID dt must be > 0 (got ${String(dt)})`);
    // Bad input: hold last output, do not corrupt internal state.
    if (!Number.isFinite(sp) || !Number.isFinite(pv)) return this.lastOutput;

    const error = sp - pv;

    // Derivative on measurement, filtered. First sample has no history -> zero.
    if (this.prevPv === null) {
      this.dFiltered = 0;
    } else {
      const raw = (pv - this.prevPv) / dt;
      const alpha = dt / (this.tf + dt);
      this.dFiltered += alpha * (raw - this.dFiltered);
    }
    this.prevPv = pv;

    const p = this.kp * error;
    const d = -this.kd * this.dFiltered;

    // Conditional integration anti-windup.
    if (!opts.hold) {
      const candidate = this.integralTerm + this.ki * error * dt;
      const unsat = p + candidate + d;
      const windingUp = (unsat > this.outMax && error > 0) || (unsat < this.outMin && error < 0);
      if (!windingUp) this.integralTerm = candidate;
    }

    this.lastTerms = { p, i: this.integralTerm, d };
    this.lastOutput = clamp(p + this.integralTerm + d, this.outMin, this.outMax);
    return this.lastOutput;
  }
}
