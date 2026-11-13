import { useState } from 'preact/hooks';
import { toCsv } from '../../app/trendData';
import { Button, Card, Segmented } from '../components';
import { useRuntime, useSnapshot } from '../hooks';
import { FLOW_SERIES, LOOP_SERIES, PRESSURE_SERIES } from '../series';
import { toast } from '../toast';
import { TrendChart } from '../TrendChart';

const WINDOWS = [
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 900, label: '15 min' },
  { value: 3600, label: '1 h' },
] as const;

export function Trends() {
  const rt = useRuntime();
  const snap = useSnapshot();
  const [windowS, setWindowS] = useState<number>(300);
  const [frozenEnd, setFrozenEnd] = useState<number | null>(null);
  const [vis, setVis] = useState<Record<string, boolean>>({ pv: true, sp: true, out: true });
  const lim = snap.control.alarmLimits;

  const exportCsv = () => {
    const samples = rt.control.history;
    if (samples.length === 0) {
      toast('Nothing to export yet', 'error');
      return;
    }
    const url = URL.createObjectURL(new Blob([toCsv(samples)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `km-ics-trend-${Math.round(snap.control.time)}s.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${samples.length} samples`);
  };

  return (
    <div class="stack">
      <Card
        title="Process value, setpoint and output"
        aside={
          <div class="toolbar">
            <Segmented label="Time window" value={windowS} options={WINDOWS} onChange={setWindowS} />
            <Button onClick={() => setFrozenEnd(frozenEnd === null ? snap.control.time : null)} aria-pressed={frozenEnd !== null}>
              {frozenEnd === null ? 'Freeze' : 'Resume live'}
            </Button>
            <Button onClick={exportCsv}>Export CSV</Button>
          </div>
        }
      >
        <div class="pens" role="group" aria-label="Visible pens">
          {LOOP_SERIES.map((s) => (
            <label class="pen">
              <input type="checkbox" checked={vis[s.key] !== false} onChange={(e) => setVis({ ...vis, [s.key]: e.currentTarget.checked })} />
              <i class={`sw ${s.key}`} />
              {s.label}
            </label>
          ))}
        </div>
        <TrendChart
          series={LOOP_SERIES}
          visible={vis}
          windowS={windowS}
          frozenEnd={frozenEnd}
          yMin={0}
          yMax={100}
          yTicks={10}
          unit="%"
          height={320}
          refLines={[
            { value: lim.levelHH, label: 'HH', color: '#c8102e' },
            { value: lim.levelH, label: 'H', color: '#7d858c' },
            { value: lim.levelL, label: 'L', color: '#7d858c' },
            { value: lim.levelLL, label: 'LL', color: '#c8102e' },
          ]}
          label="Process value, setpoint and output with alarm limits"
        />
        {frozenEnd !== null && <p class="muted small">Display frozen at t = {frozenEnd.toFixed(0)} s. The simulation keeps running.</p>}
      </Card>
      <div class="grid two">
        <Card title="Discharge pressure PT-101">
          <TrendChart
            series={PRESSURE_SERIES}
            windowS={windowS}
            frozenEnd={frozenEnd}
            yMin={0}
            yMax={7}
            yTicks={7}
            yDigits={0}
            unit="bar"
            height={200}
            refLines={[
              { value: lim.pressureH, label: 'H', color: '#7d858c' },
              { value: snap.control.safety.config.pressureTripBar, label: 'Trip', color: '#c8102e' },
            ]}
            label="Pump discharge pressure with alarm and trip limits"
          />
        </Card>
        <Card title="Inlet flow FT-101">
          <TrendChart series={FLOW_SERIES} windowS={windowS} frozenEnd={frozenEnd} yMin={0} yMax={10} yTicks={5} unit="L/s" height={200} label="Inlet flow" />
        </Card>
      </div>
    </div>
  );
}
