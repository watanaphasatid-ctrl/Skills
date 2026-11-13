import { describe, expect, it } from 'vitest';
import { DEFAULT_SAFETY_CONFIG, SafetySystem, type SafetyInputs } from '../src/core/safety';

const normal: SafetyInputs = {
  levelPct: 50,
  levelSwitchHH: false,
  levelSwitchLL: false,
  pressureBar: 1.5,
  inletValveFbPct: 100,
};
const at = (over: Partial<SafetyInputs>): SafetyInputs => ({ ...normal, ...over });

describe('SafetySystem - normal operation', () => {
  it('has no trips, pump enabled and no forced valves', () => {
    const s = new SafetySystem();
    const out = s.evaluate(normal);
    expect(out.pumpEnabled).toBe(true);
    expect(out.inletForceClosed).toBe(false);
    expect(out.outletForceClosed).toBe(false);
    expect(out.runPermissive).toBe(true);
    expect(out.pumpTripActive).toBe(false);
  });

  it('exposes the documented trip setpoints', () => {
    expect(DEFAULT_SAFETY_CONFIG.pressureTripBar).toBe(5);
    expect(DEFAULT_SAFETY_CONFIG.inletPermissivePct).toBe(20);
  });
});

describe('IL-01 high-high level (independent LSHH switch)', () => {
  it('trips the pump and closes the inlet valve, and latches after the switch clears', () => {
    const s = new SafetySystem();
    let out = s.evaluate(at({ levelSwitchHH: true, levelPct: 96 }));
    expect(out.pumpEnabled).toBe(false);
    expect(out.inletForceClosed).toBe(true);
    out = s.evaluate(at({ levelSwitchHH: false, levelPct: 94 })); // switch cleared, still latched
    expect(out.pumpEnabled).toBe(false);
    expect(out.inletForceClosed).toBe(true);
    expect(s.interlock('IL-01').tripped).toBe(true);
  });

  it('trips even if the level transmitter reads a healthy value (independence from LT-101)', () => {
    const s = new SafetySystem();
    const out = s.evaluate(at({ levelSwitchHH: true, levelPct: 40 }));
    expect(out.pumpEnabled).toBe(false);
  });

  it('cannot be reset while the level is still high, can be reset after it drops', () => {
    const s = new SafetySystem();
    s.evaluate(at({ levelSwitchHH: true, levelPct: 96 }));
    const refused = s.reset(at({ levelSwitchHH: false, levelPct: 92 }));
    expect(refused.ok).toBe(false);
    expect(refused.blockedBy).toContain('IL-01');
    expect(s.interlock('IL-01').tripped).toBe(true);
    const done = s.reset(at({ levelSwitchHH: false, levelPct: 80 }));
    expect(done.ok).toBe(true);
    expect(s.evaluate(at({ levelPct: 80 })).pumpEnabled).toBe(true);
  });

  it('is not reset while the switch itself is still made', () => {
    const s = new SafetySystem();
    s.evaluate(at({ levelSwitchHH: true, levelPct: 96 }));
    expect(s.reset(at({ levelSwitchHH: true, levelPct: 50 })).ok).toBe(false);
  });
});

describe('IL-02 low-low level (independent LSLL switch)', () => {
  it('closes the outlet valve but does not stop the fill pump, and latches', () => {
    const s = new SafetySystem();
    let out = s.evaluate(at({ levelSwitchLL: true, levelPct: 4 }));
    expect(out.outletForceClosed).toBe(true);
    expect(out.pumpEnabled).toBe(true);
    expect(out.inletForceClosed).toBe(false);
    out = s.evaluate(at({ levelSwitchLL: false, levelPct: 6 }));
    expect(out.outletForceClosed).toBe(true);
  });

  it('resets only after the tank has refilled above the reset level', () => {
    const s = new SafetySystem();
    s.evaluate(at({ levelSwitchLL: true, levelPct: 4 }));
    expect(s.reset(at({ levelSwitchLL: false, levelPct: 8 })).ok).toBe(false);
    expect(s.reset(at({ levelSwitchLL: false, levelPct: 12 })).ok).toBe(true);
    expect(s.evaluate(at({ levelPct: 12 })).outletForceClosed).toBe(false);
  });
});

