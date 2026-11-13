import type { TrendSample } from '../core/controlSystem';

/** Samples with t in [endT - windowS, endT]. Assumes ascending t (binary search). */
export function windowSamples(samples: readonly TrendSample[], windowS: number, endT: number): TrendSample[] {
  if (samples.length === 0) return [];
  const startT = endT - windowS;
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((samples[mid] as TrendSample).t < startT) lo = mid + 1;
    else hi = mid;
  }
  return samples.slice(lo);
}

/** Evenly thin a series to at most maxPoints, always keeping the first and last sample. */
export function decimate(samples: readonly TrendSample[], maxPoints: number): TrendSample[] {
  const n = samples.length;
  if (n <= maxPoints) return samples.slice();
  if (maxPoints < 2) return [samples[0] as TrendSample, samples[n - 1] as TrendSample];
  const out: TrendSample[] = [];
  const stride = (n - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) out.push(samples[Math.round(i * stride)] as TrendSample);
  return out;
}

export function toCsv(samples: readonly TrendSample[]): string {
  const rows = ['time_s,setpoint_pct,pv_pct,output_pct,pressure_bar,flow_lps'];
  for (const s of samples) {
    rows.push(
      [String(Math.round(s.t * 100) / 100), s.sp.toFixed(3), s.pv.toFixed(3), s.out.toFixed(3), s.pressure.toFixed(3), s.flow.toFixed(3)].join(','),
    );
  }
  return rows.join('\n') + '\n';
}
