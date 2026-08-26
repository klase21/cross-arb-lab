"use client";

import { useState, useEffect, useCallback } from "react";
import { getUsdKrwRate } from "@/lib/fx";

const UPBIT_FEE_PCT = 0.05;
const WITHDRAWAL_FEES: Record<string, number> = {
  ethereum: 0.0017, arbitrum: 0.0017, polygon: 0.0017, base: 0.0017, optimism: 0.0017, bsc: 0.0005
};
const GAS_COSTS_USD: Record<string, number> = {
  ethereum: 8, arbitrum: 0.15, polygon: 0.01, base: 0.05, optimism: 0.08, bsc: 0.25
};
const DEX_SWAP_FEES_PCT: Record<string, number> = {
  ethereum: 0.3, arbitrum: 0.3, polygon: 0.3, base: 0.3, optimism: 0.3, bsc: 0.25
};
const BRIDGE_FEE_PCT = 0.05;

export default function CalculatorView() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [investmentKrw, setInvestmentKrw] = useState(1000000);
  const [selectedSymbol, setSelectedSymbol] = useState("ETH");
  const [targetChain, setTargetChain] = useState("arbitrum");
  const [isCrossChain, setIsCrossChain] = useState(true);
  const [arbProfitPct, setArbProfitPct] = useState(1.5);
  const [fxRate, setFxRate] = useState(1350);

  useEffect(() => {
    getUsdKrwRate().then(rate => { if (rate > 500) setFxRate(rate); }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/prices").then(r => r.json()).then(d => {
      if (d.prices) setPrices(d.prices);
    }).catch(() => {});
  }, []);

  const upbitFeeKrw = investmentKrw * (UPBIT_FEE_PCT / 100);
  const netAfterUpbitFee = investmentKrw - upbitFeeKrw;
  const coinPriceKrw = selectedSymbol === "ETH" ? (prices.ETH ?? 4720000) : selectedSymbol === "BTC" ? (prices.BTC ?? 90000000) : (prices.XRP ?? 600);
  const tokensReceived = netAfterUpbitFee / coinPriceKrw;
  const withdrawFee = WITHDRAWAL_FEES[targetChain] ?? 0.001;
  const tokensAfterWithdrawal = tokensReceived - withdrawFee;
  const gasCostUsd = GAS_COSTS_USD[targetChain] ?? 5;
  const gasCostKrw = gasCostUsd * fxRate;
  const swapFeePct = DEX_SWAP_FEES_PCT[targetChain] ?? 0.3;
  const totalSwapFeesPct = isCrossChain ? swapFeePct * 2 : swapFeePct;
  const bridgeFeePct = isCrossChain ? BRIDGE_FEE_PCT : 0;
  const totalOnchainFeesPct = totalSwapFeesPct + bridgeFeePct;
  const onchainFeeKrw = tokensReceived * coinPriceKrw * (totalOnchainFeesPct / 100);
  const totalCostsKrw = upbitFeeKrw + withdrawFee * coinPriceKrw + gasCostKrw + onchainFeeKrw;
  const grossArbRevenue = investmentKrw * (arbProfitPct / 100);
  const netProfitKrw = grossArbRevenue - totalCostsKrw;
  const roiPct = netProfitKrw / investmentKrw * 100;

  return (
    <div>

          <div className="rounded-xl border border-zinc-800 p-6 mb-6">
            <h2 className="text-base font-semibold mb-4">Input</h2>
            <div className="grid md:grid-cols-2 gap-4">

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Investment Amount (KRW)</label>
                <input type="number" value={investmentKrw} onChange={e => setInvestmentKrw(Number(e.target.value))} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
                <div className="flex gap-2 mt-2 flex-wrap">
                  {[500000, 1000000, 5000000, 10000000].map(v => (
                    <button key={v} onClick={() => setInvestmentKrw(v)} className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">{v.toLocaleString()}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Coin to Buy on Upbit</label>
                <select value={selectedSymbol} onChange={e => setSelectedSymbol(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
                  <option value="ETH">ETH ({(prices.ETH ?? 4720000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} KRW)</option>
                  <option value="BTC">BTC ({(prices.BTC ?? 90000000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} KRW)</option>
                  <option value="XRP">XRP ({(prices.XRP ?? 600).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} KRW)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Target Chain</label>
                <select value={targetChain} onChange={e => setTargetChain(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
                  {["ethereum","arbitrum","polygon","base","optimism","bsc"].map(c => (<option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Execution Type</label>
                <div className="flex gap-2">
                  <button onClick={() => setIsCrossChain(false)} className={`flex-1 px-3 py-2 text-sm rounded-lg font-medium transition-colors ${!isCrossChain ? "bg-emerald-600 text-white" : "bg-zinc-900 border border-zinc-700 text-zinc-400"}`}>Same-Chain</button>
                  <button onClick={() => setIsCrossChain(true)} className={`flex-1 px-3 py-2 text-sm rounded-lg font-medium transition-colors ${isCrossChain ? "bg-violet-600 text-white" : "bg-zinc-900 border border-zinc-700 text-zinc-400"}`}>Cross-Chain</button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Expected Arbitrage Spread (%)</label>
                <input type="number" step="0.01" value={arbProfitPct} onChange={e => setArbProfitPct(Number(e.target.value))} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
                <input type="range" min="0" max="10" step="0.1" value={arbProfitPct} onChange={e => setArbProfitPct(Number(e.target.value))} className="w-full mt-2 accent-emerald-500" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 p-6 mb-6">
            <h2 className="text-base font-semibold mb-4">Cost Breakdown</h2>
            <div className="space-y-3">
              <CostRow label="Upbit Trading Fee (0.05%)" value={upbitFeeKrw} />
              <CostRow label={`Withdrawal Fee (${withdrawFee} ${selectedSymbol})`} value={withdrawFee * coinPriceKrw} />
              <CostRow label={`Gas Cost (${targetChain})`} value={gasCostKrw} />
              <CostRow label={`DEX Swap Fees (${totalSwapFeesPct.toFixed(2)}%) + Bridge (${bridgeFeePct}%)`} value={onchainFeeKrw} />
              <div className="border-t border-zinc-700 pt-3 mt-3"><div className="flex justify-between items-center"><span className="font-semibold text-red-400">Total Costs</span><span className="font-bold text-red-400">-{totalCostsKrw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} KRW</span></div></div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 p-6 mb-6">
            <h2 className="text-base font-semibold mb-4">Summary</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="rounded-lg bg-zinc-900 p-4">
                <p className="text-xs text-zinc-500 mb-1">Tokens Received After Withdrawal</p>
                <p className="text-xl font-bold">{tokensAfterWithdrawal.toFixed(8)} {selectedSymbol}</p>
              </div>
              <div className="rounded-lg bg-zinc-900 p-4">
                <p className="text-xs text-zinc-500 mb-1">Gross Arb Revenue (@{arbProfitPct}%)</p>
                <p className="text-xl font-bold text-emerald-400">+{grossArbRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} KRW</p>
              </div>
            </div>
            <div className={netProfitKrw >= 0 ? "rounded-xl p-6 text-center border border-emerald-800 bg-emerald-950/20" : "rounded-xl p-6 text-center border border-red-800 bg-red-950/20"}>
              <p className="text-sm text-zinc-400 mb-1">Net Profit / Loss</p>
              <p className={netProfitKrw >= 0 ? "text-3xl font-bold text-emerald-400" : "text-3xl font-bold text-red-400"}>{netProfitKrw >= 0 ? "+" : ""}{netProfitKrw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} KRW</p>
              <p className={netProfitKrw >= 0 ? "mt-2 text-lg text-emerald-500" : "mt-2 text-lg text-red-500"}>ROI: {roiPct.toFixed(3)}%</p>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 p-6">
            <h2 className="text-base font-semibold mb-2">Break-Even Analysis</h2>
            <p className="text-sm text-zinc-400">Minimum spread needed to break even: <strong className="text-yellow-400">{((totalCostsKrw / investmentKrw) * 100).toFixed(3)}%</strong></p>
            <p className="text-xs text-zinc-600 mt-1">Any arb opportunity above this threshold is profitable. Applied FX rate: {fxRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} KRW/USD (live).</p>
          </div>
    </div>
  );
}

function CostRow({ label, value }: { label: string; value: number }) {
  return (<div className="flex justify-between items-center text-sm"><span className="text-zinc-400">{label}</span><span className="font-medium text-red-400">-{value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} KRW</span></div>);
}