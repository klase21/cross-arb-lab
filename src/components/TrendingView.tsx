"use client";

import { useCallback, useEffect, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { useLang } from "@/lib/i18n";
import { dexscreenerTokenUrl } from "@/lib/dexscreener";
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
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
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

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500">
          {lang === "ko"
            ? "Dexscreener 부스트 랭킹 — 시장이 밀어주는 토큰을 우리 6개 체인에서만 필터링해 신규 차익 후보를 발굴합니다."
            : "Dexscreener boost ranking — market-pushed tokens filtered to our 6 chains for new arb candidates."}
        </p>
        {lastUpdated && <p className="text-xs text-zinc-600">{t("common.lastUpdated")}: {lastUpdated}</p>}
      </div>

      {entries.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {entries.map((entry, idx) => {
            const chain = entry.chainId ?? "";
            const token = entry.tokenAddress ?? "";
            const dexUrl = token ? dexscreenerTokenUrl(chain, token) : entry.url ?? "#";
            const gmgnUrl = token ? gmgnTokenUrl(chain, token) : null;
            return (
              <div key={`${chain}-${token}-${idx}`} className="rounded-xl border border-amber-900/50 bg-gradient-to-b from-amber-950/10 to-zinc-900/60 p-5 hover:border-amber-700 transition-colors">
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{entry.header ?? token.slice(0, 10) + "…"}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{CHAIN_LABELS[chain] ?? chain}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-medium shrink-0" title="Boost amount">
                    🔥 {entry.boostAmount}
                  </span>
                </div>
                {entry.description && <p className="text-xs text-zinc-500 mb-3 line-clamp-2">{entry.description}</p>}
                <div className="flex items-center gap-3 text-xs">
                  <a href={dexUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Dexscreener →</a>
                  {gmgnUrl && (
                    <a href={gmgnUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">
                      {lang === "ko" ? "GMGN 검증 →" : "GMGN check →"}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {entries.length === 0 && !loading && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center">
          <p className="text-lg text-zinc-400 mb-2">{lang === "ko" ? "지금은 부스트된 토큰이 없습니다" : "No boosted tokens right now"}</p>
          <p className="text-sm text-zinc-600">{lang === "ko" ? "30초마다 갱신됩니다." : "Refreshing every 30 seconds."}</p>
        </div>
      )}

      {loading && entries.length === 0 && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center animate-pulse"><p className="text-lg text-zinc-500">{t("common.loading")}</p></div>
      )}
    </>
  );
}
