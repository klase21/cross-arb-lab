"use client";

import { useState, useEffect, use, useCallback } from "react";
import ExecutionPanel from "./ExecutionPanel";
import { CHAIN_DEXES, type ChainId } from "@/lib/dex-config";
import { scoreDexArb, riskColor, riskBarColor } from "@/lib/risk-scorer";
import { LangProvider, useLang } from "@/lib/i18n";
import { useDisplayCurrency } from "@/lib/use-currency";
import { dexscreenerEmbedUrl, dexscreenerTokenUrl } from "@/lib/dexscreener";
import { gmgnTokenUrl } from "@/lib/gmgn";

interface FlowStep { order: number; action: string; detail: string; platform: string; chain?: string; icon: string; }
interface CostBreakdown { upbitFeeKrw: number; withdrawalFeeKrw: number; gasCostKrw: number; onchainFeeKrw: number; totalCostsKrw: number; tokensReceived: number; netProfitKrw: number; roiPct: number; breakEvenSpreadPct: number; }
interface ArbitrageOpportunity { pair: string; buyCoin: string; upbitMarket: string; buyChain: string; sellChain: string; buyDex: string; sellDex: string; buyPrice: number; sellPrice: number; spreadPct: number; netSpreadPct: number; liquidityUsd: number; estimatedProfitUsd: number; isCrossChain: boolean; bridgeFeePct: number; detectedAt: string; costBreakdown?: CostBreakdown; flowSteps?: FlowStep[]; }
interface ScanResult { opportunities: ArbitrageOpportunity[]; totalScannedPairs: number; chainsScanned: number; crossChainCount: number; sameChainCount: number; timestamp: string; }

const CHAIN_NAMES: Record<string, string> = { ethereum: "Ethereum", arbitrum: "Arbitrum", polygon: "Polygon", base: "Base", optimism: "Optimism", bsc: "BNB Chain" };

