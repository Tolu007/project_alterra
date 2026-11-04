import { useRef, useState } from 'react';

export interface Point {
  x: number;
  y: number;
  label: string;
}

/** Rounds a span into 3–4 clean tick values. */
function ticks(min: number, max: number): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** Single-series line: 2px line, 10% wash, end dot with a surface ring, crosshair tooltip on hover. */
export function LineChart({ points, format, title, height = 150, color = 'var(--chart)' }: { points: Point[]; format: (v: number) => string; title: string; height?: number; color?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = height;
  const pad = { l: 46, r: 14, t: 12, b: 22 };
  if (points.length < 2) {
    return <p className="muted" style={{ margin: 0, fontSize: 13 }}>Not enough weeks yet. Check back soon.</p>;
  }
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (hi - lo < 1e-9) {
    lo -= Math.abs(lo) * 0.1 + 1;
    hi += Math.abs(hi) * 0.1 + 1;
  }
  const t = ticks(lo, hi);
  lo = Math.min(lo, t[0]);
  hi = Math.max(hi, t[t.length - 1]);
  const sx = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const area = `${line}L${sx(points.length - 1)},${H - pad.b}L${sx(0)},${H - pad.b}Z`;
  const last = points.length - 1;

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((x - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: from ${format(points[0].y)} to ${format(points[last].y)}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <g className="grid">
          {t.map((v) => (
            <line key={v} x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
          ))}
        </g>
        <g className="axis">
          {t.map((v) => (
            <text key={v} x={pad.l - 6} y={sy(v) + 3} textAnchor="end">
              {format(v)}
            </text>
          ))}
          <text x={sx(0)} y={H - 6}>
            {points[0].label}
          </text>
          <text x={sx(last)} y={H - 6} textAnchor="end">
            {points[last].label}
          </text>
        </g>
        <path d={area} fill={color} opacity="0.1" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx(last)} cy={sy(points[last].y)} r="4.5" fill={color} stroke="var(--paper)" strokeWidth="2" />
        {hover !== null && (
          <g>
            <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-3)" strokeWidth="1" />
            <circle cx={sx(hover)} cy={sy(points[hover].y)} r="5" fill={color} stroke="var(--paper)" strokeWidth="2" />
          </g>
        )}
        <rect x={pad.l} y={0} width={W - pad.l - pad.r} height={H} fill="transparent" />
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(sx(hover) / W) * 100}%`, top: `${(sy(points[hover].y) / H) * 100}%` }}>
          {points[hover].label} · {format(points[hover].y)}
        </div>
      )}
    </div>
  );
}

/** Twelve-point trend in the de-emphasis hue, with the latest value marked. */
export function Sparkline({ values, width = 90, height = 22 }: { values: number[]; width?: number; height?: number }) {
  const v = values.slice(-12);
  if (v.length < 2) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const sx = (i: number) => 2 + (i / (v.length - 1)) * (width - 6);
  const sy = (x: number) => 3 + (1 - (x - lo) / (hi - lo || 1)) * (height - 6);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(x).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={sx(v.length - 1)} cy={sy(v[v.length - 1])} r="2.6" fill="var(--chart)" />
    </svg>
  );
}

/** Label, value, signed delta coloured by whether up is good, and a trend line. */
export function StatTile({ label, value, delta, upIsGood, trend }: { label: string; value: string; delta?: number; upIsGood?: boolean; trend?: number[] }) {
  const tone = delta === undefined || Math.abs(delta) < 0.005 ? '' : (delta > 0) === !!upIsGood ? 'good' : 'bad';
  return (
    <div className="tile">
      <div className="kicker">{label}</div>
      <div className="tile-value">{value}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        {delta !== undefined && (
          <span className={`tile-delta ${tone}`}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta * 100).toFixed(1)}% <span className="muted" style={{ fontWeight: 500 }}>vs start</span>
          </span>
        )}
        {trend && <Sparkline values={trend} />}
      </div>
    </div>
  );
}
