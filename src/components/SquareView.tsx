"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { useLang } from "@/lib/i18n";

interface SquareSignal {
  id: string;
  author: string;
  authorVerified: boolean;
  asset: string;
  side: "LONG" | "SHORT";
  market: "SPOT" | "FUTURES";
  confidence: "high" | "medium" | "low";
  entry: number | null;
  target: number | null;
  stop: number | null;
  leverage: number | null;
  postMs: number;
  postPrice: number | null;
  curPrice: number | null;
  roiPct: number | null;
  status: "OPEN" | "LIVE" | "CLOSED_WIN" | "CLOSED_LOSS";
  closeReason: string | null;
  views: number;
  likes: number;
  snippet: string;
  url: string;
  ai?: boolean;
}

interface SquareTrader {
  author: string;
  verified: boolean;
  calls: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRoi: number;
  trustScore: number;
  withStopPct: number;
}

type StatusFilter = "all" | "live" | "open" | "closed";
type SideFilter = "all" | "LONG" | "SHORT";
type MarketFilter = "all" | "SPOT" | "FUTURES";
type ConfFilter = "all" | "high" | "medium" | "low";
type SortKey = "roi" | "views" | "recent";

function fmtPrice(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toPrecision(4);
}

function fmtAge(ms: number, lang: string): string {
  const h = Math.max(1, Math.floor((Date.now() - ms) / 3600000));
  if (h < 24) return lang === "ko" ? `${h}시간 전` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return lang === "ko" ? `${d}일 전` : `${d}d ago`;
}

function trustCls(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 50) return "bg-lime-500";
  if (score >= 30) return "bg-amber-500";
  return "bg-red-500";
}

