import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANT_PARAMS, TankPlant } from '../src/core/plant';
import { SimulatedFieldIO } from '../src/core/io';
import { Simulation } from '../src/core/simulation';

/** Equilibrium pump demand (%) for a given level and outlet valve opening. */
function equilibriumPump(levelPct: number, outletPct: number): number {
  const p = DEFAULT_PLANT_PARAMS;
  return ((p.outletMaxFlowLps * (outletPct / 100) * Math.sqrt(levelPct / 100)) / p.pumpMaxFlowLps) * 100;
}

/** Run until `until` is true or `maxSeconds` elapse; returns elapsed seconds or null on timeout. */
function runUntil(sim: Simulation, until: () => boolean, maxSeconds: number, dt = 0.1): number | null {
  const n = Math.round(maxSeconds / dt);
  for (let i = 0; i < n; i++) {
    if (until()) return i * dt;
    sim.tick(dt);
  }
  return until() ? maxSeconds : null;
}

function steadyAuto(level = 50, outlet = 40): Simulation {
  const sim = new Simulation({ initialLevelPct: level, initialOutletValvePct: outlet, initialInletValvePct: 100, initialPumpSpeedPct: equilibriumPump(level, outlet) });
  sim.control.setSetpoint(level);
  sim.control.setOutletValveCommand(outlet);
  sim.control.setManualOutput(equilibriumPump(level, outlet));
  sim.run(15);
  expect(sim.control.setMode('auto').ok).toBe(true);
  return sim;
}

describe('SimulatedFieldIO', () => {
  const mk = (cfg = {}, level = 50) => new SimulatedFieldIO(new TankPlant(DEFAULT_PLANT_PARAMS, { levelPct: level }), cfg);

  it('is deterministic for a given seed and differs between seeds', () => {
    const a = mk({ seed: 1 });
    const b = mk({ seed: 1 });
    const c = mk({ seed: 2 });
    const ra = Array.from({ length: 5 }, () => a.read().levelPct);
    const rb = Array.from({ length: 5 }, () => b.read().levelPct);
    const rc = Array.from({ length: 5 }, () => c.read().levelPct);
    expect(ra).toEqual(rb);
    expect(ra).not.toEqual(rc);
  });

  it('measurement noise has roughly the configured standard deviation and no bias', () => {
    const io = mk({ levelNoisePct: 0.2 });
    const xs = Array.from({ length: 4000 }, () => io.read().levelPct - 50);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(sd).toBeGreaterThan(0.15);
    expect(sd).toBeLessThan(0.25);
  });

  it('noise can be changed at runtime and is clamped to >= 0', () => {
    const io = mk({ levelNoisePct: 0.5 });
    io.setLevelNoise(0);
    expect(io.read().levelPct).toBe(50);
    io.setLevelNoise(-3);
    expect(io.read().levelPct).toBe(50);
    io.setLevelNoise(Number.NaN);
    expect(io.read().levelPct).toBe(50);
    io.setLevelNoise(1);
    const xs = Array.from({ length: 50 }, () => io.read().levelPct);
    expect(new Set(xs).size).toBeGreaterThan(10);
  });

  it('LT-101 faults produce out-of-range readings flagged as bad quality', () => {
    const io = mk();
    expect(io.read().levelQuality).toBe('good');
    io.setFaults({ levelSensor: 'high' });
    expect(io.read().levelQuality).toBe('bad');
    io.setFaults({ levelSensor: 'low' });
    expect(io.read().levelQuality).toBe('bad');
    io.setFaults({ levelSensor: 'none' });
    expect(io.read().levelQuality).toBe('good');
  });

  it('level switches use the true level with hysteresis, independent of sensor faults', () => {
    const io = mk({ levelNoisePct: 0 }, 96);
    expect(io.read().levelSwitchHH).toBe(true);
    io.setFaults({ levelSensor: 'low' });
    expect(io.read().levelSwitchHH).toBe(true); // switch does not care about LT-101
    const drain = mk({ levelNoisePct: 0 }, 94.5);
    expect(drain.read().levelSwitchHH).toBe(false);
    const hyst = new SimulatedFieldIO(new TankPlant(DEFAULT_PLANT_PARAMS, { levelPct: 96, outletValvePct: 100 }), { levelNoisePct: 0 });
    hyst.write({ pumpSpeedPct: 0, inletValvePct: 0, outletValvePct: 100 });
    let stillMadeAt94_5 = false;
    for (let i = 0; i < 4000; i++) {
      hyst.advance(0.1);
      const lvl = hyst.plant.state.levelPct;
      if (lvl < 94.9 && lvl > 94.1) stillMadeAt94_5 = hyst.read().levelSwitchHH;
      if (lvl < 93) break;
    }
    expect(stillMadeAt94_5).toBe(true);
    expect(hyst.read().levelSwitchHH).toBe(false);
  });
});

