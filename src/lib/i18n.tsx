"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Lang = "ko" | "en";

type Dict = Record<string, string>;

const dictionaries: Record<Lang, Dict> = {
  ko: {
    // Tabs
    "tab.kimchi.label": "김치 프리미엄",
    "tab.kimchi.title": "김치 프리미엄",
    "tab.kimchi.desc": "업비트 전 종목 vs 글로벌 시세 — 오더북·CMC 검증·라운드트립 수익",
    "tab.arbitrage.label": "출금 차익",
    "tab.arbitrage.title": "출금 차익",
    "tab.arbitrage.desc": "업비트 매수 → 출금 → DEX 매도 — 브릿지·가스 포함 실제 수익",
    "tab.cex.label": "보유 차익",
    "tab.cex.title": "보유 차익",
    "tab.cex.desc": "양 거래소 보유 가정 — 출금 없이 즉시 양방향 체결 (Upbit·Bithumb·Binance·Bybit·OKX)",
    "tab.compare.label": "시세 비교",
    "tab.compare.title": "시세 비교",
    "tab.compare.desc": "Uniswap·Sushi 호가를 6개 체인에서 비교",
    "tab.calculator.label": "수익 계산기",
    "tab.calculator.title": "수익 계산기",
    "tab.calculator.desc": "투자금·수수료·손익분기 시뮬레이션",
    "tab.simulator.label": "실행 시뮬",
    "tab.simulator.title": "실행 시뮬레이터",
    "tab.simulator.desc": "단계별 소요시간·병목 분석",
    "tab.settings.label": "설정",
    "tab.settings.title": "설정",
    "tab.settings.desc": "갱신주기·알림·위험 가중치",
    // Common
    "common.lastUpdated": "마지막 업데이트",
    "common.fx": "FX",
    // Kimchi
    "kimchi.subtitle": "업비트 전체 KRW 마켓 vs 바이낸스 글로벌 시세",
    "kimchi.trending": "급등락 Top 5 (1시간 프리미엄 변동)",
    "kimchi.searchPlaceholder": "코인 검색 (심볼 또는 한글명)…",
    "kimchi.verifiedOnly": "CMC 검증 통과만",
    "kimchi.exportCsv": "CSV 내보내기",
    "kimchi.pairsTracking": "페어 추적 중",
    // DexArb
    "dexArb.subtitle": "업비트(KRW)에서 매수 → 출금 → Uniswap/Sushi 온체인 매도",
    "dexArb.inventoryToggle": "보유자산 가정",
    "dexArb.inventoryBanner": "보유자산 모드 ON — 출금 수수료·가스·브릿지·대기시간을 제외한 순수 스프레드만 표시. 양쪽 체인/거래소에 미리 보유한 경우 즉시 양방향 체결 가정 (보유 차익 탭은 이 로직 전용).",
    // Cex
    "cex.subtitle": "업비트·빗썸·바이낸스·바이비트·OKX 현물 시세 모니터링",
    // Compare
    "compare.subtitle": "동일 DEX를 여러 체인에서 비교 — 스프레드가 가장 큰 곳 찾기",
    // Calculator
    "calculator.title": "Profit Calculator",
    // Simulator
    "simulator.title": "Timing Simulator",
    // Settings
    "settings.title": "Settings",
    // Risk
    "risk.title": "위험도",
    "lang.ko": "한글",
    "lang.en": "English",
  },
  en: {
    "tab.kimchi.label": "Kimchi Premium",
    "tab.kimchi.title": "Kimchi Premium",
    "tab.kimchi.desc": "All Upbit KRW pairs vs global price — orderbook · CMC check · round-trip P&L",
    "tab.arbitrage.label": "Withdraw Arb",
    "tab.arbitrage.title": "Withdraw Arb",
    "tab.arbitrage.desc": "Buy on Upbit → withdraw → sell on DEX — net after bridge & gas",
    "tab.cex.label": "Inventory Arb",
    "tab.cex.title": "Inventory Arb",
    "tab.cex.desc": "Pre-funded on both CEXes — instant hedge, no on-chain move (Upbit·Bithumb·Binance·Bybit·OKX)",
    "tab.compare.label": "Price Compare",
    "tab.compare.title": "Price Compare",
    "tab.compare.desc": "Compare Uniswap & Sushi quotes across 6 chains",
    "tab.calculator.label": "Calculator",
    "tab.calculator.title": "Calculator",
    "tab.calculator.desc": "Investment, fees & break-even simulation",
    "tab.simulator.label": "Simulator",
    "tab.simulator.title": "Simulator",
    "tab.simulator.desc": "Step timing & bottleneck analysis",
    "tab.settings.label": "Settings",
    "tab.settings.title": "Settings",
    "tab.settings.desc": "Refresh interval · alerts · risk weights",
    "common.lastUpdated": "Last updated",
    "common.fx": "FX",
    "kimchi.subtitle": "All Upbit KRW pairs vs Binance global price",
    "kimchi.trending": "Top Movers (1h premium change)",
    "kimchi.searchPlaceholder": "Search coin (symbol or name)…",
    "kimchi.verifiedOnly": "Verified only",
    "kimchi.exportCsv": "Export CSV",
    "kimchi.pairsTracking": "pairs tracking",
    "dexArb.subtitle": "Buy on Upbit (KRW) → withdraw → sell on-chain via Uniswap / Sushi web quotes.",
    "dexArb.inventoryToggle": "Inventory mode",
    "dexArb.inventoryBanner": "Inventory ON — excludes withdraw, gas, bridge & wait time. Assumes pre-funded on both venues for instant hedge (see Inventory Arb tab).",
    "cex.subtitle": "Monitoring Upbit, Bithumb, Binance, Bybit, OKX spot prices.",
    "compare.subtitle": "Same DEX, multiple chains — find the widest spread.",
    "calculator.title": "Profit Calculator",
    "simulator.title": "Timing Simulator",
    "settings.title": "Settings",
    "risk.title": "Risk",
    "lang.ko": "한글",
    "lang.en": "English",
  },
};

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string } | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ko");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("arbLang") as Lang | null;
      if (saved === "ko" || saved === "en") {
        setLangState(saved);
        return;
      }
      const browser = navigator.language.toLowerCase();
      if (browser.startsWith("en")) setLangState("en");
    } catch {}
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem("arbLang", next);
      window.dispatchEvent(new Event("arbLangChanged"));
    } catch {}
  };

  useEffect(() => {
    const handler = () => {
      try {
        const saved = localStorage.getItem("arbLang") as Lang | null;
        if (saved === "ko" || saved === "en") setLangState(saved);
      } catch {}
    };
    window.addEventListener("storage", handler);
    window.addEventListener("arbLangChanged", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("arbLangChanged", handler);
    };
  }, []);

  const t = (key: string): string => dictionaries[lang][key] ?? key;

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}

export function useTranslation() {
  return useLang();
}
