import type { SimulationSnapshot } from '../core/simulation';
import { DEFAULT_PLANT_PARAMS } from '../core/plant';
import { Button, Card, NumberSlider, StatusPill } from './components';
import { fmt } from './format';
import { useRuntime } from './hooks';
import type { EquipmentId } from './three/PlantScene';

const TANK_LITRES_PER_PCT = (Math.PI * (DEFAULT_PLANT_PARAMS.tankDiameterM / 2) ** 2 * DEFAULT_PLANT_PARAMS.tankHeightM * 1000) / 100;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div class="kv">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

export function EquipmentCard({ id, snap }: { id: EquipmentId | null; snap: SimulationSnapshot }) {
  const rt = useRuntime();
  const c = snap.control;
  const p = snap.plant;
  const i = c.inputs;
  const il = (n: string) => c.safety.interlocks.find((x) => x.id === n);

  if (!id) {
    return (
      <Card title="Equipment">
        <p class="muted">Click the tank, pump, a valve or an instrument in the 3D view to see its status here.</p>
      </Card>
    );
  }

  let title = '';
  let body = null;
  switch (id) {
    case 'tank':
      title = 'T-101 Process tank';
      body = (
        <dl class="kvs">
          <Row k="True level" v={`${fmt(p.levelPct)} %`} />
          <Row k="Volume" v={`${fmt(p.levelPct * TANK_LITRES_PER_PCT, 0)} L of ${fmt(100 * TANK_LITRES_PER_PCT, 0)} L`} />
          <Row k="Inflow / outflow" v={`${fmt(p.inflowLps)} / ${fmt(p.outflowLps)} L/s`} />
        </dl>
      );
      break;
    case 'pump': {
      const state = c.safety.pumpTripActive ? 'Tripped' : !c.safety.runPermissive ? 'Inhibited (inlet valve not open)' : p.pumpSpeedPct > 2 ? 'Running' : 'Stopped';
      title = 'P-101 Fill pump';
      body = (
        <dl class="kvs">
          <Row k="State" v={state} />
          <Row k="Speed feedback" v={`${fmt(p.pumpSpeedPct)} %`} />
          <Row k="Command" v={`${fmt(c.pumpCommand)} %`} />
          <Row k="Run permissive" v={c.safety.runPermissive ? 'OK' : 'Not met'} />
        </dl>
      );
      break;
    }
    case 'inletValve':
      title = 'XV-101 Inlet valve';
      body = (
        <>
          <dl class="kvs">
            <Row k="Position" v={`${fmt(p.inletValvePct, 0)} %`} />
            <Row k="Operator command" v={`${fmt(c.operator.inletValveCmd, 0)} %`} />
            <Row k="Forced closed by interlock" v={c.safety.estop.latched || il('IL-01')?.tripped ? 'Yes' : 'No'} />
          </dl>
          <Button onClick={() => rt.act((x) => x.setInletValveCommand(c.operator.inletValveCmd > 50 ? 0 : 100))}>{c.operator.inletValveCmd > 50 ? 'Close valve' : 'Open valve'}</Button>
        </>
      );
      break;
    case 'outletValve':
      title = 'HV-102 Outlet valve (process demand)';
      body = (
        <>
          <dl class="kvs">
            <Row k="Position" v={`${fmt(p.outletValvePct, 0)} %`} />
            <Row k="Forced closed by IL-02" v={il('IL-02')?.tripped ? 'Yes' : 'No'} />
          </dl>
          <NumberSlider id="eq-outlet" label="Demand" value={c.operator.outletValveCmd} min={0} max={100} step={1} unit="%" digits={0} onCommit={(v) => rt.act((x) => x.setOutletValveCommand(v))} />
        </>
      );
      break;
    case 'lt':
      title = 'LT-101 Level transmitter';
      body = (
        <dl class="kvs">
          <Row k="Reading" v={`${fmt(i?.levelPct)} %`} />
          <Row k="Signal quality" v={c.degraded.levelSensorBad ? 'BAD' : 'Good'} />
          <Row k="Range" v="0 to 100 %" />
        </dl>
      );
      break;
    case 'ft':
      title = 'FT-101 Inlet flow';
      body = (
        <dl class="kvs">
          <Row k="Flow" v={`${fmt(i?.inflowLps, 2)} L/s`} />
          <Row k="Range" v={`0 to ${DEFAULT_PLANT_PARAMS.pumpMaxFlowLps} L/s`} />
        </dl>
      );
      break;
    case 'pt':
      title = 'PT-101 Discharge pressure';
      body = (
        <dl class="kvs">
          <Row k="Pressure" v={`${fmt(i?.pressureBar, 2)} bar`} />
          <Row k="High alarm / trip" v={`${c.alarmLimits.pressureH} / ${c.safety.config.pressureTripBar} bar`} />
        </dl>
      );
      break;
    case 'lshh':
    case 'lsll': {
      const hh = id === 'lshh';
      const trip = il(hh ? 'IL-01' : 'IL-02');
      title = hh ? 'LSHH-101 High-high level switch' : 'LSLL-101 Low-low level switch';
      body = (
        <dl class="kvs">
          <Row k="Switch" v={(hh ? i?.levelSwitchHH : i?.levelSwitchLL) ? 'Made (trip condition)' : 'Normal'} />
          <Row k="Interlock" v={`${trip?.id} ${trip?.tripped ? 'TRIPPED' : 'ready'}`} />
          <Row k="Action" v={trip?.action ?? ''} />
          <Row k="Independent of LT-101" v="Yes (hardwired)" />
        </dl>
      );
      break;
    }
    case 'estop':
      title = 'ES-001 Emergency stop';
      body = (
        <dl class="kvs">
          <Row k="Button" v={c.safety.estop.pressed ? 'Pressed' : 'Released'} />
          <Row k="Latched" v={c.safety.estop.latched ? 'Yes: reset required' : 'No'} />
        </dl>
      );
      break;
  }
  return (
    <Card title={title} aside={id === 'pump' && c.safety.pumpTripActive ? <StatusPill tone="alarm">Trip</StatusPill> : undefined}>
      {body}
    </Card>
  );
}
