import { useState } from 'preact/hooks';
import { SPEEDS } from '../../app/settings';
import type { AlarmLimits } from '../../core/controlSystem';
import { Button, Card, NumberSlider, Segmented } from '../components';
import { useRuntime, useSnapshot } from '../hooks';
import { toast } from '../toast';

const LIMIT_FIELDS: { key: keyof AlarmLimits; label: string; unit: string; step: number }[] = [
  { key: 'levelHH', label: 'Level high-high', unit: '%', step: 1 },
  { key: 'levelH', label: 'Level high', unit: '%', step: 1 },
  { key: 'levelL', label: 'Level low', unit: '%', step: 1 },
  { key: 'levelLL', label: 'Level low-low', unit: '%', step: 1 },
  { key: 'pressureH', label: 'Pressure high', unit: 'bar', step: 0.1 },
  { key: 'pressureHH', label: 'Pressure high-high', unit: 'bar', step: 0.1 },
  { key: 'deviationPct', label: 'Deviation (Auto)', unit: '%', step: 1 },
];

function AlarmLimitsForm() {
  const rt = useRuntime();
  const snap = useSnapshot();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const current = snap.control.alarmLimits;

  const apply = (e: Event) => {
    e.preventDefault();
    const next: Partial<AlarmLimits> = {};
    for (const f of LIMIT_FIELDS) {
      const raw = draft[f.key];
      if (raw === undefined || raw.trim() === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        setError(`${f.label}: "${raw}" is not a number`);
        return;
      }
      next[f.key] = n;
    }
    const r = rt.act((c) => c.setAlarmLimits(next));
    if (!r.ok) {
      setError(r.reason ?? 'Invalid limits');
      return;
    }
    setError(null);
    setDraft({});
    rt.updateSettings({ alarmLimits: rt.control.snapshot().alarmLimits });
    toast('Alarm limits applied');
  };

  return (
    <form onSubmit={apply} class="limits-form" noValidate>
      <div class="limits-grid">
        {LIMIT_FIELDS.map((f) => (
          <label class="limit">
            <span>{f.label}</span>
            <span class="field-input">
              <input
                type="text"
                inputMode="decimal"
                value={draft[f.key] ?? String(current[f.key])}
                onInput={(e) => setDraft({ ...draft, [f.key]: e.currentTarget.value })}
                aria-label={`${f.label} (${f.unit})`}
              />
              <span class="unit">{f.unit}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="row-actions">
        <Button type="submit" tone="primary">Apply limits</Button>
        <Button onClick={() => { setDraft({}); setError(null); }}>Discard changes</Button>
      </div>
    </form>
  );
}

export function Settings() {
  const rt = useRuntime();
  const snap = useSnapshot();
  const cfg = snap.control.safety.config;

  return (
    <div class="grid settings">
      <Card title="Simulation">
        <div class="field">
          <span class="field-label">Speed</span>
          <Segmented label="Simulation speed" value={rt.speed} options={SPEEDS.map((s) => ({ value: s as number, label: `${s}x` }))} onChange={(v) => rt.setSpeed(v)} />
          <p class="hint">Runs the same 0.1 s scan at a higher rate; results do not change with speed.</p>
        </div>
        <div class="row-actions">
          <Button onClick={() => rt.setPaused(!rt.paused)} aria-pressed={rt.paused}>{rt.paused ? 'Resume simulation' : 'Pause simulation'}</Button>
          <Button onClick={() => { rt.resetSimulation(); toast('Simulation restarted'); }}>Restart simulation</Button>
        </div>
        <NumberSlider id="noise" label="LT-101 measurement noise" value={rt.settings.noisePct} min={0} max={2} step={0.01} digits={2} unit="%" hint="1-sigma noise on the level signal. Higher values make derivative action noisier." onCommit={(v) => rt.updateSettings({ noisePct: v })} />
      </Card>

      <Card title="Alarm limits">
        <AlarmLimitsForm />
      </Card>

      <Card title="Fault injection (simulation only)">
        <p class="muted small">These faults exist only inside the software plant model. They let you see how alarms, interlocks and the controller react.</p>
        <div class="field">
          <span class="field-label">LT-101 level transmitter</span>
          <Segmented
            label="LT-101 fault"
            value={snap.faults.levelSensor}
            options={[
              { value: 'none', label: 'Healthy' },
              { value: 'high', label: 'Fails high' },
              { value: 'low', label: 'Fails low' },
            ]}
            onChange={(v) => rt.act(() => rt.simulation.setFaults({ levelSensor: v }))}
          />
        </div>
        <div class="field">
          <span class="field-label">Pump P-101</span>
          <Button onClick={() => rt.act(() => rt.simulation.setFaults({ pumpFailure: !snap.faults.pumpFailure }))} aria-pressed={snap.faults.pumpFailure}>
            {snap.faults.pumpFailure ? 'Clear pump failure' : 'Fail the pump'}
          </Button>
        </div>
      </Card>

      <Card title="Safety setpoints (fixed)">
        <p class="muted small">Trip points are part of the safety logic and cannot be changed at runtime.</p>
        <dl class="kvs">
          <div class="kv"><dt>IL-01 LSHH switch</dt><dd>95 % true level: trip pump, close inlet</dd></div>
          <div class="kv"><dt>IL-01 reset below</dt><dd>{cfg.levelHighResetPct} %</dd></div>
          <div class="kv"><dt>IL-02 LSLL switch</dt><dd>5 % true level: close outlet</dd></div>
          <div class="kv"><dt>IL-02 reset above</dt><dd>{cfg.levelLowResetPct} %</dd></div>
          <div class="kv"><dt>IL-03 pressure trip</dt><dd>{cfg.pressureTripBar} bar (reset below {cfg.pressureTripBar - cfg.pressureResetHysteresisBar} bar)</dd></div>
          <div class="kv"><dt>P-01 inlet valve permissive</dt><dd>at least {cfg.inletPermissivePct} % open</dd></div>
        </dl>
      </Card>

      <Card title="Data and about" class="settings-about">
        <div class="row-actions">
          <Button tone="danger" onClick={() => { rt.restoreDefaults(); toast('Defaults restored and simulation restarted'); }}>Restore defaults</Button>
        </div>
        <p class="muted small">
          K.M. Industrial Control Simulator is a training tool. It simulates a tank level loop in software only. There is no connection to real equipment and it must not be used to make safety decisions.
        </p>
      </Card>
    </div>
  );
}
