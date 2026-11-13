import { useEffect, useRef, useState } from 'preact/hooks';
import type { Runtime } from '../app/runtime';
import { DEFAULT_PLANT_PARAMS } from '../core/plant';
import { useRuntime } from './hooks';
import { PlantScene, type EquipmentId, type SceneState } from './three/PlantScene';

function sceneState(rt: Runtime): SceneState {
  const snap = rt.getSnapshot();
  const p = rt.simulation.plant;
  const c = snap.control;
  const lim = c.alarmLimits;
  return {
    levelPct: p.levelPct,
    pumpSpeedPct: p.pumpSpeedPct,
    pumpTripped: c.safety.pumpTripActive,
    inletValvePct: p.inletValvePct,
    outletValvePct: p.outletValvePct,
    inflowLps: p.inflowLps,
    outflowLps: p.outflowLps,
    pressureBar: p.dischargePressureBar,
    setpoint: c.setpoint,
    levelMeasured: c.pv,
    switchHH: c.inputs?.levelSwitchHH ?? false,
    switchLL: c.inputs?.levelSwitchLL ?? false,
    estopPressed: c.safety.estop.pressed,
    limits: { hh: lim.levelHH, h: lim.levelH, l: lim.levelL, ll: lim.levelLL },
    pumpMaxFlowLps: DEFAULT_PLANT_PARAMS.pumpMaxFlowLps,
  };
}

export function Scene3D({ selected, onSelect }: { selected: EquipmentId | null; onSelect: (id: EquipmentId | null) => void }) {
  const rt = useRuntime();
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<PlantScene | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const cbs = useRef({ onSelect });
  cbs.current = { onSelect };

  useEffect(() => {
    if (!host.current || !labels.current) return;
    let s: PlantScene;
    try {
      s = new PlantScene(host.current, labels.current, {
        onSelect: (id) => cbs.current.onSelect(id),
        onSetpointDrag: (pct) => rt.act((c) => c.setSetpoint(pct)),
        onEStopToggle: () =>
          rt.act((c) => {
            const e = c.snapshot().safety.estop;
            if (e.pressed) c.releaseEStop();
            else c.pressEStop();
          }),
      });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'WebGL is not available');
      return;
    }
    scene.current = s;
    (window as unknown as { __kmScene?: PlantScene }).__kmScene = s; // debug handle for browser tests
    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
    });
    io.observe(host.current);
    const off = rt.onFrame((dt) => {
      if (visible && !document.hidden) s.update(sceneState(rt), dt);
    });
    return () => {
      off();
      io.disconnect();
      s.dispose();
      scene.current = null;
    };
  }, [rt]);

  useEffect(() => {
    scene.current?.setSelected(selected);
  }, [selected]);

  if (failed) {
    return (
      <div class="scene scene-fallback" role="alert">
        <strong>3D view unavailable</strong>
        <p>This browser could not start WebGL ({failed}). The controls, trends and alarms keep working.</p>
      </div>
    );
  }
  return (
    <div class="scene">
      <div class="scene-host" ref={host} data-testid="scene-host" />
      <div class="scene-labels" ref={labels} aria-hidden="true" />
      <button type="button" class="btn btn-quiet scene-reset" onClick={() => scene.current?.resetView()}>
        Reset view
      </button>
      <p class="scene-hint">Drag to orbit, scroll to zoom. Drag the red tab on the tank to move the setpoint. Click equipment for details.</p>
    </div>
  );
}