describe('closed-loop PID performance (default tunings, simulation)', () => {
  it('holds a steady level at the setpoint', () => {
    const sim = steadyAuto();
    sim.run(120);
    expect(Math.abs(sim.plant.levelPct - 50)).toBeLessThan(0.5);
  });

  it('tracks a setpoint step 50 -> 70 % with limited overshoot and settles within +/-2 %', () => {
    const sim = steadyAuto();
    sim.control.setSetpoint(70);
    let peak = 0;
    let settledAt: number | null = null;
    let outside = false;
    for (let i = 0; i < 6000; i++) {
      sim.tick(0.1);
      const lvl = sim.plant.levelPct;
      peak = Math.max(peak, lvl);
      const err = Math.abs(lvl - 70);
      if (err > 2) {
        outside = true;
        settledAt = null;
      } else if (outside && settledAt === null) {
        settledAt = i * 0.1;
      }
    }
    expect(peak - 70).toBeLessThan(3); // < 15 % of the 20 % step
    expect(settledAt).not.toBeNull();
    expect(settledAt ?? Infinity).toBeLessThan(300);
    expect(Math.abs(sim.plant.levelPct - 70)).toBeLessThan(0.5);
    expect(sim.control.snapshot().safety.pumpTripActive).toBe(false);
  });

  it('tracks a step down 50 -> 30 %', () => {
    const sim = steadyAuto();
    sim.control.setSetpoint(30);
    sim.run(500);
    expect(Math.abs(sim.plant.levelPct - 30)).toBeLessThan(1);
  });

  it('rejects an outlet demand disturbance (40 -> 70 %)', () => {
    const sim = steadyAuto();
    sim.control.setOutletValveCommand(70);
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      sim.tick(0.1);
      worst = Math.max(worst, Math.abs(sim.plant.levelPct - 50));
    }
    expect(worst).toBeLessThan(10);
    expect(Math.abs(sim.plant.levelPct - 50)).toBeLessThan(1);
  });

  it('is deterministic: two identical runs give identical results', () => {
    const run = () => {
      const sim = steadyAuto();
      sim.control.setSetpoint(65);
      sim.run(200);
      return sim.plant.levelPct;
    };
    expect(run()).toBe(run());
  });

  it('a retune changes the response (higher Kp reacts faster)', () => {
    const slow = steadyAuto();
    slow.control.setTunings({ kp: 2, ki: 0.03, kd: 0 });
    slow.control.setSetpoint(70);
    slow.run(60);
    const fast = steadyAuto();
    fast.control.setTunings({ kp: 10, ki: 0.15, kd: 0 });
    fast.control.setSetpoint(70);
    fast.run(60);
    expect(fast.plant.levelPct).toBeGreaterThan(slow.plant.levelPct);
  });
});

