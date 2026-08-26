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

const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum", arbitrum: "Arbitrum", polygon: "Polygon",
  base: "Base", optimism: "Optimism", bsc: "BNB Chain",
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

export default function TrendingView() {
  const { t, lang } = useLang();
  const [entries, setEntries] = useState<TrendToken[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [chainFilter, setChainFilter] = useState<string>("all");
  const intervalSec = usePollingInterval();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/trending");
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data.entries) ? data.entries : []);
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

  const chains = useMemo(() => {
    const set = new Set(entries.map(e => e.chainId).filter(Boolean) as string[]);
    return ["all", ...Array.from(set)];
  }, [entries]);

  const filtered = useMemo(
    () => chainFilter === "all" ? entries : entries.filter(e => e.chainId === chainFilter),
    [entries, chainFilter],
  );

  useEffect(() => { setSelected(0); }, [chainFilter]);
  const idx = Math.min(selected, Math.max(filtered.length - 1, 0));
  const active = filtered[idx];

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <p className="text-xs text-zinc-500">
          {lang === "ko"
            ? "Dexscreener 부스트 랭킹 — 좌측 목록 클릭으로 차트 전환"
            : "Dexscreener boost ranking — click a row to switch the chart"}
        </p>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-[11px]">
            {chains.map(chain => (
              <button
                key={chain}
                onClick={() => setChainFilter(chain)}
                className={`px-2.5 py-1.5 transition-colors whitespace-nowrap ${chainFilter === chain ? "bg-emerald-600 text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
              >
                {chain === "all" ? (lang === "ko" ? "전체" : "All") : CHAIN_LABELS[chain] ?? chain}
              </button>
            ))}
          </div>
          {lastUpdated && <p className="text-xs text-zinc-600">{t("common.lastUpdated")}: {lastUpdated}</p>}
        </div>
      </div>

      {/* Chart-dominant layout: narrow sidebar + full-size chart */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden flex flex-col lg:max-h-[720px]">
          <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/60">
            <p className="text-[11px] font-medium text-zinc-400">
              {lang === "ko" ? "부스트 랭킹" : "Boost Ranking"} <span className="ml-1 text-emerald-400 font-mono">{filtered.length}</span>
            </p>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.map((entry, i) => {
              const isActive = i === idx;
              const change = entry.priceChangeH24;
              return (
                <button
                  key={`${entry.chainId}-${entry.tokenAddress}`}
                  onClick={() => setSelected(i)}
                  className={`w-full text-left px-3 py-2.5 border-b border-zinc-800/60 transition-colors ${isActive ? "bg-emerald-950/40 border-l-2 border-l-emerald-500" : "hover:bg-zinc-900/70 border-l-2 border-l-transparent"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${isActive ? "text-emerald-300 font-semibold" : "text-zinc-200"}`}>
                        <span className="text-[10px] font-mono text-zinc-600 mr-1">{i + 1}</span>
                        <span className="font-semibold">{entry.symbol || "?"}</span>
                        <span className="ml-1.5 text-[10px] text-zinc-500">{CHAIN_LABELS[entry.chainId] ?? entry.chainId}</span>
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                        {fmtPrice(entry.priceUsd)}
                        <span className={`ml-1.5 ${(change ?? 0) >= 0 ? "text-red-400" : "text-sky-400"}`}>
                          {(change ?? 0) >= 0 ? "+" : ""}{(change ?? 0).toFixed(1)}%
                        </span>
                      </p>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${isActive ? "bg-amber-500/25 text-amber-300" : "bg-amber-500/10 text-amber-400/80"}`}>
                      🔥{entry.boostAmount}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1 font-mono">
                    MC {fmtUsd(entry.marketCap)} · Vol {fmtUsd(entry.volumeH24)}
                  </p>
                </button>
              );
            })}
            {filtered.length === 0 && !loading && (
              <p className="text-center text-xs text-zinc-600 py-8">{lang === "ko" ? "항목 없음" : "No items"}</p>
            )}
            {loading && entries.length === 0 && (
              <p className="text-center text-xs text-zinc-600 py-8 animate-pulse">{t("common.loading")}</p>
            )}
          </div>
        </div>

        {/* Big chart area */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 flex flex-col">
          {active ? (
            <>
              <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-wrap gap-2">
                <div className="flex items-baseline gap-3 min-w-0 flex-wrap">
                  <p className="text-lg font-bold truncate">{active.symbol}</p>
                  <p className="text-xs text-zinc-500 truncate max-w-[240px]">{active.name}</p>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-medium shrink-0">🔥 {active.boostAmount}</span>
                </div>
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
              </div>
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
