"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";

interface DexQuote {
  dex: string;
  price: number;
  feeTier: number;
}

interface ChainQuoteResult {
  chainId: string;
  pair: string;
  quotes: DexQuote[];
}

interface ChainPriceResponse {
  pairs: { pair: string; chains: ChainQuoteResult[] }[];
  timestamp: string;
}

const CHAIN_NAMES: Record<string, string> = {
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  base: "Base",
  optimism: "Optimism",
  bsc: "BNB Chain",
};

const CHAIN_DOTS: Record<string, string> = {
  ethereum: "bg-indigo-400",
  arbitrum: "bg-sky-400",
  polygon: "bg-violet-400",
  base: "bg-blue-400",
  optimism: "bg-red-400",
  bsc: "bg-yellow-400",
};

function normalizeDexName(name: string): string {
  return name.replace(/\s*\((Arb|Arbitrum|Polygon|Base|Opt|Optimism|ETH|BSC|Ethereum)\)$/i, "").trim();
}

function formatPrice(value: number) {
  if (value >= 1_000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

// Only these web-API quote rows are shown on this page; raw on-chain pool
// quotes stay available to the arbitrage engine but are hidden here.
const WEB_API_DEXES = new Set(["sushi aggregator", "uniswap quote api"]);

interface CompareCell {
  chainId: string;
  price: number;
  feeTier: number;
}

interface PairCompare {
  pair: string;
  cells: CompareCell[];
  low: number;
  high: number;
  spreadPct: number;
}

interface DexGroup {
  dex: string;
  pairs: PairCompare[];
}

export default function DexCompareView() {
  const [data, setData] = useState<ChainPriceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPrices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/chain-prices");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load live DEX prices");
    } finally {
      setLoading(false);
    }
  }, []);

  const intervalSec = usePollingInterval();

  useEffect(() => {
    const initialLoad = window.setTimeout(loadPrices, 0);
    const interval = window.setInterval(loadPrices, intervalSec * 1000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadPrices, intervalSec]);

  const groups = useMemo<DexGroup[]>(() => {
    if (!data) return [];
    const byDex = new Map<string, Map<string, PairCompare>>();
    for (const { pair, chains } of data.pairs) {
      // One cell per chain per DEX family; dedupe repeated DEX entries on a chain
      const seen = new Set<string>();
      const cellsByDex = new Map<string, CompareCell[]>();
      for (const chain of chains) {
        for (const quote of chain.quotes) {
          if (!WEB_API_DEXES.has(quote.dex.toLowerCase())) continue;
          const dex = normalizeDexName(quote.dex);
          const key = `${dex}|${chain.chainId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!cellsByDex.has(dex)) cellsByDex.set(dex, []);
          cellsByDex.get(dex)!.push({ chainId: chain.chainId, price: quote.price, feeTier: quote.feeTier });
        }
      }
      for (const [dex, cells] of cellsByDex) {
        if (new Set(cells.map(cell => cell.chainId)).size < 2) continue;
        const sorted = [...cells].sort((left, right) => left.price - right.price);
        const low = sorted[0].price;
        const high = sorted[sorted.length - 1].price;
        const compare: PairCompare = {
          pair,
          cells: sorted,
          low,
          high,
          spreadPct: ((high - low) / low) * 100,
        };
        if (!byDex.has(dex)) byDex.set(dex, new Map());
        byDex.get(dex)!.set(pair, compare);
      }
    }
    return Array.from(byDex.entries())
      .map(([dex, pairMap]) => ({
        dex,
        pairs: Array.from(pairMap.values()).sort((left, right) => right.spreadPct - left.spreadPct),
      }))
      .filter(group => group.pairs.length > 0)
      .sort((left, right) =>
        Math.max(...right.pairs.map(p => p.spreadPct)) - Math.max(...left.pairs.map(p => p.spreadPct)),
      );
  }, [data]);

  const allCompared = useMemo(() => groups.flatMap(group => group.pairs), [groups]);

  return (
    <>
      <div className="flex items-center justify-end mb-6">
        <button onClick={loadPrices} disabled={loading} className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 disabled:opacity-50 text-sm text-zinc-300">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

        {error && <div className="mb-6 rounded-lg border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="DEX sources" value={String(groups.length)} />
          <StatCard label="Assets compared" value={String(allCompared.length)} accent />
          <StatCard label="Chains covered" value={String(new Set(allCompared.flatMap(pair => pair.cells.map(cell => cell.chainId))).size)} />
          <StatCard label="Widest spread" value={allCompared.length ? `${Math.max(...allCompared.map(pair => pair.spreadPct)).toFixed(3)}%` : "—"} accent="text-amber-300" />
        </div>

        {groups.map(group => (
          <section key={group.dex} className="mb-10">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {group.dex}
                <span className="text-xs font-normal text-zinc-500">{group.pairs.length} asset{group.pairs.length === 1 ? "" : "s"}</span>
              </h2>
              <span className="text-xs text-zinc-600">{Array.from(new Set(group.pairs.flatMap(pair => pair.cells.map(cell => cell.chainId))).values()).map(chainId => CHAIN_NAMES[chainId] ?? chainId).join(" · ")}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {group.pairs.map(compare => (
                <PairCard key={`${group.dex}-${compare.pair}`} compare={compare} />
              ))}
            </div>
          </section>
        ))}

        {groups.length === 0 && !loading && !error && (
          <div className="rounded-xl border border-zinc-800 p-10 text-center text-zinc-500">
            No asset is currently quoted on two or more chains by the same DEX.
          </div>
        )}
    </>
  );
}

function PairCard({ compare }: { compare: PairCompare }) {
  const [baseSymbol, quoteSymbol] = compare.pair.split("/");
  const spreadLevel = compare.spreadPct >= 1 ? "bg-red-500/15 text-red-300" : compare.spreadPct >= 0.3 ? "bg-amber-500/15 text-amber-300" : "bg-zinc-800 text-zinc-400";

  return (
    <div className={`rounded-xl border p-5 ${compare.spreadPct >= 0.3 ? "border-amber-900/60 bg-gradient-to-b from-amber-950/10 to-zinc-900/40 hover:border-amber-700" : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-600"} transition-colors`}>
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <span className="text-base font-semibold">{baseSymbol}</span>
          <span className="text-sm text-zinc-500">/{quoteSymbol}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${spreadLevel}`}>{compare.spreadPct.toFixed(3)}%</span>
      </div>

      <div className="space-y-2">
        {compare.cells.map(cell => {
          const isLow = cell.price === compare.low;
          const isHigh = cell.price === compare.high && !isLow;
          return (
            <div key={cell.chainId} className={`flex items-center justify-between rounded-lg px-3 py-2 ${isLow ? "bg-emerald-950/40 border border-emerald-900/60" : isHigh ? "bg-red-950/30 border border-red-900/50" : "bg-zinc-900/70 border border-transparent"}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${CHAIN_DOTS[cell.chainId] ?? "bg-zinc-500"}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{CHAIN_NAMES[cell.chainId] ?? cell.chainId}</p>
                  {cell.feeTier > 0 && <p className="text-[11px] text-zinc-600">Fee {(cell.feeTier / 10_000).toFixed(2)}%</p>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className={`font-mono text-sm ${isLow ? "text-emerald-400" : isHigh ? "text-red-300" : "text-zinc-200"}`}>{formatPrice(cell.price)}</p>
                {isLow ? <p className="text-[11px] text-emerald-500">cheapest buy</p> : isHigh ? <p className="text-[11px] text-red-400">best sell</p> : <p className="text-[11px] text-transparent">-</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean | string }) {
  const valueClass = typeof accent === "string" ? accent : accent ? "text-emerald-400" : "text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
