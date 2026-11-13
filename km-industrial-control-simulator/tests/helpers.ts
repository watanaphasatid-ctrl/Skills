import type { FieldInputs, FieldIO, FieldOutputs } from '../src/core/io';
import type { ControlSystem } from '../src/core/controlSystem';

/** Scripted I/O for isolating control logic from the plant model. */
export class FakeIO implements FieldIO {
  inputs: FieldInputs = {
    levelPct: 50,
    levelQuality: 'good',
    inflowLps: 0,
    pressureBar: 1,
    levelSwitchHH: false,
    levelSwitchLL: false,
    pumpSpeedFbPct: 0,
    inletValveFbPct: 100,
    outletValveFbPct: 40,
  };
  outputs: FieldOutputs | null = null;
  failRead = false;
  /** When true, pump feedback mirrors the pump command (healthy pump). */
  followPump = true;

  read(): FieldInputs {
    if (this.failRead) throw new Error('communication failure');
    return { ...this.inputs };
  }

  write(out: FieldOutputs): void {
    this.outputs = { ...out };
    if (this.followPump) this.inputs.pumpSpeedFbPct = out.pumpSpeedPct;
  }
}

export function scanFor(cs: ControlSystem, seconds: number, dt = 0.1): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) cs.scan(dt);
}
