/**
 * Control system: operator commands -> PID/manual -> safety override -> field outputs,
 * plus alarm evaluation and trend history. Talks to the process only through FieldIO.
 *
 * Scan order (every call to scan):
 *   1 read inputs (fail safe on I/O error)   2 evaluate safety   3 enforce mode rules
 *   4 run PID / manual   5 apply safety overrides   6 write outputs   7 alarms   8 history
 */

import { AlarmManager, limitCondition, type AlarmDefinition, type AlarmEvent, type AlarmInput, type AlarmPriority, type AlarmRecord } from './alarms';
import type { FieldInputs, FieldIO } from './io';
import { PidController, type PidTerms, type PidTunings } from './pid';
import { SafetySystem, type InterlockStatus, type SafetyConfig } from './safety';

export type Mode = 'manual' | 'auto';

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export interface AlarmLimits {
  levelHH: number;
  levelH: number;
  levelL: number;
  levelLL: number;
  pressureH: number;
  pressureHH: number;
  deviationPct: number;
}

export const DEFAULT_ALARM_LIMITS: Readonly<AlarmLimits> = Object.freeze({
  levelHH: 90,
  levelH: 80,
  levelL: 20,
  levelLL: 10,
  pressureH: 4,
  pressureHH: 5,
  deviationPct: 10,
});

export const DEFAULT_TUNINGS: Readonly<PidTunings> = Object.freeze({ kp: 6, ki: 0.1, kd: 0 });

export interface ControlOptions {
  tunings?: PidTunings;
  initialSetpoint?: number;
  initialOutletValvePct?: number;
  maxHistorySamples?: number;
  historyIntervalS?: number;
  safety?: Partial<SafetyConfig>;
  alarmLimits?: Partial<AlarmLimits>;
}

export interface TrendSample {
  t: number;
  sp: number;
  pv: number;
  out: number;
  pressure: number;
  flow: number;
}

export interface ControlSnapshot {
  time: number;
  mode: Mode;
  setpoint: number;
  pv: number;
  /** Controller demand (PID output in Auto, operator value in Manual), before safety override. */
  output: number;
  manualOutput: number;
  /** Value actually written to the pump after interlocks and permissives. */
  pumpCommand: number;
  operator: { inletValveCmd: number; outletValveCmd: number };
  pid: { tunings: PidTunings; terms: PidTerms };
  inputs: FieldInputs | null;
  safety: {
    estop: { pressed: boolean; latched: boolean };
    interlocks: InterlockStatus[];
    runPermissive: boolean;
    pumpTripActive: boolean;
    config: Readonly<SafetyConfig>;
  };
  degraded: { levelSensorBad: boolean; ioFault: boolean };
  alarms: AlarmRecord[];
  activeAlarmCount: number;
  unackedCount: number;
  highestAlarmPriority: AlarmPriority | null;
  alarmLimits: AlarmLimits;
}

const LEVEL_DEADBAND = 2;
const PRESSURE_DEADBAND = 0.2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const ok = (): CommandResult => ({ ok: true });
const fail = (reason: string): CommandResult => ({ ok: false, reason });

function alarmDefinitions(l: AlarmLimits): AlarmDefinition[] {
  return [
    { id: 'LAHH', tag: 'LT-101', description: `Level high-high (>= ${l.levelHH} %)`, priority: 'critical', onDelayS: 1 },
    { id: 'LAH', tag: 'LT-101', description: `Level high (>= ${l.levelH} %)`, priority: 'high', onDelayS: 1 },
    { id: 'LAL', tag: 'LT-101', description: `Level low (<= ${l.levelL} %)`, priority: 'high', onDelayS: 1 },
    { id: 'LALL', tag: 'LT-101', description: `Level low-low (<= ${l.levelLL} %)`, priority: 'critical', onDelayS: 1 },
    { id: 'PAH', tag: 'PT-101', description: `Discharge pressure high (>= ${l.pressureH} bar)`, priority: 'high', onDelayS: 1 },
    { id: 'PAHH', tag: 'PT-101', description: `Discharge pressure high-high (>= ${l.pressureHH} bar)`, priority: 'critical', onDelayS: 0 },
    { id: 'DEV', tag: 'LIC-101', description: `Control deviation > ${l.deviationPct} % in Auto`, priority: 'medium', onDelayS: 20 },
    { id: 'PUMP_FAIL', tag: 'P-101', description: 'Pump commanded but not running', priority: 'high', onDelayS: 6 },
    { id: 'LT_FAULT', tag: 'LT-101', description: 'Level transmitter signal bad', priority: 'high', onDelayS: 0 },
    { id: 'IO_FAULT', tag: 'IO', description: 'Field I/O communication failure', priority: 'critical', onDelayS: 0 },
    { id: 'IL-01', tag: 'LSHH-101', description: 'Interlock IL-01 tripped: high-high level', priority: 'critical', onDelayS: 0 },
    { id: 'IL-02', tag: 'LSLL-101', description: 'Interlock IL-02 tripped: low-low level', priority: 'critical', onDelayS: 0 },
    { id: 'IL-03', tag: 'PT-101', description: 'Interlock IL-03 tripped: high discharge pressure', priority: 'critical', onDelayS: 0 },
    { id: 'ESTOP', tag: 'ES-001', description: 'Emergency stop latched', priority: 'critical', onDelayS: 0 },
  ];
}

