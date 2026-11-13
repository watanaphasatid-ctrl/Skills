import { beforeEach, describe, expect, it } from 'vitest';
import { ControlSystem } from '../src/core/controlSystem';
import { FakeIO, scanFor } from './helpers';

let io: FakeIO;
let cs: ControlSystem;

beforeEach(() => {
  io = new FakeIO();
  cs = new ControlSystem(io);
  cs.scan(0.1); // establish a first valid process value, as the live simulator always does
});

const alarmState = (id: string) => cs.snapshot().alarms.find((a) => a.id === id)?.state;

describe('defaults and operator commands', () => {
  it('starts in Manual with the pump off, inlet open and outlet at the default demand', () => {
    cs.scan(0.1);
    expect(cs.snapshot().mode).toBe('manual');
    expect(io.outputs).toEqual({ pumpSpeedPct: 0, inletValvePct: 100, outletValvePct: 40 });
  });

  it('writes the manual output to the pump', () => {
    cs.setManualOutput(35);
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(35);
  });

  it('clamps manual output to 0..100 and rejects non-finite values', () => {
    expect(cs.setManualOutput(140).ok).toBe(true);
    expect(cs.snapshot().manualOutput).toBe(100);
    expect(cs.setManualOutput(-5).ok).toBe(true);
    expect(cs.snapshot().manualOutput).toBe(0);
    expect(cs.setManualOutput(Number.NaN).ok).toBe(false);
  });

  it('clamps the setpoint to 0..100 and rejects non-finite values', () => {
    expect(cs.setSetpoint(150).ok).toBe(true);
    expect(cs.snapshot().setpoint).toBe(100);
    expect(cs.setSetpoint(Number.NaN).ok).toBe(false);
    expect(cs.snapshot().setpoint).toBe(100);
  });

  it('applies operator valve commands and clamps them', () => {
    cs.setOutletValveCommand(70);
    cs.setInletValveCommand(150);
    cs.scan(0.1);
    expect(io.outputs?.outletValvePct).toBe(70);
    expect(io.outputs?.inletValvePct).toBe(100);
  });

  it('rejects invalid PID tunings and keeps the old ones', () => {
    const before = cs.snapshot().pid.tunings;
    expect(cs.setTunings({ kp: -1, ki: 0, kd: 0 }).ok).toBe(false);
    expect(cs.setTunings({ kp: Number.NaN, ki: 0, kd: 0 }).ok).toBe(false);
    expect(cs.snapshot().pid.tunings).toEqual(before);
    expect(cs.setTunings({ kp: 3, ki: 0.2, kd: 1 }).ok).toBe(true);
    expect(cs.snapshot().pid.tunings).toEqual({ kp: 3, ki: 0.2, kd: 1 });
  });
});

describe('Manual/Auto transfer', () => {
  it('refuses Auto before a valid process value has been scanned (no bogus bumpless seed)', () => {
    const fresh = new ControlSystem(new FakeIO());
    const r = fresh.setMode('auto');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/process value/i);
    expect(fresh.snapshot().mode).toBe('manual');
  });

  it('Manual -> Auto is bumpless', () => {
    cs.setSetpoint(50);
    cs.setManualOutput(40);
    scanFor(cs, 0.5);
    expect(cs.setMode('auto').ok).toBe(true);
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBeGreaterThan(39);
    expect(io.outputs?.pumpSpeedPct).toBeLessThan(41);
  });

  it('Auto -> Manual is bumpless (manual output takes over the last controller output)', () => {
    cs.setSetpoint(52);
    cs.setMode('auto');
    scanFor(cs, 5);
    const last = io.outputs?.pumpSpeedPct ?? -1;
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(100);
    cs.setMode('manual');
    expect(cs.snapshot().manualOutput).toBeCloseTo(last, 6);
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBeCloseTo(last, 6);
  });

  it('setManualOutput has no effect on the pump while in Auto (reports why)', () => {
    cs.setMode('auto');
    const r = cs.setManualOutput(80);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/auto/i);
  });
});

describe('emergency stop', () => {
  it('stops the pump and closes the inlet valve in the same scan and drops to Manual 0 %', () => {
    cs.setSetpoint(60);
    cs.setMode('auto');
    scanFor(cs, 5);
    expect(io.outputs?.pumpSpeedPct).toBeGreaterThan(0);
    cs.pressEStop();
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(0);
    expect(io.outputs?.inletValvePct).toBe(0);
    const snap = cs.snapshot();
    expect(snap.mode).toBe('manual');
    expect(snap.manualOutput).toBe(0);
    expect(snap.safety.estop.latched).toBe(true);
    expect(alarmState('ESTOP')).toBe('activeUnacked');
  });

  it('refuses Auto while the E-stop is latched', () => {
    cs.pressEStop();
    cs.scan(0.1);
    const r = cs.setMode('auto');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/e-stop/i);
  });

  it('does not restart after release; needs reset, then stays in Manual at 0 %', () => {
    cs.setMode('auto');
    cs.pressEStop();
    cs.scan(0.1);
    cs.releaseEStop();
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(0);
    expect(io.outputs?.inletValvePct).toBe(0);
    expect(cs.resetInterlocks().ok).toBe(true);
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(0);
    expect(io.outputs?.inletValvePct).toBe(100);
    expect(cs.snapshot().mode).toBe('manual');
  });

  it('reset is refused while the button is still pressed', () => {
    cs.pressEStop();
    cs.scan(0.1);
    expect(cs.resetInterlocks().ok).toBe(false);
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(0);
  });

  it('manual output commanded during an E-stop is forced back to 0 %', () => {
    cs.pressEStop();
    cs.setManualOutput(80);
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(0);
    expect(cs.snapshot().manualOutput).toBe(0);
  });
});

