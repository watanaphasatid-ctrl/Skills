import { Button, Card, NumberSlider, Readout, StatusPill } from '../components';
import { fmt } from '../format';
import { useRuntime, useSnapshot } from '../hooks';
import { ManualOutputControl, ModeControl, SetpointControl } from '../loopControls';
import { LOOP_SERIES } from '../series';
import { toast } from '../toast';
import { TrendChart } from '../TrendChart';

const PRESETS = [
  { name: 'Gentle', kp: 2, ki: 0.03, kd: 0 },
  { name: 'Default', kp: 6, ki: 0.1, kd: 0 },
  { name: 'Aggressive', kp: 20, ki: 0.8, kd: 0 },
] as const;

function TermBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(-100, Math.min(100, value));
  return (
    <div class="termbar">
      <span class="termbar-label">{label}</span>
      <span class="termbar-track" aria-hidden="true">
        <span class="termbar-fill" style={{ left: pct >= 0 ? '50%' : `${50 + pct / 2}%`, width: `${Math.abs(pct) / 2}%` }} />
      </span>
      <span class="termbar-value num">{fmt(value)}</span>
    </div>
  );
}

export function Control() {
  const rt = useRuntime();
  const snap = useSnapshot();
  const c = snap.control;
  const t = c.pid.tunings;
  const auto = c.mode === 'auto';

  const setTuning = (key: 'kp' | 'ki' | 'kd', v: number) => {
    const r = rt.act((x) => x.setTunings({ ...x.snapshot().pid.tunings, [key]: v }));
    if (r.ok) rt.rememberTunings();
    return r;
  };
  const applyPreset = (p: (typeof PRESETS)[number]) => {
    const r = rt.act((x) => x.setTunings({ kp: p.kp, ki: p.ki, kd: p.kd }));
    if (r.ok) {
      rt.rememberTunings();
      toast(`${p.name} tuning applied`);
    }
  };

  return (
    <div class="grid control">
      <Card title="Loop LIC-101" aside={<StatusPill tone={auto ? 'ok' : 'idle'}>{auto ? 'Auto' : 'Manual'}</StatusPill>} class="ctl-loop">
        <div class="readouts">
          <Readout tag="LT 101" label="Process value" value={fmt(c.pv)} unit="%" />
          <Readout tag="LIC 101" label="Setpoint" value={fmt(c.setpoint)} unit="%" tone="setpoint" />
          <Readout tag="LY 101" label="Output" value={fmt(c.output)} unit="%" />
        </div>
        <ModeControl snap={snap} />
        <SetpointControl snap={snap} idPrefix="ctl" />
        <ManualOutputControl snap={snap} idPrefix="ctl" />
      </Card>

      <Card
        title="PID tuning"
        class="ctl-pid"
        aside={
          <div class="presets" role="group" aria-label="Tuning presets">
            {PRESETS.map((p) => (
              <Button class="btn-sm" onClick={() => applyPreset(p)}>
                {p.name}
              </Button>
            ))}
          </div>
        }
      >
        <NumberSlider id="kp" label="Kp (proportional gain)" value={t.kp} min={0} max={1000} sliderMax={30} step={0.1} digits={2} hint="Output % per % of error." onCommit={(v) => setTuning('kp', v)} />
        <NumberSlider id="ki" label="Ki (integral gain)" value={t.ki} min={0} max={1000} sliderMax={1.5} step={0.01} digits={3} unit="1/s" hint="Integral time Ti = Kp / Ki." onCommit={(v) => setTuning('ki', v)} />
        <NumberSlider id="kd" label="Kd (derivative gain)" value={t.kd} min={0} max={1000} sliderMax={60} step={0.5} digits={2} unit="s" hint="Acts on the measurement (no setpoint kick), 1 s filter." onCommit={(v) => setTuning('kd', v)} />
        {auto ? (
          <div class="terms" aria-label="PID term contributions">
            <TermBar label="P" value={c.pid.terms.p} />
            <TermBar label="I" value={c.pid.terms.i} />
            <TermBar label="D" value={c.pid.terms.d} />
          </div>
        ) : (
          <p class="terms terms-idle muted small">In Manual the controller only tracks your output so the switch to Auto is bumpless. The P, I and D terms are shown in Auto.</p>
        )}
        <p class="muted small">Ti = {t.ki > 0 ? `${fmt(t.kp / t.ki, 0)} s` : 'off (no integral action)'}. Output is clamped to 0 to 100 % with anti-windup.</p>
      </Card>

      <Card title="Actuators" class="ctl-act">
        <dl class="kvs">
          <div class="kv"><dt>Pump P-101</dt><dd>{fmt(snap.plant.pumpSpeedPct, 0)} % (cmd {fmt(c.pumpCommand, 0)} %)</dd></div>
          <div class="kv"><dt>Inlet valve XV-101</dt><dd>{fmt(snap.plant.inletValvePct, 0)} %</dd></div>
          <div class="kv"><dt>Outlet valve HV-102</dt><dd>{fmt(snap.plant.outletValvePct, 0)} %</dd></div>
        </dl>
        <div class="row-actions">
          <Button onClick={() => rt.act((x) => x.setInletValveCommand(c.operator.inletValveCmd > 50 ? 0 : 100))}>{c.operator.inletValveCmd > 50 ? 'Close inlet valve' : 'Open inlet valve'}</Button>
        </div>
        <NumberSlider id="ctl-outlet" label="Outlet valve demand (process load)" value={c.operator.outletValveCmd} min={0} max={100} step={1} unit="%" digits={0} hint="Open it further to disturb the loop and watch the controller recover." onCommit={(v) => rt.act((x) => x.setOutletValveCommand(v))} />
      </Card>

      <Card title="Safety and interlocks" class="ctl-safety" aside={<StatusPill tone={c.safety.pumpTripActive ? 'alarm' : 'ok'}>{c.safety.pumpTripActive ? 'Pump tripped' : 'Healthy'}</StatusPill>}>
        <ul class="status-list">
          <li>
            <span>ES-001 Emergency stop</span>
            <StatusPill tone={c.safety.estop.latched ? 'alarm' : 'idle'}>{c.safety.estop.pressed ? 'Pressed' : c.safety.estop.latched ? 'Latched' : 'Ready'}</StatusPill>
          </li>
          {c.safety.interlocks.map((il) => (
            <li>
              <span>
                {il.id} {il.name}
                <small>{il.action}</small>
              </span>
              <StatusPill tone={il.tripped ? 'alarm' : il.conditionActive ? 'warn' : 'idle'}>{il.tripped ? 'Tripped' : il.conditionActive ? 'Condition' : 'Ready'}</StatusPill>
            </li>
          ))}
          <li>
            <span>
              P-01 Pump run permissive
              <small>Inlet valve at least {c.safety.config.inletPermissivePct} % open</small>
            </span>
            <StatusPill tone={c.safety.runPermissive ? 'idle' : 'warn'}>{c.safety.runPermissive ? 'Met' : 'Not met'}</StatusPill>
          </li>
        </ul>
        <div class="row-actions">
          {c.safety.estop.pressed ? (
            <Button tone="default" onClick={() => rt.act((x) => x.releaseEStop())}>Release E-stop</Button>
          ) : (
            <Button tone="danger" onClick={() => rt.act((x) => x.pressEStop())}>Emergency stop</Button>
          )}
          <Button
            tone="primary"
            onClick={() => {
              const r = rt.act((x) => x.resetInterlocks());
              toast(r.ok ? 'Interlocks reset. The pump stays off until you command it.' : `Reset refused: ${r.blockedBy.join(', ')} still present`, r.ok ? 'info' : 'error');
            }}
          >
            Reset interlocks
          </Button>
        </div>
      </Card>

      <Card title="Response" class="ctl-trend">
        <TrendChart series={LOOP_SERIES} windowS={300} yMin={0} yMax={100} yTicks={4} unit="%" height={230} label="Process value, setpoint and output over the last five minutes" />
        <ul class="legend">
          <li><i class="sw pv" />PV</li>
          <li><i class="sw sp" />Setpoint</li>
          <li><i class="sw out" />Output</li>
        </ul>
      </Card>
    </div>
  );
}
