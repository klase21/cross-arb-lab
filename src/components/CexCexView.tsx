"use client";

import { useCallback, useEffect, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";

interface CexArbitrageOpportunity {
  coin: string;
  buyCex: string;
  sellCex: string;
  buyPriceUsd: number;
  sellPriceUsd: number;
  spreadPct: number;
  netSpreadPct: number;
  estimatedProfitUsd: number;
  detectedAt: string;
}

export default function CexCexView() {
  const [opportunities, setOpportunities] = useState<CexArbitrageOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/cex-prices");
      const data = await response.json();
      const { findCexOpportunities } = await import("@/lib/cex-arbitrage");
      const next = findCexOpportunities(data.prices ?? {});
      setOpportunities(next);
      const { notifyCex } = await import("@/lib/notifications");
      for (const opp of next) notifyCex(opp.coin, opp.buyCex, opp.sellCex, opp.netSpreadPct, "cex");
      setLastUpdated(new Date().toLocaleTimeString("ko-KR"));
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  const intervalSec = usePollingInterval();

  useEffect(() => {
    load();
    const interval = setInterval(load, intervalSec * 1000);
    return () => clearInterval(interval);
  }, [load, intervalSec]);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500">Monitoring Upbit, Bithumb, Binance, Bybit, OKX spot prices.</p>
        {lastUpdated && <p className="text-xs text-zinc-600">Last updated: {lastUpdated}</p>}
      </div>

      {opportunities.length > 0 && (
        <div className="space-y-3">
          {opportunities.map((opp, idx) => (
            <div key={`${opp.coin}-${opp.buyCex}-${opp.sellCex}-${idx}`} className="rounded-xl border border-blue-900/50 bg-gradient-to-r from-blue-950/20 to-zinc-900/80 p-5 hover:border-blue-700 transition-colors">
              <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-semibold">{opp.coin}</span>
                  <span className="px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 text-xs font-medium">CEX-to-CEX</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${opp.netSpreadPct > 0.5 ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-900/60 text-emerald-400"}`}>Net +{opp.netSpreadPct.toFixed(3)}%</span>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-emerald-400">+{opp.estimatedProfitUsd.toFixed(2)} USD</p>
                  <p className="text-xs text-zinc-500">est. profit / $1,000 trade</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Buy on</p>
                  <p className="font-medium capitalize">{opp.buyCex}</p>
                  <p className="text-xs text-zinc-600">@ ${opp.buyPriceUsd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Sell on</p>
                  <p className="font-medium capitalize">{opp.sellCex}</p>
                  <p className="text-xs text-zinc-600">@ ${opp.sellPriceUsd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Gross Spread</p>
                  <p className="font-medium">{opp.spreadPct.toFixed(3)}%</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Total Fees</p>
                  <p className="font-medium">{(opp.spreadPct - opp.netSpreadPct).toFixed(3)}%</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {opportunities.length === 0 && !loading && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center">
          <p className="text-lg text-zinc-400 mb-2">No profitable CEX-to-CEX opportunities right now</p>
          <p className="text-sm text-zinc-600">Cross-exchange spreads are within fees. Refreshing every 30 seconds.</p>
        </div>
      )}

      {loading && opportunities.length === 0 && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center animate-pulse"><p className="text-lg text-zinc-500">Loading CEX prices…</p></div>
      )}
    </>
  );
}
