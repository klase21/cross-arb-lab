"use client";

export interface ChartCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface ChartLine {
  value: number;
  color: string;
  dash?: string;
  label?: string;
}

export interface ChartOverlay {
  values: (number | null)[];
  color: string;
  width?: number;
}

/** Candlestick chart with volume backdrop, horizontal levels, and MA overlays. */
export default function CandleChart({ candles, lines = [], height = 288, extraLevels = [], overlays = [], limit = 120 }: {
  candles: ChartCandle[];
  lines?: ChartLine[];
  height?: number;
  extraLevels?: number[];
  overlays?: ChartOverlay[];
  limit?: number;
}) {
  const W = 900;
  const H = 300;
  const PAD = 8;
  const TIME_H = 18;
  const priceH = Math.round((H - TIME_H) * 0.74);
  const volTop = priceH + 4;
  const volH = H - TIME_H - volTop;
  const data = limit > 0 ? candles.slice(-limit) : candles.slice();
  if (data.length < 2) return <p className="text-xs text-zinc-600">-</p>;
  const lows = data.map(c => c.l);
  const highs = data.map(c => c.h);
  for (const l of lines) {
    if (l.value > 0) { lows.push(l.value); highs.push(l.value); }
  }
  for (const v of extraLevels) {
    if (v > 0) { lows.push(v); highs.push(v); }
  }
  for (const o of overlays) {
    for (const v of o.values) {
      if (v !== null && v > 0 && Number.isFinite(v)) { lows.push(v); highs.push(v); }
    }
  }
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const y = (p: number) => PAD + (1 - (p - min) / span) * (priceH - PAD * 2);
  const cw = W / data.length;
  const maxV = Math.max(...data.map(c => c.v), 1);
  const yv = (v: number) => volTop + volH - (v / maxV) * volH;
  const fmtVol = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
  // Time axis ticks (~6 labels, granularity follows the visible span).
  const t0 = data[0].t;
  const t1 = data[data.length - 1].t;
  const tSpan = Math.max(t1 - t0, 1);
  const tickFmt = (t: number): string => {
    const d = new Date(t);
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    if (tSpan > 120 * 86400_000) return `${d.getFullYear()}-${String(mm).padStart(2, "0")}`;
    if (tSpan > 3 * 86400_000) return `${mm}/${dd}`;
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const tickIdx: number[] = [];
  const NT = 6;
  for (let k = 0; k < NT; k++) tickIdx.push(Math.min(data.length - 1, Math.round((k * (data.length - 1)) / (NT - 1))));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-zinc-950 rounded-lg border border-zinc-800" style={{ height }}>
      {data.map((c, i) => {
        const up = c.c >= c.o;
        const col = up ? "#22c55e" : "#ef4444";
        const x = i * cw + cw / 2;
        return (
          <g key={c.t}>
            <line x1={x} y1={y(c.h)} x2={x} y2={y(c.l)} stroke={col} strokeWidth={1} />
            <rect
              x={i * cw + cw * 0.2}
              y={y(Math.max(c.o, c.c))}
              width={Math.max(cw * 0.6, 1)}
              height={Math.max(Math.abs(y(c.o) - y(c.c)), 1)}
              fill={col}
            />
            <rect
              x={i * cw + 1}
              y={yv(c.v)}
              width={Math.max(cw - 2, 1)}
              height={Math.max(volTop + volH - yv(c.v), 1)}
              fill={col}
              opacity={0.65}
            />
          </g>
        );
      })}
      {/* volume pane separator + current volume */}
      <line x1={0} y1={volTop - 2} x2={W} y2={volTop - 2} stroke="#27272a" strokeWidth={1} />
      <text x={4} y={volTop + 10} fontSize={10} fill="#71717a">Vol {fmtVol(data[data.length - 1].v)}</text>
      {/* time axis */}
      {tickIdx.map(i => (
        <text key={i} x={i * cw + cw / 2} y={H - 4} fontSize={10} fill="#71717a" textAnchor="middle">{tickFmt(data[i].t)}</text>
      ))}
      {lines.map((l, i) => (
        l.value > 0 && l.value >= min && l.value <= max ? (
          <g key={i}>
            <line x1={0} y1={y(l.value)} x2={W} y2={y(l.value)} stroke={l.color} strokeWidth={1.2} strokeDasharray={l.dash} />
            {l.label && <text x={W - 4} y={y(l.value) - 3} fontSize={10} fill={l.color} textAnchor="end">{l.label}</text>}
          </g>
        ) : null
      ))}
      {overlays.map((o, oi) => {
        const pts: string[] = [];
        o.values.forEach((v, i) => {
          if (v !== null && Number.isFinite(v) && i < data.length) {
            pts.push(`${(i * cw + cw / 2).toFixed(1)},${y(v).toFixed(1)}`);
          }
        });
        if (pts.length < 2) return null;
        return <polyline key={`o${oi}`} points={pts.join(" ")} fill="none" stroke={o.color} strokeWidth={o.width ?? 1.5} />;
      })}
    </svg>
  );
}
