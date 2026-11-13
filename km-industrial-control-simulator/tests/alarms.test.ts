import { describe, expect, it } from 'vitest';
import { AlarmManager, limitCondition, type AlarmDefinition } from '../src/core/alarms';

const defs: AlarmDefinition[] = [
  { id: 'LAH', tag: 'LT-101', description: 'Level high', priority: 'high', onDelayS: 2 },
  { id: 'PAH', tag: 'PT-101', description: 'Pressure high', priority: 'medium', onDelayS: 0 },
  { id: 'ESTOP', tag: 'ES-001', description: 'Emergency stop', priority: 'critical', onDelayS: 0 },
];

/** Drive the manager for `seconds` with a constant condition set. */
function drive(m: AlarmManager, cond: Record<string, boolean>, seconds: number, t0: number, dt = 0.1): number {
  let t = t0;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    t += dt;
    const inputs: Record<string, { condition: boolean; value?: number }> = {};
    for (const [k, v] of Object.entries(cond)) inputs[k] = { condition: v, value: 1 };
    m.update(inputs, t, dt);
  }
  return t;
}

describe('limitCondition (limit with deadband)', () => {
  it('high alarm: activates at the limit and clears only below limit - deadband', () => {
    expect(limitCondition(false, 79.9, 80, 2, 'high')).toBe(false);
    expect(limitCondition(false, 80, 80, 2, 'high')).toBe(true);
    expect(limitCondition(true, 79, 80, 2, 'high')).toBe(true); // inside deadband: stays active
    expect(limitCondition(true, 77.9, 80, 2, 'high')).toBe(false);
  });

  it('low alarm: activates at the limit and clears only above limit + deadband', () => {
    expect(limitCondition(false, 20.1, 20, 2, 'low')).toBe(false);
    expect(limitCondition(false, 20, 20, 2, 'low')).toBe(true);
    expect(limitCondition(true, 21, 20, 2, 'low')).toBe(true);
    expect(limitCondition(true, 22.1, 20, 2, 'low')).toBe(false);
  });

  it('non-finite values never activate a fresh alarm and keep an active one (caller flags bad quality)', () => {
    expect(limitCondition(false, Number.NaN, 80, 2, 'high')).toBe(false);
    expect(limitCondition(true, Number.NaN, 80, 2, 'high')).toBe(true);
  });
});

describe('AlarmManager state machine', () => {
  it('honours the on-delay: a shorter blip does not raise the alarm', () => {
    const m = new AlarmManager(defs);
    let t = drive(m, { LAH: true }, 1.5, 0);
    expect(m.get('LAH')?.state).toBe('normal');
    t = drive(m, { LAH: false }, 1, t);
    t = drive(m, { LAH: true }, 1.5, t);
    expect(m.get('LAH')?.state).toBe('normal'); // timer was reset by the gap
    drive(m, { LAH: true }, 1, t);
    expect(m.get('LAH')?.state).toBe('activeUnacked');
  });

  it('active -> acknowledge -> return to normal clears without needing a second ack', () => {
    const m = new AlarmManager(defs);
    let t = drive(m, { PAH: true }, 0.5, 0);
    expect(m.get('PAH')?.state).toBe('activeUnacked');
    expect(m.acknowledge('PAH', t)).toBe(true);
    expect(m.get('PAH')?.state).toBe('activeAcked');
    t = drive(m, { PAH: false }, 0.5, t);
    expect(m.get('PAH')?.state).toBe('normal');
  });

  it('active -> return to normal unacknowledged needs an ack to clear', () => {
    const m = new AlarmManager(defs);
    let t = drive(m, { PAH: true }, 0.5, 0);
    t = drive(m, { PAH: false }, 0.5, t);
    expect(m.get('PAH')?.state).toBe('rtnUnacked');
    m.acknowledge('PAH', t);
    expect(m.get('PAH')?.state).toBe('normal');
  });

  it('re-activates from rtnUnacked when the condition comes back', () => {
    const m = new AlarmManager(defs);
    let t = drive(m, { PAH: true }, 0.5, 0);
    t = drive(m, { PAH: false }, 0.5, t);
    drive(m, { PAH: true }, 0.5, t);
    expect(m.get('PAH')?.state).toBe('activeUnacked');
  });

  it('acknowledgeAll acknowledges every unacknowledged active alarm', () => {
    const m = new AlarmManager(defs);
    const t = drive(m, { PAH: true, ESTOP: true }, 0.5, 0);
    m.acknowledgeAll(t);
    expect(m.get('PAH')?.state).toBe('activeAcked');
    expect(m.get('ESTOP')?.state).toBe('activeAcked');
    expect(m.unackedCount).toBe(0);
  });

  it('acknowledging an unknown or normal alarm is a safe no-op', () => {
    const m = new AlarmManager(defs);
    expect(m.acknowledge('NOPE', 0)).toBe(false);
    expect(m.acknowledge('PAH', 0)).toBe(false);
  });

  it('records ACTIVE, ACK and RTN events with simulation time and value', () => {
    const m = new AlarmManager(defs);
    let t = drive(m, { PAH: true }, 0.5, 0);
    m.acknowledge('PAH', t);
    t = drive(m, { PAH: false }, 0.5, t);
    expect(m.history.map((e) => e.type)).toEqual(['ACTIVE', 'ACK', 'RTN']);
    expect(m.history[0]?.id).toBe('PAH');
    expect(m.history[0]?.value).toBe(1);
    expect(m.history[1]?.time).toBeCloseTo(0.5, 5);
  });

  it('caps history length', () => {
    const m = new AlarmManager(defs, { maxHistory: 5 });
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t = drive(m, { PAH: true }, 0.2, t);
      m.acknowledge('PAH', t);
      t = drive(m, { PAH: false }, 0.2, t);
    }
    expect(m.history.length).toBe(5);
  });

  it('counts and highest priority consider only active alarms', () => {
    const m = new AlarmManager(defs);
    drive(m, { PAH: true, ESTOP: true }, 0.5, 0);
    expect(m.activeCount).toBe(2);
    expect(m.highestActivePriority).toBe('critical');
    const empty = new AlarmManager(defs);
    expect(empty.highestActivePriority).toBeNull();
  });

  it('active() lists most severe first', () => {
    const m = new AlarmManager(defs);
    drive(m, { PAH: true, ESTOP: true }, 0.5, 0);
    expect(m.active().map((a) => a.id)).toEqual(['ESTOP', 'PAH']);
  });

  it('ignores conditions for unknown ids and treats missing inputs as inactive', () => {
    const m = new AlarmManager(defs);
    expect(() => m.update({ GHOST: { condition: true } }, 1, 0.1)).not.toThrow();
    expect(m.get('PAH')?.state).toBe('normal');
  });

  it('rejects duplicate alarm ids', () => {
    expect(() => new AlarmManager([defs[0] as AlarmDefinition, defs[0] as AlarmDefinition])).toThrow(/duplicate/i);
  });
});
