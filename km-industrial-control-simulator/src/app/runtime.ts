/**
 * Runtime: owns the Simulation and drives it from requestAnimationFrame with a fixed-step
 * accumulator. UI components never touch the Simulation directly except through this class.
 */
import { SCAN_TIME_S, Simulation, type SimulationSnapshot } from '../core/simulation';
import type { ControlSystem } from '../core/controlSystem';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SPEEDS, type PersistedSettings } from './settings';
import { stepsForFrame } from './stepper';

const MAX_STEPS_PER_FRAME = 400;
const PUBLISH_INTERVAL_MS = 100;

type Listener = () => void;
type FrameListener = (realDtS: number) => void;

export class Runtime {
  private sim: Simulation;
  private settingsState: PersistedSettings;
  private readonly listeners = new Set<Listener>();
  private readonly frameListeners = new Set<FrameListener>();
  private snap: SimulationSnapshot;
  private raf = 0;
  private lastTs = 0;
  private lastPublish = 0;
  private acc = 0;
  private dirty = true;
  private pausedState = false;
  private errorState: string | null = null;

  constructor(initial: PersistedSettings = loadSettings()) {
    this.settingsState = initial;
    this.sim = this.createSimulation();
    this.snap = this.sim.snapshot();
  }

  private createSimulation(): Simulation {
    const s = this.settingsState;
    return new Simulation({
      initialLevelPct: 30,
      io: { levelNoisePct: s.noisePct },
      control: { tunings: s.tunings, alarmLimits: s.alarmLimits },
    });
  }

  // ----- accessors
  get simulation(): Simulation {
    return this.sim;
  }
  get control(): ControlSystem {
    return this.sim.control;
  }
  get settings(): PersistedSettings {
    return this.settingsState;
  }
  get speed(): number {
    return this.settingsState.speed;
  }
  get paused(): boolean {
    return this.pausedState;
  }
  get error(): string | null {
    return this.errorState;
  }
  getSnapshot(): SimulationSnapshot {
    return this.snap;
  }

  // ----- lifecycle
  start(): void {
    if (this.raf) return;
    this.lastTs = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly frame = (ts: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const realDt = this.lastTs ? (ts - this.lastTs) / 1000 : 0;
    this.lastTs = ts;

    if (!this.pausedState && !this.errorState) {
      const r = stepsForFrame(this.acc, realDt, this.settingsState.speed, SCAN_TIME_S, MAX_STEPS_PER_FRAME);
      this.acc = r.accumulator;
      try {
        for (let i = 0; i < r.steps; i++) this.sim.tick(SCAN_TIME_S);
      } catch (e) {
        // A thrown error means a logic bug: stop the process and say so instead of failing silently.
        this.errorState = e instanceof Error ? e.message : String(e);
        this.dirty = true;
      }
      if (r.steps > 0) this.dirty = true;
    }
    for (const f of this.frameListeners) f(realDt);
    if (this.dirty && ts - this.lastPublish >= PUBLISH_INTERVAL_MS) this.publish();
  };

  private publish(): void {
    this.snap = this.sim.snapshot();
    this.dirty = false;
    this.lastPublish = performance.now();
    for (const l of this.listeners) l();
  }

  // ----- subscriptions
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onFrame(f: FrameListener): () => void {
    this.frameListeners.add(f);
    return () => this.frameListeners.delete(f);
  }

  // ----- commands (publish immediately so the UI reflects the operator action)
  act<T>(fn: (control: ControlSystem) => T): T {
    const r = fn(this.sim.control);
    this.publish();
    return r;
  }

  setPaused(p: boolean): void {
    this.pausedState = p;
    this.publish();
  }

  setSpeed(speed: number): void {
    if (!(SPEEDS as readonly number[]).includes(speed)) return;
    this.updateSettings({ speed });
  }

  updateSettings(partial: Partial<PersistedSettings>): void {
    this.settingsState = { ...this.settingsState, ...partial };
    saveSettings(this.settingsState);
    if (partial.noisePct !== undefined) this.sim.io.setLevelNoise(partial.noisePct);
    this.publish();
  }

  /** Persist tunings entered on the Control page. */
  rememberTunings(): void {
    this.settingsState = { ...this.settingsState, tunings: this.sim.control.snapshot().pid.tunings };
    saveSettings(this.settingsState);
  }

  /** Restart the process from the initial state (keeps saved tunings, limits, speed, noise). */
  resetSimulation(): void {
    this.sim = this.createSimulation();
    this.acc = 0;
    this.errorState = null;
    this.publish();
  }

  restoreDefaults(): void {
    this.settingsState = {
      speed: DEFAULT_SETTINGS.speed,
      tunings: { ...DEFAULT_SETTINGS.tunings },
      alarmLimits: { ...DEFAULT_SETTINGS.alarmLimits },
      noisePct: DEFAULT_SETTINGS.noisePct,
    };
    saveSettings(this.settingsState);
    this.resetSimulation();
  }
}