export default function SquareView() {
  const { t, lang } = useLang();
  const [signals, setSignals] = useState<SquareSignal[]>([]);
  const [traders, setTraders] = useState<SquareTrader[]>([]);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [sideF, setSideF] = useState<SideFilter>("all");
  const [marketF, setMarketF] = useState<MarketFilter>("all");
  const [confF, setConfF] = useState<ConfFilter>("all");
  const [sort, setSort] = useState<SortKey>("roi");
  const intervalSec = usePollingInterval();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/square");
      if (res.ok) {
        const data = await res.json();
        setSignals(Array.isArray(data.signals) ? data.signals : []);
        setTraders(Array.isArray(data.traders) ? data.traders : []);
        setScanned(data.postsScanned ?? 0);
      }
      setLastUpdated(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {} finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    const kickoff = setTimeout(() => { void load(); }, 0);
    const interval = setInterval(load, Math.max(intervalSec, 60) * 1000);
    return () => { clearTimeout(kickoff); clearInterval(interval); };
  }, [load, intervalSec]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const list = signals.filter(s => {
      if (q && !s.asset.includes(q) && !s.author.toUpperCase().includes(q)) return false;
      if (statusF === "live" && s.status !== "LIVE") return false;
      if (statusF === "open" && s.status !== "OPEN") return false;
      if (statusF === "closed" && s.status !== "CLOSED_WIN" && s.status !== "CLOSED_LOSS") return false;
      if (sideF !== "all" && s.side !== sideF) return false;
      if (marketF !== "all" && s.market !== marketF) return false;
      if (confF !== "all" && s.confidence !== confF) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === "views") return b.views - a.views;
      if (sort === "recent") return b.postMs - a.postMs;
      return (b.roiPct ?? -Infinity) - (a.roiPct ?? -Infinity);
    });
  }, [signals, search, statusF, sideF, marketF, confF, sort]);

  const stats = useMemo(() => {
    const withClosed = traders.filter(x => x.wins + x.losses > 0);
    const avgWin = withClosed.length > 0 ? withClosed.reduce((a, x) => a + x.winRate, 0) / withClosed.length : 0;
    const best = signals.reduce((m, s) => Math.max(m, s.roiPct ?? -Infinity), -Infinity);
    return { calls: signals.length, traders: traders.length, avgWin, best: best === -Infinity ? null : best };
  }, [signals, traders]);

  const selBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${active ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`;

  return (
    <div className="space-y-6">
      <p className="text-[11px] text-violet-300/90 rounded-lg border border-violet-800/50 bg-violet-950/30 px-3 py-2">{t("square.beta")}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span>{t("square.scanned")}: <b className="text-zinc-200">{scanned}</b></span>
        <span>·</span>
        <span>{t("square.calls")}: <b className="text-zinc-200">{stats.calls}</b></span>
        <span>·</span>
        <span>{t("square.traders")}: <b className="text-zinc-200">{stats.traders}</b></span>
        <span>·</span>
        <span>{t("square.avgWin")}: <b className="text-zinc-200">{stats.avgWin.toFixed(1)}%</b></span>
        {stats.best !== null && (
          <><span>·</span><span>{t("square.bestRoi")}: <b className={stats.best >= 0 ? "text-emerald-400" : "text-red-400"}>{stats.best >= 0 ? "+" : ""}{stats.best.toFixed(1)}%</b></span></>
        )}
        <span className="ml-auto">{t("common.lastUpdated")}: {lastUpdated ?? "-"}</span>
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">🏆 {t("square.leaderboard")}</h2>
        {traders.length === 0 ? (
          <p className="text-xs text-zinc-500">{loading ? t("common.loading") : t("common.noData")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">{t("square.trader")}</th>
                  <th className="px-3 py-2 text-right">{t("square.callsCount")}</th>
                  <th className="px-3 py-2 text-right">W-L</th>
                  <th className="px-3 py-2 text-right">{t("square.winRate")}</th>
                  <th className="px-3 py-2 text-right">{t("square.avgRoi")}</th>
                  <th className="px-3 py-2 w-40">{t("square.trust")}</th>
                </tr>
              </thead>
              <tbody>
                {traders.slice(0, 10).map((x, i) => (
                  <tr key={x.author} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                    <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{x.author}{x.verified && <span className="ml-1 text-sky-400">✓</span>}</td>
                    <td className="px-3 py-2 text-right">{x.calls}</td>
                    <td className="px-3 py-2 text-right text-zinc-400">{x.wins}-{x.losses}</td>
                    <td className="px-3 py-2 text-right">{x.winRate.toFixed(0)}%</td>
                    <td className={`px-3 py-2 text-right font-medium ${x.avgRoi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {x.avgRoi >= 0 ? "+" : ""}{x.avgRoi.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded bg-zinc-800 overflow-hidden">
                          <div className={`h-full ${trustCls(x.trustScore)}`} style={{ width: `${x.trustScore}%` }} />
                        </div>
                        <span className="text-zinc-300 w-7 text-right">{x.trustScore}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">📡 {t("square.signals")}</h2>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("square.searchPlaceholder")}
            className="px-2.5 py-1 rounded-md text-xs bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 w-44"
          />
          {(["all", "live", "open", "closed"] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatusF(s)} className={selBtn(statusF === s)}>{t(`square.status.${s}`)}</button>
          ))}
          {(["all", "LONG", "SHORT"] as SideFilter[]).map(s => (
            <button key={s} onClick={() => setSideF(s)} className={selBtn(sideF === s)}>
              {s === "all" ? t("square.all") : s}
            </button>
          ))}
          {(["all", "SPOT", "FUTURES"] as MarketFilter[]).map(s => (
            <button key={s} onClick={() => setMarketF(s)} className={selBtn(marketF === s)}>
              {s === "all" ? t("square.allMarkets") : s}
            </button>
          ))}
          {(["all", "high", "medium", "low"] as ConfFilter[]).map(s => (
            <button key={s} onClick={() => setConfF(s)} className={selBtn(confF === s)}>{t(`square.conf.${s}`)}</button>
          ))}
          {(["roi", "views", "recent"] as SortKey[]).map(s => (
            <button key={s} onClick={() => setSort(s)} className={selBtn(sort === s)}>↓ {t(`square.sort.${s}`)}</button>
          ))}
        </div>

        {loading && signals.length === 0 ? (
          <p className="text-xs text-zinc-500">{t("common.loading")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-zinc-500">{t("common.noData")}</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {filtered.slice(0, 60).map(s => (
              <a
                key={s.id}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 hover:border-zinc-600 transition-colors block"
              >
                <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                  <span className="font-bold text-sm">${s.asset}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${s.side === "LONG" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{s.side}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{s.market}{s.leverage ? ` ${s.leverage}x` : ""}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.confidence === "high" ? "bg-sky-500/15 text-sky-300" : s.confidence === "medium" ? "bg-amber-500/15 text-amber-300" : "bg-zinc-800 text-zinc-500"}`}>
                    {t(`square.conf.${s.confidence}`)}
                  </span>
                  {s.ai && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300" title="LLM refined">AI</span>
                  )}
                  <span className={`ml-auto text-sm font-bold ${s.roiPct === null ? "text-zinc-500" : s.roiPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {s.roiPct === null ? "-" : `${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(1)}%`}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 line-clamp-2 mb-2">{s.snippet}</p>
                <div className="flex items-center gap-2 text-[11px] text-zinc-500 flex-wrap">
                  <span>{t("square.entry")}: <b className="text-zinc-300">{s.entry !== null ? fmtPrice(s.entry) : `@${fmtPrice(s.postPrice)}`}</b></span>
                  {s.target !== null && <span>TP: <b className="text-zinc-300">{fmtPrice(s.target)}</b></span>}
                  {s.stop !== null && <span>SL: <b className="text-zinc-300">{fmtPrice(s.stop)}</b></span>}
                  <span className={`px-1.5 py-0.5 rounded ${
                    s.status === "CLOSED_WIN" ? "bg-emerald-500/15 text-emerald-300" :
                    s.status === "CLOSED_LOSS" ? "bg-red-500/15 text-red-300" :
                    s.status === "LIVE" ? "bg-sky-500/15 text-sky-300" : "bg-zinc-800 text-zinc-400"
                  }`}>
                    {t(`square.status.${s.status === "CLOSED_WIN" || s.status === "CLOSED_LOSS" ? "closed" : s.status.toLowerCase()}`)}{s.closeReason ? ` · ${s.closeReason}` : ""}
                  </span>
                  <span className="ml-auto">{s.author} · {fmtAge(s.postMs, lang)} · 👁 {s.views}</span>
                </div>
              </a>
            ))}
          </div>
        )}
        <p className="text-[11px] text-zinc-600 mt-3">{t("square.disclaimer")}</p>
      </section>
    </div>
  );
}