export function validateLimits(l: AlarmLimits): string | null {
  const vals = Object.values(l);
  if (vals.some((v) => !Number.isFinite(v))) return 'Alarm limits must be finite numbers';
  if (!(l.levelLL >= 0 && l.levelLL < l.levelL && l.levelL < l.levelH && l.levelH < l.levelHH && l.levelHH <= 100)) {
    return 'Level limits must satisfy 0 <= LL < L < H < HH <= 100';
  }
  if (!(l.pressureH > 0 && l.pressureH < l.pressureHH)) return 'Pressure limits must satisfy 0 < H < HH';
  if (!(l.deviationPct >= 1 && l.deviationPct <= 50)) return 'Deviation limit must be between 1 and 50 %';
  return null;
}

export class ControlSystem {
  private readonly io: FieldIO;
  private readonly pid: PidController;
  private readonly safety: SafetySystem;
  private readonly alarms: AlarmManager;
  private limits: AlarmLimits;

  private mode: Mode = 'manual';
  private setpoint: number;
  private manualOutput = 0;
  private opInlet = 100;
  private opOutlet: number;

  private time = 0;
  private lastInputs: FieldInputs | null = null;
  private lastPv = 0;
  private havePv = false;
  private demand = 0;
  private pumpCommand = 0;
  private levelBad = false;
  private ioFault = false;
  private lastRunPermissive = true;
  private readonly raw = new Map<string, boolean>();

  private readonly samples: TrendSample[] = [];
  private readonly maxSamples: number;
  private readonly sampleInterval: number;
  private sinceSample = Number.POSITIVE_INFINITY;

  constructor(io: FieldIO, opts: ControlOptions = {}) {
    this.io = io;
    this.limits = { ...DEFAULT_ALARM_LIMITS, ...opts.alarmLimits };
    const t = opts.tunings ?? DEFAULT_TUNINGS;
    this.pid = new PidController({ ...t, outMin: 0, outMax: 100, derivativeFilterTime: 1 });
    this.safety = new SafetySystem(opts.safety);
    this.alarms = new AlarmManager(alarmDefinitions(this.limits));
    this.setpoint = clamp(opts.initialSetpoint ?? 50, 0, 100);
    this.opOutlet = clamp(opts.initialOutletValvePct ?? 40, 0, 100);
    this.maxSamples = opts.maxHistorySamples ?? 7200;
    this.sampleInterval = opts.historyIntervalS ?? 0.5;
  }

  // ------------------------------------------------------------------ operator actions

  setMode(mode: Mode): CommandResult {
    if (mode === this.mode) return ok();
    if (mode === 'manual') {
      this.manualOutput = this.pid.output;
      this.mode = 'manual';
      return ok();
    }
    if (this.safety.estop.latched) return fail('E-stop is latched: release it and reset before using Auto');
    if (this.safety.pumpTripActive) return fail('Pump trip active: reset interlocks before using Auto');
    if (this.ioFault) return fail('Field I/O fault: Auto not available');
    if (this.levelBad) return fail('LT-101 signal is bad: Auto not available');
    if (!this.havePv) return fail('No valid process value yet: wait for the first scan');
    this.pid.trackOutput(this.manualOutput, this.setpoint, this.lastPv);
    this.mode = 'auto';
    return ok();
  }

  setSetpoint(value: number): CommandResult {
    if (!Number.isFinite(value)) return fail('Setpoint must be a number');
    this.setpoint = clamp(value, 0, 100);
    return ok();
  }

