/**
 * Field I/O boundary.
 *
 * The control system (controlSystem.ts) talks ONLY to the FieldIO interface. The one implementation
 * shipped here, SimulatedFieldIO, wraps the software plant model. There is intentionally NO
 * implementation that talks to real hardware (Modbus / BACnet / OPC UA / GPIO): connecting this
 * code to a real process would require a separate design, safety review and commissioning.
 */

import { TankPlant, type PlantCommands } from './plant';

export interface FieldInputs {
  /** LT-101 level transmitter, % of span (filtered + noise). */
  levelPct: number;
  /** Analog-input diagnostics (out-of-range / wire break detection), like NAMUR NE43. */
  levelQuality: 'good' | 'bad';
  /** FT-101 inlet flow, L/s. */
  inflowLps: number;
  /** PT-101 pump discharge pressure, bar. */
  pressureBar: number;
  /** LSHH-101 hardwired level switch (independent of LT-101). */
  levelSwitchHH: boolean;
  /** LSLL-101 hardwired level switch (independent of LT-101). */
  levelSwitchLL: boolean;
  pumpSpeedFbPct: number;
  inletValveFbPct: number;
  outletValveFbPct: number;
}

export interface FieldOutputs {
  pumpSpeedPct: number;
  inletValvePct: number;
  outletValvePct: number;
}

export interface FieldIO {
  /** May throw on communication failure; the control system fails safe. */
  read(): FieldInputs;
  write(outputs: FieldOutputs): void;
}

export interface SimulatedFaults {
  /** 'high' / 'low' drive LT-101 out of range (wire short / break). */
  levelSensor: 'none' | 'high' | 'low';
  pumpFailure: boolean;
}

export interface SimIoConfig {
  /** 1-sigma measurement noise on level, % of span. */
  levelNoisePct: number;
  levelFilterTimeS: number;
  seed: number;
  switchHighPct: number;
  switchLowPct: number;
  switchHysteresisPct: number;
}

export const DEFAULT_SIM_IO_CONFIG: Readonly<SimIoConfig> = Object.freeze({
  levelNoisePct: 0.05,
  levelFilterTimeS: 0.5,
  seed: 20240607,
  switchHighPct: 95,
  switchLowPct: 5,
  switchHysteresisPct: 1,
});

/** Deterministic PRNG so simulations and tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEVEL_BAD_LOW = -2;
const LEVEL_BAD_HIGH = 102;

export class SimulatedFieldIO implements FieldIO {
  readonly plant: TankPlant;
  private cfg: SimIoConfig;
  private readonly rand: () => number;
  private faultState: SimulatedFaults = { levelSensor: 'none', pumpFailure: false };
  private cmd: PlantCommands;
  private levelFiltered: number;
  private switchHH = false;
  private switchLL = false;

  constructor(plant: TankPlant, config: Partial<SimIoConfig> = {}) {
    this.plant = plant;
    this.cfg = { ...DEFAULT_SIM_IO_CONFIG, ...config };
    this.rand = mulberry32(this.cfg.seed);
    const s = plant.state;
    this.cmd = { pumpSpeedPct: s.pumpSpeedPct, inletValvePct: s.inletValvePct, outletValvePct: s.outletValvePct };
    this.levelFiltered = s.levelPct;
    this.updateSwitches(s.levelPct);
  }

  get faults(): SimulatedFaults {
    return { ...this.faultState };
  }

  setFaults(f: Partial<SimulatedFaults>): void {
    this.faultState = { ...this.faultState, ...f };
  }

  /** Runtime change of LT-101 noise (1-sigma, % of span). Invalid values are ignored; negatives clamp to 0. */
  setLevelNoise(pct: number): void {
    if (!Number.isFinite(pct)) return;
    this.cfg = { ...this.cfg, levelNoisePct: Math.max(0, pct) };
  }

  read(): FieldInputs {
    const s = this.plant.state;
    let level = this.levelFiltered + this.gaussian() * this.cfg.levelNoisePct;
    if (this.faultState.levelSensor === 'high') level = 120;
    else if (this.faultState.levelSensor === 'low') level = -10;
    const bad = !Number.isFinite(level) || level < LEVEL_BAD_LOW || level > LEVEL_BAD_HIGH;
    return {
      levelPct: level,
      levelQuality: bad ? 'bad' : 'good',
      inflowLps: Math.max(0, s.inflowLps + this.gaussian() * 0.01),
      pressureBar: Math.max(0, s.dischargePressureBar + this.gaussian() * 0.01),
      levelSwitchHH: this.switchHH,
      levelSwitchLL: this.switchLL,
      pumpSpeedFbPct: s.pumpSpeedPct,
      inletValveFbPct: s.inletValvePct,
      outletValveFbPct: s.outletValvePct,
    };
  }

  write(outputs: FieldOutputs): void {
    this.cmd = { ...outputs };
  }

  /** Advance the physical process by dt seconds using the last written outputs. */
  advance(dt: number): void {
    const s = this.plant.step(this.cmd, dt, { pumpFailure: this.faultState.pumpFailure });
    this.levelFiltered += (s.levelPct - this.levelFiltered) * (1 - Math.exp(-dt / this.cfg.levelFilterTimeS));
    this.updateSwitches(s.levelPct);
  }

  private updateSwitches(trueLevel: number): void {
    const { switchHighPct, switchLowPct, switchHysteresisPct } = this.cfg;
    this.switchHH = this.switchHH ? trueLevel >= switchHighPct - switchHysteresisPct : trueLevel >= switchHighPct;
    this.switchLL = this.switchLL ? trueLevel <= switchLowPct + switchHysteresisPct : trueLevel <= switchLowPct;
  }

  private gaussian(): number {
    const u = Math.max(this.rand(), 1e-12);
    const v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