function OpportunityDetailInner({ params }: { params: Promise<{ id: string }> }) {
  const { t, lang } = useLang();
  const displayCurrency = useDisplayCurrency();
  const resolvedParams = use(params);
  const decoded = decodeURIComponent(resolvedParams.id);
  const [rawPair, buyChain, sellChain] = decoded.split("|");
  const pair = rawPair.includes("/") ? rawPair : rawPair.replace("-", "/");
  const [opp, setOpp] = useState<ArbitrageOpportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveUsdtKrw, setLiveUsdtKrw] = useState<number | null>(null);
  const [liveUpbitKrw, setLiveUpbitKrw] = useState<number | null>(null);
  const [liveBinanceUsd, setLiveBinanceUsd] = useState<number | null>(null);
  const [liveFx, setLiveFx] = useState<number | null>(null);
  const [liveFetchedAt, setLiveFetchedAt] = useState<string | null>(null);

  const refreshLivePrices = useCallback(async () => {
    const coin = pair.split("/")[0].replace("W", "");
    const upbitSymbolMap: Record<string, string> = { WETH: "ETH", WBTC: "BTC", WBNB: "BNB" };
    const upbitCoin = upbitSymbolMap[coin] ?? coin;
    try {
      const [usdtOrderbook, coinOrderbook, binanceBook, fxRes] = await Promise.all([
        fetch(`https://api.upbit.com/v1/orderbook?markets=KRW-USDT`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`https://api.upbit.com/v1/orderbook?markets=KRW-${upbitCoin}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${coin}USDT`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`https://open.er-api.com/v6/latest/USD`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (usdtOrderbook?.[0]?.orderbook_units?.[0]?.ask_price) setLiveUsdtKrw(usdtOrderbook[0].orderbook_units[0].ask_price);
      if (coinOrderbook?.[0]?.orderbook_units?.[0]) {
        setLiveUpbitKrw(coinOrderbook[0].orderbook_units[0].bid_price ?? coinOrderbook[0].orderbook_units[0].ask_price);
      }
      if (binanceBook?.askPrice) setLiveBinanceUsd(Number(binanceBook.askPrice));
      else if (binanceBook?.bidPrice) setLiveBinanceUsd(Number(binanceBook.bidPrice));
      if (fxRes?.rates?.KRW) setLiveFx(fxRes.rates.KRW);
      setLiveFetchedAt(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {}
  }, [pair, lang]);

  useEffect(() => {
    Promise.all([
      fetch("/api/scan").then(r => r.json()).catch(() => null),
      fetch("/api/recent-arbs?hours=168").then(r => r.json()).catch(() => null),
    ]).then(([scanData, recentData]) => {
      const scanOpps: ArbitrageOpportunity[] = scanData?.opportunities ?? [];
      let found = scanOpps.find(o => o.pair === pair && o.buyChain === buyChain && o.sellChain === sellChain) ?? null;
      if (!found && recentData?.entries) {
        const rec = (recentData.entries as { pair: string; buyChain: string; sellChain: string; netSpreadPct: number; estimatedProfitUsd: number }[]).find(
          e => e.pair === pair && e.buyChain === buyChain && e.sellChain === sellChain,
        );
        if (rec) {
          // reconstruct minimal opportunity from recent entry so detail page still renders
          found = {
            pair: rec.pair,
            buyCoin: rec.pair.split("/")[0].replace(/^W/, ""),
            upbitMarket: `KRW-${rec.pair.split("/")[0].replace(/^W/, "")}`,
            buyChain,
            sellChain,
            buyDex: (rec as unknown as { buyDex?: string }).buyDex ?? "Unknown",
            sellDex: (rec as unknown as { sellDex?: string }).sellDex ?? "Unknown",
            buyPrice: 0,
            sellPrice: 0,
            spreadPct: rec.netSpreadPct,
            netSpreadPct: rec.netSpreadPct,
            liquidityUsd: 100,
            estimatedProfitUsd: rec.estimatedProfitUsd,
            isCrossChain: buyChain !== sellChain,
            bridgeFeePct: 0.05,
            detectedAt: new Date().toISOString(),
          } as ArbitrageOpportunity;
        }
      }
      if (!found) {
        // fallback: still render a skeleton so user sees the pair even if scan no longer contains it
        found = {
          pair,
          buyCoin: pair.split("/")[0].replace(/^W/, ""),
          upbitMarket: `KRW-${pair.split("/")[0].replace(/^W/, "")}`,
          buyChain,
          sellChain,
          buyDex: "Unknown",
          sellDex: "Unknown",
          buyPrice: 0,
          sellPrice: 0,
          spreadPct: 0,
          netSpreadPct: 0,
          liquidityUsd: 0,
          estimatedProfitUsd: 0,
          isCrossChain: buyChain !== sellChain,
          bridgeFeePct: 0.05,
          detectedAt: new Date().toISOString(),
        } as ArbitrageOpportunity;
      }
      setOpp(found);
      setLoading(false);
    }).catch(() => setLoading(false));
    refreshLivePrices();
  }, [pair, buyChain, sellChain, refreshLivePrices]);

  const fmtUsd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPrice = (n: number) => n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toFixed(6);

  if (loading) return (<div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center"><div className="animate-pulse text-lg text-zinc-500">{lang === "ko" ? "기회 로딩 중…" : "Loading opportunity..."}</div></div>);

  if (!opp) return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4"><a href="/" className="text-sm text-emerald-400 hover:text-emerald-300">&larr; {lang === "ko" ? "스캐너로 돌아가기" : "Back to Scanner"}</a></header>
      <main className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-lg text-zinc-400 mb-2">{lang === "ko" ? "기회를 찾을 수 없거나 만료되었습니다" : "Opportunity not found or expired"}</p>
        <p className="text-sm text-zinc-600">{lang === "ko" ? "차익 기회가 닫혔을 수 있습니다. 스캐너로 돌아가 최신 기회를 확인하세요." : "The arbitrage window may have closed. Return to scanner for current opportunities."}</p>
      </main>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{opp.pair} {lang === "ko" ? "실행 흐름" : "Execution Flow"}</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{CHAIN_NAMES[opp.buyChain]} → {CHAIN_NAMES[opp.sellChain]} · Net +{opp.netSpreadPct.toFixed(3)}%</p>
        </div>
        <a href="/" className="px-4 py-1.5 rounded-lg border border-zinc-700 hover:border-emerald-500 text-sm font-medium transition-colors">&larr; {lang === "ko" ? "돌아가기" : "Back"}</a>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <SummaryCard label={lang === "ko" ? "순 스프레드" : "Net Spread"} value={"+" + opp.netSpreadPct.toFixed(3) + "%"} accent />
            <SummaryCard
              label={lang === "ko" ? "예상 수익" : "Est. Profit"}
              value={
                opp.costBreakdown
                  ? displayCurrency === "USD"
                    ? `$${(opp.costBreakdown.netProfitKrw / 1350).toFixed(2)}`
                    : `${Math.round(opp.costBreakdown.netProfitKrw).toLocaleString()} KRW`
                  : displayCurrency === "USD"
                    ? fmtUsd(opp.estimatedProfitUsd)
                    : `${Math.round(opp.estimatedProfitUsd * 1350).toLocaleString()} KRW`
              }
              accent={opp.costBreakdown ? opp.costBreakdown.netProfitKrw > 0 : true}
            />
            <SummaryCard label={lang === "ko" ? "매수 가격" : "Buy Price"} value={"@ " + fmtPrice(opp.buyPrice)} />
            <SummaryCard label={lang === "ko" ? "매도 가격" : "Sell Price"} value={"@ " + fmtPrice(opp.sellPrice)} />
          </div>

          {(() => {
            const risk = scoreDexArb({
              pair: opp.pair,
              buyChain: opp.buyChain,
              sellChain: opp.sellChain,
              buyCoin: opp.buyCoin,
              isCrossChain: opp.isCrossChain,
              liquidityUsd: opp.liquidityUsd,
              netSpreadPct: opp.netSpreadPct,
              breakEvenSpreadPct: opp.costBreakdown?.breakEvenSpreadPct,
            });
            const gradeLabel = t(`risk.grade.${risk.grade}`);
            return (
              <div className="rounded-xl border border-zinc-800 p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold">{t("risk.breakdown")} <span className={`ml-2 px-3 py-1 rounded-full text-xs border ${riskColor(risk.grade)}`}>{risk.grade} {gradeLabel} · {risk.total}/100</span></h2>
                  <span className="text-[11px] text-zinc-600">{t("risk.weighted")}</span>
                </div>
                <div className="space-y-3">
                  {([
                    [`${t("risk.axis.liquidity")} (30%)`, risk.axes.liquidity, lang === "ko" ? "거래대금·호가 깊이" : "Volume & depth"],
                    [`${t("risk.axis.execution")} (25%)`, risk.axes.execution, lang === "ko" ? "가스·브릿지·소요시간" : "Gas · bridge · time"],
                    [`${t("risk.axis.exchange")} (20%)`, risk.axes.exchange, lang === "ko" ? "입출금 상태" : "Deposit/withdrawal"],
                    [`${t("risk.axis.token")} (15%)`, risk.axes.token, lang === "ko" ? "검증·심볼충돌" : "Verification · collision"],
                    [`${t("risk.axis.volatility")} (10%)`, risk.axes.volatility, lang === "ko" ? "스프레드 버퍼" : "Spread buffer"],
                  ] as const).map(([label, val, desc]) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-1"><span className="text-zinc-400">{label} <span className="text-zinc-600">— {desc}</span></span><span className="text-zinc-500 font-mono">{val}</span></div>
                      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className={`h-full rounded-full ${riskBarColor(risk.grade)}`} style={{ width: `${val}%`, opacity: 0.35 + (val / 100) * 0.65 }} /></div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-600 mt-3">
                  {lang === "ko"
                    ? "A 0-20 초저위험 · B 21-40 저위험 · C 41-60 중위험 · D 61-80 고위험 · F 81-100 초고위험. 총점 = 5축 가중합."
                    : "A 0-20 Very Low · B 21-40 Low · C 41-60 Medium · D 61-80 High · F 81-100 Very High. Total = weighted sum."}
                </p>
              </div>
            );
          })()}

          {/* Upbit Round-trip Scenario — always assumes starting from Upbit KRW as requested */}
          <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/10 p-6 mb-6">
            <h2 className="text-base font-semibold mb-1">
              {lang === "ko" ? "업비트 라운드트립 시나리오" : "Upbit Round-trip Scenario"}
              <span className="text-xs font-normal text-zinc-500 ml-2">{lang === "ko" ? "(1,000,000 KRW 기준 · 무조건 업비트에서 시작)" : "(Based on 1,000,000 KRW · always starts at Upbit)"}</span>
            </h2>
            <p className="text-xs text-zinc-500 mb-4">
              {lang === "ko"
                ? "KRW로 시작해 업비트에서 매수 → 출금 → DEX 스왑 → 재입금 → KRW로 매도까지의 전 과정을 금액으로 추적합니다."
                : "Tracks the full loop from KRW on Upbit → buy → withdraw → DEX swaps → redeposit → sell back to KRW."}
            </p>
            {opp.costBreakdown ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="rounded-lg bg-zinc-900 p-3 text-center">
                    <p className="text-zinc-500 mb-1">{lang === "ko" ? "시작 자금" : "Initial"}</p>
                    <p className="font-bold">
                      {displayCurrency === "USD"
                        ? `$${(1000000 / 1350).toFixed(2)}`
                        : `1,000,000 KRW`}
                    </p>
                    <p className="text-[10px] text-zinc-600">{displayCurrency === "USD" ? "1,000,000 KRW" : `$${(1000000 / 1350).toFixed(2)}`}</p>
                  </div>
                  <div className="rounded-lg bg-zinc-900 p-3 text-center">
                    <p className="text-zinc-500 mb-1">{lang === "ko" ? "매수 후 보유" : "After Buy"}</p>
                    <p className="font-bold">{opp.costBreakdown.tokensReceived.toFixed(6)} {opp.buyCoin}</p>
                    <p className="text-[10px] text-zinc-600">≈ {(1000000 - opp.costBreakdown.upbitFeeKrw).toLocaleString()} KRW</p>
                  </div>
                  <div className={`rounded-lg p-3 text-center border ${opp.costBreakdown.netProfitKrw >= 0 ? "bg-emerald-950/30 border-emerald-800" : "bg-red-950/30 border-red-800"}`}>
                    <p className="text-zinc-500 mb-1">{lang === "ko" ? "최종 회수" : "Final"}</p>
                    <p className={`font-bold ${opp.costBreakdown.netProfitKrw >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {displayCurrency === "USD"
                        ? `$${((1000000 + opp.costBreakdown.netProfitKrw) / 1350).toFixed(2)}`
                        : `${(1000000 + opp.costBreakdown.netProfitKrw).toLocaleString()} KRW`}
                    </p>
                    <p className={`text-[10px] ${opp.costBreakdown.netProfitKrw >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {opp.costBreakdown.netProfitKrw >= 0 ? "+" : ""}{displayCurrency === "USD" ? `$${(Math.abs(opp.costBreakdown.netProfitKrw) / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.netProfitKrw).toLocaleString()} KRW`} ({opp.costBreakdown.roiPct.toFixed(2)}%)
                    </p>
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-zinc-400">{lang === "ko" ? "실시간 계산 기준" : "Live Calculation Basis"}</p>
                    <div className="flex items-center gap-2">
                      {liveFetchedAt && <span className="text-[10px] text-zinc-500">{liveFetchedAt}</span>}
                      <button onClick={refreshLivePrices} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300">{lang === "ko" ? "새로고침" : "Refresh"}</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div className="rounded bg-zinc-950 p-2 text-center">
                      <p className="text-zinc-500 mb-1">USDT/KRW Ask</p>
                      <p className="font-mono font-bold">{liveUsdtKrw ? `${liveUsdtKrw.toLocaleString()} KRW` : "—"}</p>
                      <p className="text-[10px] text-zinc-600">{lang === "ko" ? "업비트 테더" : "Upbit Tether"}</p>
                    </div>
                    <div className="rounded bg-zinc-950 p-2 text-center">
                      <p className="text-zinc-500 mb-1">{opp.buyCoin} / KRW</p>
                      <p className="font-mono font-bold">{liveUpbitKrw ? `${liveUpbitKrw.toLocaleString()} KRW` : "—"}</p>
                      <p className="text-[10px] text-zinc-600">{lang === "ko" ? "업비트 Bid" : "Upbit Bid"}</p>
                    </div>
                    <div className="rounded bg-zinc-950 p-2 text-center">
                      <p className="text-zinc-500 mb-1">{opp.buyCoin} / USD</p>
                      <p className="font-mono font-bold">{liveBinanceUsd ? `$${liveBinanceUsd.toFixed(4)}` : "—"}</p>
                      <p className="text-[10px] text-zinc-600">Binance Ask</p>
                    </div>
                    <div className="rounded bg-zinc-950 p-2 text-center">
                      <p className="text-zinc-500 mb-1">FX USD/KRW</p>
                      <p className="font-mono font-bold">{liveFx ? liveFx.toFixed(2) : "—"}</p>
                      <p className="text-[10px] text-zinc-600">{lang === "ko" ? "실시간 환율" : "Live FX"}</p>
                    </div>
                  </div>
                  {liveUsdtKrw && liveUpbitKrw && liveBinanceUsd && liveFx && (
                    <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">{lang === "ko" ? "실시간 프리미엄" : "Live premium"}</span>
                        <span className={`font-mono font-bold ${((liveUpbitKrw / liveFx - liveBinanceUsd) / liveBinanceUsd) * 100 >= 0 ? "text-red-400" : "text-sky-400"}`}>
                          {(((liveUpbitKrw / liveFx - liveBinanceUsd) / liveBinanceUsd) * 100).toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-zinc-500">{lang === "ko" ? "실시간 총수익(수수료 전, 1M 기준)" : "Live gross (1M, ex-fees)"}</span>
                        <span className="font-mono text-zinc-300">
                          {Math.round(1000000 * ((liveUpbitKrw / liveFx - liveBinanceUsd) / liveBinanceUsd)).toLocaleString()} KRW
                          <span className="text-zinc-600 ml-1">
                            ({displayCurrency === "USD"
                              ? `$${(Math.round(1000000 * ((liveUpbitKrw / liveFx - liveBinanceUsd) / liveBinanceUsd)) / (liveFx || 1350)).toFixed(2)}`
                              : `$${((liveUpbitKrw / liveFx - liveBinanceUsd) / liveBinanceUsd * 1000).toFixed(2)}`})
                          </span>
                        </span>
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-zinc-600 mt-2">
                    {lang === "ko"
                      ? "클릭 시점의 실시간 호가로 재계산됩니다. 테더 가격은 1,000,000원이 몇 USDT로 바뀌는지 결정합니다."
                      : "Recalculated with live quotes at click time. Tether price determines how much USDT 1,000,000 KRW converts to."}
                  </p>
                </div>
                <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-4">
                  <p className="text-xs font-medium text-zinc-400 mb-2">{lang === "ko" ? "단계별 비용 (1,000,000 KRW 투자 시)" : "Step costs (on 1,000,000 KRW)"}</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-zinc-400">1. {lang === "ko" ? "업비트 매수 수수료 (0.05%)" : "Upbit buy fee (0.05%)"}</span><span className="font-mono text-red-400">-{displayCurrency === "USD" ? `$${(opp.costBreakdown.upbitFeeKrw / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.upbitFeeKrw).toLocaleString()} KRW`}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">2. {lang === "ko" ? "출금 수수료" : "Withdrawal fee"} ({opp.buyChain})</span><span className="font-mono text-red-400">-{displayCurrency === "USD" ? `$${(opp.costBreakdown.withdrawalFeeKrw / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.withdrawalFeeKrw).toLocaleString()} KRW`}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">3-4. {lang === "ko" ? "가스 + DEX/브릿지" : "Gas + DEX/Bridge"}</span><span className="font-mono text-red-400">-{displayCurrency === "USD" ? `$${((opp.costBreakdown.gasCostKrw + opp.costBreakdown.onchainFeeKrw) / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.gasCostKrw + opp.costBreakdown.onchainFeeKrw).toLocaleString()} KRW`}</span></div>
                    <div className="flex justify-between border-t border-zinc-700 pt-2 mt-2 font-bold"><span className="text-zinc-300">{lang === "ko" ? "총 비용" : "Total costs"}</span><span className="text-red-400">-{displayCurrency === "USD" ? `$${(opp.costBreakdown.totalCostsKrw / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.totalCostsKrw).toLocaleString()} KRW`}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">{lang === "ko" ? "필요 스프레드 (손익분기)" : "Break-even spread"}</span><span className="font-mono text-amber-400">{opp.costBreakdown.breakEvenSpreadPct.toFixed(3)}%</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">{lang === "ko" ? "현재 스프레드" : "Current spread"}</span><span className="font-mono text-zinc-200">+{opp.netSpreadPct.toFixed(3)}%</span></div>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-600">
                  {lang === "ko"
                    ? `1,000,000 KRW로 ${opp.buyCoin}을(를) 업비트에서 매수한 뒤 ${CHAIN_NAMES[opp.buyChain] ?? opp.buyChain}로 출금해 DEX에서 운용하고 다시 업비트로 돌아오는 전체 라운드트립을 가정한 시뮬레이션입니다. 실제 출금 네트워크 수수료·가스·슬리피지는 변동될 수 있습니다.`
                    : `Simulation of a full round-trip starting with 1,000,000 KRW on Upbit: buy ${opp.buyCoin}, withdraw to ${CHAIN_NAMES[opp.buyChain] ?? opp.buyChain}, operate on DEX, redeposit and sell back to KRW. Fees and slippage vary.`}
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">{lang === "ko" ? "비용 정보를 불러오는 중입니다…" : "Loading cost breakdown…"}</p>
            )}
          </div>

          {/* Dexscreener Chart — token embed */}
          {(() => {
            const baseSym = opp.pair.split("/")[0];
            const token = CHAIN_DEXES.find(c => c.chain === opp.buyChain)?.tokens[baseSym];
            if (!token) return null;
            const embedUrl = dexscreenerEmbedUrl(opp.buyChain, token.address);
            const tokenUrl = dexscreenerTokenUrl(opp.buyChain, token.address);
            const gmgnUrl = gmgnTokenUrl(opp.buyChain, token.address);
            return (
              <div className="rounded-xl border border-zinc-800 p-6 mb-6">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-base font-semibold">{lang === "ko" ? "덱스 차트" : "DEX Chart"} <span className="text-xs font-normal text-zinc-500 ml-2">{baseSym} / {CHAIN_NAMES[opp.buyChain] ?? opp.buyChain}</span></h2>
                  <div className="flex items-center gap-3 text-xs">
                    <a href={gmgnUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline" title={lang === "ko" ? "GMGN에서 홀더 분포·번들·허니팟 검증" : "Verify holders, bundles & honeypot on GMGN"}>
                      {lang === "ko" ? "GMGN 보안 검증 →" : "GMGN safety check →"}
                    </a>
                    <a href={tokenUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Dexscreener →</a>
                  </div>
                </div>
                <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900" style={{ height: 400 }}>
                  <iframe src={embedUrl} style={{ width: "100%", height: "100%", border: 0 }} title={`Dexscreener ${baseSym}`} loading="lazy" />
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">{lang === "ko" ? "Dexscreener 임베드 차트 — 토큰 시세·유동성·거래량 확인. 실행 전 GMGN에서 토큰 안전성(홀더·번들)을 확인하세요." : "Dexscreener embed — price, liquidity & volume. Verify token safety (holders/bundles) on GMGN before executing."}</p>
              </div>
            );
          })()}

          <div className="rounded-xl border border-zinc-800 p-6 mb-6">
            <h2 className="text-base font-semibold mb-1">{lang === "ko" ? "단계별 실행 계획" : "Step-by-Step Execution Plan"} <span className="text-xs font-normal text-zinc-500 ml-2">{lang === "ko" ? "(단순 스왑 기반 차익 — LP 토큰 없음)" : "(Simple swap-based arbitrage - no LP tokens involved)"}</span></h2>
            <p className="text-xs text-zinc-500 mb-6">{lang === "ko" ? "차익 거래를 실행하려면 아래 단계를 순서대로 따르세요." : "Follow these steps in order to execute the arbitrage trade"}</p>

            <div className="relative">

              <div className="absolute left-[19px] top-2 bottom-2 w-[2px] bg-gradient-to-b from-emerald-500/60 via-zinc-700 to-violet-500/60" />

              {(opp.flowSteps ?? []).map((step, i) => (
                <div key={step.order} className="relative z-10 flex items-start gap-4 mb-6 last:mb-0">
                  <div className={i === 0 ? "w-10 h-10 rounded-full bg-emerald-900 border-2 border-emerald-500 flex items-center justify-center text-lg shrink-0 shadow-lg shadow-emerald-500/20" : i === (opp.flowSteps?.length ?? 0) - 1 ? "w-10 h-10 rounded-full bg-violet-900 border-2 border-violet-500 flex items-center justify-center text-lg shrink-0 shadow-lg shadow-violet-500/20" : "w-10 h-10 rounded-full bg-zinc-800 border-2 border-zinc-600 flex items-center justify-center text-lg shrink-0"}>
                    {step.icon}
                  </div>
                  <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800 p-4 hover:border-emerald-700/50 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded">STEP {step.order}</span>
                      <span className="font-semibold text-sm">{step.action}</span>
                    </div>
                    <p className="text-sm text-zinc-400 mt-1">{step.detail}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {step.chain && <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400">{CHAIN_NAMES[step.chain] ?? step.chain}</span>}
                      <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400">{step.platform}</span>
                    </div>
                  </div>
                </div>
              ))}

            </div>
          </div>

          {opp.costBreakdown && (
            <div className="rounded-xl border border-zinc-800 p-6">
              <h2 className="text-base font-semibold mb-4">{lang === "ko" ? "비용 상세" : "Cost Breakdown"}</h2>
              <p className="text-xs text-zinc-600 mb-3">
                {lang === "ko"
                  ? `모든 금액은 1,000,000 KRW 투자 기준 추정치이며, ${displayCurrency === "USD" ? "달러로 환산해 표시 중입니다." : "원화로 표시 중입니다."} 실제 비용은 변동될 수 있습니다.`
                  : `All amounts estimated on 1,000,000 KRW investment, shown in ${displayCurrency}. Actual costs may vary.`}
              </p>
              <div className="space-y-2">
                <DetailRow
                  label={lang === "ko" ? "업비트 거래 수수료 (0.05%)" : "Upbit Trading Fee (0.05%)"}
                  value={"-" + (displayCurrency === "USD" ? `$${(opp.costBreakdown.upbitFeeKrw / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.upbitFeeKrw).toLocaleString()} KRW`)}
                />
                <DetailRow
                  label={lang === "ko" ? "출금 수수료" : "Withdrawal Fee"}
                  value={"-" + (displayCurrency === "USD" ? `$${(opp.costBreakdown.withdrawalFeeKrw / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.withdrawalFeeKrw).toLocaleString()} KRW`)}
                />
                <DetailRow
                  label={lang === "ko" ? "가스 비용" : "Gas Cost"}
                  value={"-" + (displayCurrency === "USD" ? `$${(opp.costBreakdown.gasCostKrw / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.gasCostKrw).toLocaleString()} KRW`)}
                />
                <DetailRow
                  label={lang === "ko" ? "DEX 스왑 + 브릿지 수수료" : "DEX Swap + Bridge Fees"}
                  value={"-" + (displayCurrency === "USD" ? `$${(opp.costBreakdown.onchainFeeKrw / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.onchainFeeKrw).toLocaleString()} KRW`)}
                />
                <div className="border-t border-zinc-700 pt-2 mt-2">
                  <DetailRow
                    label={lang === "ko" ? "총 비용" : "Total Costs"}
                    value={"-" + (displayCurrency === "USD" ? `$${(opp.costBreakdown.totalCostsKrw / 1350).toFixed(2)}` : `${Math.round(opp.costBreakdown.totalCostsKrw).toLocaleString()} KRW`)}
                    bold
                  />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <MiniStat label={lang === "ko" ? "매수 수량" : "Tokens Bought"} value={opp.costBreakdown.tokensReceived.toFixed(6)} sub={opp.buyCoin} />
                <MiniStat label="ROI" value={opp.costBreakdown.roiPct.toFixed(3) + "%"} sub={lang === "ko" ? "순수익률" : "net return"} />
                <MiniStat label={lang === "ko" ? "손익분기 스프레드" : "Break-even Spread"} value={opp.costBreakdown.breakEvenSpreadPct.toFixed(2) + "%"} sub={lang === "ko" ? "필요 최소" : "minimum needed"} />
              </div>
            </div>
          )}

          {/* Live Execution */}
          <ExecutionPanel
            baseSymbol={opp.pair.split("/")[0]}
            quoteSymbol={opp.pair.split("/")[1] ?? "USDC"}
            chainId={opp.buyChain as ChainId}
            dexLabel={opp.buyDex}
          />

          {/* Risk Disclosure */}
          <div className="rounded-xl border border-zinc-800 p-5 mt-6">
            <h3 className="text-sm font-semibold text-zinc-400 mb-2">{lang === "ko" ? "중요 안내" : "Important Notes"}</h3>
            <ul className="text-xs text-zinc-500 space-y-1 list-disc list-inside">
              {lang === "ko" ? (
                <>
                  <li>단순 저가 매수·고가 매도 전략이며, LP 토큰·이자 농사·스테이킹은 포함되지 않습니다.</li>
                  <li>가격은 빠르게 변하니 모든 단계를 최대한 신속히 실행하세요.</li>
                  <li>업비트 출금 네트워크가 지갑 체인과 일치하는지 반드시 확인하세요. 잘못 보내면 복구 불가입니다.</li>
                  <li>가스·브릿지 수수료는 네트워크 혼잡 시 크게 변동될 수 있습니다.</li>
                  <li>검증을 위해 소액으로 먼저 테스트하세요.</li>
                </>
              ) : (
                <>
                  <li>This is a simple buy-low-sell-high strategy across two DEXes. No LP tokens, no yield farming, no staking involved.</li>
                  <li>Prices change rapidly - execute all steps as quickly as possible to avoid losing the spread.</li>
                  <li>Always double-check the withdrawal network on Upbit matches your wallet chain. Wrong network = permanent loss.</li>
                  <li>Gas fees and bridge fees can fluctuate significantly during network congestion.</li>
                  <li>Start with small amounts to verify the flow before scaling up.</li>
                </>
              )}
            </ul>
          </div>
      </main>
    </div>
  );
}

export default function OpportunityDetail({ params }: { params: Promise<{ id: string }> }) {
  return (
    <LangProvider>
      <OpportunityDetailInner params={params} />
    </LangProvider>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (<div className="rounded-lg border border-zinc-800 p-3"><p className="text-xs text-zinc-500 mb-0.5">{label}</p><p className={accent ? "text-base font-bold text-emerald-400" : "text-base font-bold"}>{value}</p></div>);
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (<div className="flex justify-between items-center text-sm"><span className="text-zinc-400">{label}</span><span className={bold ? "text-red-400 font-bold" : "text-red-400 font-medium"}>{value}</span></div>);
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (<div className="rounded-lg bg-zinc-900 p-3 text-center"><p className="text-xs text-zinc-500">{label}</p><p className="text-base font-bold mt-0.5">{value}</p>{sub && <p className="text-xs text-zinc-600 mt-0.5">{sub}</p>}</div>);
}