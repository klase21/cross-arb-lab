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

/** Candlestick chart with volume backdrop and optional horizontal levels. */
export default function CandleChart({ candles, lines = [], height = 288, extraLevels = [] }: {
  candles: ChartCandle[];
  lines?: ChartLine[];
  height?: number;
  extraLevels?: number[];
}) {
  const W = 900;
  const H = 300;
  const PAD = 8;
  const data = candles.slice(-120);
  if (data.length < 2) return <p className="text-xs text-zinc-600">-</p>;
  const lows = data.map(c => c.l);
  const highs = data.map(c => c.h);
  for (const l of lines) {
    if (l.value > 0) { lows.push(l.value); highs.push(l.value); }
  }
  for (const v of extraLevels) {
    if (v > 0) { lows.push(v); highs.push(v); }
  }
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const y = (p: number) => PAD + (1 - (p - min) / span) * (H - PAD * 2);
  const cw = W / data.length;
  const maxV = Math.max(...data.map(c => c.v), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-zinc-950 rounded-lg border border-zinc-800" style={{ height }}>
      {data.map((c, i) => {
        const up = c.c >= c.o;
        const col = up ? "#22c55e" : "#ef4444";
        const x = i * cw + cw / 2;
        const vh = (c.v / maxV) * H * 0.18;
        return (
          <g key={c.t}>
            <rect x={i * cw + 1} y={H - vh} width={Math.max(cw - 2, 1)} height={vh} fill={col} opacity={0.25} />
            <line x1={x} y1={y(c.h)} x2={x} y2={y(c.l)} stroke={col} strokeWidth={1} />
            <rect
              x={i * cw + cw * 0.2}
              y={y(Math.max(c.o, c.c))}
              width={Math.max(cw * 0.6, 1)}
              height={Math.max(Math.abs(y(c.o) - y(c.c)), 1)}
              fill={col}
            />
          </g>
        );
      })}
      {lines.map((l, i) => (
        l.value > 0 && l.value >= min && l.value <= max ? (
          <g key={i}>
            <line x1={0} y1={y(l.value)} x2={W} y2={y(l.value)} stroke={l.color} strokeWidth={1.2} strokeDasharray={l.dash} />
            {l.label && <text x={W - 4} y={y(l.value) - 3} fontSize={10} fill={l.color} textAnchor="end">{l.label}</text>}
          </g>
        ) : null
      ))}
    </svg>
  );
}
