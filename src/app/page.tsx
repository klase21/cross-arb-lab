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
  { id: "kimchi", label: "김치 프리미엄", title: "김치 프리미엄", desc: "업비트 전 종목 vs 글로벌 시세 — 오더북·CMC 검증·라운드트립 수익" },
  { id: "arbitrage", label: "출금 차익", title: "출금 차익", desc: "업비트 매수 → 출금 → DEX 매도 — 브릿지·가스 포함 실제 수익" },
  { id: "cex", label: "보유 차익", title: "보유 차익", desc: "양 거래소 보유 가정 — 출금 없이 즉시 양방향 체결 (Upbit·Bithumb·Binance·Bybit·OKX)" },
  { id: "compare", label: "시세 비교", title: "시세 비교", desc: "Uniswap·Sushi 호가를 6개 체인에서 비교" },
  { id: "calculator", label: "수익 계산기", title: "수익 계산기", desc: "투자금·수수료·손익분기 시뮬레이션" },
  { id: "simulator", label: "실행 시뮬", title: "실행 시뮬레이터", desc: "단계별 소요시간·병목 분석" },
  { id: "settings", label: "설정", title: "설정", desc: "갱신주기·알림·위험 가중치" },
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
