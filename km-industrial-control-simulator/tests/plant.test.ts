import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANT_PARAMS, TankPlant } from '../src/core/plant';

const P = DEFAULT_PLANT_PARAMS;
const areaM2 = Math.PI * (P.tankDiameterM / 2) ** 2;
const maxFillRatePctPerS = (P.pumpMaxFlowLps / 1000 / areaM2 / P.tankHeightM) * 100;

function run(plant: TankPlant, cmd: { pumpSpeedPct: number; inletValvePct: number; outletValvePct: number }, seconds: number, dt = 0.1, faults = { pumpFailure: false }) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) plant.step(cmd, dt, faults);
}

describe('TankPlant - mass balance', () => {
  it('keeps level constant with pump off and outlet closed', () => {
    const plant = new TankPlant(P, { levelPct: 40 });
    run(plant, { pumpSpeedPct: 0, inletValvePct: 0, outletValvePct: 0 }, 120);
    expect(plant.state.levelPct).toBeCloseTo(40, 6);
  });

  it('fills at the analytical rate when pump is at 100 % and the outlet is closed', () => {
    const plant = new TankPlant(P, { levelPct: 0, inletValvePct: 100, outletValvePct: 0 });
    run(plant, { pumpSpeedPct: 100, inletValvePct: 100, outletValvePct: 0 }, 30);
    // pump lag (tau) delays the ramp: expected = rate * (T - tau*(1-e^{-T/tau}))
    const tau = P.pumpTimeConstantS;
    const expected = maxFillRatePctPerS * (30 - tau * (1 - Math.exp(-30 / tau)));
    expect(plant.state.levelPct).toBeGreaterThan(expected - 1.5);
    expect(plant.state.levelPct).toBeLessThan(expected + 1.5);
  });

  it('holds equilibrium when inflow equals outflow', () => {
    const outletPct = 40;
    const level = 50;
    const qOut = P.outletMaxFlowLps * (outletPct / 100) * Math.sqrt(level / 100);
    const speed = (qOut / P.pumpMaxFlowLps) * 100;
    const plant = new TankPlant(P, { levelPct: level, pumpSpeedPct: speed, inletValvePct: 100, outletValvePct: outletPct });
    run(plant, { pumpSpeedPct: speed, inletValvePct: 100, outletValvePct: outletPct }, 120);
    expect(plant.state.levelPct).toBeGreaterThan(level - 0.3);
    expect(plant.state.levelPct).toBeLessThan(level + 0.3);
  });

  it('outflow follows Torricelli: flow at 100 % level is twice the flow at 25 % level', () => {
    const hi = new TankPlant(P, { levelPct: 100, outletValvePct: 100 });
    const lo = new TankPlant(P, { levelPct: 25, outletValvePct: 100 });
    const cmd = { pumpSpeedPct: 0, inletValvePct: 0, outletValvePct: 100 };
    hi.step(cmd, 0.01);
    lo.step(cmd, 0.01);
    expect(hi.state.outflowLps / lo.state.outflowLps).toBeCloseTo(2, 1);
  });

  it('never leaves 0..100 % (empty and overflow)', () => {
    const empty = new TankPlant(P, { levelPct: 1, outletValvePct: 100 });
    run(empty, { pumpSpeedPct: 0, inletValvePct: 0, outletValvePct: 100 }, 200);
    expect(empty.state.levelPct).toBeGreaterThanOrEqual(0);
    const full = new TankPlant(P, { levelPct: 99, inletValvePct: 100 });
    run(full, { pumpSpeedPct: 100, inletValvePct: 100, outletValvePct: 0 }, 60);
    expect(full.state.levelPct).toBeLessThanOrEqual(100);
    expect(full.state.levelPct).toBeGreaterThan(99.9);
  });

  it('is numerically consistent for different time steps (0.1 s vs 1 s)', () => {
    const a = new TankPlant(P, { levelPct: 30, outletValvePct: 40 });
    const b = new TankPlant(P, { levelPct: 30, outletValvePct: 40 });
    const cmd = { pumpSpeedPct: 60, inletValvePct: 100, outletValvePct: 40 };
    run(a, cmd, 100, 0.1);
    run(b, cmd, 100, 1);
    expect(Math.abs(a.state.levelPct - b.state.levelPct)).toBeLessThan(0.5);
  });
});

