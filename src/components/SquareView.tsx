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
  avatar?: string | null;
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
  avatar?: string | null;
  activity: number;
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
type PeriodFilter = "all" | "d1" | "d7" | "d30";
type ViewMode = "signals" | "assets";
type SortKey = "roi" | "views" | "recent";

const SRC_LABEL: Record<string, string> = { square: "SQ", tv: "TV", st: "ST" };

function fmtPrice(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toPrecision(4);
}

function fmtAgeShort(ms: number): string {
  const mins = Math.max(1, Math.floor((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
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
  const [periodF, setPeriodF] = useState<PeriodFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("signals");
  const [visibleCount, setVisibleCount] = useState(60);
  const [selected, setSelected] = useState<SquareSignal | null>(null);
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

  const periodMs = periodF === "d1" ? 86400000 : periodF === "d7" ? 7 * 86400000 : periodF === "d30" ? 30 * 86400000 : 0;

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    // Anchor to newest post (not wall clock): stable across renders, works on snapshots.
    let latest = 0;
    for (const s of signals) if (s.postMs > latest) latest = s.postMs;
    const cutoff = periodMs > 0 && latest > 0 ? latest - periodMs : 0;
    const list = signals.filter(s => {
      if (q && !s.asset.includes(q) && !s.author.toUpperCase().includes(q)) return false;
      if (cutoff > 0 && s.postMs < cutoff) return false;
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
  }, [signals, search, statusF, sideF, marketF, confF, sourceF, sort, periodMs]);

  // Leaderboard aggregated client-side from the filtered set (high+medium only,
  // authors namespaced per source to avoid cross-source collisions).
  const traders = useMemo<SquareTrader[]>(() => {
    let latest = 0;
    for (const s of filtered) if (s.postMs > latest) latest = s.postMs;
    const weekAgo = latest - 7 * 86400000;
    const byAuthor = new Map<string, { signals: SquareSignal[]; verified: boolean; avatar: string | null }>();
    for (const s of filtered) {
      if (s.confidence === "low") continue;
      const key = `${s.source ?? "square"}:${s.author}`;
      const g = byAuthor.get(key) ?? { signals: [], verified: false, avatar: null };
      g.signals.push(s);
      g.verified = g.verified || s.authorVerified;
      if (!g.avatar && s.avatar) g.avatar = s.avatar;
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
        avatar: g.avatar,
        activity: g.signals.filter(s => s.postMs >= weekAgo).length,
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

  const leadersByKey = useMemo(() => {
    const map = new Map<string, { avatar?: string | null }>();
    for (const x of traders) map.set(`${x.source}:${x.author}`, { avatar: x.avatar });
    return map;
  }, [traders]);

  // Per-asset aggregation (markets view): calls, win rate, ROI, bias, top trader.
  const assets = useMemo(() => {
    const byAsset = new Map<string, SquareSignal[]>();
    for (const s of filtered) {
      if (s.confidence === "low") continue;
      const g = byAsset.get(s.asset) ?? [];
      g.push(s);
      byAsset.set(s.asset, g);
    }
    return [...byAsset.entries()].map(([asset, list]) => {
      const closed = list.filter(s => s.status === "CLOSED_WIN" || s.status === "CLOSED_LOSS");
      const wins = closed.filter(s => s.status === "CLOSED_WIN").length;
      const rois = list.map(s => s.roiPct).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const avgRoi = rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : 0;
      const longs = list.filter(s => s.side === "LONG").length;
      const byTrader = new Map<string, number>();
      for (const s of list) byTrader.set(s.author, (byTrader.get(s.author) ?? 0) + 1);
      const top = [...byTrader.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        asset,
        calls: list.length,
        winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
        avgRoi,
        totalRoi: rois.reduce((a, b) => a + b, 0),
        longPct: list.length > 0 ? (longs / list.length) * 100 : 50,
        topTrader: top ? top[0] : "-",
      };
    }).sort((a, b) => b.calls - a.calls);
  }, [filtered]);

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
                  <th className="px-3 py-2 text-right">⚡</th>
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
                      <span className="inline-flex items-center gap-1.5">
                        {x.avatar
                          // eslint-disable-next-line @next/next/no-img-element -- external bnbstatic avatars; next/image would bill Vercel optimizer bandwidth
                          ? <img src={x.avatar} alt="" className="w-6 h-6 rounded-full object-cover" loading="lazy" />
                          : <span className="w-6 h-6 rounded-full bg-zinc-800 inline-flex items-center justify-center text-[10px] text-zinc-500">{x.author.slice(0, 1).toUpperCase()}</span>}
                        <button onClick={() => setSearch(x.author)} className="hover:text-emerald-400 hover:underline" title={t("square.viewCalls")}>
                          {x.author}
                        </button>
                      </span>
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
                      <td className="px-3 py-2 text-right text-amber-300" title={t("square.activityWeek")}>{x.activity}</td>
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
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold">📡 {t("square.signals")}</h2>
          <div className="flex gap-1 ml-auto">
            <button onClick={() => setViewMode("signals")} className={selBtn(viewMode === "signals")}>{t("square.viewSignals")}</button>
            <button onClick={() => setViewMode("assets")} className={selBtn(viewMode === "assets")}>{t("square.viewAssets")}</button>
          </div>
        </div>
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
          {(["all", "d1", "d7", "d30"] as PeriodFilter[]).map(s => (
            <button key={s} onClick={() => setPeriodF(s)} className={selBtn(periodF === s)}>{t(`square.period.${s}`)}</button>
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
        ) : viewMode === "assets" ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2">{t("ta.coin")}</th>
                  <th className="px-3 py-2 text-right">{t("square.callsCount")}</th>
                  <th className="px-3 py-2 text-right">{t("square.winRate")}</th>
                  <th className="px-3 py-2 text-right">{t("square.avgRoi")}</th>
                  <th className="px-3 py-2 text-right">{t("square.totalRoi")}</th>
                  <th className="px-3 py-2 text-right">Long%</th>
                  <th className="px-3 py-2">{t("square.trader")}</th>
                </tr>
              </thead>
              <tbody>
                {assets.slice(0, 30).map(a => (
                  <tr key={a.asset} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                    <td className="px-3 py-2 font-bold">${a.asset}</td>
                    <td className="px-3 py-2 text-right text-zinc-300">{a.calls}</td>
                    <td className="px-3 py-2 text-right">{a.winRate.toFixed(0)}%</td>
                    <td className={`px-3 py-2 text-right ${a.avgRoi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {a.avgRoi >= 0 ? "+" : ""}{a.avgRoi.toFixed(1)}%
                    </td>
                    <td className={`px-3 py-2 text-right font-bold ${a.totalRoi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {a.totalRoi >= 0 ? "+" : ""}{a.totalRoi.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 justify-end">
                        <div className="w-16 h-1.5 rounded bg-red-500/40 overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${Math.round(a.longPct)}%` }} />
                        </div>
                        <span className="text-zinc-400 w-9 text-right">{Math.round(a.longPct)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => { setSearch(a.asset); setViewMode("signals"); }} className="text-zinc-300 hover:text-emerald-400 hover:underline" title={t("square.viewAssetCalls")}>
                        {a.topTrader}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs min-w-[880px]">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2">{t("ta.coin")}</th>
                  <th className="px-3 py-2">{t("square.direction")}</th>
                  <th className="px-3 py-2 text-right">{t("square.entry")}</th>
                  <th className="px-3 py-2 text-right">{t("square.current")}</th>
                  <th className="px-3 py-2 text-right">
                    <button onClick={() => setSort(sort === "roi" ? "recent" : "roi")} className="hover:text-zinc-200" title={t("square.sortTip")}>
                      ROI {sort === "roi" ? "↓" : sort === "recent" ? "·" : ""}
                    </button>
                  </th>
                  <th className="px-3 py-2">{t("square.statusTitle")}</th>
                  <th className="px-3 py-2">{t("square.marketTitle")}</th>
                  <th className="px-3 py-2">{t("square.trader")}</th>
                  <th className="px-3 py-2 text-right">
                    <button onClick={() => setSort(sort === "recent" ? "roi" : "recent")} className="hover:text-zinc-200" title={t("square.sortTip")}>
                      {t("square.age")} {sort === "recent" ? "↓" : ""}
                    </button>
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, visibleCount).map(s => {
                  const watched = watch.includes(`${s.source ?? "square"}:${s.author}`);
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className="border-t border-zinc-800 hover:bg-zinc-900/60 cursor-pointer"
                    >
                      <td className="px-3 py-2 font-bold whitespace-nowrap">
                        ${s.asset}
                        <span className="ml-1.5 text-[10px] px-1 py-px rounded bg-zinc-800 text-zinc-500 font-normal">{SRC_LABEL[s.source ?? "square"] ?? "SQ"}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${s.side === "LONG" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                          {s.side === "LONG" ? t("square.buy") : t("square.sell")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-300">{s.entry !== null ? fmtPrice(s.entry) : `@${fmtPrice(s.postPrice)}`}</td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-300">{fmtPrice(s.curPrice)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${s.roiPct === null ? "text-zinc-600" : s.roiPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {s.roiPct === null ? "-" : `${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(2)}%`}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap ${
                          s.status === "CLOSED_WIN" ? "bg-emerald-500/15 text-emerald-300" :
                          s.status === "CLOSED_LOSS" ? "bg-red-500/15 text-red-300" :
                          s.status === "LIVE" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
                        }`}>
                          {s.status === "LIVE" ? "● LIVE" : s.status === "OPEN" ? t("square.status.open") : t("square.status.closed")}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 whitespace-nowrap">{s.market}{s.leverage ? ` ${s.leverage}x` : ""}</span>
                      </td>
                      <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {(leadersByKey.get(`${s.source ?? "square"}:${s.author}`)?.avatar)
                            // eslint-disable-next-line @next/next/no-img-element -- external bnbstatic avatars; next/image would bill Vercel optimizer bandwidth
                            ? <img src={leadersByKey.get(`${s.source ?? "square"}:${s.author}`)?.avatar as string} alt="" className="w-5 h-5 rounded-full object-cover" loading="lazy" />
                            : null}
                          {s.author}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500 whitespace-nowrap">{fmtAgeShort(s.postMs)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); toggleWatch(`${s.source ?? "square"}:${s.author}`); }}
                          className={watched ? "text-amber-400" : "text-zinc-600 hover:text-amber-300"}
                        >
                          {watched ? "★" : "☆"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {viewMode === "signals" && filtered.length > visibleCount && (
          <button onClick={() => setVisibleCount(v => v + 60)} className="mt-2 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500">
            {t("square.more")} ({filtered.length - visibleCount})
          </button>
        )}
        <p className="text-[11px] text-zinc-600 mt-3">{t("square.disclaimer")}</p>
      </section>

      {selected && (
        <SignalModal
          key={selected.id}
          signal={selected}
          signals={signals}
          traders={traders}
          t={t}
          lang={lang}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function CandleChart({ candles, entry, target, stop }: {
  candles: Candle[];
  entry: number | null;
  target: number | null;
  stop: number | null;
}) {
  const W = 760;
  const H = 260;
  const PAD = 8;
  const data = candles.slice(-100);
  if (data.length < 2) return <p className="text-xs text-zinc-600">-</p>;
  const lows = data.map(c => c.l);
  const highs = data.map(c => c.h);
  for (const v of [entry, target, stop]) if (v !== null && v > 0) { lows.push(v); highs.push(v); }
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const y = (p: number) => PAD + (1 - (p - min) / span) * (H - PAD * 2);
  const cw = W / data.length;
  const maxV = Math.max(...data.map(c => c.v), 1);
  const line = (v: number | null, color: string, dash?: string) => v !== null && v > 0 && v >= min && v <= max ? (
    <line x1={0} y1={y(v)} x2={W} y2={y(v)} stroke={color} strokeWidth={1.2} strokeDasharray={dash} />
  ) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-zinc-950 rounded-lg border border-zinc-800" style={{ height: 240 }}>
      {data.map((c, i) => {
        const up = c.c >= c.o;
        const col = up ? "#22c55e" : "#ef4444";
        const x = i * cw + cw / 2;
        const vh = (c.v / maxV) * H * 0.16;
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
      {line(entry, "#facc15")}
      {line(target, "#34d399", "5 3")}
      {line(stop, "#f87171", "5 3")}
    </svg>
  );
}

function Donut({ wins, losses, size = 92 }: { wins: number; losses: number; size?: number }) {
  const total = wins + losses;
  const pct = total > 0 ? wins / total : 0;
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={10} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={pct >= 0.5 ? "#34d399" : "#f87171"} strokeWidth={10}
        strokeDasharray={`${circ * pct} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fontSize={size / 4.5} fontWeight="bold" fill="#e4e4e7">
        {total > 0 ? `${Math.round(pct * 100)}%` : "-"}
      </text>
    </svg>
  );
}

function SignalModal({ signal: s, signals, traders, t, lang, onClose }: {
  signal: SquareSignal;
  signals: SquareSignal[];
  traders: SquareTrader[];
  t: (key: string) => string;
  lang: string;
  onClose: () => void;
}) {
  const basis = s.entry ?? s.postPrice;
  // Progress from entry toward TP (1.0 = target hit), SL side negative.
  let progress: number | null = null;
  if (basis !== null && basis > 0 && s.curPrice !== null) {
    if (s.side === "LONG" && s.target !== null && s.target > basis) {
      progress = Math.max(-0.25, Math.min(1.25, (s.curPrice - basis) / (s.target - basis)));
    } else if (s.side === "SHORT" && s.target !== null && s.target < basis) {
      progress = Math.max(-0.25, Math.min(1.25, (basis - s.curPrice) / (basis - s.target)));
    }
  }

  const [tf, setTf] = useState("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSeenAt(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/candles?symbol=${encodeURIComponent(s.symbol)}&interval=${tf}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.candles)) setCandles(data.candles);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [s.symbol, tf]);

  const trader = traders.find(x => x.source === (s.source ?? "square") && x.author === s.author) ?? null;
  const peers = signals
    .filter(x => x.asset === s.asset && x.id !== s.id)
    .sort((a, b) => b.postMs - a.postMs)
    .slice(0, 8);
  const mine = signals
    .filter(x => x.source === (s.source ?? "square") && x.author === s.author)
    .sort((a, b) => b.postMs - a.postMs)
    .slice(0, 12);
  const mineClosed = mine.filter(x => x.status === "CLOSED_WIN" || x.status === "CLOSED_LOSS");
  const mineWins = mineClosed.filter(x => x.status === "CLOSED_WIN").length;
  const onAsset = mine.filter(x => x.asset === s.asset);
  const onAssetClosed = onAsset.filter(x => x.status === "CLOSED_WIN" || x.status === "CLOSED_LOSS");
  const onAssetWins = onAssetClosed.filter(x => x.status === "CLOSED_WIN").length;
  const onAssetRois = onAsset.map(x => x.roiPct).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const onAssetAvg = onAssetRois.length > 0 ? onAssetRois.reduce((a, b) => a + b, 0) / onAssetRois.length : 0;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/70 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-6xl rounded-xl border border-zinc-700 bg-zinc-950 p-4 md:p-5 my-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="font-bold text-lg">${s.asset}</span>
          <span className={`text-xs px-2 py-0.5 rounded font-bold ${s.side === "LONG" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
            {s.side === "LONG" ? t("square.buy") : t("square.sell")} · {s.side}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{SRC_LABEL[s.source ?? "square"] ?? "SQ"} · {s.market}</span>
          <span className={`ml-auto text-xl font-bold ${s.roiPct === null ? "text-zinc-500" : s.roiPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {s.roiPct === null ? "-" : `${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(2)}%`}
          </span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[240px_1fr_240px]">
          {/* Left: outcome + levels + progress */}
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800 p-3">
              <p className="text-[11px] text-zinc-500 mb-1">{t("square.current")} ROI</p>
              <p className={`text-lg font-bold ${s.roiPct === null ? "text-zinc-500" : s.roiPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {s.roiPct === null ? "-" : `${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(2)}%`}
              </p>
              <span className={`inline-block mt-1 text-[11px] px-2 py-0.5 rounded font-bold ${
                s.status === "CLOSED_WIN" ? "bg-emerald-500/15 text-emerald-300" :
                s.status === "CLOSED_LOSS" ? "bg-red-500/15 text-red-300" :
                s.status === "LIVE" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
              }`}>
                {s.status === "LIVE" ? "● LIVE" : s.status === "OPEN" ? t("square.status.open") : t("square.status.closed")}{s.closeReason ? ` · ${s.closeReason}` : ""}
              </span>
            </div>
            <div className="rounded-lg border border-zinc-800 p-3 text-xs space-y-1.5">
              <p className="text-[11px] text-zinc-500 font-semibold">{t("square.levels")}</p>
              {[
                [t("square.entry"), s.entry !== null ? fmtPrice(s.entry) : `@${fmtPrice(s.postPrice)}`],
                ["TP", fmtPrice(s.target)],
                ["SL", fmtPrice(s.stop)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-zinc-500">{label}</span>
                  <b className="font-mono text-zinc-200">{value}</b>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-zinc-800 p-3 text-xs space-y-1.5">
              <p className="text-[11px] text-zinc-500 font-semibold">{t("square.outcome")}</p>
              {[
                [t("square.direction"), s.side],
                [t("square.statusTitle"), s.status],
                [t("square.result"), s.status === "CLOSED_WIN" ? "WIN" : s.status === "CLOSED_LOSS" ? "LOSS" : "-"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-zinc-500">{label}</span>
                  <b className="text-zinc-200">{value}</b>
                </div>
              ))}
            </div>
            {progress !== null && (
              <div className="rounded-lg border border-zinc-800 p-3">
                <p className="text-[11px] text-zinc-500 font-semibold mb-1.5">{t("square.progress")}</p>
                <div className="h-2 rounded bg-zinc-800 overflow-hidden">
                  <div className={`h-full ${progress >= 1 ? "bg-emerald-500" : progress >= 0 ? "bg-sky-500" : "bg-red-500"}`} style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                  <span>{t("square.entry")}</span>
                  <span>{(progress * 100).toFixed(0)}%</span>
                  <span>TP</span>
                </div>
              </div>
            )}
          </div>

          {/* Center: chart + other calls + timeline + original */}
          <div className="space-y-4 min-w-0">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                {(["15m", "1h", "4h", "1d"] as const).map(iv => (
                  <button key={iv} onClick={() => setTf(iv)} className={`px-2 py-0.5 rounded text-[11px] ${tf === iv ? "bg-amber-500/20 text-amber-300 font-bold" : "bg-zinc-800 text-zinc-500"}`}>{iv}</button>
                ))}
                <span className="ml-auto text-[10px] text-zinc-600">
                  <span className="text-yellow-400">— {t("square.entry")}</span>
                  <span className="ml-2 text-emerald-400">┄ TP</span>
                  <span className="ml-2 text-red-400">┄ SL</span>
                </span>
              </div>
              <CandleChart candles={candles} entry={s.entry ?? s.postPrice} target={s.target} stop={s.stop} />
            </div>

            <div>
              <p className="text-xs font-semibold mb-1.5">
                {t("square.otherCalls")} ${s.asset}
                <span className="ml-2 font-normal text-zinc-500">{peers.length}{t("square.tradersUnit")}</span>
              </p>
              {peers.length === 0 ? (
                <p className="text-[11px] text-zinc-600">{t("common.noData")}</p>
              ) : (
                <div className="rounded-lg border border-zinc-800 overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-zinc-900 text-zinc-500 text-left">
                        <th className="px-2 py-1.5">{t("square.trader")}</th>
                        <th className="px-2 py-1.5">{t("square.direction")}</th>
                        <th className="px-2 py-1.5 text-right">{t("square.entry")}</th>
                        <th className="px-2 py-1.5">{t("square.statusTitle")}</th>
                        <th className="px-2 py-1.5 text-right">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {peers.map(p => (
                        <tr key={p.id} className="border-t border-zinc-800/70">
                          <td className="px-2 py-1.5 text-zinc-300">{p.author}</td>
                          <td className="px-2 py-1.5">
                            <span className={`px-1.5 py-px rounded font-bold ${p.side === "LONG" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                              {p.side === "LONG" ? t("square.buy") : t("square.sell")}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-zinc-300">{p.entry !== null ? fmtPrice(p.entry) : "-"}</td>
                          <td className="px-2 py-1.5">
                            <span className={p.status === "CLOSED_WIN" ? "text-emerald-400" : p.status === "CLOSED_LOSS" ? "text-red-400" : p.status === "LIVE" ? "text-emerald-300" : "text-amber-300"}>
                              {p.status === "LIVE" ? "● LIVE" : p.status === "OPEN" ? t("square.status.open") : t("square.status.closed")}
                            </span>
                          </td>
                          <td className={`px-2 py-1.5 text-right font-mono font-bold ${p.roiPct === null ? "text-zinc-600" : p.roiPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {p.roiPct === null ? "-" : `${p.roiPct >= 0 ? "+" : ""}${p.roiPct.toFixed(1)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold mb-1.5">{t("square.timeline")}</p>
              <div className="rounded-lg border border-zinc-800 p-3 space-y-2 text-[11px]">
                {[
                  { label: t("square.posted"), time: s.postMs, dot: "bg-sky-500" },
                  { label: t("square.lastUpdated"), time: seenAt ?? s.postMs, dot: "bg-zinc-500", ago: true },
                ].map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${row.dot}`} />
                    <span className="text-zinc-400">{row.label}</span>
                    <span className="ml-auto font-mono text-zinc-300">
                      {new Date(row.time).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center mb-1.5">
                <p className="text-xs font-semibold">{t("square.originalPost")}</p>
                <a href={s.url} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-amber-300 hover:underline">
                  {t("square.original")} →
                </a>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 whitespace-pre-wrap">{s.snippet}</p>
            </div>
          </div>

          {/* Right: trader card */}
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800 p-3">
              <p className="text-[11px] text-zinc-500 font-semibold mb-2">{t("square.trader")}</p>
              <p className="text-sm font-bold">{s.author}{s.authorVerified && <span className="ml-1 text-sky-400">✓</span>}</p>
              {trader && (
                <div className="flex items-center gap-2 mt-2 text-[11px]">
                  <span className={`px-1.5 py-px rounded font-bold ${trader.style === "Scalper" ? "bg-amber-500/15 text-amber-300" : trader.style === "Swing" ? "bg-violet-500/15 text-violet-300" : "bg-zinc-800 text-zinc-500"}`}>
                    {trader.style}
                  </span>
                  <span className="px-1.5 py-px rounded bg-zinc-800 text-zinc-400 font-bold">{trader.market}</span>
                  <span className="ml-auto text-zinc-500">{t("square.callsCount")}: <b className="text-zinc-200">{trader.calls}</b></span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5 mt-2 text-[11px]">
                <div className="bg-zinc-900 rounded p-1.5">{t("square.closedCount")} <b className="float-right">{trader ? trader.wins + trader.losses : "-"}</b></div>
                <div className="bg-zinc-900 rounded p-1.5">{t("square.activeNow")} <b className="float-right">{mine.filter(x => x.status === "LIVE" || x.status === "OPEN").length}</b></div>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 p-3">
              <p className="text-[11px] text-zinc-500 font-semibold mb-1.5">{t("square.last12")}</p>
              <div className="flex gap-1">
                {mine.length === 0 && <span className="text-[11px] text-zinc-600">-</span>}
                {mine.map(x => (
                  <span
                    key={x.id}
                    title={`${x.asset} ${x.roiPct !== null ? `${x.roiPct >= 0 ? "+" : ""}${x.roiPct.toFixed(1)}%` : x.status}`}
                    className={`w-4 h-6 rounded-sm ${x.status === "CLOSED_WIN" ? "bg-emerald-500" : x.status === "CLOSED_LOSS" ? "bg-red-500" : "bg-zinc-700"}`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-zinc-600 mt-1">
                {mineWins}W / {mineClosed.length - mineWins}L · {mineClosed.length > 0 ? Math.round((mineWins / mineClosed.length) * 100) : 0}% {t("square.winRate")}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 p-3 text-center">
              <p className="text-[11px] text-zinc-500 font-semibold mb-1">{t("square.recordOn")} ${s.asset}</p>
              <div className="flex justify-center"><Donut wins={onAssetWins} losses={onAssetClosed.length - onAssetWins} /></div>
              <div className="grid grid-cols-2 gap-1 mt-2 text-[11px]">
                <div className="bg-zinc-900 rounded p-1.5">{t("square.wins")} <b className="float-right text-emerald-400">{onAssetWins}</b></div>
                <div className="bg-zinc-900 rounded p-1.5">{t("square.losses")} <b className="float-right text-red-400">{onAssetClosed.length - onAssetWins}</b></div>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1.5">{t("square.avgRoi")}: <b className={onAssetAvg >= 0 ? "text-emerald-400" : "text-red-400"}>{onAssetAvg >= 0 ? "+" : ""}{onAssetAvg.toFixed(2)}%</b></p>
            </div>
            <div className="rounded-lg border border-zinc-800 p-3 text-[11px] space-y-1">
              <p className="text-zinc-500 font-semibold">{t("square.howVerified")}</p>
              <div className="flex justify-between"><span className="text-zinc-500">{t("square.confTitle")}</span><b>{t(`square.conf.${s.confidence}`)}</b></div>
              <div className="flex justify-between"><span className="text-zinc-500">{t("square.replayed")}</span><b>{s.postPrice !== null ? t("square.yes") : t("square.no")}</b></div>
              <div className="flex justify-between"><span className="text-zinc-500">{t("square.sourceTitle")}</span><b>{SRC_LABEL[s.source ?? "square"]}</b></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
