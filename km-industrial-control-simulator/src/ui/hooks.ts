import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Runtime } from '../app/runtime';
import type { SimulationSnapshot } from '../core/simulation';

export const RuntimeContext = createContext<Runtime | null>(null);

export function useRuntime(): Runtime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error('RuntimeContext missing');
  return rt;
}

/** Re-renders at the runtime publish rate (~10 Hz) or immediately after an operator action. */
export function useSnapshot(): SimulationSnapshot {
  const rt = useRuntime();
  const [snap, setSnap] = useState(rt.getSnapshot());
  useEffect(() => {
    setSnap(rt.getSnapshot());
    return rt.subscribe(() => setSnap(rt.getSnapshot()));
  }, [rt]);
  return snap;
}

export type Route = 'dashboard' | 'control' | 'trends' | 'alarms' | 'settings';
export const ROUTES: readonly Route[] = ['dashboard', 'control', 'trends', 'alarms', 'settings'];

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(h) ? h : 'dashboard';
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