describe('interlocks through the control loop', () => {
  it('IL-01 trips pump + inlet in Auto and returns the loop to Manual 0 %', () => {
    cs.setSetpoint(50);
    cs.setMode('auto');
    scanFor(cs, 2);
    io.inputs.levelSwitchHH = true;
    io.inputs.levelPct = 96;
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(0);
    expect(io.outputs?.inletValvePct).toBe(0);
    expect(cs.snapshot().mode).toBe('manual');
    expect(cs.setMode('auto').ok).toBe(false);
  });

  it('after the cause clears, reset reopens the inlet but does not restart the pump', () => {
    io.inputs.levelSwitchHH = true;
    io.inputs.levelPct = 96;
    cs.scan(0.1);
    io.inputs.levelSwitchHH = false;
    io.inputs.levelPct = 80;
    expect(cs.resetInterlocks().ok).toBe(true);
    cs.scan(0.1);
    expect(io.outputs?.inletValvePct).toBe(100);
    expect(io.outputs?.pumpSpeedPct).toBe(0);
  });

  it('IL-02 closes the outlet valve regardless of the operator demand', () => {
    cs.setOutletValveCommand(80);
    io.inputs.levelSwitchLL = true;
    io.inputs.levelPct = 4;
    cs.scan(0.1);
    expect(io.outputs?.outletValvePct).toBe(0);
  });

  it('IL-03 trips the pump on high discharge pressure', () => {
    cs.setManualOutput(60);
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(60);
    io.inputs.pressureBar = 5.2;
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(0);
    expect(io.outputs?.inletValvePct).toBe(100); // not closed: would make dead-head worse
  });

  it('run permissive: pump is inhibited while the inlet valve is shut, and releases without a reset', () => {
    cs.setManualOutput(50);
    io.inputs.inletValveFbPct = 10;
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(0);
    expect(cs.snapshot().safety.runPermissive).toBe(false);
    io.inputs.inletValveFbPct = 100;
    cs.scan(0.1);
    expect(io.outputs?.pumpSpeedPct).toBe(50);
  });

  it('PID integrator is frozen while the pump is inhibited by the permissive (no windup)', () => {
    cs.setSetpoint(52); // small error: output stays unsaturated, so the integrator would move without a hold
    cs.setMode('auto');
    scanFor(cs, 3);
    const running = cs.snapshot().pid.terms.i;
    scanFor(cs, 3);
    expect(cs.snapshot().pid.terms.i).toBeGreaterThan(running); // sanity: integrates when permitted
    io.inputs.inletValveFbPct = 5;
    cs.scan(0.1);
    const frozen = cs.snapshot().pid.terms.i;
    scanFor(cs, 30);
    expect(cs.snapshot().pid.terms.i).toBe(frozen);
  });
});

describe('degraded instrumentation and I/O', () => {
  it('bad LT-101 quality in Auto drops to Manual holding the last output, raises LT_FAULT, refuses Auto', () => {
    cs.setSetpoint(60);
    cs.setMode('auto');
    scanFor(cs, 5);
    const last = io.outputs?.pumpSpeedPct ?? -1;
    io.inputs.levelQuality = 'bad';
    cs.scan(0.1);
    const snap = cs.snapshot();
    expect(snap.mode).toBe('manual');
    expect(snap.manualOutput).toBeCloseTo(last, 0);
    expect(snap.degraded.levelSensorBad).toBe(true);
    expect(alarmState('LT_FAULT')).toBe('activeUnacked');
    expect(cs.setMode('auto').ok).toBe(false);
    io.inputs.levelQuality = 'good';
    cs.scan(0.1);
    expect(cs.setMode('auto').ok).toBe(true);
  });

  it('a non-finite level reading is treated as bad quality', () => {
    cs.setMode('auto');
    io.inputs.levelPct = Number.NaN;
    cs.scan(0.1);
    expect(cs.snapshot().degraded.levelSensorBad).toBe(true);
    expect(cs.snapshot().mode).toBe('manual');
    expect(Number.isFinite(io.outputs?.pumpSpeedPct ?? Number.NaN)).toBe(true);
  });

  it('an I/O read failure drives safe outputs (pump 0, inlet closed), raises IO_FAULT and does not throw', () => {
    cs.setManualOutput(60);
    cs.scan(0.1);
    io.failRead = true;
    expect(() => cs.scan(0.1)).not.toThrow();
    expect(io.outputs?.pumpSpeedPct).toBe(0);
    expect(io.outputs?.inletValvePct).toBe(0);
    expect(cs.snapshot().degraded.ioFault).toBe(true);
    expect(alarmState('IO_FAULT')).toBe('activeUnacked');
    expect(cs.snapshot().mode).toBe('manual');
    expect(cs.snapshot().manualOutput).toBe(0);
    io.failRead = false;
    cs.scan(0.1);
    expect(cs.snapshot().degraded.ioFault).toBe(false);
    expect(io.outputs?.pumpSpeedPct).toBe(0); // operator must command the pump again
  });
});

