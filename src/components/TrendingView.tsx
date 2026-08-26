"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { useLang } from "@/lib/i18n";
import { dexscreenerEmbedUrl } from "@/lib/dexscreener";

interface TrendToken {
  chainId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCap: number;
  fdv: number;
  liquidityUsd: number;
  volumeH24: number;
  volumeH1: number;
  priceChangeH24: number;
  priceChangeH1: number;
  dexId: string;
  pairCreatedAt?: number;
  boostAmount: number;
  totalBoost: number;
  description?: string;
}

interface CexListing {
  symbol: string;
  name: string;
  source: "binance" | "upbit" | "cmc";
  title?: string;
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  percentChange24h: number;
  dateIso: string;
}

type UnifiedEntry =
  | ({ kind: "dex"; sortScore: number } & TrendToken)
  | ({ kind: "listing"; sortScore: number } & CexListing);

const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum", arbitrum: "Arbitrum", polygon: "Polygon",
  base: "Base", optimism: "Optimism", bsc: "BNB Chain",
};

const SOURCE_BADGES: Record<string, { label: string; cls: string }> = {
  dex: { label: "DEX", cls: "bg-amber-500/15 text-amber-300" },
  binance: { label: "Binance", cls: "bg-yellow-500/15 text-yellow-300" },
  upbit: { label: "Upbit", cls: "bg-sky-500/15 text-sky-300" },
  cmc: { label: "CMC", cls: "bg-violet-500/15 text-violet-300" },
};

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  if (n > 0) return `$${n.toPrecision(4)}`;
  return "-";
}

function fmtAge(createdMs?: number, lang = "ko"): string {
  if (!createdMs) return "-";
  const days = Math.floor((Date.now() - createdMs) / 86400000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - createdMs) / 3600000);
    return lang === "ko" ? `${Math.max(hours, 1)}시간` : `${Math.max(hours, 1)}h`;
  }
  return lang === "ko" ? `${days}일` : `${days}d`;
}

