import { describe, expect, it } from 'vitest';
import { stepsForFrame } from '../src/app/stepper';
import { decimate, toCsv, windowSamples } from '../src/app/trendData';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from '../src/app/settings';
import type { TrendSample } from '../src/core/controlSystem';

const mk = (n: number, dt = 0.5): TrendSample[] =>
  Array.from({ length: n }, (_, i) => ({ t: i * dt, sp: 50, pv: 40 + (i % 7), out: 30, pressure: 1.5, flow: 2 }));

describe('stepsForFrame (fixed-step accumulator)', () => {
  it('converts real elapsed time to whole scans at 1x and keeps the remainder', () => {
    const r = stepsForFrame(0, 0.25, 1, 0.1, 1000);
    expect(r.steps).toBe(2);
    expect(r.accumulator).toBeCloseTo(0.05, 9);
  });

  it('scales with simulation speed', () => {
    expect(stepsForFrame(0, 0.1, 10, 0.1, 1000).steps).toBe(10);
  });

  it('clamps a long frame (tab was hidden) to 0.25 s of real time instead of fast-forwarding', () => {
    expect(stepsForFrame(0, 30, 1, 0.1, 1000).steps).toBe(2);
  });

  it('caps the number of scans per frame and drops the backlog (no spiral of death)', () => {
    const r = stepsForFrame(0, 0.25, 20, 0.1, 10);
    expect(r.steps).toBe(10);
    expect(r.accumulator).toBe(0);
  });

  it('ignores negative, NaN and zero elapsed time', () => {
    expect(stepsForFrame(0.03, -1, 1, 0.1, 100)).toEqual({ steps: 0, accumulator: 0.03 });
    expect(stepsForFrame(0.03, Number.NaN, 1, 0.1, 100)).toEqual({ steps: 0, accumulator: 0.03 });
  });
});

describe('trend data helpers', () => {
  it('windowSamples keeps only samples inside the window ending at endT', () => {
    const s = mk(200); // t = 0 .. 99.5
    const w = windowSamples(s, 10, 99.5);
    expect(w[0]?.t).toBeGreaterThanOrEqual(89.5);
    expect(w[w.length - 1]?.t).toBe(99.5);
    expect(w.length).toBeGreaterThan(18);
    expect(w.length).toBeLessThan(23);
  });

  it('windowSamples returns everything when the window is longer than the data, and [] for empty input', () => {
    expect(windowSamples(mk(10), 3600, 4.5).length).toBe(10);
    expect(windowSamples([], 60, 0)).toEqual([]);
  });

  it('decimate never exceeds the point budget and keeps first and last samples in order', () => {
    const s = mk(5000);
    const d = decimate(s, 400);
    expect(d.length).toBeLessThanOrEqual(400);
    expect(d[0]).toBe(s[0]);
    expect(d[d.length - 1]).toBe(s[s.length - 1]);
    for (let i = 1; i < d.length; i++) expect((d[i] as TrendSample).t).toBeGreaterThan((d[i - 1] as TrendSample).t);
  });

  it('decimate returns the input untouched when it already fits, and handles a budget below 2', () => {
    const s = mk(50);
    expect(decimate(s, 400)).toEqual(s);
    expect(decimate(s, 1).length).toBeLessThanOrEqual(2);
  });

  it('toCsv writes a header and one line per sample', () => {
    const csv = toCsv(mk(3));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('time_s,setpoint_pct,pv_pct,output_pct,pressure_bar,flow_lps');
    expect(lines.length).toBe(4);
    expect(lines[2]).toBe('0.5,50.000,41.000,30.000,1.500,2.000');
  });
});

describe('settings persistence', () => {
  const store = (initial?: string) => {
    const data = new Map<string, string>();
    if (initial !== undefined) data.set(SETTINGS_KEY, initial);
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      data,
    };
  };

  it('returns defaults when nothing is stored', () => {
    expect(loadSettings(store())).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for corrupted JSON', () => {
    expect(loadSettings(store('{not json'))).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips valid settings', () => {
    const s = store();
    const custom = { ...DEFAULT_SETTINGS, speed: 5, tunings: { kp: 3, ki: 0.2, kd: 1.5 }, noisePct: 0.3 };
    saveSettings(custom, s);
    expect(loadSettings(s)).toEqual(custom);
  });

  it('sanitises invalid parts individually without discarding valid parts', () => {
    const bad = JSON.stringify({ speed: 7, tunings: { kp: -4, ki: 0.2, kd: 0 }, alarmLimits: { levelHH: 50 }, noisePct: 99 });
    const out = loadSettings(store(bad));
    expect(out.speed).toBe(DEFAULT_SETTINGS.speed);
    expect(out.tunings).toEqual(DEFAULT_SETTINGS.tunings);
    expect(out.alarmLimits).toEqual(DEFAULT_SETTINGS.alarmLimits);
    expect(out.noisePct).toBe(DEFAULT_SETTINGS.noisePct);
  });

  it('keeps a valid speed and valid tunings when other fields are invalid', () => {
    const mixed = JSON.stringify({ speed: 10, tunings: { kp: 4, ki: 0.2, kd: 0.5 }, noisePct: -1 });
    const out = loadSettings(store(mixed));
    expect(out.speed).toBe(10);
    expect(out.tunings).toEqual({ kp: 4, ki: 0.2, kd: 0.5 });
    expect(out.noisePct).toBe(DEFAULT_SETTINGS.noisePct);
  });

  it('never throws when storage access fails (private mode, quota)', () => {
    const boom = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadSettings(boom)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, boom)).not.toThrow();
  });
});
