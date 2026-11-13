import type { SeriesDef } from './trendCanvas';

export const SERIES_COLORS = { pv: '#2b2f33', sp: '#c8102e', out: '#7d858c', pressure: '#2b2f33', flow: '#2b2f33' } as const;

export const LOOP_SERIES: SeriesDef[] = [
  { key: 'pv', label: 'PV level', color: SERIES_COLORS.pv, width: 2.2, value: (s) => s.pv },
  { key: 'sp', label: 'Setpoint', color: SERIES_COLORS.sp, width: 1.8, dash: [6, 4], step: true, value: (s) => s.sp },
  { key: 'out', label: 'Output', color: SERIES_COLORS.out, width: 1.6, value: (s) => s.out },
];

export const PRESSURE_SERIES: SeriesDef[] = [{ key: 'pressure', label: 'PT-101', color: SERIES_COLORS.pressure, width: 1.8, value: (s) => s.pressure }];
export const FLOW_SERIES: SeriesDef[] = [{ key: 'flow', label: 'FT-101', color: SERIES_COLORS.flow, width: 1.8, value: (s) => s.flow }];
