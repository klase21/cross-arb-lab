"use client";

import { useCallback, useEffect, useState } from "react";
import { simulateTiming } from "@/lib/timing-simulator";
import { usePollingInterval } from "@/lib/use-polling";

interface ArbitrageOpportunity {
  pair: string;
  buyCoin: string;
  upbitMarket: string;
  buyChain: string;
  sellChain: string;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  netSpreadPct: number;
  liquidityUsd: number;
  estimatedProfitUsd: number;
  isCrossChain: boolean;
  bridgeFeePct: number;
  direction?: "upbitToDex" | "dexToUpbit" | "dexToDex";
  upbitPriceKrw?: number;
  detectedAt: string;
  costBreakdown?: CostBreakdown;
  flowSteps?: FlowStep[];
  roundTrip?: RoundTripResult;
  spotPrices?: DexSpotPrice[];
}

interface FlowStep {
  order: number;
  action: string;
  detail: string;
  platform: string;
  chain?: string;
  icon: string;
}

interface DexSpotPrice {
  dex: string;
  chainId: string;
  baseToQuote: number;
  reverseBase: number;
}

interface RoundTripResult {
  inputBase: number;
  midQuote: number;
  finalBase: number;
  profitPct: number;
  leg1Dex: string;
  leg2Dex: string;
}

interface CostBreakdown {
  upbitFeeKrw: number;
  withdrawalFeeKrw: number;
  gasCostKrw: number;
  onchainFeeKrw: number;
  totalCostsKrw: number;
  tokensReceived: number;
  netProfitKrw: number;
  roiPct: number;
  breakEvenSpreadPct: number;
}

interface ScanResult {
  opportunities: ArbitrageOpportunity[];
  totalScannedPairs: number;
  chainsScanned: number;
  crossChainCount: number;
  sameChainCount: number;
  timestamp: string;
  stableArbs?: StableArbRow[];
}

interface StableArbRow {
  pair: string;
  buyChain: string;
  buyDex: string;
  sellChain: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  quotes: { chainId: string; dex: string; price: number }[];
}

const CHAIN_NAMES: Record<string, string> = {
  ethereum: "Ethereum", arbitrum: "Arbitrum", polygon: "Polygon",
  base: "Base", optimism: "Optimism", bsc: "BNB Chain", upbit: "Upbit",
};

