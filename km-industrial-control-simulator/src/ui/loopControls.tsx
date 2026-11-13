import type { SimulationSnapshot } from '../core/simulation';
import { Segmented, NumberSlider } from './components';
import { useRuntime } from './hooks';
import { toast } from './toast';

export function ModeControl({ snap }: { snap: SimulationSnapshot }) {
  const rt = useRuntime();
  const mode = snap.control.mode;
  return (
    <Segmented
      label="Controller mode"
      value={mode}
      options={[
        { value: 'manual', label: 'Manual' },
        { value: 'auto', label: 'Auto' },
      ]}
      onChange={(m) => {
        const r = rt.act((c) => c.setMode(m));
        if (!r.ok) toast(r.reason ?? 'Mode change rejected', 'error');
      }}
    />
  );
}

export function SetpointControl({ snap, idPrefix }: { snap: SimulationSnapshot; idPrefix: string }) {
  const rt = useRuntime();
  return (
    <NumberSlider
      id={`${idPrefix}-sp`}
      label="Setpoint"
      value={snap.control.setpoint}
      min={0}
      max={100}
      step={0.5}
      unit="%"
      hint="Above 90 % the high alarms and the 95 % trip will act."
      onCommit={(v) => rt.act((c) => c.setSetpoint(v))}
    />
  );
}

export function ManualOutputControl({ snap, idPrefix }: { snap: SimulationSnapshot; idPrefix: string }) {
  const rt = useRuntime();
  const auto = snap.control.mode === 'auto';
  const tripped = snap.control.safety.pumpTripActive;
  return (
    <NumberSlider
      id={`${idPrefix}-out`}
      label={auto ? 'Output (controller)' : 'Output (manual)'}
      value={snap.control.output}
      min={0}
      max={100}
      step={1}
      unit="%"
      digits={1}
      disabled={auto || tripped}
      hint={auto ? 'Controller is in Auto. Switch to Manual to drive the pump yourself.' : tripped ? 'Pump trip active: output forced to 0 %.' : undefined}
      onCommit={(v) => rt.act((c) => c.setManualOutput(v))}
    />
  );
}
