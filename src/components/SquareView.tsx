"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { useLang } from "@/lib/i18n";
import { trustScore, traderStyle } from "@/lib/square";

interface SquareSignal {
  id: string;
  source: "square" | "tv" | "st";
  postId: string;
  author: string;
  authorId?: string | null;
  authorVerified: boolean;
  asset: string;
  symbol: string;
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
  source: "square" | "tv" | "st";
  verified: boolean;
  calls: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRoi: number;
  totalRoi: number;
  trustScore: number;
  withStopPct: number;
  followers?: number | null;
  avgHoldHours?: number | null;
  longPct?: number;
  style?: "Scalper" | "Swing" | "Mixed";
  bias?: "Bull" | "Bear" | "Mixed";
  market?: "Spot" | "Futures" | "Mixed";
}

function fmtFollowers(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

type StatusFilter = "all" | "live" | "open" | "closed";
type SideFilter = "all" | "LONG" | "SHORT";
type MarketFilter = "all" | "SPOT" | "FUTURES";
type ConfFilter = "all" | "high" | "medium" | "low";
type SourceFilter = "all" | "square" | "tv" | "st";
type SortKey = "roi" | "views" | "recent";

const SRC_LABEL: Record<string, string> = { square: "SQ", tv: "TV", st: "ST" };

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
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [sideF, setSideF] = useState<SideFilter>("all");
  const [marketF, setMarketF] = useState<MarketFilter>("all");
  const [confF, setConfF] = useState<ConfFilter>("all");
  const [sourceF, setSourceF] = useState<SourceFilter>("all");
  const [showDetail, setShowDetail] = useState(false);
  const [authors, setAuthors] = useState<Record<string, { followers: number | null }>>({});
  const [tracked, setTracked] = useState<{ squareUid: string; username: string; displayName: string; followers: number; postCount: number }[]>([]);
  const [trackInput, setTrackInput] = useState("");
  const [trackMsg, setTrackMsg] = useState<string | null>(null);
  const [leaderSort, setLeaderSort] = useState<"trust" | "followers">("trust");
  const [watch, setWatch] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("roi");
  const [fng, setFng] = useState<{ value: number; label: string } | null>(null);
  const [whales, setWhales] = useState<{ base: string; netUsd: number; bias: string; prints: number }[]>([]);
  const intervalSec = usePollingInterval();

  const activeDetailCount =
    (statusF !== "all" ? 1 : 0) + (marketF !== "all" ? 1 : 0) +
    (confF !== "all" ? 1 : 0) + (sort !== "roi" ? 1 : 0);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [sqRes, tvRes, stRes, fngRes, whaleRes, trackRes] = await Promise.all([
        fetch("/api/square").catch(() => null),
        fetch("/api/tv").catch(() => null),
        fetch("/api/st").catch(() => null),
        fetch("/api/fng").catch(() => null),
        fetch("/api/whales").catch(() => null),
        fetch("/api/square/track").catch(() => null),
      ]);
      const merged: SquareSignal[] = [];
      let scannedTotal = 0;
      if (sqRes?.ok) {
        const data = await sqRes.json();
        if (Array.isArray(data.signals)) merged.push(...data.signals);
        scannedTotal += data.postsScanned ?? 0;
        if (data.authors && typeof data.authors === "object") setAuthors(data.authors);
      }
      if (tvRes?.ok) {
        const data = await tvRes.json();
        if (Array.isArray(data.signals)) merged.push(...data.signals);
        scannedTotal += data.postsScanned ?? 0;
      }
      if (stRes?.ok) {
        const data = await stRes.json();
        if (Array.isArray(data.signals)) merged.push(...data.signals);
        scannedTotal += data.postsScanned ?? 0;
      }
      if (fngRes?.ok) {
        const data = await fngRes.json();
        if (data.current) setFng({ value: data.current.value, label: data.current.label });
      }
      if (whaleRes?.ok) {
        const data = await whaleRes.json();
        if (Array.isArray(data.rows)) {
          setWhales(data.rows.filter((r: { bias: string }) => r.bias !== "NEUTRAL").slice(0, 10));
        }
      }
      if (trackRes?.ok) {
        const data = await trackRes.json();
        if (Array.isArray(data.traders)) setTracked(data.traders);
      }
      setSignals(merged);
      setScanned(scannedTotal);
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

  useEffect(() => {
    const kickoff = setTimeout(() => {
      try {
        const raw = localStorage.getItem("sqWatch");
        if (raw) setWatch(JSON.parse(raw) as string[]);
      } catch {}
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const toggleWatch = (key: string) => {
    setWatch(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      try { localStorage.setItem("sqWatch", JSON.stringify(next)); } catch {}
      return next;
    });
  };

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
      if (sourceF !== "all" && (s.source ?? "square") !== sourceF) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === "views") return b.views - a.views;
      if (sort === "recent") return b.postMs - a.postMs;
      return (b.roiPct ?? -Infinity) - (a.roiPct ?? -Infinity);
    });
  }, [signals, search, statusF, sideF, marketF, confF, sourceF, sort]);

  // Leaderboard aggregated client-side from the filtered set (high+medium only,
  // authors namespaced per source to avoid cross-source collisions).
  const traders = useMemo<SquareTrader[]>(() => {
    const byAuthor = new Map<string, { signals: SquareSignal[]; verified: boolean }>();
    for (const s of filtered) {
      if (s.confidence === "low") continue;
      const key = `${s.source ?? "square"}:${s.author}`;
      const g = byAuthor.get(key) ?? { signals: [], verified: false };
      g.signals.push(s);
      g.verified = g.verified || s.authorVerified;
      byAuthor.set(key, g);
    }
    const out: SquareTrader[] = [];
    for (const [key, g] of byAuthor) {
      const closed = g.signals.filter(s => s.status === "CLOSED_WIN" || s.status === "CLOSED_LOSS");
      const wins = closed.filter(s => s.status === "CLOSED_WIN").length;
      const losses = closed.length - wins;
      const rois = g.signals.map(s => s.roiPct).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const avgRoi = rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : 0;
      const withStop = g.signals.filter(s => s.stop !== null).length;
      const withStopPct = g.signals.length > 0 ? (withStop / g.signals.length) * 100 : 0;
      const author = key.replace(/^(square|tv|st):/, "");
      const source = (key.startsWith("tv:") ? "tv" : key.startsWith("st:") ? "st" : "square") as "square" | "tv" | "st";
      const followers = source === "square" ? (authors[key]?.followers ?? null) : null;
      const style = traderStyle(g.signals);
      out.push({
        author,
        source,
        followers,
        verified: g.verified,
        calls: g.signals.length,
        wins,
        losses,
        winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
        avgRoi,
        totalRoi: style.totalRoi,
        trustScore: trustScore(g.signals.length, wins, losses, avgRoi, withStopPct),
        withStopPct,
        avgHoldHours: style.avgHoldHours,
        longPct: style.longPct,
        style: style.style,
        bias: style.bias,
        market: style.market,
      });
    }
    return out.sort((a, b) => b.trustScore - a.trustScore || b.calls - a.calls);
  }, [filtered, authors]);

  const sortedTraders = useMemo(() => {
    if (leaderSort === "followers") {
      return [...traders].sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1) || b.calls - a.calls);
    }
    return traders;
  }, [traders, leaderSort]);

  const boardStats = useMemo(() => {
    const closed = filtered.filter(s => s.status === "CLOSED_WIN" || s.status === "CLOSED_LOSS");
    const wins = closed.filter(s => s.status === "CLOSED_WIN").length;
    const live = filtered.filter(s => s.status === "LIVE").length;
    const open = filtered.filter(s => s.status === "OPEN").length;
    const totalRoi = filtered
      .map(s => s.roiPct)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .reduce((a, b) => a + b, 0);
    return { total: filtered.length, live, open, closed: closed.length, wins, totalRoi };
  }, [filtered]);

  // One-click suggestions: most active firehose authors not yet tracked.
  // Passes squareUid directly (display names often differ from usernames).
  const suggestions = useMemo(() => {
    const trackedNames = new Set(tracked.map(t => (t.displayName || t.username).toLowerCase()));
    const counts = new Map<string, { author: string; uid: string | null; calls: number }>();
    for (const s of signals) {
      if (s.source !== "square") continue;
      const g = counts.get(s.author) ?? { author: s.author, uid: s.authorId ?? null, calls: 0 };
      g.calls++;
      if (!g.uid && s.authorId) g.uid = s.authorId;
      counts.set(s.author, g);
    }
    return [...counts.values()]
      .filter(c => c.uid && !trackedNames.has(c.author.toLowerCase()))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 5);
  }, [signals, tracked]);

  const addTracked = async (input: string) => {
    const value = input.trim();
    if (!value) return;
    setTrackMsg(null);
    try {
      const res = await fetch("/api/square/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTrackMsg(data.error ?? t("square.trackFail"));
        return;
      }
      setTrackInput("");
      setTrackMsg(t("square.trackAdded"));
      void load();
    } catch {
      setTrackMsg(t("square.trackFail"));
    }
  };

  const removeTracked = async (uid: string) => {
    try {
      await fetch(`/api/square/track?uid=${encodeURIComponent(uid)}`, { method: "DELETE" });
      setTracked(prev => prev.filter(x => x.squareUid !== uid));
    } catch {}
  };

  const trackAllSuggestions = async () => {
    setTrackMsg(null);
    let done = 0;
    for (const s of suggestions) {
      if (!s.uid) continue;
      try {
        const res = await fetch("/api/square/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: s.uid }),
        });
        if (res.ok) done++;
      } catch {}
    }
    setTrackMsg(done > 0 ? t("square.trackAdded") : t("square.trackFail"));
    void load();
  };

  const stats = useMemo(() => {
    const withClosed = traders.filter(x => x.wins + x.losses > 0);
    const avgWin = withClosed.length > 0 ? withClosed.reduce((a, x) => a + x.winRate, 0) / withClosed.length : 0;
    const best = filtered.reduce((m, s) => Math.max(m, s.roiPct ?? -Infinity), -Infinity);
    return { calls: filtered.length, traders: traders.length, avgWin, best: best === -Infinity ? null : best };
  }, [filtered, traders]);

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
        {fng !== null && (
          <><span>·</span><span title="Crypto Fear & Greed Index">F&G <b className={fng.value <= 25 ? "text-red-400" : fng.value < 45 ? "text-amber-300" : fng.value <= 55 ? "text-zinc-300" : "text-emerald-400"}>{fng.value}</b> <span className="text-zinc-500">{fng.label}</span></span></>
        )}
        <span className="ml-auto">{t("common.lastUpdated")}: {lastUpdated ?? "-"}</span>
      </div>

      {whales.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto text-[11px]">
          <span className="text-zinc-500 whitespace-nowrap">🐋 {t("square.whales")}:</span>
          {whales.map(w => (
            <span
              key={w.base}
              title={`${w.base} net ${w.netUsd >= 0 ? "+" : ""}$${Math.abs(w.netUsd) >= 1_000_000 ? `${(w.netUsd / 1_000_000).toFixed(1)}M` : `${Math.round(w.netUsd / 1000)}K`} · ${w.prints} prints`}
              className={`px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${w.bias === "ACCUMULATE" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}
            >
              ${w.base} {w.bias === "ACCUMULATE" ? "▲" : "▼"}
            </span>
          ))}
        </div>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2">👁️ {t("square.tracked")}</h2>
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <input
            value={trackInput}
            onChange={e => setTrackInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void addTracked(trackInput); }}
            placeholder={t("square.trackPlaceholder")}
            className="px-2.5 py-1 rounded-md text-xs bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 w-64"
          />
          <button onClick={() => void addTracked(trackInput)} className={selBtn(false)}>+ {t("square.trackAdd")}</button>
          {suggestions.length > 0 && (
            <button onClick={() => void trackAllSuggestions()} className={selBtn(false)}>⚡ {t("square.trackAll")}</button>
          )}
          {trackMsg && <span className="text-[11px] text-amber-300">{trackMsg}</span>}
        </div>
        {(tracked.length > 0 || suggestions.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {tracked.map(x => (
              <span key={x.squareUid} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-xs">
                <b>{x.displayName || x.username}</b>
                <span className="text-zinc-400">👥{fmtFollowers(x.followers)} · {x.postCount}{t("square.postsUnit")}</span>
                <button onClick={() => void removeTracked(x.squareUid)} className="text-zinc-500 hover:text-red-300">✕</button>
              </span>
            ))}
            {suggestions.map(s => (
              <button
                key={s.author}
                onClick={() => void addTracked(s.uid ?? s.author)}
                title={t("square.suggestTitle")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-400 hover:border-emerald-600 hover:text-emerald-300"
              >
                + {s.author} <span className="text-zinc-600">({s.calls})</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-zinc-600 mt-1.5">{t("square.trackDesc")}</p>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold">🏆 {t("square.leaderboard")}</h2>
          <div className="flex gap-1 ml-auto">
            <button onClick={() => setLeaderSort("trust")} className={selBtn(leaderSort === "trust")}>{t("square.trust")}</button>
            <button onClick={() => setLeaderSort("followers")} className={selBtn(leaderSort === "followers")}>{t("square.followers")}</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 mb-2">
          <span>📶 {t("square.calls")}: <b className="text-zinc-200">{boardStats.total}</b></span>
          <span>🟢 Live <b className="text-zinc-200">{boardStats.live}</b></span>
          <span>🕓 Open <b className="text-zinc-200">{boardStats.open}</b></span>
          <span>✅ {t("square.closedCount")}: <b className="text-zinc-200">{boardStats.closed}</b></span>
          <span>🎯 {t("square.winRate")}: <b className="text-zinc-200">{boardStats.closed > 0 ? Math.round((boardStats.wins / boardStats.closed) * 100) : 0}%</b></span>
          <span>💰 ROI: <b className={boardStats.totalRoi >= 0 ? "text-emerald-400" : "text-red-400"}>{boardStats.totalRoi >= 0 ? "+" : ""}{boardStats.totalRoi.toFixed(1)}%</b></span>
        </div>
        {sortedTraders.length === 0 ? (
          <p className="text-xs text-zinc-500">{loading ? t("common.loading") : t("common.noData")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs min-w-[860px]">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">{t("square.trader")}</th>
                  <th className="px-3 py-2">{t("square.style")}</th>
                  <th className="px-3 py-2 text-right">{t("square.winRate")}</th>
                  <th className="px-3 py-2 text-right">{t("square.totalRoi")}</th>
                  <th className="px-3 py-2 text-right">{t("square.avgHold")}</th>
                  <th className="px-3 py-2 text-right">W-L</th>
                  <th className="px-3 py-2 text-right">{t("square.callsCount")}</th>
                  <th className="px-3 py-2 text-right">{t("square.followers")}</th>
                  <th className="px-3 py-2 w-32">{t("square.trust")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedTraders.slice(0, 20).map((x, i) => {
                  const watched = watch.includes(`${x.source}:${x.author}`);
                  return (
                    <tr key={`${x.source}:${x.author}`} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                      <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">
                        <button onClick={() => setSearch(x.author)} className="hover:text-emerald-400 hover:underline" title={t("square.viewCalls")}>
                          {x.author}
                        </button>
                        {x.verified && <span className="ml-1 text-sky-400">✓</span>}
                        <span className="ml-1.5 text-[10px] px-1 py-px rounded bg-zinc-800 text-zinc-500">{SRC_LABEL[x.source] ?? x.source}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex gap-1">
                          <span className={`text-[10px] px-1.5 py-px rounded font-bold ${x.style === "Scalper" ? "bg-amber-500/15 text-amber-300" : x.style === "Swing" ? "bg-violet-500/15 text-violet-300" : "bg-zinc-800 text-zinc-500"}`}>
                            {x.style ?? "-"}
                          </span>
                          <span className={`text-[10px] px-1.5 py-px rounded font-bold ${x.market === "Futures" ? "bg-yellow-500/15 text-yellow-300" : x.market === "Spot" ? "bg-sky-500/15 text-sky-300" : "bg-zinc-800 text-zinc-500"}`}>
                            {x.market ?? "-"}
                          </span>
                          <span className={`text-[10px] px-1.5 py-px rounded font-bold ${x.bias === "Bull" ? "bg-emerald-500/15 text-emerald-300" : x.bias === "Bear" ? "bg-red-500/15 text-red-300" : "bg-zinc-800 text-zinc-500"}`}>
                            {x.bias ?? "-"}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="font-bold">{x.winRate.toFixed(0)}%</span>
                        <span className="block h-1 rounded bg-zinc-800 overflow-hidden mt-0.5">
                          <span className="block h-full bg-emerald-500" style={{ width: `${Math.round(x.winRate)}%` }} />
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right font-bold ${x.totalRoi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {x.totalRoi >= 0 ? "+" : ""}{x.totalRoi.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-400">
                        {x.avgHoldHours === null || x.avgHoldHours === undefined ? "-" : x.avgHoldHours < 1 ? `${Math.round(x.avgHoldHours * 60)}m` : x.avgHoldHours < 48 ? `${x.avgHoldHours.toFixed(1)}h` : `${(x.avgHoldHours / 24).toFixed(1)}d`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-emerald-400">{x.wins}</span>
                        <span className="text-zinc-600">/</span>
                        <span className="text-red-400">{x.losses}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-300">{x.calls}</td>
                      <td className="px-3 py-2 text-right text-zinc-300">{fmtFollowers(x.followers)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded bg-zinc-800 overflow-hidden">
                            <div className={`h-full ${trustCls(x.trustScore)}`} style={{ width: `${x.trustScore}%` }} />
                          </div>
                          <span className="text-zinc-300 w-7 text-right">{x.trustScore}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => toggleWatch(`${x.source}:${x.author}`)} className={watched ? "text-amber-400" : "text-zinc-600 hover:text-amber-300"} title={t("square.watch")}>
                            {watched ? "★" : "☆"}
                          </button>
                          {x.source === "square" && (
                            <a href={`https://www.binance.com/en/square/profile/${encodeURIComponent(x.author)}`} target="_blank" rel="noreferrer" className="text-zinc-600 hover:text-zinc-300" title={t("square.profile")}>👁</a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
          {(["all", "square", "tv", "st"] as SourceFilter[]).map(s => (
            <button key={s} onClick={() => setSourceF(s)} className={selBtn(sourceF === s)}>{t(`square.src.${s}`)}</button>
          ))}
          {(["all", "LONG", "SHORT"] as SideFilter[]).map(s => (
            <button key={s} onClick={() => setSideF(s)} className={selBtn(sideF === s)}>
              {s === "all" ? t("square.all") : s}
            </button>
          ))}
          <button onClick={() => setShowDetail(v => !v)} className={selBtn(showDetail)}>
            {t("square.detail")}{activeDetailCount > 0 ? ` (${activeDetailCount})` : ""} {showDetail ? "▴" : "▾"}
          </button>
        </div>
        {showDetail && (
          <div className="flex flex-wrap gap-1.5 mb-3 pl-1 border-l-2 border-zinc-800">
            {(["all", "live", "open", "closed"] as StatusFilter[]).map(s => (
              <button key={s} onClick={() => setStatusF(s)} className={selBtn(statusF === s)}>{t(`square.status.${s}`)}</button>
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
        )}

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
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{SRC_LABEL[s.source ?? "square"] ?? "SQ"}</span>
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