function formatStablePrice(v: number) {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

export default function DexArbitrageView() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [walletMap, setWalletMap] = useState<Map<string, { wallet_state: string; block_state: string; message: string }>>(new Map());
  const intervalSec = usePollingInterval();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [scanRes, walletRes] = await Promise.all([
        fetch("/api/scan"),
        fetch("/api/upbit/wallet-status").catch(() => null),
      ]);
      if (!scanRes.ok) throw new Error(`HTTP ${scanRes.status}`);
      const next: ScanResult = await scanRes.json();
      setData(next);
      const { notifyCex } = await import("@/lib/notifications");
      for (const opp of next.opportunities) notifyCex(opp.pair.split("/")[0], opp.buyDex, opp.sellDex, opp.netSpreadPct, "dex");
      if (walletRes?.ok) {
        const walletData = await walletRes.json();
        const list = Array.isArray(walletData.data) ? walletData.data : [];
        const map = new Map<string, { wallet_state: string; block_state: string; message: string }>();
        for (const entry of list) if (entry.currency && !map.has(entry.currency)) map.set(entry.currency, { wallet_state: entry.wallet_state, block_state: entry.block_state, message: entry.message ?? "" });
        if (map.size > 0) setWalletMap(map);
      }
      setLastUpdated(new Date().toLocaleTimeString("ko-KR"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, intervalSec * 1000);
    return () => clearInterval(interval);
  }, [load, intervalSec]);

  const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (n: number) => `${n.toFixed(3)}%`;
  const fmtPrice = (n: number) => n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toFixed(6);

  const opportunities = data?.opportunities ?? [];
  const fxRate = 1350;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500">Buy on Upbit (KRW) &rarr; withdraw &rarr; sell on-chain via Uniswap / Sushi web quotes.</p>
        {lastUpdated && <p className="text-xs text-zinc-600">Last updated: {lastUpdated}</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Opportunities" value={opportunities.length} accent />
        <StatCard label="Chains Active" value={data?.chainsScanned ?? 0} />
        <StatCard label="Cross-Chain" value={data?.crossChainCount ?? 0} />
        <StatCard label="Same-Chain" value={data?.sameChainCount ?? 0} />
      </div>

      {error && (
        <div className="rounded-xl border border-red-900 bg-red-950/50 p-4 mb-6">
          <p className="text-sm text-red-400 font-medium">Error: {error}</p>
        </div>
      )}

      {opportunities.length > 0 && (
        <div className="space-y-3">
          {opportunities.map((opp, idx) => (
            <OpportunityCard key={`${opp.pair}-${idx}-${opp.detectedAt}`} opp={opp} fmtUsd={fmtUsd} fmtPct={fmtPct} fmtPrice={fmtPrice} fxRate={fxRate} walletMap={walletMap} />
          ))}
        </div>
      )}

      {opportunities.length === 0 && !loading && !error && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center">
          <p className="text-lg text-zinc-400 mb-2">No profitable opportunities found</p>
          <p className="text-sm text-zinc-600">Scanning {data?.totalScannedPairs ?? 0} pairs across {data?.chainsScanned ?? 0} chains.</p>
        </div>
      )}

      {/* Stablecoin DEX-to-DEX cross-chain spreads — same card style as above */}
      <div className="mt-8">
        {(data?.stableArbs?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-6 text-center text-sm text-zinc-500">
            {loading ? <span className="animate-pulse">Loading stablecoin quotes…</span> : "현재 스테이블 페어 스프레드가 없거나 2개 체인 이상에서 호가가 없습니다."}
          </div>
        ) : (
          <div className="space-y-3">
            {(data?.stableArbs ?? []).map(row => {
              const [baseSymbol, quoteSymbol] = row.pair.split("/");
              const crossChain = row.buyChain !== row.sellChain;
              const estProfitUsd = 1000 * row.spreadPct / 100;
              const roundTripReturn = row.buyPrice > 0 ? row.sellPrice / row.buyPrice : 0;
              const roundTripPct = (roundTripReturn - 1) * 100;
              return (
                <div key={`${row.pair}-${row.buyChain}-${row.sellChain}`} className={`rounded-xl border p-5 cursor-pointer select-none transition-all ${crossChain ? "border-violet-800/60 bg-gradient-to-r from-violet-950/20 to-zinc-900/80 hover:border-violet-600" : "border-emerald-900/50 bg-gradient-to-r from-emerald-950/30 to-zinc-900/80 hover:border-emerald-700"}`}>
                  <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div>
                        <span className="text-base font-semibold">{row.pair}</span>
                        <p className="text-xs text-amber-400 mt-0.5">
                          🚀 Buy <strong>{baseSymbol}</strong> on {CHAIN_NAMES[row.buyChain] ?? row.buyChain} ({row.buyDex}) &rarr; sell on {(CHAIN_NAMES[row.sellChain] ?? row.sellChain)} ({row.sellDex})
                        </p>
                      </div>
                      {crossChain && (
                        <span className="px-2 py-0.5 rounded-full bg-violet-900/60 text-violet-300 text-xs font-medium">Cross-Chain</span>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 text-xs font-medium">Stable</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.spreadPct >= 0.2 ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-900/60 text-emerald-400"}`}>Net +{row.spreadPct.toFixed(3)}%</span>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${estProfitUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>+${estProfitUsd.toFixed(2)}</p>
                      <p className="text-xs text-zinc-500">est. profit / $1,000 trade</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-zinc-500 mb-0.5">Buy on</p>
                      <p className="font-medium">{CHAIN_NAMES[row.buyChain] ?? row.buyChain} &middot; {row.buyDex}</p>
                      <p className="text-xs text-zinc-600">@ {formatStablePrice(row.buyPrice)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500 mb-0.5">Sell on</p>
                      <p className="font-medium">{CHAIN_NAMES[row.sellChain] ?? row.sellChain} &middot; {row.sellDex}</p>
                      <p className="text-xs text-zinc-600">@ {formatStablePrice(row.sellPrice)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500 mb-0.5">Gross Spread</p>
                      <p className="font-medium">{row.spreadPct.toFixed(3)}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500 mb-0.5">Bridge Fee</p>
                      <p className="font-medium">{crossChain ? "0.050%" : "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500 mb-0.5">Liquidity</p>
                      <p className="font-medium">$100.00</p>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-zinc-800/60 text-xs">
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="text-zinc-500">Round trip:</span>
                      <span className="text-zinc-300 font-mono">1 {quoteSymbol} → {(1 / row.buyPrice).toFixed(4)} {baseSymbol} → <strong className={roundTripPct >= 0 ? "text-emerald-400" : "text-red-400"}>{roundTripReturn.toFixed(6)} {quoteSymbol}</strong></span>
                      <span className={roundTripPct >= 0 ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>({roundTripPct >= 0 ? "+" : ""}{roundTripPct.toFixed(4)}%)</span>
                    </div>
                    <p className="text-zinc-600 mt-1">Web-quote round trip: buy 1 {quoteSymbol} worth of {baseSymbol} via {row.buyDex} on {CHAIN_NAMES[row.buyChain] ?? row.buyChain}, sell via {row.sellDex} on {CHAIN_NAMES[row.sellChain] ?? row.sellChain}. Real amounts after slippage and fees.</p>
                  </div>

                  <div className="mt-3 pt-3 border-t border-zinc-800/60">
                    <p className="text-xs font-medium text-zinc-400 mb-2">Live DEX Prices</p>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {row.quotes.map((quote, i) => (
                        <div key={i} className="rounded-lg bg-zinc-900/70 border border-zinc-800 p-2.5">
                          <p className="text-[10px] text-zinc-500 mb-1">{quote.dex} ({CHAIN_NAMES[quote.chainId] ?? quote.chainId})</p>
                          <p className="font-mono text-zinc-200">
                            1 {quoteSymbol} = <span className="text-emerald-400">{(1 / quote.price).toFixed(4)}</span> {baseSymbol}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {loading && !data && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center animate-pulse"><p className="text-lg text-zinc-500">Scanning all chains…</p></div>
      )}
    </>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-emerald-800 bg-emerald-950/20" : "border-zinc-800"}`}>
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-emerald-400" : ""}`}>{value}</p>
    </div>
  );
}

function OpportunityCard({ opp, fmtUsd, fmtPct, fmtPrice, fxRate, walletMap }: {
  opp: ArbitrageOpportunity; fmtUsd: (n: number) => string; fmtPct: (n: number) => string; fmtPrice: (n: number) => string; fxRate: number; walletMap: Map<string, { wallet_state: string; block_state: string; message: string }>;
}) {
  const detailUrl = `/opportunity/${encodeURIComponent(`${opp.pair}|${opp.buyChain}|${opp.sellChain}`)}`;
  const isDexToUpbit = opp.direction === "dexToUpbit";

  // Compute expected execution time for this opportunity (also validates the coin-chain combo)
  const timing = simulateTiming({
    coinSymbol: opp.buyCoin,
    buyCexId: isDexToUpbit ? "binance" : "upbit",
    sellCexId: isDexToUpbit ? "upbit" : "binance",
    chainId: opp.buyChain,
    isCrossChainDex: false,
  });
  const invalidRoute = timing.totalSec === -1;
  const totalExecSec = Math.max(timing.totalSec, 0);
  const stillLikelyProfitable = !invalidRoute && totalExecSec < 600; // under 10 min = still profitable window
  const fmtDur = (s: number) => s >= 60 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : s + "s";
  return (
    <div className={`rounded-xl border p-5 cursor-pointer select-none transition-all ${opp.isCrossChain ? "border-violet-800/60 bg-gradient-to-r from-violet-950/20 to-zinc-900/80 hover:border-violet-600" : "border-emerald-900/50 bg-gradient-to-r from-emerald-950/30 to-zinc-900/80 hover:border-emerald-700"}`}>
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div>
            <span className="text-base font-semibold">{opp.pair}</span>
            {isDexToUpbit ? (
              <p className="text-xs text-amber-400 mt-0.5">
                🚀 Buy <strong>{opp.buyCoin}</strong> on {(CHAIN_NAMES[opp.buyChain] ?? opp.buyChain)} ({opp.buyDex}) &rarr; withdraw to Upbit &rarr; sell at <strong>{opp.upbitPriceKrw?.toLocaleString(undefined, { maximumFractionDigits: 2 })} KRW</strong>
              </p>
            ) : (
              <p className="text-xs text-amber-400 mt-0.5">
                🚀 Buy <strong>{opp.buyCoin}</strong> on Upbit ({opp.upbitMarket}) &rarr; withdraw to {(CHAIN_NAMES[opp.buyChain] ?? opp.buyChain)}
              </p>
            )}
          </div>
          {opp.isCrossChain && (
            <span className="px-2 py-0.5 rounded-full bg-violet-900/60 text-violet-300 text-xs font-medium">Cross-Chain</span>
          )}
          {isDexToUpbit && (
            <span className="px-2 py-0.5 rounded-full bg-orange-900/60 text-orange-300 text-xs font-medium">Reverse (DEX→Upbit)</span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${opp.netSpreadPct > 1 ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-900/60 text-emerald-400"}`}>Net +{fmtPct(opp.netSpreadPct)}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${invalidRoute ? "bg-red-900/60 text-red-300" : stillLikelyProfitable ? "bg-cyan-900/60 text-cyan-300" : "bg-red-900/60 text-red-300"}`} title="Estimated time: market buy to sell completion">
            {"⏱"} {invalidRoute ? "invalid route" : <>{fmtDur(totalExecSec)} {stillLikelyProfitable ? "✅ profitable window" : "⚠️ premium risk"}</>}
          </span>
        </div>
        <div className="text-right">
          {opp.costBreakdown ? (
            <>
              <p className={opp.costBreakdown.netProfitKrw >= 0 ? "text-lg font-bold text-emerald-400" : "text-lg font-bold text-red-400"}>
                {(opp.costBreakdown.netProfitKrw >= 0 ? "+" : "")}${(Math.abs(opp.costBreakdown.netProfitKrw / fxRate)).toFixed(2)}
              </p>
              <p className={opp.costBreakdown.roiPct >= 0 ? "text-xs text-emerald-500" : "text-xs text-red-500"}>ROI: {opp.costBreakdown.roiPct.toFixed(3)}% &middot; Net profit</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">after all fees</p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-emerald-400">{fmtUsd(opp.estimatedProfitUsd)}</p>
              <p className="text-xs text-zinc-500">est. profit / $1,000 trade</p>
            </>
          )}
        </div>
      </div>

      {invalidRoute && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-950/30 p-3">
          <p className="text-xs font-semibold text-red-400 mb-0.5">Invalid Route</p>
          <p className="text-xs text-zinc-400">{timing.bottleneckLabel}</p>
          <p className="text-[11px] text-zinc-600 mt-1">Native BTC only exists on the Bitcoin network; on EVM chains it would be WBTC (a different token). Check which withdrawal network the exchange supports.</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <div>
          <p className="text-xs text-zinc-500 mb-0.5 flex items-center gap-1">Buy on {(() => {
            const wallet = walletMap.get(opp.buyCoin);
            const href = "https://www.upbit.com/service_center/wallet_status";
            if (!wallet) return <a href={href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500 hover:text-emerald-400" title="지갑 상태 정보 없음 — 공식 페이지에서 확인"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M20 12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2"/><path d="M20 12a2 2 0 0 0 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12z"/></svg>지갑</a>;
            const isWorking = wallet.wallet_state === "working" && wallet.block_state === "normal" && !wallet.message;
            const isWithdrawOnly = wallet.wallet_state === "withdraw_only";
            const label = isWorking ? "정상" : isWithdrawOnly ? "출금만" : wallet.wallet_state;
            const color = isWorking ? "text-emerald-400" : isWithdrawOnly ? "text-amber-400" : "text-red-400";
            const title = wallet.message ? `${label}: ${wallet.message} — 클릭하면 공식 현황 페이지` : `${label} — 클릭하면 공식 현황 페이지`;
            return <a href={href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`inline-flex items-center gap-0.5 text-[10px] ${color} hover:opacity-80`} title={title}>{isWorking ? "●" : isWithdrawOnly ? "◐" : "●"} {label}</a>;
          })()}</p>
          <p className="font-medium">{CHAIN_NAMES[opp.buyChain] ?? opp.buyChain} &middot; {opp.buyDex}</p>
          <p className="text-xs text-zinc-600">@ {fmtPrice(opp.buyPrice)}{isDexToUpbit ? " USD" : ""}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Sell on</p>
          <p className="font-medium">{CHAIN_NAMES[opp.sellChain] ?? opp.sellChain} &middot; {opp.sellDex}</p>
          <p className="text-xs text-zinc-600">@ {isDexToUpbit ? `${fmtPrice(opp.sellPrice)} KRW` : fmtPrice(opp.sellPrice)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Gross Spread</p>
          <p className="font-medium">{fmtPct(opp.spreadPct)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Bridge Fee</p>
          <p className="font-medium">{opp.isCrossChain && opp.direction !== "dexToUpbit" && opp.direction !== "upbitToDex" ? fmtPct(opp.bridgeFeePct) : "-"}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Liquidity</p>
          <p className="font-medium">{fmtUsd(opp.liquidityUsd)}</p>
        </div>
      </div>

      {opp.roundTrip && opp.direction !== "dexToUpbit" && opp.direction !== "upbitToDex" && (
        <div className="mt-3 pt-3 border-t border-zinc-800/60 text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-zinc-500">Round trip:</span>
            <span className="text-zinc-300 font-mono">1 {opp.pair.split("/")[0]} → {opp.roundTrip.midQuote.toFixed(4)} {opp.pair.split("/")[1]} → <strong className={opp.roundTrip.profitPct >= 0 ? "text-emerald-400" : "text-red-400"}>{opp.roundTrip.finalBase.toFixed(6)} {opp.pair.split("/")[0]}</strong></span>
            <span className={opp.roundTrip.profitPct >= 0 ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>({opp.roundTrip.profitPct >= 0 ? "+" : ""}{opp.roundTrip.profitPct.toFixed(4)}%)</span>
          </div>
          <p className="text-zinc-600 mt-1">Web-quote round trip: sell 1 unit via {opp.roundTrip.leg1Dex}, buy back via {opp.roundTrip.leg2Dex}. Real amounts after slippage and fees.</p>
        </div>
      )}

      {opp.spotPrices && opp.spotPrices.length > 0 && opp.direction !== "dexToUpbit" && opp.direction !== "upbitToDex" && (
        <div className="mt-3 pt-3 border-t border-zinc-800/60">
          <p className="text-xs font-medium text-zinc-400 mb-2">Live DEX Prices</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {opp.spotPrices.map((sp, i) => (
              <div key={i} className="rounded-lg bg-zinc-900/70 border border-zinc-800 p-2.5">
                <p className="text-[10px] text-zinc-500 mb-1">{sp.dex} ({CHAIN_NAMES[sp.chainId] ?? sp.chainId})</p>
                <p className="font-mono text-zinc-200">
                  1 {opp.pair.split("/")[0]} = <span className="text-emerald-400">{sp.baseToQuote.toFixed(4)}</span> {opp.pair.split("/")[1]}
                </p>
                {sp.reverseBase > 0 && sp.reverseBase !== sp.baseToQuote && (
                  <p className="text-[10px] text-zinc-600 mt-0.5">round-trip return: {sp.reverseBase.toFixed(6)} {opp.pair.split("/")[0]}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