  setManualOutput(value: number): CommandResult {
    if (!Number.isFinite(value)) return fail('Output must be a number');
    if (this.mode === 'auto') return fail('Controller is in Auto: switch to Manual to set the output');
    if (this.safety.pumpTripActive) return fail('Pump trip active: output is forced to 0 %');
    this.manualOutput = clamp(value, 0, 100);
    return ok();
  }

  setTunings(t: PidTunings): CommandResult {
    try {
      this.pid.setTunings(t);
      return ok();
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Invalid tunings');
    }
  }

  setInletValveCommand(pct: number): CommandResult {
    if (!Number.isFinite(pct)) return fail('Valve position must be a number');
    this.opInlet = clamp(pct, 0, 100);
    return ok();
  }

  setOutletValveCommand(pct: number): CommandResult {
    if (!Number.isFinite(pct)) return fail('Valve position must be a number');
    this.opOutlet = clamp(pct, 0, 100);
    return ok();
  }

  setAlarmLimits(partial: Partial<AlarmLimits>): CommandResult {
    const next = { ...this.limits, ...partial };
    const err = validateLimits(next);
    if (err) return fail(err);
    this.limits = next;
    for (const d of alarmDefinitions(next)) this.alarms.setDescription(d.id, d.description);
    return ok();
  }

  pressEStop(): void {
    this.safety.pressEStop();
    this.forceManualZero();
  }

  releaseEStop(): void {
    this.safety.releaseEStop();
  }

  /** Reset is judged on a fresh field read, never on stale scan data. */
  resetInterlocks(): { ok: boolean; blockedBy: string[] } {
    let fresh: FieldInputs;
    try {
      fresh = this.io.read();
    } catch {
      return { ok: false, blockedBy: ['I/O'] };
    }
    return this.safety.reset(this.safetyInputs(fresh));
  }

  acknowledgeAlarm(id: string): boolean {
    return this.alarms.acknowledge(id, this.time);
  }

  acknowledgeAll(): number {
    return this.alarms.acknowledgeAll(this.time);
  }

  clearAlarmHistory(): void {
    this.alarms.clearHistory();
  }

  clearTrendHistory(): void {
    this.samples.length = 0;
  }

  // ------------------------------------------------------------------ scan

  scan(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) throw new RangeError(`Scan time must be > 0 (got ${String(dt)})`);
    this.time += dt;

    let inputs: FieldInputs;
    try {
      inputs = this.io.read();
    } catch {
      this.handleIoFault(dt);
      return;
    }
    this.ioFault = false;
    this.lastInputs = inputs;

    this.levelBad = inputs.levelQuality !== 'good' || !Number.isFinite(inputs.levelPct);
    if (!this.levelBad) {
      this.lastPv = inputs.levelPct;
      this.havePv = true;
    }
    const pv = this.lastPv;

    const safe = this.safety.evaluate(this.safetyInputs(inputs));
    this.lastRunPermissive = safe.runPermissive;

    // Mode rules
    if (safe.pumpTripActive) {
      this.forceManualZero();
    } else if (this.levelBad && this.mode === 'auto') {
      this.manualOutput = this.pid.output; // hold last controller output
      this.mode = 'manual';
    }

    // Controller
    if (this.mode === 'auto') {
      this.demand = this.pid.update(this.setpoint, pv, dt, { hold: !safe.runPermissive });
    } else {
      this.demand = this.manualOutput;
      if (!this.levelBad) this.pid.trackOutput(this.manualOutput, this.setpoint, pv);
    }

    // Safety overrides are applied after the controller and cannot be bypassed by it.
    this.pumpCommand = safe.pumpEnabled ? clamp(this.demand, 0, 100) : 0;
    this.io.write({
      pumpSpeedPct: this.pumpCommand,
      inletValvePct: safe.inletForceClosed ? 0 : this.opInlet,
      outletValvePct: safe.outletForceClosed ? 0 : this.opOutlet,
    });

