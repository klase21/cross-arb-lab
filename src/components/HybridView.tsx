"use client";

import { useCallback, useEffect, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";

interface HybridArbOpportunity {
  coin: string;
  stablecoin: string;
  entryCex: string;
  exitCex: string;
  dexName: string;
  chainId: string;
  cexCoinPriceUsd: number;
  dexCoinPriceUsd: number;
  spreadPct: number;
  netSpreadPct: number;
  estimatedProfitUsd: number;
  detectedAt: string;
}

export default function HybridView() {
  const [opportunities, setOpportunities] = useState<HybridArbOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/hybrid-scan");
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.opportunities)) {
        setOpportunities(data.opportunities);
        const { notifyCex } = await import("@/lib/notifications");
        for (const opp of data.opportunities as HybridArbOpportunity[]) notifyCex(opp.coin, `Hybrid@${opp.chainId}`, opp.exitCex, opp.netSpreadPct, "hybrid");
      }
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
      <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-cyan-300 font-medium">CEX &rarr; DEX &rarr; CEX Strategy</p>
          {lastUpdated && <span className="text-xs text-zinc-600">Last updated: {lastUpdated}</span>}
        </div>
        <p className="text-xs text-zinc-500 mt-1">Buy USDT on Upbit with KRW &rarr; withdraw to wallet &rarr; swap for coin on DEX &rarr; deposit to Binance &rarr; sell at CEX price.</p>
      </div>

      {opportunities.length > 0 && (
        <div className="space-y-3">
          {opportunities.map((opp, idx) => (
            <div key={`${opp.coin}-${opp.chainId}-${idx}`} className="rounded-xl border border-cyan-900/50 bg-gradient-to-r from-cyan-950/20 to-zinc-900/80 p-5 hover:border-cyan-700 transition-colors">
              <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-semibold">{opp.coin}</span>
                  <span className="px-2 py-0.5 rounded-full bg-cyan-900/60 text-cyan-300 text-xs font-medium">Hybrid</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${opp.netSpreadPct > 0.5 ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-900/60 text-emerald-400"}`}>Net +{opp.netSpreadPct.toFixed(3)}%</span>
                </div>
                <div className="text-right">
                  <p className={`text-lg font-bold ${opp.estimatedProfitUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {opp.estimatedProfitUsd >= 0 ? "+" : ""}${Math.abs(opp.estimatedProfitUsd).toFixed(2)}
                  </p>
                  <p className="text-xs text-zinc-500">est. profit / $1,000 trade</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">DEX Buy ({opp.chainId})</p>
                  <p className="font-medium">{opp.dexName}</p>
                  <p className="text-xs text-zinc-600">@ ${opp.dexCoinPriceUsd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">CEX Sell</p>
                  <p className="font-medium">{opp.exitCex}</p>
                  <p className="text-xs text-zinc-600">@ ${opp.cexCoinPriceUsd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Gross Spread</p>
                  <p className="font-medium">{opp.spreadPct.toFixed(3)}%</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Net After Fees</p>
                  <p className={`font-medium ${opp.netSpreadPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{opp.netSpreadPct >= 0 ? "+" : ""}{opp.netSpreadPct.toFixed(3)}%</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Path</p>
                  <p className="text-xs text-zinc-300">Upbit&rarr;DEX&rarr;{opp.exitCex}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {opportunities.length === 0 && !loading && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center">
          <p className="text-lg text-zinc-400 mb-2">No profitable hybrid opportunities right now</p>
          <p className="text-sm text-zinc-600">The scanner compares on-chain DEX prices against Binance prices every cycle.</p>
        </div>
      )}

      {loading && opportunities.length === 0 && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center animate-pulse"><p className="text-lg text-zinc-500">Scanning DEX and CEX prices…</p></div>
      )}
    </>
  );
}
