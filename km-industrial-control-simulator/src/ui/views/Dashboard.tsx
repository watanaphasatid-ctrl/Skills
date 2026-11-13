import { useState } from 'preact/hooks';
import { Card, Readout, StatusPill } from '../components';
import { EquipmentCard } from '../EquipmentCard';
import { fmt } from '../format';
import { useRuntime, useSnapshot } from '../hooks';
import { ManualOutputControl, ModeControl, SetpointControl } from '../loopControls';
import { Scene3D } from '../Scene3D';
import { LOOP_SERIES } from '../series';
import type { EquipmentId } from '../three/PlantScene';
import { TrendChart } from '../TrendChart';

export function Dashboard() {
  const rt = useRuntime();
  const snap = useSnapshot();
  const c = snap.control;
  const [selected, setSelected] = useState<EquipmentId | null>(null);
  const activeAlarms = c.alarms.filter((a) => a.state !== 'normal').sort((a, b) => ['critical', 'high', 'medium', 'low'].indexOf(a.priority) - ['critical', 'high', 'medium', 'low'].indexOf(b.priority));
  const deviation = c.setpoint - c.pv;

  return (
    <div class="grid dash">
      <div class="dash-scene">
        <Scene3D selected={selected} onSelect={setSelected} />
      </div>

      <Card title="Level loop LIC-101" class="dash-loop" aside={<StatusPill tone={c.mode === 'auto' ? 'ok' : 'idle'}>{c.mode === 'auto' ? 'Auto' : 'Manual'}</StatusPill>}>
        <div class="readouts">
          <Readout tag="LT 101" label="Process value" value={fmt(c.pv)} unit="%" tone={c.degraded.levelSensorBad ? 'alarm' : 'normal'} />
          <Readout tag="LIC 101" label="Setpoint" value={fmt(c.setpoint)} unit="%" tone="setpoint" />
          <Readout tag="LY 101" label="Output" value={fmt(c.output)} unit="%" />
        </div>
        <p class="muted small">
          Error {fmt(deviation)} % · Pump {fmt(snap.plant.pumpSpeedPct, 0)} % · Level true {fmt(snap.plant.levelPct)} %
        </p>
        <ModeControl snap={snap} />
        <SetpointControl snap={snap} idPrefix="dash" />
        <ManualOutputControl snap={snap} idPrefix="dash" />
      </Card>

      <Card title="Last 2 minutes" class="dash-trend">
        <TrendChart series={LOOP_SERIES} windowS={120} yMin={0} yMax={100} yTicks={4} unit="%" height={190} label="Process value, setpoint and output over the last two minutes" />
        <ul class="legend">
          <li><i class="sw pv" />PV</li>
          <li><i class="sw sp" />Setpoint</li>
          <li><i class="sw out" />Output</li>
        </ul>
      </Card>

      <div class="dash-side">
        <EquipmentCard id={selected} snap={snap} />
        <Card
          title="Active alarms"
          aside={
            <a class="link" href="#/alarms">
              Open alarm list
            </a>
          }
        >
          {activeAlarms.length === 0 ? (
            <p class="muted">No active alarms.</p>
          ) : (
            <ul class="mini-alarms">
              {activeAlarms.slice(0, 4).map((a) => (
                <li class={`prio-${a.priority}`}>
                  <span class="prio-tag">{a.priority}</span>
                  <span>
                    <b>{a.tag}</b> {a.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {c.unackedCount > 0 && (
            <button type="button" class="btn btn-default" onClick={() => rt.act((x) => x.acknowledgeAll())}>
              Acknowledge all
            </button>
          )}
        </Card>
      </div>
    </div>
  );
}
