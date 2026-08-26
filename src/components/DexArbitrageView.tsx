"use client";

import { useCallback, useEffect, useState } from "react";
import { simulateTiming } from "@/lib/timing-simulator";
import { usePollingInterval } from "@/lib/use-polling";
import { scoreDexArb, riskColor, riskBarColor } from "@/lib/risk-scorer";
import { useLang } from "@/lib/i18n";
import { useDisplayCurrency } from "@/lib/use-currency";
import type { RecentArbEntry } from "@/lib/recent-arbs-store";

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
  const { t, lang } = useLang();
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [walletMap, setWalletMap] = useState<Map<string, { wallet_state: string; block_state: string; message: string }>>(new Map());
  const [inventoryMode, setInventoryMode] = useState(false);
  const [recent, setRecent] = useState<RecentArbEntry[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const intervalSec = usePollingInterval();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [scanRes, walletRes, recentRes] = await Promise.all([
        fetch("/api/scan"),
        fetch("/api/upbit/wallet-status").catch(() => null),
        fetch("/api/recent-arbs?hours=24").catch(() => null),
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
      if (recentRes?.ok) {
        const recentData = await recentRes.json();
        if (Array.isArray(recentData.entries)) setRecent(recentData.entries);
      }
      setLastUpdated(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
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
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <p className="text-xs text-zinc-500">{t("dexArb.subtitle")}</p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none" title={t("dexArb.inventoryBanner")}>
            <button onClick={() => setInventoryMode(v => !v)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${inventoryMode ? "bg-emerald-600" : "bg-zinc-700"}`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${inventoryMode ? "translate-x-[18px]" : "translate-x-1"}`} />
            </button>
            {t("dexArb.inventoryToggle")}
          </label>
          {lastUpdated && <p className="text-xs text-zinc-600">{t("common.lastUpdated")}: {lastUpdated}</p>}
        </div>
      </div>
      {inventoryMode && (
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-4 py-3 mb-4 text-xs text-emerald-200">
          {t("dexArb.inventoryBanner")}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label={t("dexArb.stats.opportunities")} value={opportunities.length} accent />
        <StatCard label={t("dexArb.stats.chains")} value={data?.chainsScanned ?? 0} />
        <StatCard label={t("dexArb.stats.crossChain")} value={data?.crossChainCount ?? 0} />
        <StatCard label={t("dexArb.stats.sameChain")} value={data?.sameChainCount ?? 0} />
      </div>

      {error && (
        <div className="rounded-xl border border-red-900 bg-red-950/50 p-4 mb-6">
          <p className="text-sm text-red-400 font-medium">Error: {error}</p>
        </div>
      )}

      {opportunities.length > 0 && (
        <div className="space-y-3">
          {opportunities.map((opp, idx) => (
            <OpportunityCard key={`${opp.pair}-${idx}-${opp.detectedAt}`} opp={opp} fmtUsd={fmtUsd} fmtPct={fmtPct} fmtPrice={fmtPrice} fxRate={fxRate} walletMap={walletMap} inventoryMode={inventoryMode} />
          ))}
        </div>
      )}

      {opportunities.length === 0 && !loading && !error && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center">
          <p className="text-lg text-zinc-400 mb-2">{t("dexArb.noOpp.title")}</p>
          <p className="text-sm text-zinc-600">{t("dexArb.noOpp.desc")}</p>
        </div>
      )}

      {/* Stablecoin DEX-to-DEX cross-chain spreads — unified loading via single API call */}
      <div className="mt-8">
        {!data ? null : (data.stableArbs?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-6 text-center text-sm text-zinc-500">
            {t("dexArb.stable.empty")}
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
        <div className="rounded-xl border border-zinc-800 p-12 text-center animate-pulse"><p className="text-lg text-zinc-500">{t("dexArb.loading")}</p></div>
      )}

      {/* Recently spotted opportunities (24h history, Phase 1) */}
      <div className="mt-8">
        <button
          onClick={() => setShowRecent(v => !v)}
          className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-3 hover:border-zinc-600 transition-colors"
        >
          <div className="text-left">
            <p className="text-sm font-medium text-zinc-300">{t("dexArb.recent.title")} <span className="ml-2 text-xs font-mono text-emerald-400">{recent.length}</span></p>
            <p className="text-[11px] text-zinc-600">{t("dexArb.recent.desc")}</p>
          </div>
          <span className="text-zinc-500 text-xs">{showRecent ? "▲" : "▼"}</span>
        </button>
        {showRecent && (
          <div className="mt-3 space-y-2">
            {recent.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 p-6 text-center text-sm text-zinc-500">{t("dexArb.recent.none")}</div>
            ) : (
              recent.slice(0, 30).map(entry => {
                const href = `/opportunity/${encodeURIComponent(`${entry.pair}|${entry.buyChain}|${entry.sellChain}`)}`;
                const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US", { hour: "2-digit", minute: "2-digit" });
                return (
                  <a key={entry.key} href={href} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 hover:border-emerald-700/50 transition-colors">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold">{entry.pair}</span>
                      <span className="ml-2 text-[11px] text-zinc-500">{CHAIN_NAMES[entry.buyChain] ?? entry.buyChain} → {CHAIN_NAMES[entry.sellChain] ?? entry.sellChain}</span>
                      <span className="ml-2 text-[10px] font-mono text-cyan-400">×{entry.seenCount}{t("dexArb.recent.seen")}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs font-mono">
                      <span className="text-emerald-400">+{entry.netSpreadPct.toFixed(2)}%</span>
                      <span className="text-zinc-600" title={`${t("dexArb.recent.first")} ${fmtTime(entry.firstSeen)}`}>{t("dexArb.recent.last")} {fmtTime(entry.lastSeen)}</span>
                    </div>
                  </a>
                );
              })
            )}
          </div>
        )}
      </div>
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

function OpportunityCard({ opp, fmtUsd, fmtPct, fmtPrice, fxRate, walletMap, inventoryMode }: {
  opp: ArbitrageOpportunity; fmtUsd: (n: number) => string; fmtPct: (n: number) => string; fmtPrice: (n: number) => string; fxRate: number; walletMap: Map<string, { wallet_state: string; block_state: string; message: string }>; inventoryMode?: boolean;
}) {
  const { t, lang } = useLang();
  const displayCurrency = useDisplayCurrency();
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

  const wallet = walletMap.get(opp.buyCoin);
  const risk = scoreDexArb({
    pair: opp.pair,
    buyChain: opp.buyChain,
    sellChain: opp.sellChain,
    buyCoin: opp.buyCoin,
    isCrossChain: opp.isCrossChain,
    liquidityUsd: opp.liquidityUsd,
    netSpreadPct: opp.netSpreadPct,
    breakEvenSpreadPct: opp.costBreakdown?.breakEvenSpreadPct,
    walletState: wallet?.wallet_state,
    blockState: wallet?.block_state,
    walletMessage: wallet?.message,
  });

  // Inventory assumption: both venues pre-funded, no withdraw/bridge, instant 2s execution
  const inventoryNetPct = opp.netSpreadPct + (opp.isCrossChain ? opp.bridgeFeePct : 0);
  const inventoryRisk = inventoryMode
    ? scoreDexArb({
        pair: opp.pair,
        buyChain: opp.buyChain,
        sellChain: opp.sellChain,
        buyCoin: opp.buyCoin,
        isCrossChain: false,
        liquidityUsd: opp.liquidityUsd,
        netSpreadPct: inventoryNetPct,
        breakEvenSpreadPct: opp.costBreakdown ? opp.costBreakdown.breakEvenSpreadPct * 0.4 : undefined, // lower breakeven without withdraw/gas
        walletState: wallet?.wallet_state,
        blockState: wallet?.block_state,
        walletMessage: wallet?.message,
      })
    : null;
  const displayRisk = inventoryMode && inventoryRisk ? inventoryRisk : risk;
  const inventoryProfitUsd = inventoryMode ? opp.liquidityUsd * inventoryNetPct / 100 - (opp.isCrossChain ? 2 : 1) : null;
  const inventoryNetKrw = opp.costBreakdown && inventoryMode
    ? opp.costBreakdown.netProfitKrw + opp.costBreakdown.withdrawalFeeKrw + opp.costBreakdown.gasCostKrw + (opp.isCrossChain ? opp.costBreakdown.onchainFeeKrw * 0.08 : 0)
    : null;
  const detailHref = `/opportunity/${encodeURIComponent(`${opp.pair}|${opp.buyChain}|${opp.sellChain}`)}`;
  return (
    <div
      onClick={() => { window.location.href = detailHref; }}
      className={`rounded-xl border p-5 cursor-pointer select-none transition-all ${opp.isCrossChain ? "border-violet-800/60 bg-gradient-to-r from-violet-950/20 to-zinc-900/80 hover:border-violet-600" : "border-emerald-900/50 bg-gradient-to-r from-emerald-950/30 to-zinc-900/80 hover:border-emerald-700"}`}
    >
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
          {inventoryMode ? (
            <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-medium" title={`보유 가정: 브릿지 제외 순수 스프레드 ${inventoryNetPct.toFixed(3)}%`}>보유 Net +{fmtPct(inventoryNetPct)} </span>
          ) : (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${opp.netSpreadPct > 1 ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-900/60 text-emerald-400"}`}>Net +{fmtPct(opp.netSpreadPct)}</span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-xs font-mono border ${riskColor(displayRisk.grade)}`} title={`Risk ${displayRisk.grade} ${displayRisk.label} (${displayRisk.total}) — 유동성 ${displayRisk.axes.liquidity} · 실행 ${displayRisk.axes.execution} · 거래소 ${displayRisk.axes.exchange} · 토큰 ${displayRisk.axes.token} · 변동성 ${displayRisk.axes.volatility} ${inventoryMode ? "— 보유가정: 브릿지/대기 제외" : ""}`}>
            Risk {displayRisk.grade} {displayRisk.total}{inventoryMode ? " (보유)" : ""}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${invalidRoute ? "bg-red-900/60 text-red-300" : stillLikelyProfitable ? "bg-cyan-900/60 text-cyan-300" : "bg-red-900/60 text-red-300"}`} title="Estimated time: market buy to sell completion">
            {"⏱"} {invalidRoute ? "invalid route" : <>{fmtDur(totalExecSec)} {stillLikelyProfitable ? "✅ profitable window" : "⚠️ premium risk"}</>}
          </span>
        </div>
        <div className="text-right">
          {opp.costBreakdown ? (
            inventoryMode && inventoryNetKrw !== null ? (
              <>
                <p className={inventoryNetKrw >= 0 ? "text-lg font-bold text-emerald-400" : "text-lg font-bold text-red-400"}>
                  {displayCurrency === "USD"
                    ? `${inventoryNetKrw >= 0 ? "+" : ""}$${(Math.abs(inventoryNetKrw) / (fxRate || 1350)).toFixed(2)}`
                    : `${inventoryNetKrw >= 0 ? "+" : ""}${Math.round(inventoryNetKrw).toLocaleString()} KRW`}
                </p>
                <p className="text-xs text-emerald-500">{lang === "ko" ? "보유 가정 · 출금/브릿지 제외" : "Inventory · excl. withdraw/bridge"}</p>
                <p className="text-[10px] text-zinc-600 line-through">
                  {lang === "ko" ? "출금 포함: " : "With withdraw: "}
                  {displayCurrency === "USD"
                    ? `${opp.costBreakdown.netProfitKrw >= 0 ? "+" : ""}$${(Math.abs(opp.costBreakdown.netProfitKrw) / (fxRate || 1350)).toFixed(2)}`
                    : `${opp.costBreakdown.netProfitKrw >= 0 ? "+" : ""}${Math.round(opp.costBreakdown.netProfitKrw).toLocaleString()} KRW`}
                </p>
                <p className="text-[10px] text-zinc-500">
                  {displayCurrency === "USD"
                    ? `${Math.round(inventoryNetKrw).toLocaleString()} KRW`
                    : `$${(inventoryNetKrw / (fxRate || 1350)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </p>
              </>
            ) : (
              <>
                <p className={opp.costBreakdown.netProfitKrw >= 0 ? "text-lg font-bold text-emerald-400" : "text-lg font-bold text-red-400"}>
                  {displayCurrency === "USD"
                    ? `${opp.costBreakdown.netProfitKrw >= 0 ? "+" : ""}$${(Math.abs(opp.costBreakdown.netProfitKrw) / (fxRate || 1350)).toFixed(2)}`
                    : `${opp.costBreakdown.netProfitKrw >= 0 ? "+" : ""}${Math.round(opp.costBreakdown.netProfitKrw).toLocaleString()} KRW`}
                </p>
                <p className={opp.costBreakdown.roiPct >= 0 ? "text-xs text-emerald-500" : "text-xs text-red-500"}>ROI: {opp.costBreakdown.roiPct.toFixed(3)}% &middot; Net profit</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  {displayCurrency === "USD"
                    ? `${Math.round(opp.costBreakdown.netProfitKrw).toLocaleString()} KRW`
                    : `$${(opp.costBreakdown.netProfitKrw / (fxRate || 1350)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </p>
              </>
            )
          ) : inventoryMode && inventoryProfitUsd !== null ? (
            <>
              <p className="text-lg font-bold text-emerald-400">
                {displayCurrency === "USD" ? fmtUsd(inventoryProfitUsd) : `${Math.round(inventoryProfitUsd * (fxRate || 1350)).toLocaleString()} KRW`}
              </p>
              <p className="text-xs text-emerald-500">{lang === "ko" ? "보유 가정 · 브릿지 제외" : "Inventory · excl. bridge"}</p>
              <p className="text-[10px] text-zinc-600 line-through">
                {lang === "ko" ? "출금 포함: " : "With withdraw: "}{displayCurrency === "USD" ? fmtUsd(opp.estimatedProfitUsd) : `${Math.round(opp.estimatedProfitUsd * (fxRate || 1350)).toLocaleString()} KRW`}
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-emerald-400">
                {displayCurrency === "USD" ? fmtUsd(opp.estimatedProfitUsd) : `${Math.round(opp.estimatedProfitUsd * (fxRate || 1350)).toLocaleString()} KRW`}
              </p>
              <p className="text-xs text-zinc-500">{displayCurrency === "USD" ? "est. profit / $1,000 trade" : "예상 수익 / 100만원 거래"}</p>
              <p className="text-[10px] text-zinc-600">
                {displayCurrency === "USD"
                  ? `${Math.round(opp.estimatedProfitUsd * (fxRate || 1350)).toLocaleString()} KRW`
                  : fmtUsd(opp.estimatedProfitUsd)}
              </p>
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

      <div className="mt-3 pt-3 border-t border-zinc-800/60">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-zinc-400">{t("risk.breakdown")} <span className={`ml-2 px-2 py-0.5 rounded-full text-xs border ${riskColor(displayRisk.grade)}`}>{displayRisk.grade} {t(`risk.grade.${displayRisk.grade}`)} · {displayRisk.total}/100{inventoryMode ? (lang === "ko" ? " (보유)" : " (inv)") : ""}</span></p>
          <span className="text-[10px] text-zinc-600">{t("risk.weighted")} {inventoryMode ? (lang === "ko" ? "· 보유가정" : "· inventory") : ""}</span>
        </div>
        <div className="space-y-1.5">
          {([
            [t("risk.axis.liquidity"), displayRisk.axes.liquidity, risk.axes.liquidity],
            [t("risk.axis.execution"), displayRisk.axes.execution, risk.axes.execution],
            [t("risk.axis.exchange"), displayRisk.axes.exchange, risk.axes.exchange],
            [t("risk.axis.token"), displayRisk.axes.token, risk.axes.token],
            [t("risk.axis.volatility"), displayRisk.axes.volatility, risk.axes.volatility],
          ] as const).map(([label, val, orig]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500 w-10">{label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div className={`h-full rounded-full ${riskBarColor(displayRisk.grade)}`} style={{ width: `${val}%`, opacity: 0.3 + (val / 100) * 0.7 }} />
              </div>
              <span className="text-[11px] font-mono text-zinc-400 w-6 text-right">{val}</span>
              {inventoryMode && orig !== val && <span className="text-[10px] font-mono text-zinc-600 line-through">{orig}</span>}
            </div>
          ))}
        </div>
        {inventoryMode && <p className="text-[10px] text-zinc-600 mt-2">{lang === "ko" ? "보유가정: 브릿지 0%, 실행 2초, 가스 1회만 반영. 원래 점수는 취소선으로 표시." : "Inventory: bridge 0%, exec 2s, single gas. Original strikethrough."}</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mt-3">
        <div>
          <p className="text-xs text-zinc-500 mb-0.5 flex items-center gap-1">Buy on {(() => {
            const wallet = walletMap.get(opp.buyCoin);
            const href = "https://www.upbit.com/service_center/wallet_status";
            if (!wallet) return <a href={href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500 hover:text-emerald-400" title={lang === "ko" ? "지갑 상태 정보 없음 — 공식 페이지에서 확인" : "No wallet status — check official page"}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M20 12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2"/><path d="M20 12a2 2 0 0 0 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12z"/></svg>{t("kimchi.header.wallet")}</a>;
            const isWorking = wallet.wallet_state === "working" && wallet.block_state === "normal" && !wallet.message;
            const isWithdrawOnly = wallet.wallet_state === "withdraw_only";
            const label = isWorking ? t("kimchi.wallet.normal") : isWithdrawOnly ? t("kimchi.wallet.withdrawOnly") : wallet.wallet_state;
            const color = isWorking ? "text-emerald-400" : isWithdrawOnly ? "text-amber-400" : "text-red-400";
            const title = wallet.message ? `${label}: ${wallet.message}` : isWorking ? t("kimchi.wallet.tooltipNormal") : `${label} — ${lang === "ko" ? "클릭하면 공식 현황 페이지" : "click for official status"}`;
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
      <div className="mt-3 pt-3 border-t border-zinc-800/60 flex justify-end">
        <a
          href={detailHref}
          onClick={e => e.stopPropagation()}
          className="text-xs text-emerald-400 hover:text-emerald-300 hover:underline"
        >
          {lang === "ko" ? "상세 시나리오 보기 →" : "View detailed scenario →"}
        </a>
      </div>
    </div>
  );
}
