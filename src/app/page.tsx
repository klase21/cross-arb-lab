"use client";

import { useState, useEffect } from "react";
import KimchiView from "@/components/KimchiView";
import DexArbitrageView from "@/components/DexArbitrageView";
import DexCompareView from "@/components/DexCompareView";
import SettingsView from "@/components/SettingsView";
import CalculatorView from "@/components/CalculatorView";
import SimulatorView from "@/components/SimulatorView";
import CexCexView from "@/components/CexCexView";
import TrendingView from "@/components/TrendingView";
import SniperView from "@/components/SniperView";
import { LangProvider, useLang } from "@/lib/i18n";

const TAB_DEFS = [
  { id: "kimchi" as const, labelKey: "tab.kimchi.label", titleKey: "tab.kimchi.title", descKey: "tab.kimchi.desc" },
  { id: "arbitrage" as const, labelKey: "tab.arbitrage.label", titleKey: "tab.arbitrage.title", descKey: "tab.arbitrage.desc" },
  { id: "cex" as const, labelKey: "tab.cex.label", titleKey: "tab.cex.title", descKey: "tab.cex.desc" },
  { id: "sniper" as const, labelKey: "tab.sniper.label", titleKey: "tab.sniper.title", descKey: "tab.sniper.desc" },
  { id: "compare" as const, labelKey: "tab.compare.label", titleKey: "tab.compare.title", descKey: "tab.compare.desc" },
  { id: "trending" as const, labelKey: "tab.trending.label", titleKey: "tab.trending.title", descKey: "tab.trending.desc" },
  { id: "calculator" as const, labelKey: "tab.calculator.label", titleKey: "tab.calculator.title", descKey: "tab.calculator.desc" },
  { id: "simulator" as const, labelKey: "tab.simulator.label", titleKey: "tab.simulator.title", descKey: "tab.simulator.desc" },
  { id: "settings" as const, labelKey: "tab.settings.label", titleKey: "tab.settings.title", descKey: "tab.settings.desc" },
] as const;

type TabId = (typeof TAB_DEFS)[number]["id"];

function HomeInner() {
  const [tab, setTab] = useState<TabId>("kimchi");
  const { t } = useLang();

  const TABS = TAB_DEFS.map(d => ({ id: d.id, label: t(d.labelKey), title: t(d.titleKey), desc: t(d.descKey) }));
  const HIDDEN_TABS = new Set<TabId>(["calculator", "simulator"]);
  const VISIBLE_TABS = TABS.filter(tabItem => !HIDDEN_TABS.has(tabItem.id));

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("tab") as TabId | null;
    if (initial && TABS.some(item => item.id === initial)) setTab(initial);
  }, [TABS]);

  const switchTab = (id: TabId) => {
    setTab(id);
    window.history.replaceState(null, "", `/?tab=${id}`);
  };

  const current = TABS.find(item => item.id === tab) ?? TABS[0];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-[1800px] mx-auto px-4 md:px-8 py-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{current.title}</h1>
            <p className="text-xs text-zinc-500 mt-0.5">{current.desc}</p>
          </div>
          <div className="-mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto scrollbar-thin">
            <nav className="flex rounded-lg border border-zinc-700 overflow-hidden text-sm self-start w-max">
              {VISIBLE_TABS.map(item => (
                <button
                  key={item.id}
                  onClick={() => switchTab(item.id)}
                  className={`px-3 md:px-4 py-2 transition-colors whitespace-nowrap text-xs md:text-sm ${tab === item.id ? "bg-emerald-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {tab === "kimchi" && <KimchiView />}
        {tab === "arbitrage" && <DexArbitrageView />}
        {tab === "cex" && <CexCexView />}
        {tab === "sniper" && <SniperView />}
        {tab === "compare" && <DexCompareView />}
        {tab === "trending" && <TrendingView />}
        {tab === "calculator" && <CalculatorView />}
        {tab === "simulator" && <SimulatorView />}
        {tab === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <LangProvider>
      <HomeInner />
    </LangProvider>
  );
}
