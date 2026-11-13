import { DEFAULT_ALARM_LIMITS, DEFAULT_TUNINGS, validateLimits, type AlarmLimits } from '../core/controlSystem';
import type { PidTunings } from '../core/pid';

export const SETTINGS_KEY = 'km-ics-settings-v1';
export const SPEEDS = [1, 2, 5, 10, 20] as const;

export interface PersistedSettings {
  speed: number;
  tunings: PidTunings;
  alarmLimits: AlarmLimits;
  /** LT-101 measurement noise, 1-sigma % of span. */
  noisePct: number;
}

export const DEFAULT_SETTINGS: Readonly<PersistedSettings> = Object.freeze({
  speed: 1,
  tunings: { ...DEFAULT_TUNINGS },
  alarmLimits: { ...DEFAULT_ALARM_LIMITS },
  noisePct: 0.05,
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function sanitize(raw: unknown): PersistedSettings {
  const out: PersistedSettings = {
    speed: DEFAULT_SETTINGS.speed,
    tunings: { ...DEFAULT_SETTINGS.tunings },
    alarmLimits: { ...DEFAULT_SETTINGS.alarmLimits },
    noisePct: DEFAULT_SETTINGS.noisePct,
  };
  if (!isRecord(raw)) return out;
  if ((SPEEDS as readonly unknown[]).includes(raw.speed)) out.speed = raw.speed as number;
  if (inRange(raw.noisePct, 0, 2)) out.noisePct = raw.noisePct;
  const t = raw.tunings;
  if (isRecord(t) && inRange(t.kp, 0, 1000) && inRange(t.ki, 0, 1000) && inRange(t.kd, 0, 1000)) {
    out.tunings = { kp: t.kp, ki: t.ki, kd: t.kd };
  }
  if (isRecord(raw.alarmLimits)) {
    const merged = { ...DEFAULT_ALARM_LIMITS, ...raw.alarmLimits } as AlarmLimits;
    if (validateLimits(merged) === null) out.alarmLimits = merged;
  }
  return out;
}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): PersistedSettings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return sanitize(text ? JSON.parse(text) : null);
  } catch {
    return sanitize(null);
  }
}

export function saveSettings(settings: PersistedSettings, storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Persistence is a convenience only; ignore quota / privacy-mode failures.
  }
}
