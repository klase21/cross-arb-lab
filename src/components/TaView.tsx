"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { useLang } from "@/lib/i18n";
import CandleChart from "@/components/CandleChart";
import { fmtPricePlain } from "@/lib/format";

interface TaReason {
  code: string;
  value: number | null;
  bull: boolean;
}

interface TaReading {
  symbol: string;
  price: number;
  change24h: number | null;
  rsi14: number | null;
  macdHist: number | null;
  bbUpper: number | null;
  bbMid: number | null;
  bbLower: number | null;
  bbPctB: number | null;
  ema20: number | null;
  ema60: number | null;
  bias: "LONG" | "SHORT" | "NEUTRAL";
  strength: "STRONG" | "WEAK" | "NONE";
  score: number;
  reasons: TaReason[];
}

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const INTERVALS = ["15m", "1h", "4h", "1d"] as const;

function fmtPrice(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return fmtPricePlain(n);
}

function reasonValue(code: string, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "";
  if (code.startsWith("rsi")) return v.toFixed(1);
  if (code.startsWith("macd")) return fmtPricePlain(v);
  if (code.startsWith("bb")) return v.toFixed(2);
  return fmtPrice(v);
}

function biasCls(bias: string): string {
  if (bias === "LONG") return "bg-emerald-500/15 text-emerald-300";
  if (bias === "SHORT") return "bg-red-500/15 text-red-300";
  return "bg-zinc-800 text-zinc-400";
}

function rsiCls(v: number | null): string {
  if (v === null) return "text-zinc-500";
  if (v < 30) return "text-emerald-400 font-bold";
  if (v > 70) return "text-red-400 font-bold";
  return "text-zinc-200";
}

function Chart({ candles, reading }: { candles: Candle[]; reading: TaReading }) {
  const extraLevels: number[] = [];
  if (reading.bbUpper !== null) extraLevels.push(reading.bbUpper);
  if (reading.bbLower !== null) extraLevels.push(reading.bbLower);
  return <CandleChart candles={candles} extraLevels={extraLevels} height={288} />;
}