describe('IL-03 high discharge pressure', () => {
  it('trips the pump at the setpoint but does NOT close the inlet valve (would worsen dead-head)', () => {
    const s = new SafetySystem();
    expect(s.evaluate(at({ pressureBar: 4.99 })).pumpEnabled).toBe(true);
    const out = s.evaluate(at({ pressureBar: 5.0 }));
    expect(out.pumpEnabled).toBe(false);
    expect(out.inletForceClosed).toBe(false);
  });

  it('latches and requires pressure to fall below trip minus hysteresis to reset', () => {
    const s = new SafetySystem();
    s.evaluate(at({ pressureBar: 5.5 }));
    expect(s.reset(at({ pressureBar: 4.9 })).ok).toBe(false);
    expect(s.reset(at({ pressureBar: 4.4 })).ok).toBe(true);
  });

  it('fails safe: a non-finite pressure reading trips the pump', () => {
    const s = new SafetySystem();
    expect(s.evaluate(at({ pressureBar: Number.NaN })).pumpEnabled).toBe(false);
  });
});

describe('P-01 pump run permissive (inlet valve open)', () => {
  it('inhibits the pump without latching, and releases automatically when the valve opens', () => {
    const s = new SafetySystem();
    let out = s.evaluate(at({ inletValveFbPct: 10 }));
    expect(out.runPermissive).toBe(false);
    expect(out.pumpEnabled).toBe(false);
    expect(out.pumpTripActive).toBe(false);
    out = s.evaluate(at({ inletValveFbPct: 60 }));
    expect(out.runPermissive).toBe(true);
    expect(out.pumpEnabled).toBe(true);
  });

  it('boundary: exactly at the permissive threshold is permitted', () => {
    const s = new SafetySystem();
    expect(s.evaluate(at({ inletValveFbPct: 20 })).runPermissive).toBe(true);
    expect(s.evaluate(at({ inletValveFbPct: 19.99 })).runPermissive).toBe(false);
  });
});

describe('Emergency stop', () => {
  it('stops the pump and closes the inlet valve immediately', () => {
    const s = new SafetySystem();
    s.pressEStop();
    const out = s.evaluate(normal);
    expect(out.pumpEnabled).toBe(false);
    expect(out.inletForceClosed).toBe(true);
    expect(out.pumpTripActive).toBe(true);
  });

  it('stays latched after the button is released until an explicit reset', () => {
    const s = new SafetySystem();
    s.pressEStop();
    s.releaseEStop();
    expect(s.evaluate(normal).pumpEnabled).toBe(false);
    expect(s.estop.pressed).toBe(false);
    expect(s.estop.latched).toBe(true);
    expect(s.reset(normal).ok).toBe(true);
    expect(s.evaluate(normal).pumpEnabled).toBe(true);
  });

  it('cannot be reset while the button is still pressed', () => {
    const s = new SafetySystem();
    s.pressEStop();
    const r = s.reset(normal);
    expect(r.ok).toBe(false);
    expect(r.blockedBy).toContain('ESTOP');
    expect(s.evaluate(normal).pumpEnabled).toBe(false);
  });

  it('takes priority over everything and pressing twice is harmless', () => {
    const s = new SafetySystem();
    s.pressEStop();
    s.pressEStop();
    expect(s.evaluate(normal).pumpEnabled).toBe(false);
    expect(s.estop.pressed).toBe(true);
  });
});

describe('multiple simultaneous trips', () => {
  it('reset clears only the cleared interlocks and reports the rest', () => {
    const s = new SafetySystem();
    s.evaluate(at({ levelSwitchHH: true, levelPct: 96, pressureBar: 5.5 }));
    const r = s.reset(at({ levelSwitchHH: true, levelPct: 96, pressureBar: 3 }));
    expect(r.ok).toBe(false);
    expect(r.blockedBy).toEqual(['IL-01']);
    expect(s.interlock('IL-03').tripped).toBe(false);
    expect(s.interlock('IL-01').tripped).toBe(true);
  });
});
