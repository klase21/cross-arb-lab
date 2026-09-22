"use client";

import { useState, useEffect } from "react";
import KimchiView from "@/components/KimchiView";
import DexArbitrageView from "@/components/DexArbitrageView";
import SettingsView from "@/components/SettingsView";
import CexCexView from "@/components/CexCexView";
import SquareView from "@/components/SquareView";
import TaView from "@/components/TaView";
import FuturesView from "@/components/FuturesView";
import PaperView from "@/components/PaperView";
import PaperAutoRunner from "@/components/PaperAutoRunner";
import { LangProvider, useLang } from "@/lib/i18n";

const TAB_DEFS = [
  { id: "kimchi" as const, labelKey: "tab.kimchi.label", titleKey: "tab.kimchi.title", descKey: "tab.kimchi.desc" },
  { id: "arbitrage" as const, labelKey: "tab.arbitrage.label", titleKey: "tab.arbitrage.title", descKey: "tab.arbitrage.desc" },
  { id: "cex" as const, labelKey: "tab.cex.label", titleKey: "tab.cex.title", descKey: "tab.cex.desc" },
  { id: "square" as const, labelKey: "tab.square.label", titleKey: "tab.square.title", descKey: "tab.square.desc" },
  { id: "ta" as const, labelKey: "tab.ta.label", titleKey: "tab.ta.title", descKey: "tab.ta.desc" },
  { id: "futures" as const, labelKey: "tab.futures.label", titleKey: "tab.futures.title", descKey: "tab.futures.desc" },
  { id: "paper" as const, labelKey: "tab.paper.label", titleKey: "tab.paper.title", descKey: "tab.paper.desc" },
  { id: "settings" as const, labelKey: "tab.settings.label", titleKey: "tab.settings.title", descKey: "tab.settings.desc" },
] as const;

type TabId = (typeof TAB_DEFS)[number]["id"];

function HomeInner() {
  const [tab, setTab] = useState<TabId>("kimchi");
  const { t } = useLang();

  const TABS = TAB_DEFS.map(d => ({ id: d.id, label: t(d.labelKey), title: t(d.titleKey), desc: t(d.descKey) }));

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
              {TABS.map(item => (
                <button
                  key={item.id}
                  onClick={() => switchTab(item.id)}
                  className={`px-3 md:px-4 py-2 transition-colors whitespace-nowrap text-xs md:text-sm ${tab === item.id ? "bg-emerald-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
                >
                  {item.label}
                  {item.id === "square" && (
                    <span className="ml-1 px-1 py-px rounded bg-violet-500/25 text-violet-200 text-[10px] font-bold align-middle">BETA</span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {tab === "kimchi" && <KimchiView />}
        {tab === "arbitrage" && <DexArbitrageView />}
        {tab === "cex" && <CexCexView />}
        {tab === "square" && <SquareView />}
        {tab === "ta" && <TaView />}
        {tab === "futures" && <FuturesView />}
        {tab === "paper" && <PaperView />}
        {tab === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <LangProvider>
      <HomeInner />
      <PaperAutoRunner />
    </LangProvider>
  );
}