export default function TaView() {
  const { t, lang } = useLang();
  const [timeframe, setTimeframe] = useState<string>("1h");
  const [readings, setReadings] = useState<TaReading[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [biasF, setBiasF] = useState<"all" | "LONG" | "SHORT" | "NEUTRAL">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ reading: TaReading; candles: Candle[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const intervalSec = usePollingInterval();

  const load = useCallback(async (iv: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/ta?interval=${iv}`);
      if (res.ok) {
        const data = await res.json();
        setReadings(Array.isArray(data.readings) ? data.readings : []);
        setNames(data.names ?? {});
      }
      setLastUpdated(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {} finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    const kickoff = setTimeout(() => { void load(timeframe); }, 0);
    const timer = setInterval(() => { void load(timeframe); }, Math.max(intervalSec, 60) * 1000);
    return () => { clearTimeout(kickoff); clearInterval(timer); };
  }, [load, timeframe, intervalSec]);

  const loadDetail = useCallback(async (symbol: string, iv: string) => {
    try {
      setDetailLoading(true);
      const res = await fetch(`/api/ta?symbol=${symbol}&interval=${iv}`);
      if (res.ok) {
        const data = await res.json();
        const r = (data.readings as TaReading[]).find(x => x.symbol === symbol);
        if (r) setDetail({ reading: r, candles: data.candles ?? [] });
      }
    } catch {} finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    const kickoff = setTimeout(() => { void loadDetail(selected, timeframe); }, 0);
    return () => clearTimeout(kickoff);
  }, [selected, timeframe, loadDetail]);

  const baseOf = (s: string) => s.replace(/USDT$/, "");
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return readings.filter(r => {
      if (q && !r.symbol.includes(q)) return false;
      if (biasF !== "all" && r.bias !== biasF) return false;
      return true;
    });
  }, [readings, search, biasF]);

  const selBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${active ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5">
        {INTERVALS.map(iv => (
          <button key={iv} onClick={() => setTimeframe(iv)} className={selBtn(timeframe === iv)}>{iv}</button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t("ta.searchPlaceholder")}
          className="px-2.5 py-1 rounded-md text-xs bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 w-40"
        />
        {(["all", "LONG", "SHORT", "NEUTRAL"] as const).map(b => (
          <button key={b} onClick={() => setBiasF(b)} className={selBtn(biasF === b)}>
            {b === "all" ? t("ta.all") : t(`ta.bias.${b.toLowerCase()}`)}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500">{t("common.lastUpdated")}: {lastUpdated ?? "-"} · {filtered.length}/{readings.length}</span>
      </div>

      {selected && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <b className="text-sm">${baseOf(selected)}</b>
            {names[baseOf(selected)] && <span className="text-xs text-zinc-500">{names[baseOf(selected)]}</span>}
            <button onClick={() => { setSelected(null); setDetail(null); }} className="ml-auto text-xs text-zinc-500 hover:text-zinc-200">✕</button>
          </div>
          {detailLoading && !detail ? (
            <p className="text-xs text-zinc-500">{t("common.loading")}</p>
          ) : detail ? (
            <div className="grid gap-3 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <Chart candles={detail.candles} reading={detail.reading} />
              </div>
              <div className="lg:col-span-2 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded font-bold ${biasCls(detail.reading.bias)}`}>
                    {t(`ta.bias.${detail.reading.bias.toLowerCase()}`)} {detail.reading.strength !== "NONE" && `· ${t(`ta.strength.${detail.reading.strength.toLowerCase()}`)}`}
                  </span>
                  <span className="text-zinc-400">score {detail.reading.score}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <div className="bg-zinc-950 rounded p-1.5">RSI(14) <b className={`float-right ${rsiCls(detail.reading.rsi14)}`}>{detail.reading.rsi14?.toFixed(1) ?? "-"}</b></div>
                  <div className="bg-zinc-950 rounded p-1.5">MACD hist <b className="float-right">{detail.reading.macdHist != null ? fmtPricePlain(detail.reading.macdHist) : "-"}</b></div>
                  <div className="bg-zinc-950 rounded p-1.5">BB %B <b className="float-right">{detail.reading.bbPctB?.toFixed(2) ?? "-"}</b></div>
                  <div className="bg-zinc-950 rounded p-1.5">EMA20/60 <b className="float-right">{detail.reading.ema20 !== null && detail.reading.ema60 !== null ? (detail.reading.ema20 > detail.reading.ema60 ? "▲" : "▼") : "-"}</b></div>
                </div>
                <ul className="space-y-1">
                  {detail.reading.reasons.map((r, i) => (
                    <li key={i} className={r.bull ? "text-emerald-400" : "text-red-400"}>
                      {r.bull ? "▲" : "▼"} {t(`ta.reason.${r.code}`)} <span className="text-zinc-500">{reasonValue(r.code, r.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      )}

      <section>
        {loading && readings.length === 0 ? (
          <p className="text-xs text-zinc-500">{t("common.loading")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs min-w-[860px]">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">{t("ta.coin")}</th>
                  <th className="px-3 py-2 text-right">{t("ta.price")}</th>
                  <th className="px-3 py-2 text-right">24h %</th>
                  <th className="px-3 py-2 text-right">RSI</th>
                  <th className="px-3 py-2 text-right">MACD</th>
                  <th className="px-3 py-2 text-right">BB %B</th>
                  <th className="px-3 py-2 text-right">EMA</th>
                  <th className="px-3 py-2">{t("ta.signal")}</th>
                  <th className="px-3 py-2 w-28 text-right">score</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const base = baseOf(r.symbol);
                  return (
                    <tr
                      key={r.symbol}
                      onClick={() => {
                        const next = selected === r.symbol ? null : r.symbol;
                        setSelected(next);
                        if (next === null) setDetail(null);
                      }}
                      className={`border-t border-zinc-800 hover:bg-zinc-900/60 cursor-pointer ${selected === r.symbol ? "bg-zinc-900/80" : ""}`}
                    >
                      <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">${base}
                        {names[base] && <span className="ml-1.5 font-normal text-zinc-500">{names[base]}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">${fmtPrice(r.price)}</td>
                      <td className={`px-3 py-2 text-right ${r.change24h !== null && r.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {r.change24h !== null ? `${r.change24h >= 0 ? "+" : ""}${r.change24h.toFixed(1)}%` : "-"}
                      </td>
                      <td className={`px-3 py-2 text-right ${rsiCls(r.rsi14)}`}>{r.rsi14?.toFixed(1) ?? "-"}</td>
                      <td className={`px-3 py-2 text-right ${r.macdHist !== null && r.macdHist >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {r.macdHist !== null ? `${r.macdHist >= 0 ? "▲" : "▼"} ${fmtPricePlain(r.macdHist)}` : "-"}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-300">{r.bbPctB?.toFixed(2) ?? "-"}</td>
                      <td className="px-3 py-2 text-right text-zinc-300">
                        {r.ema20 !== null && r.ema60 !== null ? (r.ema20 > r.ema60 ? "▲" : "▼") : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${biasCls(r.bias)}`}>
                          {t(`ta.bias.${r.bias.toLowerCase()}`)}{r.strength !== "NONE" ? ` ${t(`ta.strength.${r.strength.toLowerCase()}`)}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 justify-end">
                          <div className="w-16 h-1.5 rounded bg-zinc-800 overflow-hidden">
                            <div
                              className={`h-full ${r.score >= 0 ? "bg-emerald-500 ml-auto" : "bg-red-500"}`}
                              style={{ width: `${Math.abs(r.score)}%`, marginLeft: r.score >= 0 ? "auto" : undefined }}
                            />
                          </div>
                          <span className="w-8 text-right text-zinc-300">{r.score}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-zinc-600 mt-3">{t("ta.disclaimer")}</p>
      </section>
    </div>
  );
}
