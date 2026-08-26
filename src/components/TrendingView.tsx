"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { useLang } from "@/lib/i18n";
import { dexscreenerEmbedUrl, dexscreenerTokenUrl } from "@/lib/dexscreener";
import { gmgnTokenUrl } from "@/lib/gmgn";

interface TrendEntry {
  chainId: string;
  tokenAddress?: string;
  url?: string;
  boostAmount: number;
  totalBoost: number;
  icon?: string;
  header?: string;
  description?: string;
}

const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum", arbitrum: "Arbitrum", polygon: "Polygon",
  base: "Base", optimism: "Optimism", bsc: "BNB Chain",
};

export default function TrendingView() {
  const { t, lang } = useLang();
  const [entries, setEntries] = useState<TrendEntry[]>([]);
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

  // clamp selection when filter changes
  useEffect(() => { setSelected(0); }, [chainFilter]);
  const active = filtered[Math.min(selected, filtered.length - 1)];
  const activeToken = active?.tokenAddress ?? "";
  const activeChain = active?.chainId ?? "ethereum";

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <p className="text-xs text-zinc-500">
          {lang === "ko"
            ? "Dexscreener 부스트 랭킹 — 좌측 목록에서 토큰을 선택하면 우측 차트가 전환됩니다."
            : "Dexscreener boost ranking — select a token on the left to switch the chart."}
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

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Left: ranked list (tab-like switching) */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden flex flex-col" style={{ maxHeight: 560 }}>
          <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/60">
            <p className="text-xs font-medium text-zinc-400">
              {lang === "ko" ? "부스트 랭킹" : "Boost Ranking"} <span className="ml-1 text-emerald-400 font-mono">{filtered.length}</span>
            </p>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.map((entry, idx) => {
              const isActive = idx === Math.min(selected, filtered.length - 1);
              return (
                <button
                  key={`${entry.chainId}-${entry.tokenAddress}-${idx}`}
                  onClick={() => setSelected(idx)}
                  className={`w-full text-left px-4 py-3 border-b border-zinc-800/60 transition-colors ${isActive ? "bg-emerald-950/40 border-l-2 border-l-emerald-500" : "hover:bg-zinc-900/70 border-l-2 border-l-transparent"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${isActive ? "text-emerald-300 font-semibold" : "text-zinc-300"}`}>
                        <span className="text-[10px] font-mono text-zinc-600 mr-1.5">#{idx + 1}</span>
                        {entry.header ?? entry.tokenAddress?.slice(0, 8) + "…"}
                      </p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">{CHAIN_LABELS[entry.chainId ?? ""] ?? entry.chainId}</p>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${isActive ? "bg-amber-500/25 text-amber-300" : "bg-amber-500/10 text-amber-400/80"}`}>
                      🔥{entry.boostAmount}
                    </span>
                  </div>
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

        {/* Right: large chart for selected token */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col" style={{ minHeight: 560 }}>
          {active ? (
            <>
              <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold truncate">{active.header ?? active.tokenAddress?.slice(0, 12) + "…"}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-medium">🔥 {lang === "ko" ? `부스트 ${active.boostAmount}` : `Boost ${active.boostAmount}`}</span>
                    <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-[11px]">{CHAIN_LABELS[activeChain] ?? activeChain}</span>
                    {active.totalBoost > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 text-[11px] font-mono">{lang === "ko" ? `누적 ${active.totalBoost}` : `Total ${active.totalBoost}`}</span>
                    )}
                  </div>
                  {active.description && <p className="text-xs text-zinc-500 mt-2 line-clamp-2 max-w-xl">{active.description}</p>}
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  {activeToken && (
                    <a href={gmgnTokenUrl(activeChain, activeToken)} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">
                      {lang === "ko" ? "GMGN 검증 →" : "GMGN check →"}
                    </a>
                  )}
                  <a
                    href={activeToken ? dexscreenerTokenUrl(activeChain, activeToken) : active.url ?? "#"}
                    target="_blank" rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline"
                  >
                    Dexscreener →
                  </a>
                </div>
              </div>
              <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 flex-1" style={{ minHeight: 440 }}>
                {activeToken ? (
                  <iframe
                    key={`${activeChain}-${activeToken}`}
                    src={dexscreenerEmbedUrl(activeChain, activeToken)}
                    style={{ width: "100%", height: "100%", minHeight: 440, border: 0 }}
                    title={`Dexscreener ${activeToken}`}
                    loading="lazy"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-zinc-600">
                    {lang === "ko" ? "차트를 사용할 수 없습니다" : "Chart unavailable"}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
              {loading ? <span className="animate-pulse">{t("common.loading")}</span> : (lang === "ko" ? "좌측에서 토큰을 선택하세요" : "Select a token on the left")}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
