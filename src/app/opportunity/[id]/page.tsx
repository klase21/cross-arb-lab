"use client";

import { useState, useEffect, use } from "react";
import ExecutionPanel from "./ExecutionPanel";
import type { ChainId } from "@/lib/dex-config";

interface FlowStep { order: number; action: string; detail: string; platform: string; chain?: string; icon: string; }
interface CostBreakdown { upbitFeeKrw: number; withdrawalFeeKrw: number; gasCostKrw: number; onchainFeeKrw: number; totalCostsKrw: number; tokensReceived: number; netProfitKrw: number; roiPct: number; breakEvenSpreadPct: number; }
interface ArbitrageOpportunity { pair: string; buyCoin: string; upbitMarket: string; buyChain: string; sellChain: string; buyDex: string; sellDex: string; buyPrice: number; sellPrice: number; spreadPct: number; netSpreadPct: number; liquidityUsd: number; estimatedProfitUsd: number; isCrossChain: boolean; bridgeFeePct: number; detectedAt: string; costBreakdown?: CostBreakdown; flowSteps?: FlowStep[]; }
interface ScanResult { opportunities: ArbitrageOpportunity[]; totalScannedPairs: number; chainsScanned: number; crossChainCount: number; sameChainCount: number; timestamp: string; }

const CHAIN_NAMES: Record<string, string> = { ethereum: "Ethereum", arbitrum: "Arbitrum", polygon: "Polygon", base: "Base", optimism: "Optimism", bsc: "BNB Chain" };

export default function OpportunityDetail({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const decoded = decodeURIComponent(resolvedParams.id);
  const [pair, buyChain, sellChain] = decoded.split("|");
  const [opp, setOpp] = useState<ArbitrageOpportunity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/scan").then(r => r.json()).then((data: ScanResult) => {
      const found = data.opportunities.find(o => o.pair === pair && o.buyChain === buyChain && o.sellChain === sellChain);
      setOpp(found ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [pair, buyChain, sellChain]);

  const fmtUsd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPrice = (n: number) => n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toFixed(6);

  if (loading) return (<div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center"><div className="animate-pulse text-lg text-zinc-500">Loading opportunity...</div></div>);

  if (!opp) return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4"><a href="/" className="text-sm text-emerald-400 hover:text-emerald-300">&larr; Back to Scanner</a></header>
      <main className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-lg text-zinc-400 mb-2">Opportunity not found or expired</p>
        <p className="text-sm text-zinc-600">The arbitrage window may have closed. Return to scanner for current opportunities.</p>
      </main>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{opp.pair} Execution Flow</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{CHAIN_NAMES[opp.buyChain]} → {CHAIN_NAMES[opp.sellChain]} · Net +{opp.netSpreadPct.toFixed(3)}%</p>
        </div>
        <a href="/" className="px-4 py-1.5 rounded-lg border border-zinc-700 hover:border-emerald-500 text-sm font-medium transition-colors">&larr; Back</a>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <SummaryCard label="Net Spread" value={"+" + opp.netSpreadPct.toFixed(3) + "%"} accent />
            <SummaryCard label="Est. Profit" value={opp.costBreakdown ? Math.round(opp.costBreakdown.netProfitKrw).toLocaleString() + " KRW" : fmtUsd(opp.estimatedProfitUsd)} accent={opp.costBreakdown ? opp.costBreakdown.netProfitKrw > 0 : true} />
            <SummaryCard label="Buy Price" value={"@ " + fmtPrice(opp.buyPrice)} />
            <SummaryCard label="Sell Price" value={"@ " + fmtPrice(opp.sellPrice)} />
          </div>

          <div className="rounded-xl border border-zinc-800 p-6 mb-6">
            <h2 className="text-base font-semibold mb-1">Step-by-Step Execution Plan <span className="text-xs font-normal text-zinc-500 ml-2">(Simple swap-based arbitrage - no LP tokens involved)</span></h2>
            <p className="text-xs text-zinc-500 mb-6">Follow these steps in order to execute the arbitrage trade</p>

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
              <h2 className="text-base font-semibold mb-4">Cost Breakdown</h2>
              <p className="text-xs text-zinc-600 mb-3">All amounts are estimated in KRW based on your configured investment. Actual costs may vary.</p>
              <div className="space-y-2">
                <DetailRow label="Upbit Trading Fee (0.05%)" value={"-" + Math.round(opp.costBreakdown.upbitFeeKrw).toLocaleString() + " KRW"} />
                <DetailRow label="Withdrawal Fee" value={"-" + Math.round(opp.costBreakdown.withdrawalFeeKrw).toLocaleString() + " KRW"} />
                <DetailRow label="Gas Cost" value={"-" + Math.round(opp.costBreakdown.gasCostKrw).toLocaleString() + " KRW"} />
                <DetailRow label="DEX Swap + Bridge Fees" value={"-" + Math.round(opp.costBreakdown.onchainFeeKrw).toLocaleString() + " KRW"} />
                <div className="border-t border-zinc-700 pt-2 mt-2"><DetailRow label="Total Costs" value={"-" + Math.round(opp.costBreakdown.totalCostsKrw).toLocaleString() + " KRW"} bold /></div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <MiniStat label="Tokens Bought" value={opp.costBreakdown.tokensReceived.toFixed(6)} sub={opp.buyCoin} />
                <MiniStat label="ROI" value={opp.costBreakdown.roiPct.toFixed(3) + "%"} sub="net return" />
                <MiniStat label="Break-even Spread" value={opp.costBreakdown.breakEvenSpreadPct.toFixed(2) + "%"} sub="minimum needed" />
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
            <h3 className="text-sm font-semibold text-zinc-400 mb-2">Important Notes</h3>
            <ul className="text-xs text-zinc-500 space-y-1 list-disc list-inside">
              <li>This is a simple buy-low-sell-high strategy across two DEXes. No LP tokens, no yield farming, no staking involved.</li>
              <li>Prices change rapidly - execute all steps as quickly as possible to avoid losing the spread.</li>
              <li>Always double-check the withdrawal network on Upbit matches your wallet chain. Wrong network = permanent loss.</li>
              <li>Gas fees and bridge fees can fluctuate significantly during network congestion.</li>
              <li>Start with small amounts to verify the flow before scaling up.</li>
            </ul>
          </div>
      </main>
    </div>
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