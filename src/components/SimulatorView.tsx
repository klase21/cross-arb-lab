"use client";

import { useState, useMemo } from "react";
import { simulateTiming } from "@/lib/timing-simulator";

const CHAINS = [
  { id: "ethereum", name: "Ethereum" },
  { id: "arbitrum", name: "Arbitrum" },
  { id: "polygon", name: "Polygon" },
  { id: "base", name: "Base" },
  { id: "optimism", name: "Optimism" },
  { id: "bsc", name: "BNB Chain" },
];
const COINS = ["ETH", "BTC", "XRP", "SOL"];
const CEXES = ["upbit", "bithumb", "binance", "bybit", "okx"];

export default function SimulatorView() {
  const [coin, setCoin] = useState("ETH");
  const [buyCex, setBuyCex] = useState("upbit");
  const [sellCex, setSellCex] = useState("binance");
  const [chainId, setChainId] = useState("arbitrum");
  const [useDexLeg, setUseDexLeg] = useState(false);

  const result = useMemo(() => simulateTiming({ coinSymbol: coin, buyCexId: buyCex, sellCexId: sellCex, chainId, isCrossChainDex: useDexLeg, dexChainId: chainId }), [coin, buyCex, sellCex, chainId, useDexLeg]);

  const fmtDur = (s: number) => s >= 60 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : s + "s";

  const riskClass = result.totalSec > 1800 ? "border-red-800 bg-red-950/20 text-red-400" : result.totalSec > 600 ? "border-yellow-800 bg-yellow-950/20 text-yellow-400" : "border-emerald-800 bg-emerald-950/20 text-emerald-400";

  return (
    <div>

          <div className="rounded-xl border border-zinc-800 p-6 mb-6">
            <h2 className="text-base font-semibold mb-4">Route Configuration</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div><label className="block text-xs text-zinc-500 mb-1.5">Coin</label><select value={coin} onChange={e => setCoin(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">{COINS.map(c => <option key={c}>{c}</option>)}</select></div>
              <div><label className="block text-xs text-zinc-500 mb-1.5">Buy CEX</label><select value={buyCex} onChange={e => setBuyCex(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm capitalize">{CEXES.map(c => <option key={c}>{c}</option>)}</select></div>
              <div><label className="block text-xs text-zinc-500 mb-1.5">Sell CEX</label><select value={sellCex} onChange={e => setSellCex(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm capitalize">{CEXES.map(c => <option key={c}>{c}</option>)}</select></div>
              <div><label className="block text-xs text-zinc-500 mb-1.5">Chain (withdrawal network)</label><select value={chainId} onChange={e => setChainId(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">{CHAINS.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}</select></div>
            </div>
            <label className="flex items-center gap-2 mt-4 cursor-pointer select-none"><button onClick={() => setUseDexLeg(!useDexLeg)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${useDexLeg ? "bg-cyan-600" : "bg-zinc-700"}`}><span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${useDexLeg ? "translate-x-[18px]" : "translate-x-1"}`} /></button><span className="text-sm text-zinc-400">Include DEX swap leg (+15s)</span></label>
          </div>

          <div className={"rounded-xl border p-6 mb-6 text-center " + riskClass}>
            <p className="text-sm text-zinc-400 mb-1">Total Time to Execute Full Route</p>
            <p className={"text-4xl font-bold " + riskClass.split(" ").pop()}>{result.totalMinutes}</p>
            <p className="text-xs text-zinc-500 mt-2">Bottleneck: <strong>{result.bottleneckLabel}</strong>{result.totalSec > 0 ? " (" + fmtDur(result.bottleneckSec) + ")" : ""}</p>
          </div>

          {result.totalSec === -1 && (
            <div className="rounded-xl border border-red-800 bg-red-950/30 p-5 mb-6">
              <p className="text-sm font-semibold text-red-400 mb-1">Invalid Route</p>
              <p className="text-sm text-zinc-400">{result.bottleneckLabel}</p>
              <p className="text-xs text-zinc-600 mt-2">Native BTC only exists on the Bitcoin network. To use it on EVM chains you would need WBTC (wrapped), which is a different token. Check which network each exchange supports for withdrawal.</p>
          </div>
        )}

          <div className="rounded-xl border border-zinc-800 p-6 mb-6">
            <h2 className="text-base font-semibold mb-4">Step Timeline</h2>
            <div className="space-y-3">
              {result.steps.map(step => (
                <div key={step.order} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-base shrink-0">{step.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{step.label}</p>
                    <p className="text-xs text-zinc-500">{step.detail}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-bold">{fmtDur(step.durationSec)}</p>
                    <p className="text-[10px] text-zinc-600">t+{fmtDur(step.cumulativeSec)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 p-6">
            <h2 className="text-base font-semibold mb-4">Time Breakdown</h2>
            <div className="space-y-2">
              {result.steps.map(step => (
                <div key={step.order}>
                  <div className="flex justify-between text-xs mb-1"><span className="text-zinc-400 truncate max-w-[70%]">{step.label}</span><span className="text-zinc-500 font-mono">{fmtDur(step.durationSec)}</span></div>
                  <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-cyan-500" style={{ width: Math.max((step.durationSec / result.totalSec) * 100, 2) + "%" }} /></div>
                </div>
              ))}
            </div>
          </div>
    </div>
  );
}