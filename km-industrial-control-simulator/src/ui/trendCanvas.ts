import type { TrendSample } from '../core/controlSystem';

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  width: number;
  dash?: number[];
  step?: boolean;
  value: (s: TrendSample) => number;
}

export interface RefLine {
  value: number;
  label: string;
  color: string;
}

export interface ChartOptions {
  width: number;
  height: number;
  dpr: number;
  windowS: number;
  endT: number;
  yMin: number;
  yMax: number;
  yTicks: number;
  yDigits: number;
  series: SeriesDef[];
  refLines?: RefLine[];
  cursorT?: number | null;
  colors: { grid: string; axis: string; text: string; cursor: string; bg: string };
}

export const PAD = { left: 46, right: 14, top: 10, bottom: 24 };
const X_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900];

export function plotArea(w: number, h: number) {
  return { x0: PAD.left, x1: w - PAD.right, y0: PAD.top, y1: h - PAD.bottom };
}

export function formatAgo(sec: number): string {
  if (sec <= 0) return 'now';
  if (sec < 60) return `-${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `-${m}m` : `-${m}:${String(s).padStart(2, '0')}`;
}

export function drawChart(ctx: CanvasRenderingContext2D, samples: readonly TrendSample[], o: ChartOptions): void {
  const { width: w, height: h, dpr } = o;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = o.colors.bg;
  ctx.fillRect(0, 0, w, h);
  const { x0, x1, y0, y1 } = plotArea(w, h);
  const tStart = o.endT - o.windowS;
  const xOf = (t: number) => x0 + ((t - tStart) / o.windowS) * (x1 - x0);
  const yOf = (v: number) => y1 - ((v - o.yMin) / (o.yMax - o.yMin)) * (y1 - y0);

  ctx.font = '11px Barlow, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;

  // horizontal grid + y labels
  ctx.textAlign = 'right';
  for (let i = 0; i <= o.yTicks; i++) {
    const v = o.yMin + ((o.yMax - o.yMin) * i) / o.yTicks;
    const y = Math.round(yOf(v)) + 0.5;
    ctx.strokeStyle = o.colors.grid;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.fillStyle = o.colors.text;
    ctx.fillText(v.toFixed(o.yDigits), x0 - 6, y);
  }

  // vertical grid + time labels
  const step = X_STEPS.find((s) => o.windowS / s <= 8) ?? 900;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let ago = 0; ago <= o.windowS; ago += step) {
    const x = Math.round(xOf(o.endT - ago)) + 0.5;
    ctx.strokeStyle = o.colors.grid;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    ctx.fillStyle = o.colors.text;
    ctx.fillText(formatAgo(ago), Math.min(x1 - 8, Math.max(x0 + 8, x)), y1 + 6);
  }

  ctx.strokeStyle = o.colors.axis;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);

  // reference lines (alarm limits)
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  for (const r of o.refLines ?? []) {
    if (r.value < o.yMin || r.value > o.yMax) continue;
    const y = Math.round(yOf(r.value)) + 0.5;
    ctx.strokeStyle = r.color;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = r.color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(r.label, x1 - 4, y - 1);
  }

  // data
  for (const s of o.series) {
    if (samples.length === 0) break;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineJoin = 'round';
    ctx.setLineDash(s.dash ?? []);
    ctx.beginPath();
    let prevY = 0;
    samples.forEach((p, i) => {
      const x = xOf(p.t);
      const y = yOf(s.value(p));
      if (i === 0) ctx.moveTo(x, y);
      else {
        if (s.step) ctx.lineTo(x, prevY);
        ctx.lineTo(x, y);
      }
      prevY = y;
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // cursor
  if (o.cursorT !== null && o.cursorT !== undefined) {
    const x = Math.round(xOf(o.cursorT)) + 0.5;
    ctx.strokeStyle = o.colors.cursor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }
  ctx.restore();
}

/** Nearest sample to time t (binary search). */
export function nearestSample(samples: readonly TrendSample[], t: number): TrendSample | null {
  if (samples.length === 0) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((samples[mid] as TrendSample).t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = samples[lo] as TrendSample;
  const b = samples[Math.max(0, lo - 1)] as TrendSample;
  return Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b;
}
