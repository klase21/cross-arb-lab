"use client";

import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

interface Pt {
  t: number;
  usd: number;
  krw: number;
}

const EXCHANGES = ["upbit", "bithumb", "binance", "bybit", "okx"] as const;
const COLORS: Record<string, string> = {
  upbit: "#34d399",
  bithumb: "#38bdf8",
  binance: "#facc15",
  bybit: "#a78bfa",
  okx: "#f472b6",
};

function Line({
  series, w, h, colors, isPremium,
}: {
  series: { key: string; pts: Pt[] }[];
  w: number;
  h: number;
  colors: Record<string, string>;
  isPremium?: boolean;
}) {
  const all = series.flatMap(s => s.pts.map(p => p.usd));
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const times = series.flatMap(s => s.pts.map(p => p.t));
  const t0 = times.length > 0 ? Math.min(...times) : 0;
  const t1 = times.length > 0 ? Math.max(...times) : 1;
  const x = (t: number) => 34 + ((t - t0) / Math.max(t1 - t0, 1)) * (w - 40);
  const y = (v: number) => 6 + (1 - (v - min) / span) * (h - 22);
  const zeroY = isPremium && min < 0 && max > 0 ? y(0) : null;
  const fmtTick = (v: number) => (isPremium ? `${v.toFixed(1)}%` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toLocaleString("en-US", { maximumFractionDigits: 4 }));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }}>
      {[0.15, 0.5, 0.85].map(f => {
        const v = min + span * (1 - f);
        return (
          <g key={f}>
            <line x1={34} y1={h * f} x2={w - 6} y2={h * f} stroke="#27272a" strokeWidth={1} />
            <text x={2} y={h * f + 3} fontSize={9} fill="#71717a">{fmtTick(v)}</text>
          </g>
        );
      })}
      {zeroY !== null && <line x1={34} y1={zeroY} x2={w - 6} y2={zeroY} stroke="#52525b" strokeWidth={1} strokeDasharray="4 3" />}
      {series.map(s => (
        <polyline
          key={s.key}
          points={s.pts.map(p => `${x(p.t).toFixed(1)},${y(p.usd).toFixed(1)}`).join(" ")}
          fill="none"
          stroke={colors[s.key] ?? "#fff"}
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

export default function HistoryChart({ symbol }: { symbol: string }) {
  const { t, lang } = useLang();
  const [days, setDays] = useState(7);
  const [series, setSeries] = useState<Record<string, Pt[]>>({});
  const [premium, setPremium] = useState<{ t: number; pct: number }[]>([]);
  const [points, setPoints] = useState(0);
  const [source, setSource] = useState<"db" | "live" | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadLive = useCallback(async (d: number) => {
    // Klines fallback for coins outside the DB collection universe (top 60).
    // Served by /api/klines (Upbit blocks browser CORS, so server proxies).
    try {
      const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&days=${d}`);
      if (!res.ok) return false;
      const data = await res.json() as {
        series?: Record<string, Pt[]>;
        premium?: { t: number; pct: number }[];
      };
      const up = data.series?.upbit ?? [];
      if (up.length < 2) return false;
      setSeries(data.series ?? {});
      setPremium(Array.isArray(data.premium) ? data.premium : []);
      setPoints(up.length + (data.series?.binance?.length ?? 0));
      setSource("live");
      return true;
    } catch {
      return false;
    }
  }, [symbol]);

  const load = useCallback(async (d: number) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=${d}`);
      if (res.status === 503) { setUnavailable(true); return; }
      if (res.ok) {
        const data = await res.json();
        const dbPoints = data.points ?? 0;
        if (dbPoints >= 4) {
          setSeries(data.series ?? {});
          setPremium(Array.isArray(data.premium) ? data.premium : []);
          setPoints(dbPoints);
          setSource("db");
          return;
        }
      }
      await loadLive(d);
    } catch {} finally {
      setLoading(false);
    }
  }, [symbol, loadLive]);

  useEffect(() => {
    const kickoff = setTimeout(() => { void load(days); }, 0);
    return () => clearTimeout(kickoff);
  }, [load, days]);

  if (unavailable) return null;
  const active = EXCHANGES.filter(ex => (series[ex] ?? []).length >= 2);
  return (
    <div className="rounded-xl border border-zinc-800 p-6 mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-base font-semibold">
          {t("hist.title")}
          <span className="text-xs font-normal text-zinc-500 ml-2">{points}{lang === "ko" ? "개 수집" : " pts"}</span>
          {source && (
            <span className={`ml-1.5 px-1.5 py-px rounded text-[10px] font-bold ${source === "db" ? "bg-emerald-500/15 text-emerald-300" : "bg-sky-500/15 text-sky-300"}`}>
              {source === "db" ? "DB" : "LIVE"}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5">
          {[1, 7, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${days === d ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
            >
              {d}{lang === "ko" ? "일" : "d"}
            </button>
          ))}
        </div>
      </div>
      {loading && active.length === 0 ? (
        <p className="text-xs text-zinc-500">{t("common.loading")}</p>
      ) : active.length === 0 ? (
        <p className="text-xs text-zinc-500">{t("hist.empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-[11px] text-zinc-400 mb-2">
            {active.map(ex => (
              <span key={ex} className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-0.5" style={{ background: COLORS[ex] }} />
                {ex}
              </span>
            ))}
            <span className="ml-auto text-zinc-600">USD</span>
          </div>
          <Line series={active.map(ex => ({ key: ex, pts: series[ex] }))} w={760} h={220} colors={COLORS} />
          {premium.length >= 2 && (
            <>
              <p className="text-[11px] text-zinc-500 mt-3 mb-1">{t("hist.premium")}</p>
              <Line series={[{ key: "premium", pts: premium.map(p => ({ t: p.t, usd: p.pct, krw: p.pct })) }]} w={760} h={90} colors={{ premium: "#f87171" }} isPremium />
            </>
          )}
        </>
      )}
    </div>
  );
}