    this.updateAlarms(inputs, dt);
    this.recordSample(inputs, dt);
  }

  // ------------------------------------------------------------------ views

  snapshot(): ControlSnapshot {
    return {
      time: this.time,
      mode: this.mode,
      setpoint: this.setpoint,
      pv: this.lastPv,
      output: this.mode === 'auto' ? this.demand : this.manualOutput,
      manualOutput: this.manualOutput,
      pumpCommand: this.pumpCommand,
      operator: { inletValveCmd: this.opInlet, outletValveCmd: this.opOutlet },
      pid: { tunings: this.pid.tunings, terms: this.pid.terms },
      inputs: this.lastInputs ? { ...this.lastInputs } : null,
      safety: {
        estop: this.safety.estop,
        interlocks: this.safety.interlocks(),
        runPermissive: this.lastRunPermissive,
        pumpTripActive: this.safety.pumpTripActive,
        config: this.safety.config,
      },
      degraded: { levelSensorBad: this.levelBad, ioFault: this.ioFault },
      alarms: this.alarms.all(),
      activeAlarmCount: this.alarms.activeCount,
      unackedCount: this.alarms.unackedCount,
      highestAlarmPriority: this.alarms.highestActivePriority,
      alarmLimits: { ...this.limits },
    };
  }

  get history(): readonly TrendSample[] {
    return this.samples;
  }

  get alarmHistory(): readonly AlarmEvent[] {
    return this.alarms.history;
  }

  // ------------------------------------------------------------------ internals

  private safetyInputs(i: FieldInputs) {
    const levelGood = i.levelQuality === 'good' && Number.isFinite(i.levelPct);
    return {
      levelPct: levelGood ? i.levelPct : Number.NaN,
      levelSwitchHH: i.levelSwitchHH,
      levelSwitchLL: i.levelSwitchLL,
      pressureBar: i.pressureBar,
      inletValveFbPct: i.inletValveFbPct,
    };
  }

  private forceManualZero(): void {
    this.mode = 'manual';
    this.manualOutput = 0;
    this.pid.reset();
  }

  private handleIoFault(dt: number): void {
    this.ioFault = true;
    this.forceManualZero();
    this.demand = 0;
    this.pumpCommand = 0;
    try {
      this.io.write({ pumpSpeedPct: 0, inletValvePct: 0, outletValvePct: this.opOutlet });
    } catch {
      // Nothing more can be done in software if the output path is also down.
    }
    this.alarms.update({ IO_FAULT: { condition: true } }, this.time, dt);
  }

  private rawLimit(id: string, value: number, limit: number, band: number, dir: 'high' | 'low'): boolean {
    const next = limitCondition(this.raw.get(id) ?? false, value, limit, band, dir);
    this.raw.set(id, next);
    return next;
  }

  private updateAlarms(i: FieldInputs, dt: number): void {
    const l = this.limits;
    const lvl = this.levelBad ? Number.NaN : i.levelPct; // suppress level alarms on bad signal; LT_FAULT shows instead
    if (this.levelBad) for (const id of ['LAHH', 'LAH', 'LAL', 'LALL']) this.raw.set(id, false);
    const inputs: Record<string, AlarmInput> = {
      LAHH: { condition: this.rawLimit('LAHH', lvl, l.levelHH, LEVEL_DEADBAND, 'high'), value: lvl },
      LAH: { condition: this.rawLimit('LAH', lvl, l.levelH, LEVEL_DEADBAND, 'high'), value: lvl },
      LAL: { condition: this.rawLimit('LAL', lvl, l.levelL, LEVEL_DEADBAND, 'low'), value: lvl },
      LALL: { condition: this.rawLimit('LALL', lvl, l.levelLL, LEVEL_DEADBAND, 'low'), value: lvl },
      PAH: { condition: this.rawLimit('PAH', i.pressureBar, l.pressureH, PRESSURE_DEADBAND, 'high'), value: i.pressureBar },
      PAHH: { condition: this.rawLimit('PAHH', i.pressureBar, l.pressureHH, PRESSURE_DEADBAND, 'high'), value: i.pressureBar },
      DEV: {
        condition: this.mode === 'auto' && !this.levelBad && Math.abs(this.setpoint - this.lastPv) > l.deviationPct,
        value: this.setpoint - this.lastPv,
      },
      PUMP_FAIL: {
        condition: this.pumpCommand >= 30 && i.pumpSpeedFbPct < this.pumpCommand * 0.5,
        value: i.pumpSpeedFbPct,
      },
      LT_FAULT: { condition: this.levelBad },
      IO_FAULT: { condition: false },
      ESTOP: { condition: this.safety.estop.latched },
    };
    for (const il of this.safety.interlocks()) inputs[il.id] = { condition: il.tripped };
    this.alarms.update(inputs, this.time, dt);
  }

  private recordSample(i: FieldInputs, dt: number): void {
    this.sinceSample += dt;
    if (this.sinceSample + 1e-9 < this.sampleInterval) return;
    this.sinceSample = 0;
    this.samples.push({
      t: this.time,
      sp: this.setpoint,
      pv: this.lastPv,
      out: this.mode === 'auto' ? this.demand : this.manualOutput,
      pressure: i.pressureBar,
      flow: i.inflowLps,
    });
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
  }
}
