"use client";

import { useState, useEffect } from "react";
import KimchiView from "@/components/KimchiView";
import DexArbitrageView from "@/components/DexArbitrageView";
import DexCompareView from "@/components/DexCompareView";
import SettingsView from "@/components/SettingsView";
import CalculatorView from "@/components/CalculatorView";
import SimulatorView from "@/components/SimulatorView";
import CexCexView from "@/components/CexCexView";
import { LangProvider, useLang } from "@/lib/i18n";

const TAB_DEFS = [
  { id: "kimchi" as const, labelKey: "tab.kimchi.label", titleKey: "tab.kimchi.title", descKey: "tab.kimchi.desc" },
  { id: "arbitrage" as const, labelKey: "tab.arbitrage.label", titleKey: "tab.arbitrage.title", descKey: "tab.arbitrage.desc" },
  { id: "cex" as const, labelKey: "tab.cex.label", titleKey: "tab.cex.title", descKey: "tab.cex.desc" },
  { id: "compare" as const, labelKey: "tab.compare.label", titleKey: "tab.compare.title", descKey: "tab.compare.desc" },
  { id: "calculator" as const, labelKey: "tab.calculator.label", titleKey: "tab.calculator.title", descKey: "tab.calculator.desc" },
  { id: "simulator" as const, labelKey: "tab.simulator.label", titleKey: "tab.simulator.title", descKey: "tab.simulator.desc" },
  { id: "settings" as const, labelKey: "tab.settings.label", titleKey: "tab.settings.title", descKey: "tab.settings.desc" },
] as const;

type TabId = (typeof TAB_DEFS)[number]["id"];

function HomeInner() {
  const [tab, setTab] = useState<TabId>("kimchi");
  const { lang, setLang, t } = useLang();

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
      <main className="max-w-[1800px] mx-auto px-8 py-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{current.title}</h1>
            <p className="text-xs text-zinc-500 mt-0.5">{current.desc}</p>
          </div>
          <div className="flex items-center gap-3 self-start">
            <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-xs">
              <button
                onClick={() => setLang("ko")}
                className={`px-3 py-2 transition-colors ${lang === "ko" ? "bg-zinc-100 text-zinc-900 font-medium" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
              >
                KO
              </button>
              <button
                onClick={() => setLang("en")}
                className={`px-3 py-2 transition-colors ${lang === "en" ? "bg-zinc-100 text-zinc-900 font-medium" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
              >
                EN
              </button>
            </div>
            <nav className="flex rounded-lg border border-zinc-700 overflow-hidden text-sm">
              {VISIBLE_TABS.map(item => (
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

export default function Home() {
  return (
    <LangProvider>
      <HomeInner />
    </LangProvider>
  );
}
