/**
 * Simulation = ControlSystem + SimulatedFieldIO (+ TankPlant).
 *
 * This is the ONLY place where the control logic is connected to a process, and the process is
 * software. Replacing SimulatedFieldIO with a hardware driver is deliberately out of scope.
 */

import { ControlSystem, type ControlOptions, type ControlSnapshot } from './controlSystem';
import { SimulatedFieldIO, type SimIoConfig, type SimulatedFaults } from './io';
import { DEFAULT_PLANT_PARAMS, TankPlant, type PlantParams, type PlantState } from './plant';

export interface SimulationOptions {
  initialLevelPct?: number;
  initialPumpSpeedPct?: number;
  initialInletValvePct?: number;
  initialOutletValvePct?: number;
  plant?: Partial<PlantParams>;
  io?: Partial<SimIoConfig>;
  control?: ControlOptions;
}

export interface SimulationSnapshot {
  control: ControlSnapshot;
  plant: PlantState;
  faults: SimulatedFaults;
}

export const SCAN_TIME_S = 0.1;

export class Simulation {
  readonly io: SimulatedFieldIO;
  readonly control: ControlSystem;
  private readonly plantModel: TankPlant;

  constructor(opts: SimulationOptions = {}) {
    const outlet = opts.initialOutletValvePct ?? opts.control?.initialOutletValvePct ?? 40;
    this.plantModel = new TankPlant(
      { ...DEFAULT_PLANT_PARAMS, ...opts.plant },
      {
        levelPct: opts.initialLevelPct ?? 30,
        pumpSpeedPct: opts.initialPumpSpeedPct ?? 0,
        inletValvePct: opts.initialInletValvePct ?? 100,
        outletValvePct: outlet,
      },
    );
    this.io = new SimulatedFieldIO(this.plantModel, opts.io);
    this.control = new ControlSystem(this.io, { ...opts.control, initialOutletValvePct: outlet });
    // Prime one scan so the controller has a valid process value before the operator acts.
    this.control.scan(SCAN_TIME_S);
  }

  get plant(): PlantState {
    return this.plantModel.state;
  }

  get faults(): SimulatedFaults {
    return this.io.faults;
  }

  setFaults(f: Partial<SimulatedFaults>): void {
    this.io.setFaults(f);
  }

  /** One scan of the controller followed by one step of the process. */
  tick(dt: number = SCAN_TIME_S): void {
    this.control.scan(dt);
    this.io.advance(dt);
  }

  run(seconds: number, dt: number = SCAN_TIME_S): void {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) this.tick(dt);
  }

  snapshot(): SimulationSnapshot {
    return { control: this.control.snapshot(), plant: this.plant, faults: this.faults };
  }
}
