import { describe, expect, it } from 'vitest';
import { PidController } from '../src/core/pid';

const base = { kp: 2, ki: 0, kd: 0, outMin: 0, outMax: 100, derivativeFilterTime: 0.5 };
const make = (over: Partial<typeof base> = {}) => new PidController({ ...base, ...over });

describe('PidController - proportional', () => {
  it('outputs kp * error when only P is active', () => {
    const pid = make({ kp: 2 });
    expect(pid.update(50, 40, 0.1)).toBeCloseTo(20, 9);
  });

  it('clamps output to outMax and outMin', () => {
    const pid = make({ kp: 10 });
    expect(pid.update(100, 0, 0.1)).toBe(100);
    expect(pid.update(0, 100, 0.1)).toBe(0);
  });
});

describe('PidController - integral', () => {
  it('accumulates ki * error * dt', () => {
    const pid = make({ kp: 0, ki: 0.5 });
    let out = 0;
    for (let i = 0; i < 10; i++) out = pid.update(60, 50, 0.1); // e=10 for 1 s
    expect(pid.integral).toBeCloseTo(5, 9);
    expect(out).toBeCloseTo(5, 9);
  });

  it('does not wind up while saturated and leaves saturation as soon as error reverses', () => {
    const pid = make({ kp: 1, ki: 1 });
    for (let i = 0; i < 3000; i++) pid.update(100, 50, 0.1); // 300 s saturated high
    expect(pid.output).toBe(100);
    expect(pid.integral).toBeLessThanOrEqual(100); // bounded by conditional integration
    const out = pid.update(50, 55, 0.1); // error now -5
    expect(out).toBeLessThan(100);
  });

  it('freezes the integrator when hold is requested', () => {
    const pid = make({ kp: 0, ki: 1 });
    pid.update(60, 50, 1);
    const before = pid.integral;
    pid.update(60, 50, 1, { hold: true });
    expect(pid.integral).toBe(before);
  });

  it('changing Ki alone does not cause an output step', () => {
    const pid = make({ kp: 1, ki: 1 });
    for (let i = 0; i < 50; i++) pid.update(60, 50, 0.1);
    const before = pid.output;
    pid.setTunings({ kp: 1, ki: 5, kd: 0 });
    const after = pid.update(60, 50, 0.1);
    // only one extra step of integration at the new Ki is allowed
    expect(after - before).toBeLessThan(5 * 10 * 0.1 + 1e-9);
    expect(after - before).toBeLessThan(6);
  });
});

describe('PidController - derivative', () => {
  it('uses derivative on measurement: no kick on a setpoint step', () => {
    const pid = make({ kp: 1, kd: 20 });
    pid.update(50, 50, 0.1);
    const out = pid.update(80, 50, 0.1); // SP jumps, PV constant
    expect(out).toBeCloseTo(30, 9); // pure P = 1 * 30
  });

  it('opposes a rising process value', () => {
    const pid = make({ kp: 0, kd: 10 });
    pid.update(50, 50, 0.1);
    const out = pid.update(50, 51, 0.1); // PV rising 10 %/s
    expect(out).toBe(0); // D term negative -> clamped to outMin
    const pid2 = make({ kp: 0, kd: 10, outMin: -100 });
    pid2.update(50, 50, 0.1);
    expect(pid2.update(50, 51, 0.1)).toBeLessThan(0);
  });

  it('filters the derivative so a PV step decays over time', () => {
    const pid = make({ kp: 0, kd: 10, outMin: -1000, outMax: 1000, derivativeFilterTime: 1 });
    pid.update(50, 50, 0.1);
    const first = pid.update(50, 52, 0.1);
    let later = first;
    for (let i = 0; i < 30; i++) later = pid.update(50, 52, 0.1);
    expect(first).toBeLessThan(0);
    expect(Math.abs(later)).toBeLessThan(Math.abs(first) * 0.1);
  });
});

describe('PidController - bumpless transfer and robustness', () => {
  it('trackOutput makes the next update continue from the given output', () => {
    const pid = make({ kp: 2, ki: 0.1 });
    pid.trackOutput(40, 50, 45);
    const out = pid.update(50, 45, 0.1);
    expect(out).toBeCloseTo(40, 1); // within one integration step (0.1*5*0.1 = 0.05)
  });

  it('trackOutput clamps a request outside the output range', () => {
    const pid = make();
    pid.trackOutput(250, 50, 50);
    expect(pid.output).toBe(100);
  });

  it('rejects non-positive or non-finite dt', () => {
    const pid = make();
    expect(() => pid.update(50, 50, 0)).toThrow(RangeError);
    expect(() => pid.update(50, 50, -1)).toThrow(RangeError);
    expect(() => pid.update(50, 50, Number.NaN)).toThrow(RangeError);
  });

  it('holds last output and keeps state finite on a non-finite PV', () => {
    const pid = make({ kp: 1, ki: 1 });
    for (let i = 0; i < 10; i++) pid.update(60, 50, 0.1);
    const before = pid.output;
    const integral = pid.integral;
    expect(pid.update(60, Number.NaN, 0.1)).toBe(before);
    expect(pid.integral).toBe(integral);
    expect(Number.isFinite(pid.update(60, 50, 0.1))).toBe(true);
  });

  it('rejects invalid tunings (negative or NaN)', () => {
    const pid = make();
    expect(() => pid.setTunings({ kp: -1, ki: 0, kd: 0 })).toThrow(RangeError);
    expect(() => pid.setTunings({ kp: 1, ki: Number.NaN, kd: 0 })).toThrow(RangeError);
    expect(() => pid.setTunings({ kp: 1, ki: 0, kd: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('reset clears integral and output', () => {
    const pid = make({ kp: 1, ki: 1 });
    for (let i = 0; i < 20; i++) pid.update(60, 50, 0.1);
    pid.reset();
    expect(pid.integral).toBe(0);
    expect(pid.output).toBe(0);
  });
});