describe('TankPlant - actuators', () => {
  it('pump follows a first-order lag (63 % after one time constant)', () => {
    const plant = new TankPlant(P, { levelPct: 50 });
    run(plant, { pumpSpeedPct: 100, inletValvePct: 100, outletValvePct: 0 }, P.pumpTimeConstantS);
    expect(plant.state.pumpSpeedPct).toBeGreaterThan(60);
    expect(plant.state.pumpSpeedPct).toBeLessThan(66);
  });

  it('valves are rate limited by stroke time (half open after half the stroke time)', () => {
    const plant = new TankPlant(P, { levelPct: 50, inletValvePct: 0, outletValvePct: 0 });
    run(plant, { pumpSpeedPct: 0, inletValvePct: 100, outletValvePct: 100 }, P.valveStrokeS / 2);
    expect(plant.state.inletValvePct).toBeCloseTo(50, 0);
    expect(plant.state.outletValvePct).toBeCloseTo(50, 0);
  });

  it('pump failure fault drives pump speed and inflow to zero', () => {
    const plant = new TankPlant(P, { levelPct: 50, pumpSpeedPct: 80, inletValvePct: 100 });
    run(plant, { pumpSpeedPct: 80, inletValvePct: 100, outletValvePct: 0 }, 30, 0.1, { pumpFailure: true });
    expect(plant.state.pumpSpeedPct).toBeLessThan(0.1);
    expect(plant.state.inflowLps).toBeLessThan(0.01);
  });

  it('clamps out-of-range commands instead of misbehaving', () => {
    const plant = new TankPlant(P, { levelPct: 50 });
    run(plant, { pumpSpeedPct: 500, inletValvePct: -20, outletValvePct: 1000 }, 60);
    expect(plant.state.pumpSpeedPct).toBeLessThanOrEqual(100);
    expect(plant.state.inletValvePct).toBeGreaterThanOrEqual(0);
    expect(plant.state.outletValvePct).toBeLessThanOrEqual(100);
  });
});

describe('TankPlant - discharge pressure', () => {
  it('is only static head when the pump is stopped', () => {
    const plant = new TankPlant(P, { levelPct: 100, inletValvePct: 100 });
    run(plant, { pumpSpeedPct: 0, inletValvePct: 100, outletValvePct: 0 }, 5);
    expect(plant.state.dischargePressureBar).toBeLessThan(0.3);
  });

  it('rises toward shut-off pressure when running against a closed inlet valve', () => {
    const plant = new TankPlant(P, { levelPct: 50, pumpSpeedPct: 100, inletValvePct: 0 });
    run(plant, { pumpSpeedPct: 100, inletValvePct: 0, outletValvePct: 0 }, 30);
    expect(plant.state.dischargePressureBar).toBeGreaterThan(P.pumpShutoffBar - 0.2);
  });

  it('is lower with the inlet valve open than closed at the same speed', () => {
    const open = new TankPlant(P, { levelPct: 50, pumpSpeedPct: 100, inletValvePct: 100 });
    const shut = new TankPlant(P, { levelPct: 50, pumpSpeedPct: 100, inletValvePct: 0 });
    run(open, { pumpSpeedPct: 100, inletValvePct: 100, outletValvePct: 0 }, 5);
    run(shut, { pumpSpeedPct: 100, inletValvePct: 0, outletValvePct: 0 }, 5);
    expect(open.state.dischargePressureBar).toBeLessThan(shut.state.dischargePressureBar);
  });
});

describe('TankPlant - input validation', () => {
  it('rejects non-positive dt', () => {
    const plant = new TankPlant(P);
    expect(() => plant.step({ pumpSpeedPct: 0, inletValvePct: 0, outletValvePct: 0 }, 0)).toThrow(RangeError);
  });
});
