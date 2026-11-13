/**
 * Safety logic: latched interlocks, run permissive and emergency stop.
 *
 * Design rules (simulation of common good practice - NOT a certified SIS):
 *  - Trips are LATCHED and need an explicit operator reset, and reset is refused while the
 *    cause is still present.
 *  - Level trips use the independent level SWITCHES, not the control transmitter, so a faulty
 *    LT-101 cannot defeat the high-high protection.
 *  - Fail-safe: a non-finite pressure reading is treated as a trip.
 *  - E-stop is latched: releasing the button does not restart anything; reset is required.
 *  - Safety outputs are applied AFTER the controller output, so the controller can never override them.
 */

export interface SafetyConfig {
  pressureTripBar: number;
  pressureResetHysteresisBar: number;
  /** Inlet valve feedback must be at least this open to allow the pump to run. */
  inletPermissivePct: number;
  /** IL-01 can only be reset when level is at or below this value. */
  levelHighResetPct: number;
  /** IL-02 can only be reset when level is at or above this value. */
  levelLowResetPct: number;
}

export const DEFAULT_SAFETY_CONFIG: Readonly<SafetyConfig> = Object.freeze({
  pressureTripBar: 5,
  pressureResetHysteresisBar: 0.5,
  inletPermissivePct: 20,
  levelHighResetPct: 85,
  levelLowResetPct: 10,
});

export interface SafetyInputs {
  /** Level from the control transmitter (used only for reset conditions). */
  levelPct: number;
  levelSwitchHH: boolean;
  levelSwitchLL: boolean;
  pressureBar: number;
  inletValveFbPct: number;
}

export interface SafetyOutputs {
  pumpEnabled: boolean;
  inletForceClosed: boolean;
  outletForceClosed: boolean;
  runPermissive: boolean;
  /** True when a latched condition (IL-01, IL-03 or E-stop) is stopping the pump. */
  pumpTripActive: boolean;
}

export type InterlockId = 'IL-01' | 'IL-02' | 'IL-03';

export interface InterlockStatus {
  id: InterlockId;
  name: string;
  action: string;
  /** Latched trip state. */
  tripped: boolean;
  /** Raw trip condition present right now. */
  conditionActive: boolean;
}

export interface ResetResult {
  ok: boolean;
  blockedBy: string[];
}

interface InterlockDef {
  id: InterlockId;
  name: string;
  action: string;
  condition: (i: SafetyInputs, c: SafetyConfig) => boolean;
  canClear: (i: SafetyInputs, c: SafetyConfig) => boolean;
}

const DEFS: InterlockDef[] = [
  {
    id: 'IL-01',
    name: 'High-high level (LSHH-101)',
    action: 'Trip pump, close inlet valve',
    condition: (i) => i.levelSwitchHH,
    canClear: (i, c) => !i.levelSwitchHH && Number.isFinite(i.levelPct) && i.levelPct <= c.levelHighResetPct,
  },
  {
    id: 'IL-02',
    name: 'Low-low level (LSLL-101)',
    action: 'Close outlet valve',
    condition: (i) => i.levelSwitchLL,
    canClear: (i, c) => !i.levelSwitchLL && Number.isFinite(i.levelPct) && i.levelPct >= c.levelLowResetPct,
  },
  {
    id: 'IL-03',
    name: 'High discharge pressure (PT-101)',
    action: 'Trip pump',
    condition: (i, c) => !Number.isFinite(i.pressureBar) || i.pressureBar >= c.pressureTripBar,
    canClear: (i, c) => Number.isFinite(i.pressureBar) && i.pressureBar < c.pressureTripBar - c.pressureResetHysteresisBar,
  },
];

export class SafetySystem {
  private readonly cfg: SafetyConfig;
  private readonly latched = new Map<InterlockId, boolean>(DEFS.map((d) => [d.id, false]));
  private readonly active = new Map<InterlockId, boolean>(DEFS.map((d) => [d.id, false]));
  private estopPressed = false;
  private estopLatched = false;
  private lastRunPermissive = true;

  constructor(config: Partial<SafetyConfig> = {}) {
    this.cfg = { ...DEFAULT_SAFETY_CONFIG, ...config };
  }

  get config(): Readonly<SafetyConfig> {
    return this.cfg;
  }

  get estop(): { pressed: boolean; latched: boolean } {
    return { pressed: this.estopPressed, latched: this.estopLatched };
  }

  get runPermissive(): boolean {
    return this.lastRunPermissive;
  }

  /** True while a latched condition (E-stop, IL-01, IL-03) is stopping the pump. */
  get pumpTripActive(): boolean {
    return this.estopLatched || this.latched.get('IL-01') === true || this.latched.get('IL-03') === true;
  }

  pressEStop(): void {
    this.estopPressed = true;
    this.estopLatched = true;
  }

  /** Releasing the button does NOT clear the latch; call reset(). */
  releaseEStop(): void {
    this.estopPressed = false;
  }

  evaluate(inputs: SafetyInputs): SafetyOutputs {
    for (const d of DEFS) {
      const cond = d.condition(inputs, this.cfg);
      this.active.set(d.id, cond);
      if (cond) this.latched.set(d.id, true);
    }
    const il01 = this.latched.get('IL-01') === true;
    const il02 = this.latched.get('IL-02') === true;
    const pumpTripActive = this.pumpTripActive;
    const runPermissive = Number.isFinite(inputs.inletValveFbPct) && inputs.inletValveFbPct >= this.cfg.inletPermissivePct;
    this.lastRunPermissive = runPermissive;
    return {
      pumpEnabled: !pumpTripActive && runPermissive,
      inletForceClosed: this.estopLatched || il01,
      outletForceClosed: il02,
      runPermissive,
      pumpTripActive,
    };
  }

  /**
   * Operator reset of E-stop latch and interlock latches. Each latch is cleared only if its
   * own cause has gone; ok is false if anything remains tripped (or the E-stop button is still pressed).
   */
  reset(inputs: SafetyInputs): ResetResult {
    if (this.estopPressed) return { ok: false, blockedBy: ['ESTOP'] };
    this.estopLatched = false;
    const blockedBy: string[] = [];
    for (const d of DEFS) {
      if (this.latched.get(d.id) !== true) continue;
      if (d.canClear(inputs, this.cfg)) this.latched.set(d.id, false);
      else blockedBy.push(d.id);
    }
    return { ok: blockedBy.length === 0, blockedBy };
  }

  interlock(id: InterlockId): InterlockStatus {
    const d = DEFS.find((x) => x.id === id);
    if (!d) throw new Error(`Unknown interlock ${id}`);
    return {
      id: d.id,
      name: d.name,
      action: d.action,
      tripped: this.latched.get(id) === true,
      conditionActive: this.active.get(id) === true,
    };
  }

  interlocks(): InterlockStatus[] {
    return DEFS.map((d) => this.interlock(d.id));
  }
}
