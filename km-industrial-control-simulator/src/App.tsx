import { useEffect, useState } from 'preact/hooks';
import type { Runtime } from './app/runtime';
import { SPEEDS } from './app/settings';
import { Button } from './ui/components';
import { fmtClock } from './ui/format';
import { ROUTES, RuntimeContext, useRoute, useRuntime, useSnapshot, type Route } from './ui/hooks';
import { onToast, toast, type ToastMessage } from './ui/toast';
import { Alarms } from './ui/views/Alarms';
import { Control } from './ui/views/Control';
import { Dashboard } from './ui/views/Dashboard';
import { Settings } from './ui/views/Settings';
import { Trends } from './ui/views/Trends';

const NAV: Record<Route, { label: string; icon: string }> = {
  dashboard: { label: 'Dashboard', icon: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z' },
  control: { label: 'Control', icon: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M10 10v4M18 16v4' },
  trends: { label: 'Trends', icon: 'M3 20h18M4 15l4-5 4 3 5-8 3 4' },
  alarms: { label: 'Alarms', icon: 'M6 17h12l-1.5-2V10a4.5 4.5 0 0 0-9 0v5zM10 20h4' },
  settings: { label: 'Settings', icon: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8' },
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function EStopControl() {
  const rt = useRuntime();
  const { control } = useSnapshot();
  const e = control.safety.estop;
  if (!e.latched) {
    return (
      <button type="button" class="estop" onClick={() => rt.act((c) => c.pressEStop())} aria-label="Emergency stop">
        <span class="estop-cap" aria-hidden="true" />
        <span>E-stop</span>
      </button>
    );
  }
  if (e.pressed) {
    return (
      <button type="button" class="estop is-active" onClick={() => rt.act((c) => c.releaseEStop())} aria-label="Release emergency stop">
        <span class="estop-cap" aria-hidden="true" />
        <span>Release E-stop</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      class="estop is-reset"
      onClick={() => {
        const r = rt.act((c) => c.resetInterlocks());
        toast(r.ok ? 'E-stop reset. Start the pump from Manual or Auto.' : `Reset refused: ${r.blockedBy.join(', ')} still present`, r.ok ? 'info' : 'error');
      }}
      aria-label="Reset emergency stop"
    >
      <span class="estop-cap" aria-hidden="true" />
      <span>Reset</span>
    </button>
  );
}

function Header() {
  const rt = useRuntime();
  const snap = useSnapshot();
  return (
    <header class="topbar">
      <div class="brand">
        <svg class="brand-mark" viewBox="0 0 32 32" width="36" height="36" role="img" aria-label="K.M.">
          <rect width="32" height="32" fill="#c8102e" />
          <path d="M8 8h4v6l7-6h5l-8 8 8 8h-5l-7-6v6H8z" fill="#fff" />
        </svg>
        <div class="brand-text">
          <h1>Industrial Control Simulator</h1>
          <span>K.M. Hybrid Mechatronics</span>
        </div>
      </div>
      <div class="topbar-status">
        <span class="sim-badge" title="All values come from a software model. No hardware is connected."><span class="long">Simulation · no hardware connected</span><span class="short">Simulation</span></span>
        <span class="clock num" aria-label="Simulation time">T+ {fmtClock(snap.control.time)}</span>
        <label class="speed">
          <span>Speed</span>
          <select value={rt.speed} onChange={(e) => rt.setSpeed(Number(e.currentTarget.value))} aria-label="Simulation speed">
            {SPEEDS.map((s) => (
              <option value={s}>{s}x</option>
            ))}
          </select>
        </label>
        <Button onClick={() => rt.setPaused(!rt.paused)} aria-pressed={rt.paused}>
          {rt.paused ? 'Run' : 'Pause'}
        </Button>
      </div>
      <EStopControl />
    </header>
  );
}

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

function AlarmBanner() {
  const rt = useRuntime();
  const { control } = useSnapshot();
  const bySeverity = (a: { priority: string }, b: { priority: string }) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  // Show a genuinely active alarm first; a cleared-but-unacknowledged one only when nothing is active.
  const active = control.alarms.filter((a) => a.state === 'activeUnacked' || a.state === 'activeAcked').sort(bySeverity)[0];
  const cleared = control.alarms.filter((a) => a.state === 'rtnUnacked').sort(bySeverity)[0];
  const top = active ?? cleared;
  if (!top) return null;
  const isCleared = !active;
  const unacked = control.unackedCount > 0;
  return (
    <div class={`alarm-banner ${isCleared ? 'is-cleared' : `prio-${top.priority}`} ${unacked && !isCleared ? 'is-unacked' : ''}`} role="status" aria-live="polite">
      <span class="prio-tag">{isCleared ? 'cleared' : top.priority}</span>
      <a href="#/alarms">
        {isCleared ? 'Returned to normal: ' : ''}
        <b>{top.tag}</b> {top.description}
      </a>
      <span class="count">{control.activeAlarmCount} active</span>
      {unacked && (
        <button type="button" class="btn btn-quiet" onClick={() => rt.act((c) => c.acknowledgeAll())}>
          Acknowledge all
        </button>
      )}
    </div>
  );
}

function Toasts() {
  const [items, setItems] = useState<ToastMessage[]>([]);
  useEffect(
    () =>
      onToast((t) => {
        setItems((xs) => [...xs.slice(-3), t]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6000 : 3500);
      }),
    [],
  );
  return (
    <div class="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div class={`toast toast-${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}

function Nav({ route }: { route: Route }) {
  const { control } = useSnapshot();
  return (
    <nav class="nav" aria-label="Main">
      {ROUTES.map((r) => (
        <a href={`#/${r}`} class={r === route ? 'nav-item on' : 'nav-item'} aria-current={r === route ? 'page' : undefined}>
          <span class="nav-icon">
            <Icon d={NAV[r].icon} />
            {r === 'alarms' && control.unackedCount > 0 && (
              <span class="nav-badge" aria-label={`${control.unackedCount} unacknowledged alarms`}>
                {control.unackedCount}
              </span>
            )}
          </span>
          <span>{NAV[r].label}</span>
        </a>
      ))}
    </nav>
  );
}

function Shell() {
  const route = useRoute();
  const rt = useRuntime();
  const snap = useSnapshot();
  return (
    <div class="app">
      <Header />
      <AlarmBanner />
      <Nav route={route} />
      <main class="main" id="main">
        {rt.error && (
          <div class="fatal" role="alert">
            <b>Simulation stopped:</b> {rt.error}
            <Button onClick={() => rt.resetSimulation()}>Restart simulation</Button>
          </div>
        )}
        {route === 'dashboard' && <Dashboard />}
        {route === 'control' && <Control />}
        {route === 'trends' && <Trends />}
        {route === 'alarms' && <Alarms />}
        {route === 'settings' && <Settings />}
        <aside class="titleblock" aria-label="Sheet information">
          <div><span>Project</span><b>K.M. Hybrid Mechatronics</b></div>
          <div><span>Loop</span><b>LIC-101 tank level</b></div>
          <div><span>Mode</span><b>Simulation</b></div>
          <div><span>Sheet</span><b>{NAV[route].label}</b></div>
          <div><span>Sim time</span><b class="num">{fmtClock(snap.control.time)}</b></div>
        </aside>
      </main>
      <Toasts />
    </div>
  );
}

export function App({ runtime }: { runtime: Runtime }) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <Shell />
    </RuntimeContext.Provider>
  );
}
