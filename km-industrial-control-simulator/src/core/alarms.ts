/**
 * Alarm management modelled on the ISA-18.2 alarm state machine (simplified: no shelving/suppression).
 *
 *   normal --cond (after on-delay)--> activeUnacked --ack--> activeAcked --RTN--> normal
 *   activeUnacked --RTN--> rtnUnacked --ack--> normal       rtnUnacked --cond--> activeUnacked
 *
 * Pure logic, driven by update(inputs, simTime, dt) once per scan.
 */

export type AlarmPriority = 'critical' | 'high' | 'medium' | 'low';
export type AlarmState = 'normal' | 'activeUnacked' | 'activeAcked' | 'rtnUnacked';
export type AlarmEventType = 'ACTIVE' | 'ACK' | 'RTN';

export interface AlarmDefinition {
  id: string;
  tag: string;
  description: string;
  priority: AlarmPriority;
  /** Condition must persist this long (s) before the alarm is raised (chatter protection). */
  onDelayS: number;
}

export interface AlarmInput {
  condition: boolean;
  value?: number;
}

export interface AlarmRecord {
  id: string;
  tag: string;
  description: string;
  priority: AlarmPriority;
  state: AlarmState;
  /** Simulation time the alarm last became active. */
  activeSince: number | null;
  value: number | null;
}

export interface AlarmEvent {
  time: number;
  id: string;
  tag: string;
  description: string;
  priority: AlarmPriority;
  type: AlarmEventType;
  value: number | null;
}

const PRIORITY_RANK: Record<AlarmPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Limit comparison with hysteresis (deadband) so a value hovering at the limit cannot chatter.
 * A non-finite value does not raise an alarm and does not clear an active one.
 */
export function limitCondition(
  wasActive: boolean,
  value: number,
  limit: number,
  deadband: number,
  direction: 'high' | 'low',
): boolean {
  if (!Number.isFinite(value)) return wasActive;
  if (direction === 'high') return wasActive ? value > limit - deadband : value >= limit;
  return wasActive ? value < limit + deadband : value <= limit;
}

interface Internal extends AlarmRecord {
  timer: number;
  onDelayS: number;
}

export class AlarmManager {
  private readonly alarms = new Map<string, Internal>();
  private readonly events: AlarmEvent[] = [];
  private readonly maxHistory: number;

  constructor(definitions: AlarmDefinition[], opts: { maxHistory?: number } = {}) {
    this.maxHistory = opts.maxHistory ?? 500;
    for (const d of definitions) {
      if (this.alarms.has(d.id)) throw new Error(`Duplicate alarm id: ${d.id}`);
      this.alarms.set(d.id, { ...d, state: 'normal', activeSince: null, value: null, timer: 0 });
    }
  }

  update(inputs: Record<string, AlarmInput | undefined>, time: number, dt: number): void {
    for (const a of this.alarms.values()) {
      const input = inputs[a.id];
      const cond = input?.condition ?? false;
      if (input?.value !== undefined && Number.isFinite(input.value)) a.value = input.value;

      if (cond) {
        a.timer += dt;
        if ((a.state === 'normal' || a.state === 'rtnUnacked') && a.timer >= a.onDelayS) {
          a.state = 'activeUnacked';
          a.activeSince = time;
          this.log(a, 'ACTIVE', time);
        }
      } else {
        a.timer = 0;
        if (a.state === 'activeUnacked') {
          a.state = 'rtnUnacked';
          this.log(a, 'RTN', time);
        } else if (a.state === 'activeAcked') {
          a.state = 'normal';
          this.log(a, 'RTN', time);
        }
      }
    }
  }

  /** @returns true if the alarm exists and needed acknowledgement. */
  acknowledge(id: string, time: number): boolean {
    const a = this.alarms.get(id);
    if (!a) return false;
    if (a.state === 'activeUnacked') {
      a.state = 'activeAcked';
    } else if (a.state === 'rtnUnacked') {
      a.state = 'normal';
    } else {
      return false;
    }
    this.log(a, 'ACK', time);
    return true;
  }

  acknowledgeAll(time: number): number {
    let n = 0;
    for (const id of this.alarms.keys()) if (this.acknowledge(id, time)) n++;
    return n;
  }

  setDescription(id: string, description: string): void {
    const a = this.alarms.get(id);
    if (a) a.description = description;
  }

  get(id: string): AlarmRecord | undefined {
    const a = this.alarms.get(id);
    return a ? this.toRecord(a) : undefined;
  }

  all(): AlarmRecord[] {
    return [...this.alarms.values()].map((a) => this.toRecord(a));
  }

  /** Active and return-to-normal-unacknowledged alarms, most severe first, then oldest first. */
  active(): AlarmRecord[] {
    return this.all()
      .filter((a) => a.state !== 'normal')
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.activeSince ?? 0) - (b.activeSince ?? 0));
  }

  /** Number of alarms whose condition is currently active (acknowledged or not). */
  get activeCount(): number {
    let n = 0;
    for (const a of this.alarms.values()) if (a.state === 'activeUnacked' || a.state === 'activeAcked') n++;
    return n;
  }

  get unackedCount(): number {
    let n = 0;
    for (const a of this.alarms.values()) if (a.state === 'activeUnacked' || a.state === 'rtnUnacked') n++;
    return n;
  }

  get highestActivePriority(): AlarmPriority | null {
    let best: AlarmPriority | null = null;
    for (const a of this.alarms.values()) {
      if (a.state !== 'activeUnacked' && a.state !== 'activeAcked') continue;
      if (best === null || PRIORITY_RANK[a.priority] < PRIORITY_RANK[best]) best = a.priority;
    }
    return best;
  }

  /** Chronological (oldest first). */
  get history(): readonly AlarmEvent[] {
    return this.events;
  }

  clearHistory(): void {
    this.events.length = 0;
  }

  private toRecord(a: Internal): AlarmRecord {
    return {
      id: a.id,
      tag: a.tag,
      description: a.description,
      priority: a.priority,
      state: a.state,
      activeSince: a.activeSince,
      value: a.value,
    };
  }

  private log(a: Internal, type: AlarmEventType, time: number): void {
    this.events.push({ time, id: a.id, tag: a.tag, description: a.description, priority: a.priority, type, value: a.value });
    if (this.events.length > this.maxHistory) this.events.splice(0, this.events.length - this.maxHistory);
  }
}
