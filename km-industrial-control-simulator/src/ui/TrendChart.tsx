import { useEffect, useRef, useState } from 'preact/hooks';
import { decimate, windowSamples } from '../app/trendData';
import type { TrendSample } from '../core/controlSystem';
import { useRuntime } from './hooks';
import { drawChart, nearestSample, plotArea, type RefLine, type SeriesDef } from './trendCanvas';

interface Props {
  series: SeriesDef[];
  visible?: Record<string, boolean>;
  windowS: number;
  /** When set, the chart is frozen at this simulation time. */
  frozenEnd?: number | null;
  yMin: number;
  yMax: number;
  yTicks?: number;
  yDigits?: number;
  unit?: string;
  height?: number;
  refLines?: RefLine[];
  label: string;
}

function cssColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { grid: v('--line', '#d3d7da'), axis: v('--line-strong', '#aeb4b9'), text: v('--steel', '#6b737a'), cursor: v('--graphite', '#2b2f33'), bg: v('--paper', '#ffffff') };
}

export function TrendChart({ series, visible, windowS, frozenEnd = null, yMin, yMax, yTicks = 5, yDigits = 0, unit = '', height = 240, refLines, label }: Props) {
  const rt = useRuntime();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<number | null>(null);
  const [tip, setTip] = useState<{ x: number; sample: TrendSample } | null>(null);
  // Always read latest props inside the draw loop without re-subscribing.
  const props = useRef({ series, visible, windowS, frozenEnd, yMin, yMax, yTicks, yDigits, refLines });
  props.current = { series, visible, windowS, frozenEnd, yMin, yMax, yTicks, yDigits, refLines };

  useEffect(() => {
    const cv = canvas.current;
    const box = wrap.current;
    if (!cv || !box) return;
    let last = 0;
    let lastKey = '';

    const draw = (force: boolean) => {
      const p = props.current;
      const history = rt.control.history;
      const endT = p.frozenEnd ?? rt.control.snapshot().time;
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (w < 20 || h < 20) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const key = `${w}x${h}@${dpr}|${endT.toFixed(2)}|${history.length}|${p.windowS}|${cursor.current}|${JSON.stringify(p.visible)}|${p.series.length}`;
      if (!force && key === lastKey) return;
      lastKey = key;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const win = windowSamples(history, p.windowS, endT);
      const data = decimate(win, Math.max(50, Math.floor(w * 1.2)));
      drawChart(ctx, data, {
        width: w, height: h, dpr, windowS: p.windowS, endT, yMin: p.yMin, yMax: p.yMax, yTicks: p.yTicks, yDigits: p.yDigits,
        series: p.series.filter((s) => p.visible?.[s.key] !== false),
        refLines: p.refLines,
        cursorT: cursor.current,
        colors: cssColors(),
      });
    };

    const off = rt.onFrame(() => {
      const now = performance.now();
      if (now - last < 100) return;
      last = now;
      draw(false);
    });
    const ro = new ResizeObserver(() => draw(true));
    ro.observe(box);
    draw(true);
    return () => {
      off();
      ro.disconnect();
    };
  }, [rt]);

  const onMove = (e: PointerEvent) => {
    const box = wrap.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const { x0, x1 } = plotArea(rect.width, rect.height);
    const frac = (e.clientX - rect.left - x0) / (x1 - x0);
    if (frac < 0 || frac > 1) {
      cursor.current = null;
      setTip(null);
      return;
    }
    const endT = props.current.frozenEnd ?? rt.control.snapshot().time;
    const t = endT - props.current.windowS + frac * props.current.windowS;
    const s = nearestSample(rt.control.history, t);
    cursor.current = s ? s.t : null;
    setTip(s ? { x: e.clientX - rect.left, sample: s } : null);
  };
  const onLeave = () => {
    cursor.current = null;
    setTip(null);
  };

  const shown = series.filter((s) => visible?.[s.key] !== false);
  return (
    <div class="chart" style={{ height: `${height}px` }} ref={wrap} role="img" aria-label={label}>
      <canvas ref={canvas} onPointerMove={onMove} onPointerLeave={onLeave} />
      {tip && (
        <div class="chart-tip" style={{ left: `${Math.min(tip.x + 12, (wrap.current?.clientWidth ?? 300) - 150)}px` }}>
          <b>t = {tip.sample.t.toFixed(1)} s</b>
          {shown.map((s) => (
            <span>
              <i style={{ background: s.color }} /> {s.label}: {s.value(tip.sample).toFixed(yDigits === 0 ? 1 : yDigits)} {unit}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