function fmtDate(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function recencyScore(iso: string): number {
  const hours = (Date.now() - Date.parse(iso)) / 3600000;
  if (!Number.isFinite(hours)) return 0;
  return Math.max(0, 300 - hours);
}

export default function TrendingView() {
  const { t, lang } = useLang();
  const [dex, setDex] = useState<TrendToken[]>([]);
  const [listings, setListings] = useState<CexListing[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const intervalSec = usePollingInterval();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/trending");
      if (res.ok) {
        const data = await res.json();
        setDex(Array.isArray(data.dex) ? data.dex : []);
        setListings(Array.isArray(data.listings) ? data.listings : []);
      }
      setLastUpdated(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {} finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    load();
    const interval = setInterval(load, Math.max(intervalSec, 30) * 1000);
    return () => clearInterval(interval);
  }, [load, intervalSec]);

  const unified = useMemo<UnifiedEntry[]>(() => {
    const dexEntries: UnifiedEntry[] = dex.map(d => ({ kind: "dex" as const, sortScore: d.boostAmount, ...d }));
    const listingEntries: UnifiedEntry[] = listings.map(l => ({ kind: "listing" as const, sortScore: recencyScore(l.dateIso), ...l }));
    return [...dexEntries, ...listingEntries].sort((a, b) => b.sortScore - a.sortScore);
  }, [dex, listings]);

  useEffect(() => { setSelected(0); }, [unified.length]);
  const idx = Math.min(selected, Math.max(unified.length - 1, 0));
  const active = unified[idx];

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <p className="text-xs text-zinc-500">
          {lang === "ko"
            ? "트렌딩 토큰 — DEX 부스트 + 바이낸스/업비트 신규 상장 + CMC 신규 등록을 하나의 랭킹으로 통합. 좌측 클릭으로 상세 전환."
            : "Trending tokens — DEX boosts + Binance/Upbit listings + CMC entries in one ranking. Click a row for details."}
        </p>
        {lastUpdated && <p className="text-xs text-zinc-600">{t("common.lastUpdated")}: {lastUpdated}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-3">
        {/* Unified ranked list */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden flex flex-col lg:max-h-[720px]">
          <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/60">
            <p className="text-[11px] font-medium text-zinc-400">
              {lang === "ko" ? "트렌딩 랭킹" : "Trending"} <span className="ml-1 text-emerald-400 font-mono">{unified.length}</span>
            </p>
          </div>
          <div className="overflow-y-auto flex-1">
            {unified.map((entry, i) => {
              const isActive = i === idx;
              const badge = SOURCE_BADGES[entry.kind === "dex" ? "dex" : entry.source];
              const change = entry.kind === "dex" ? entry.priceChangeH24 : entry.percentChange24h;
              const hasPrice = entry.kind === "dex" ? entry.priceUsd > 0 : entry.marketCap > 0;
              return (
                <button
                  key={entry.kind === "dex" ? `dex-${entry.chainId}-${entry.tokenAddress}` : `lst-${entry.source}-${entry.symbol}-${i}`}
                  onClick={() => setSelected(i)}
                  className={`w-full text-left px-3 py-2.5 border-b border-zinc-800/60 transition-colors ${isActive ? "bg-emerald-950/40 border-l-2 border-l-emerald-500" : "hover:bg-zinc-900/70 border-l-2 border-l-transparent"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${isActive ? "text-emerald-300 font-semibold" : "text-zinc-200"}`}>
                        <span className="text-[10px] font-mono text-zinc-600 mr-1">{i + 1}</span>
                        <span className="font-semibold">{entry.symbol || "?"}</span>
                        {entry.kind === "dex" && <span className="ml-1.5 text-[10px] text-zinc-500">{CHAIN_LABELS[entry.chainId] ?? entry.chainId}</span>}
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5 truncate max-w-[180px]">{entry.kind === "listing" ? entry.name : entry.name || entry.dexId}</p>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${badge?.cls ?? "bg-zinc-800 text-zinc-400"}`}>
                      {entry.kind === "dex" ? `DEX 🔥${entry.boostAmount}` : badge?.label ?? entry.source}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono mt-1">
                    {hasPrice ? (
                      <>
                        <span className="text-zinc-400">{fmtPrice(entry.priceUsd)}</span>
                        <span className={`ml-1.5 ${(change ?? 0) >= 0 ? "text-red-400" : "text-sky-400"}`}>
                          {(change ?? 0) >= 0 ? "+" : ""}{(change ?? 0).toFixed(1)}%
                        </span>
                        {entry.kind === "dex"
                          ? <span className="ml-1.5 text-zinc-600">MC {fmtUsd(entry.marketCap)}</span>
                          : <span className="ml-1.5 text-zinc-600">{fmtDate(entry.dateIso, lang)}</span>}
                      </>
                    ) : (
                      <span className="text-zinc-600">{entry.kind === "listing" ? fmtDate(entry.dateIso, lang) : "-"}</span>
                    )}
                  </p>
                </button>
              );
            })}
            {unified.length === 0 && !loading && (
              <p className="text-center text-xs text-zinc-600 py-8">{lang === "ko" ? "항목 없음" : "No items"}</p>
            )}
            {loading && unified.length === 0 && (
              <p className="text-center text-xs text-zinc-600 py-8 animate-pulse">{t("common.loading")}</p>
            )}
          </div>
        </div>

        {/* Detail panel: chart for dex tokens, info for listings */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 flex flex-col">
          {active ? (
            <>
              <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-wrap gap-2">
                <div className="flex items-baseline gap-3 min-w-0 flex-wrap">
                  <p className="text-lg font-bold truncate">{active.symbol}</p>
                  <p className="text-xs text-zinc-500 truncate max-w-[260px]">{active.name}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${SOURCE_BADGES[active.kind === "dex" ? "dex" : active.source]?.cls ?? "bg-zinc-800 text-zinc-400"}`}>
                    {active.kind === "dex" ? `DEX 🔥 ${active.boostAmount}` : (SOURCE_BADGES[active.source]?.label ?? active.source)}
                  </span>
                </div>
                {active.kind === "dex" && (
                  <div className="flex items-center gap-4 text-xs font-mono shrink-0 flex-wrap">
                    <span className="text-zinc-300">{fmtPrice(active.priceUsd)}</span>
                    <span className={(active.priceChangeH24 ?? 0) >= 0 ? "text-red-400" : "text-sky-400"}>
                      24h {(active.priceChangeH24 ?? 0) >= 0 ? "+" : ""}{(active.priceChangeH24 ?? 0).toFixed(1)}%
                    </span>
                    <span className="text-zinc-500">{lang === "ko" ? "시총" : "MC"} {fmtUsd(active.marketCap)}</span>
                    <span className="text-zinc-500">Vol {fmtUsd(active.volumeH24)}</span>
                    <span className="text-zinc-500">Liq {fmtUsd(active.liquidityUsd)}</span>
                    <span className="text-zinc-600">{lang === "ko" ? "상장" : "Age"} {fmtAge(active.pairCreatedAt, lang)}</span>
                  </div>
                )}
              </div>

              {active.kind === "dex" ? (
                <div className="px-2 pb-2 flex-1">
                  <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
                    <iframe
                      key={`${active.chainId}-${active.tokenAddress}`}
                      src={dexscreenerEmbedUrl(active.chainId, active.tokenAddress)}
                      style={{ width: "100%", height: "68vh", minHeight: 560, border: 0, display: "block" }}
                      title={`Dexscreener ${active.symbol}`}
                      loading="lazy"
                    />
                  </div>
                </div>
              ) : (
                <div className="px-4 pb-4 flex-1 flex flex-col">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 flex-1 flex flex-col justify-center">
                    <p className="text-xs text-zinc-500 mb-2">{fmtDate(active.dateIso, lang)}</p>
                    {active.title && <p className="text-base font-medium text-zinc-200 mb-4">{active.title}</p>}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
                        <p className="text-[10px] text-zinc-500 mb-1">{lang === "ko" ? "심볼" : "Symbol"}</p>
                        <p className="font-bold">{active.symbol}</p>
                      </div>
                      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
                        <p className="text-[10px] text-zinc-500 mb-1">{lang === "ko" ? "가격" : "Price"}</p>
                        <p className="font-bold font-mono">{active.priceUsd > 0 ? fmtPrice(active.priceUsd) : "-"}</p>
                      </div>
                      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
                        <p className="text-[10px] text-zinc-500 mb-1">{lang === "ko" ? "시총" : "MCap"}</p>
                        <p className="font-bold font-mono">{active.marketCap > 0 ? fmtUsd(active.marketCap) : "-"}</p>
                      </div>
                      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
                        <p className="text-[10px] text-zinc-500 mb-1">24h</p>
                        <p className={`font-bold font-mono ${active.marketCap > 0 ? ((active.percentChange24h ?? 0) >= 0 ? "text-red-400" : "text-sky-400") : "text-zinc-500"}`}>
                          {active.marketCap > 0 ? `${(active.percentChange24h ?? 0) >= 0 ? "+" : ""}${(active.percentChange24h ?? 0).toFixed(1)}%` : "-"}
                        </p>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-600 mt-4">
                      {lang === "ko"
                        ? "공지 기반 상장 정보입니다. DEX 풀이 형성되면 차트가 표시됩니다."
                        : "Announcement-based listing. Chart appears once a DEX pool forms."}
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-zinc-500" style={{ minHeight: 560 }}>
              {loading ? <span className="animate-pulse">{t("common.loading")}</span> : (lang === "ko" ? "좌측에서 토큰을 선택하세요" : "Select a token on the left")}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
