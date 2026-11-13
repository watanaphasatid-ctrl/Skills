/**
 * Physical model of the simulated process: a vertical cylindrical tank filled by a
 * variable-speed pump through an inlet valve and drained through an outlet (process demand) valve.
 *
 * SIMULATION ONLY. Parameters are plausible training values, not field-validated data.
 * Level is in % of tank height. Flows are in L/s.
 */

export interface PlantParams {
  tankDiameterM: number;
  tankHeightM: number;
  pumpMaxFlowLps: number;
  pumpTimeConstantS: number;
  /** Time for a valve to travel 0 -> 100 % (rate limit = 100 / stroke per second). */
  valveStrokeS: number;
  /** Outlet flow at 100 % opening and 100 % level. */
  outletMaxFlowLps: number;
  /** Discharge pressure at 100 % speed with the inlet valve closed (dead head). */
  pumpShutoffBar: number;
  /** Discharge pressure at 100 % speed with the inlet valve fully open (excl. static head). */
  pumpRunBar: number;
}

export const DEFAULT_PLANT_PARAMS: Readonly<PlantParams> = Object.freeze({
  tankDiameterM: 0.8,
  tankHeightM: 1.5,
  pumpMaxFlowLps: 8,
  pumpTimeConstantS: 2,
  valveStrokeS: 6,
  outletMaxFlowLps: 11.3,
  pumpShutoffBar: 6,
  pumpRunBar: 2.5,
});

export interface PlantCommands {
  /** 0..100 % pump speed demand. */
  pumpSpeedPct: number;
  /** 0..100 % inlet valve position demand. */
  inletValvePct: number;
  /** 0..100 % outlet valve position demand. */
  outletValvePct: number;
}

export interface PlantFaults {
  /** Pump cannot deliver (seized / tripped at the motor starter). */
  pumpFailure: boolean;
}

export interface PlantState {
  levelPct: number;
  pumpSpeedPct: number;
  inletValvePct: number;
  outletValvePct: number;
  inflowLps: number;
  outflowLps: number;
  dischargePressureBar: number;
}

const WATER_HEAD_BAR_PER_M = 0.0981;
const MAX_SUBSTEP_S = 0.05;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const sane = (v: number): number => (Number.isFinite(v) ? v : 0);

export class TankPlant {
  private readonly params: PlantParams;
  private readonly areaM2: number;
  private level: number;
  private pump: number;
  private inlet: number;
  private outlet: number;
  private inflow = 0;
  private outflow = 0;
  private pressure = 0;

  constructor(params: Readonly<PlantParams> = DEFAULT_PLANT_PARAMS, initial: Partial<PlantState> = {}) {
    this.params = { ...params };
    this.areaM2 = Math.PI * (params.tankDiameterM / 2) ** 2;
    this.level = clamp(initial.levelPct ?? 0, 0, 100);
    this.pump = clamp(initial.pumpSpeedPct ?? 0, 0, 100);
    this.inlet = clamp(initial.inletValvePct ?? 0, 0, 100);
    this.outlet = clamp(initial.outletValvePct ?? 0, 0, 100);
    this.computeAlgebraic();
  }

  get state(): PlantState {
    return {
      levelPct: this.level,
      pumpSpeedPct: this.pump,
      inletValvePct: this.inlet,
      outletValvePct: this.outlet,
      inflowLps: this.inflow,
      outflowLps: this.outflow,
      dischargePressureBar: this.pressure,
    };
  }

  /** Advance the model by dt seconds (internally sub-stepped for numerical stability). */
  step(cmd: PlantCommands, dt: number, faults: PlantFaults = { pumpFailure: false }): PlantState {
    if (!Number.isFinite(dt) || dt <= 0) throw new RangeError(`Plant dt must be > 0 (got ${String(dt)})`);
    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_S));
    const h = dt / n;
    const pumpCmd = faults.pumpFailure ? 0 : clamp(sane(cmd.pumpSpeedPct), 0, 100);
    const inletCmd = clamp(sane(cmd.inletValvePct), 0, 100);
    const outletCmd = clamp(sane(cmd.outletValvePct), 0, 100);
    const maxTravel = 100 / this.params.valveStrokeS;

    for (let k = 0; k < n; k++) {
      // Actuator dynamics: pump = first-order lag (exact discretisation), valves = rate limited.
      this.pump += (pumpCmd - this.pump) * (1 - Math.exp(-h / this.params.pumpTimeConstantS));
      this.inlet += clamp(inletCmd - this.inlet, -maxTravel * h, maxTravel * h);
      this.outlet += clamp(outletCmd - this.outlet, -maxTravel * h, maxTravel * h);
      this.computeAlgebraic();

      // Mass balance: dL/dt [%/s] = (Qin - Qout)[m3/s] / A / H * 100
      const dLevel = ((this.inflow - this.outflow) / 1000 / this.areaM2 / this.params.tankHeightM) * 100;
      this.level = clamp(this.level + dLevel * h, 0, 100); // 100 % = overflow (excess is lost)
    }
    this.computeAlgebraic();
    return this.state;
  }

  private computeAlgebraic(): void {
    const speed = this.pump / 100;
    const inletOpen = this.inlet / 100;
    this.inflow = this.params.pumpMaxFlowLps * speed * inletOpen;
    this.outflow = this.params.outletMaxFlowLps * (this.outlet / 100) * Math.sqrt(this.level / 100);
    const staticBar = WATER_HEAD_BAR_PER_M * this.params.tankHeightM * (this.level / 100);
    const pumpHead =
      speed * speed * (this.params.pumpShutoffBar - (this.params.pumpShutoffBar - this.params.pumpRunBar) * inletOpen);
    this.pressure = staticBar + pumpHead;
  }
}