describe('alarms', () => {
  it('raises level high and high-high alarms after the on-delay and lets the operator acknowledge', () => {
    io.inputs.levelPct = 85;
    scanFor(cs, 0.5);
    expect(alarmState('LAH')).toBe('normal'); // still inside on-delay
    scanFor(cs, 3);
    expect(alarmState('LAH')).toBe('activeUnacked');
    expect(alarmState('LAHH')).toBe('normal');
    io.inputs.levelPct = 92;
    scanFor(cs, 3);
    expect(alarmState('LAHH')).toBe('activeUnacked');
    cs.acknowledgeAll();
    expect(alarmState('LAH')).toBe('activeAcked');
    expect(cs.snapshot().unackedCount).toBe(0);
  });

  it('does not chatter at the limit thanks to the deadband', () => {
    io.inputs.levelPct = 80;
    scanFor(cs, 3);
    expect(alarmState('LAH')).toBe('activeUnacked');
    io.inputs.levelPct = 79;
    scanFor(cs, 3);
    expect(alarmState('LAH')).toBe('activeUnacked'); // inside deadband
    io.inputs.levelPct = 70;
    scanFor(cs, 1);
    expect(alarmState('LAH')).toBe('rtnUnacked');
  });

  it('raises low level alarms', () => {
    io.inputs.levelPct = 15;
    scanFor(cs, 3);
    expect(alarmState('LAL')).toBe('activeUnacked');
    io.inputs.levelPct = 8;
    scanFor(cs, 3);
    expect(alarmState('LALL')).toBe('activeUnacked');
  });

  it('raises pressure high before the trip setpoint', () => {
    io.inputs.pressureBar = 4.2;
    scanFor(cs, 3);
    expect(alarmState('PAH')).toBe('activeUnacked');
    expect(cs.snapshot().safety.pumpTripActive).toBe(false);
  });

  it('raises a deviation alarm only in Auto and only after the delay', () => {
    cs.setSetpoint(70);
    io.inputs.levelPct = 50;
    scanFor(cs, 30);
    expect(alarmState('DEV')).toBe('normal'); // Manual: no deviation alarm
    cs.setMode('auto');
    scanFor(cs, 10);
    expect(alarmState('DEV')).toBe('normal'); // inside the 20 s delay
    scanFor(cs, 15);
    expect(alarmState('DEV')).toBe('activeUnacked');
  });

  it('raises PUMP_FAIL when the pump is commanded but does not respond', () => {
    io.followPump = false;
    io.inputs.pumpSpeedFbPct = 0;
    cs.setManualOutput(80);
    scanFor(cs, 3);
    expect(alarmState('PUMP_FAIL')).toBe('normal');
    scanFor(cs, 6);
    expect(alarmState('PUMP_FAIL')).toBe('activeUnacked');
  });

  it('does not raise PUMP_FAIL for a healthy pump', () => {
    cs.setManualOutput(80);
    scanFor(cs, 30);
    expect(alarmState('PUMP_FAIL')).toBe('normal');
  });

  it('validates alarm limit ordering and applies valid changes', () => {
    const bad = cs.setAlarmLimits({ levelH: 95 });
    expect(bad.ok).toBe(false);
    expect(cs.snapshot().alarmLimits.levelH).toBe(80);
    expect(cs.setAlarmLimits({ levelH: 70 }).ok).toBe(true);
    io.inputs.levelPct = 75;
    scanFor(cs, 3);
    expect(alarmState('LAH')).toBe('activeUnacked');
  });

  it('records alarm events in the history log', () => {
    io.inputs.levelPct = 85;
    scanFor(cs, 3);
    expect(cs.alarmHistory.some((e) => e.id === 'LAH' && e.type === 'ACTIVE')).toBe(true);
  });
});

describe('trend history', () => {
  it('samples SP, PV and OUT every 0.5 s of simulated time', () => {
    scanFor(cs, 10);
    const h = cs.history;
    expect(h.length).toBeGreaterThanOrEqual(19);
    expect(h.length).toBeLessThanOrEqual(21);
    expect(h[h.length - 1]).toMatchObject({ pv: 50, sp: cs.snapshot().setpoint });
  });

  it('caps the number of retained samples', () => {
    const small = new ControlSystem(io, { maxHistorySamples: 10 });
    scanFor(small, 30);
    expect(small.history.length).toBe(10);
  });

  it('rejects a non-positive scan time', () => {
    expect(() => cs.scan(0)).toThrow(RangeError);
  });
});