describe('safety behaviour with the simulated plant', () => {
  it('IL-01 stops an overfill in Auto when the setpoint is demanded at 100 %', () => {
    const sim = steadyAuto();
    sim.control.setSetpoint(100);
    const t = runUntil(sim, () => sim.control.snapshot().safety.interlocks.find((i) => i.id === 'IL-01')?.tripped === true, 800);
    expect(t).not.toBeNull();
    sim.run(30);
    expect(sim.plant.levelPct).toBeLessThanOrEqual(100);
    expect(sim.plant.pumpSpeedPct).toBeLessThan(1);
    expect(sim.plant.inletValvePct).toBeLessThan(1);
    const snap = sim.control.snapshot();
    expect(snap.mode).toBe('manual');
    expect(snap.alarms.find((a) => a.id === 'IL-01')?.state).toMatch(/active/);
  });

  it('IL-01 in Manual: reset is refused while the tank is full and accepted after draining below the reset level', () => {
    const sim = new Simulation({ initialLevelPct: 80, initialOutletValvePct: 0 });
    sim.control.setOutletValveCommand(0);
    sim.control.setManualOutput(100);
    expect(runUntil(sim, () => sim.control.snapshot().safety.interlocks[0]?.tripped === true, 300)).not.toBeNull();
    expect(sim.control.resetInterlocks().ok).toBe(false);
    sim.control.setOutletValveCommand(100);
    expect(runUntil(sim, () => sim.plant.levelPct <= 84, 600)).not.toBeNull();
    sim.run(1);
    expect(sim.control.resetInterlocks().ok).toBe(true);
    sim.run(10);
    expect(sim.plant.inletValvePct).toBeGreaterThan(99); // inlet reopened
    expect(sim.plant.pumpSpeedPct).toBeLessThan(1); // pump did NOT restart by itself
  });

  it('dead-head: closing the inlet valve with the pump running never lets pressure exceed the trip region', () => {
    const sim = new Simulation({ initialLevelPct: 40, initialPumpSpeedPct: 100, initialInletValvePct: 100 });
    sim.control.setManualOutput(100);
    sim.run(10);
    sim.control.setInletValveCommand(0);
    let peak = 0;
    for (let i = 0; i < 1200; i++) {
      sim.tick(0.1);
      peak = Math.max(peak, sim.plant.dischargePressureBar);
    }
    expect(peak).toBeLessThan(5.4);
    expect(sim.plant.pumpSpeedPct).toBeLessThan(1);
    const s = sim.control.snapshot();
    expect(s.safety.interlocks.find((i) => i.id === 'IL-03')?.tripped === true || !s.safety.runPermissive).toBe(true);
  });

  it('E-stop in Auto stops the pump, closes the inlet and the level stops rising', () => {
    const sim = steadyAuto();
    sim.control.setSetpoint(80);
    sim.run(30);
    sim.control.pressEStop();
    sim.run(15);
    expect(sim.plant.pumpSpeedPct).toBeLessThan(1);
    expect(sim.plant.inletValvePct).toBe(0);
    const level = sim.plant.levelPct;
    sim.run(20);
    expect(sim.plant.levelPct).toBeLessThanOrEqual(level + 1e-9); // only draining via the outlet
    sim.control.releaseEStop();
    sim.run(5);
    expect(sim.plant.pumpSpeedPct).toBeLessThan(1); // release alone does not restart
  });

  it('pump failure in Auto: PUMP_FAIL alarm, then low-level alarms and finally IL-02 closes the outlet', () => {
    const sim = steadyAuto();
    sim.io.setFaults({ pumpFailure: true });
    sim.run(20);
    expect(sim.control.snapshot().alarms.find((a) => a.id === 'PUMP_FAIL')?.state).toBe('activeUnacked');
    const t = runUntil(sim, () => sim.control.snapshot().safety.interlocks.find((i) => i.id === 'IL-02')?.tripped === true, 1500);
    expect(t).not.toBeNull();
    sim.run(20);
    expect(sim.plant.outletValvePct).toBeLessThan(1);
    expect(sim.plant.levelPct).toBeGreaterThanOrEqual(0);
    const ids = sim.control.snapshot().alarms.filter((a) => a.state !== 'normal').map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['LAL', 'LALL', 'IL-02']));
  });

  it('a failed LT-101 cannot defeat IL-01: the independent LSHH switch still trips the pump', () => {
    const sim = new Simulation({ initialLevelPct: 85, initialOutletValvePct: 0 });
    sim.control.setOutletValveCommand(0);
    sim.control.setManualOutput(80);
    sim.run(2);
    sim.io.setFaults({ levelSensor: 'low' }); // transmitter reads -10 % ("bad"), tank really filling
    const t = runUntil(sim, () => sim.control.snapshot().safety.interlocks[0]?.tripped === true, 300);
    expect(t).not.toBeNull();
    sim.run(15);
    expect(sim.plant.pumpSpeedPct).toBeLessThan(1);
    expect(sim.control.snapshot().degraded.levelSensorBad).toBe(true);
  });

  it('LT-101 fault in Auto holds the pump output and returns control to the operator', () => {
    const sim = steadyAuto();
    const before = sim.control.snapshot().output;
    sim.io.setFaults({ levelSensor: 'high' });
    sim.run(5);
    const s = sim.control.snapshot();
    expect(s.mode).toBe('manual');
    expect(Math.abs(s.manualOutput - before)).toBeLessThan(3);
    expect(s.alarms.find((a) => a.id === 'LT_FAULT')?.state).toBe('activeUnacked');
    // no spurious level alarms from the failed reading
    expect(s.alarms.find((a) => a.id === 'LAHH')?.state).toBe('normal');
  });
});
