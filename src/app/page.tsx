"use client";

import { useState, useEffect } from "react";
import KimchiView from "@/components/KimchiView";
import DexArbitrageView from "@/components/DexArbitrageView";
import DexCompareView from "@/components/DexCompareView";
import SettingsView from "@/components/SettingsView";
import CalculatorView from "@/components/CalculatorView";
import SimulatorView from "@/components/SimulatorView";
import CexCexView from "@/components/CexCexView";

const TABS = [
  { id: "kimchi", label: "Kimchi", title: "Kimchi Premium Tracker", desc: "All Upbit KRW pairs vs global price, with per-pair round-trip P&L" },
  { id: "arbitrage", label: "DEX Arbitrage", title: "Upbit → DEX Arbitrage", desc: "Buy on Upbit, withdraw, sell on-chain — live web-quote prices" },
  { id: "cex", label: "CEX Arbitrage", title: "CEX → CEX (보유자산)", desc: "No on-chain move — hold inventory on both CEXes, instant hedge (Upbit·Bithumb·Binance·Bybit·OKX)" },
  { id: "compare", label: "DEX Compare", title: "DEX Price Compare", desc: "Live Uniswap & Sushi web-quote APIs compared across chains" },
  { id: "calculator", label: "Calculator", title: "Profit Calculator", desc: "Investment, fees and break-even simulation for a chosen coin and chain" },
  { id: "simulator", label: "Simulator", title: "Timing Simulator", desc: "Step-by-step execution timing and bottleneck analysis for any route" },
  { id: "settings", label: "Settings", title: "Settings", desc: "Scanner display and behavior preferences" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Home() {
  const [tab, setTab] = useState<TabId>("kimchi");

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("tab") as TabId | null;
    if (initial && TABS.some(item => item.id === initial)) setTab(initial);
  }, []);

  const switchTab = (id: TabId) => {
    setTab(id);
    window.history.replaceState(null, "", `/?tab=${id}`);
  };

  const current = TABS.find(item => item.id === tab) ?? TABS[0];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-[1800px] mx-auto px-8 py-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{current.title}</h1>
            <p className="text-xs text-zinc-500 mt-0.5">{current.desc}</p>
          </div>
          <nav className="flex-shrink-0 flex rounded-lg border border-zinc-700 overflow-hidden text-sm self-start">
            {TABS.map(item => (
              <button
                key={item.id}
                onClick={() => switchTab(item.id)}
                className={`px-4 py-2 transition-colors whitespace-nowrap ${tab === item.id ? "bg-emerald-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === "kimchi" && <KimchiView />}
        {tab === "arbitrage" && <DexArbitrageView />}
        {tab === "cex" && <CexCexView />}
        {tab === "compare" && <DexCompareView />}
        {tab === "calculator" && <CalculatorView />}
        {tab === "simulator" && <SimulatorView />}
        {tab === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
