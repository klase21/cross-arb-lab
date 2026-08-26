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
    "tab.sniper.label": "상장 스나이퍼",
    "tab.sniper.title": "상장 스나이퍼",
    "tab.sniper.desc": "바이낸스 상장 · 업비트 미상장 코인 감시 — 업비트 신규 상장 즉시 알림",
    "tab.compare.label": "시세 비교",
    "tab.compare.title": "시세 비교",
    "tab.compare.desc": "Uniswap·Sushi 호가를 6개 체인에서 비교",
    "tab.trending.label": "트렌딩",
    "tab.trending.title": "트렌딩 토큰",
    "tab.trending.desc": "Dexscreener 부스트 랭킹 — 6개 체인에서 시장이 밀어주는 토큰",
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
    "common.loading": "로딩 중…",
    "common.noData": "데이터 없음",
    "common.minute": "분",
    // Kimchi
    "kimchi.subtitle": "업비트 전체 KRW 마켓 vs 바이낸스 글로벌 시세",
    "kimchi.trending": "급등락 Top 5 (1시간 프리미엄 변동)",
    "kimchi.searchPlaceholder": "코인 검색 (심볼 또는 한글명)…",
    "kimchi.verifiedOnly": "CMC 검증 통과만",
    "kimchi.exportCsv": "CSV 내보내기",
    "kimchi.pairsTracking": "페어 추적 중",
    "kimchi.header.coin": "코인",
    "kimchi.header.volume": "24h 거래대금",
    "kimchi.header.trend": "추이",
    "kimchi.header.upbitKrw": "Upbit (KRW)",
    "kimchi.header.upbitKrwBid": "매도 Bid",
    "kimchi.header.upbitUsd": "Upbit (USD)",
    "kimchi.header.globalUsd": "Global (USD)",
    "kimchi.header.globalUsdAsk": "매수 Ask",
    "kimchi.header.globalKrw": "Global (KRW)",
    "kimchi.header.cmcCheck": "CMC 검증",
    "kimchi.header.premium": "김치 프리미엄",
    "kimchi.header.risk": "위험도",
    "kimchi.header.wallet": "지갑",
    "kimchi.header.roundTrip": "라운드트립 (100만원)",
    "kimchi.filter.allVolume": "전체 유동성",
    "kimchi.filter.volume100m": "1억 이상",
    "kimchi.filter.volume1b": "10억 이상",
    "kimchi.filter.volume10b": "100억 이상",
    "kimchi.wallet.normal": "정상",
    "kimchi.wallet.withdrawOnly": "출금만",
    "kimchi.wallet.tooltipNormal": "입출금 정상 — 클릭하면 공식 현황 페이지",
    "kimchi.wallet.tooltipWithdrawOnly": "출금만 가능 — 클릭하면 공식 현황 페이지",
    "kimchi.noMatch": "검색 결과가 없습니다.",
    "kimchi.loadingPairs": "모든 KRW 페어 로딩 중…",
    // DexArb
    "dexArb.subtitle": "업비트(KRW)에서 매수 → 출금 → Uniswap/Sushi 온체인 매도",
    "dexArb.inventoryToggle": "보유자산 가정",
    "dexArb.inventoryBanner": "보유자산 모드 ON — 출금 수수료·가스·브릿지·대기시간을 제외한 순수 스프레드만 표시. 양쪽 체인/거래소에 미리 보유한 경우 즉시 양방향 체결 가정 (보유 차익 탭은 이 로직 전용).",
    "dexArb.stats.opportunities": "기회 수",
    "dexArb.stats.chains": "활성 체인",
    "dexArb.stats.crossChain": "크로스체인",
    "dexArb.stats.sameChain": "동일체인",
    "dexArb.noOpp.title": "수익 가능한 기회가 없습니다",
    "dexArb.noOpp.desc": "스캔한 페어·체인에서 수수료를 넘기는 스프레드가 없습니다.",
    "dexArb.loading": "모든 체인 스캔 중…",
    "dexArb.stable.loading": "스테이블 호가 로딩 중…",
    "dexArb.stable.empty": "현재 스테이블 페어 스프레드가 없거나 2개 체인 이상에서 호가가 없습니다.",
    "dexArb.recent.title": "최근 포착된 기회 (24시간)",
    "dexArb.recent.desc": "스캐너가 감지한 기회의 누적 기록 — 반복 등장 횟수가 많을수록 지속성이 높습니다.",
    "dexArb.recent.none": "아직 기록된 기회가 없습니다. 스캔이 몇 회 진행되면 표시됩니다.",
    "dexArb.recent.seen": "회 포착",
    "dexArb.recent.first": "최초",
    "dexArb.recent.last": "최근",
    // Cex
    "cex.subtitle": "업비트·빗썸·바이낸스·바이비트·OKX 현물 시세 모니터링",
    "cex.noOpp.title": "지금은 수익 가능한 CEX 간 기회가 없습니다",
    "cex.noOpp.desc": "거래소 간 스프레드가 수수료 범위 안에 있습니다. 30초마다 갱신됩니다.",
    "cex.loading": "CEX 시세 로딩 중…",
    // Compare
    "compare.subtitle": "동일 DEX를 여러 체인에서 비교 — 스프레드가 가장 큰 곳 찾기",
    "compare.loading": "DEX 시세 로딩 중…",
    "compare.noData": "동일 DEX가 2개 이상 체인에서 호가하는 자산이 없습니다.",
    // Calculator
    "calculator.title": "수익 계산기",
    "calculator.subtitle": "투자금·수수료·손익분기 시뮬레이션",
    // Simulator
    "simulator.title": "실행 시뮬레이터",
    "simulator.subtitle": "단계별 소요시간·병목 분석",
    // Settings
    "settings.title": "설정",
    "settings.liveData": "실시간 데이터",
    "settings.refreshInterval": "갱신 주기",
    "settings.refreshIntervalDesc": "CEX-to-CEX, 김치, CEX→DEX→CEX, DEX 차익 및 시세 비교 뷰에 적용됩니다.",
    "settings.displayCurrency": "표시 통화",
    "settings.displayCurrencyDesc": "수익·가격 표시에 사용할 통화 — 언어와 무관하게 적용됩니다.",
    "settings.currency.KRW": "원화 (KRW)",
    "settings.currency.USD": "달러 (USD)",
    "settings.language": "언어",
    "settings.languageDesc": "인터페이스 언어 — 탭, 헤더, 테이블에 적용됩니다.",
    "settings.alerts": "알림",
    "settings.alertsDesc": "임계값을 넘은 기회가 감지되면 브라우저 알림(및 선택 시 텔레그램)으로 알려줍니다. 각 코인별 쿨다운이 적용되어 스팸을 방지합니다.",
    "settings.enableAlerts": "알림 활성화",
    "settings.enableAlertsDesc": "브라우저 알림을 사용합니다",
    "settings.permissionUnsupported": "이 브라우저는 알림을 지원하지 않습니다.",
    "settings.permissionGranted": "✓ 알림 권한 허용됨",
    "settings.requestPermission": "알림 권한 요청",
    "settings.testNotification": "테스트 알림 보내기",
    "settings.kimchiThreshold": "김치 프리미엄 ≥",
    "settings.roundTripThreshold": "라운드트립 수익 ≥",
    "settings.dexThreshold": "DEX 차익 ≥",
    "settings.cexThreshold": "CEX 차익 ≥",
    "settings.hybridThreshold": "하이브리드 ≥",
    "settings.cooldown": "코인별 쿨다운:",
    "settings.telegram": "텔레그램 (선택)",
    "settings.telegramDesc": "@BotFather에서 봇을 만들고, 봇과 대화 후 chat_id를 입력하세요.",
    "settings.telegramEnable": "텔레그램 알림 사용",
    "settings.botToken": "Bot Token",
    "settings.chatId": "Chat ID",
    "settings.save": "설정 저장",
    "settings.saved": "✓ 저장됨!",
    "settings.testTitle": "Arb Scanner — 테스트 알림",
    "settings.testBody": "알림이 정상적으로 동작합니다.",
    "settings.testTelegram": "Arb Scanner — 텔레그램 테스트 알림이 정상 동작합니다.",
    // Risk
    "risk.title": "위험도",
    "risk.axis.liquidity": "유동성",
    "risk.axis.execution": "실행",
    "risk.axis.exchange": "거래소",
    "risk.axis.token": "토큰",
    "risk.axis.volatility": "변동성",
    "risk.grade.A": "초저위험",
    "risk.grade.B": "저위험",
    "risk.grade.C": "중위험",
    "risk.grade.D": "고위험",
    "risk.grade.F": "초고위험",
    "risk.weighted": "가중합 30/25/20/15/10",
    "risk.breakdown": "위험도 분석",
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
    "tab.sniper.label": "Listing Sniper",
    "tab.sniper.title": "Listing Sniper",
    "tab.sniper.desc": "Watches Binance-listed coins missing on Upbit — instant alert on new Upbit listing",
    "tab.compare.label": "Price Compare",
    "tab.compare.title": "Price Compare",
    "tab.compare.desc": "Compare Uniswap & Sushi quotes across 6 chains",
    "tab.trending.label": "Trending",
    "tab.trending.title": "Trending Tokens",
    "tab.trending.desc": "Dexscreener boost ranking — market-pushed tokens on our 6 chains",
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
    "common.loading": "Loading…",
    "common.noData": "No data",
    "kimchi.subtitle": "All Upbit KRW pairs vs Binance global price",
    "kimchi.trending": "Top Movers (1h premium change)",
    "kimchi.searchPlaceholder": "Search coin (symbol or name)…",
    "kimchi.verifiedOnly": "Verified only",
    "kimchi.exportCsv": "Export CSV",
    "kimchi.pairsTracking": "pairs tracking",
    "kimchi.header.coin": "Coin",
    "kimchi.header.volume": "24h Volume",
    "kimchi.header.trend": "Trend",
    "kimchi.header.upbitKrw": "Upbit (KRW)",
    "kimchi.header.upbitKrwBid": "Bid",
    "kimchi.header.upbitUsd": "Upbit (USD)",
    "kimchi.header.globalUsd": "Global (USD)",
    "kimchi.header.globalUsdAsk": "Ask",
    "kimchi.header.globalKrw": "Global (KRW)",
    "kimchi.header.cmcCheck": "CMC Check",
    "kimchi.header.premium": "Kimchi Premium",
    "kimchi.header.risk": "Risk",
    "kimchi.header.wallet": "Wallet",
    "kimchi.header.roundTrip": "Round Trip (1M KRW)",
    "kimchi.filter.allVolume": "All liquidity",
    "kimchi.filter.volume100m": "≥100M",
    "kimchi.filter.volume1b": "≥1B",
    "kimchi.filter.volume10b": "≥10B",
    "kimchi.wallet.normal": "Normal",
    "kimchi.wallet.withdrawOnly": "Withdraw only",
    "kimchi.wallet.tooltipNormal": "Deposits & withdrawals normal — click for official status",
    "kimchi.wallet.tooltipWithdrawOnly": "Withdraw only — click for official status",
    "kimchi.noMatch": "No pairs match the search.",
    "kimchi.loadingPairs": "Loading all KRW pairs…",
    "dexArb.subtitle": "Buy on Upbit (KRW) → withdraw → sell on-chain via Uniswap / Sushi web quotes.",
    "dexArb.inventoryToggle": "Inventory mode",
    "dexArb.inventoryBanner": "Inventory ON — excludes withdraw, gas, bridge & wait time. Assumes pre-funded on both venues for instant hedge (see Inventory Arb tab).",
    "dexArb.stats.opportunities": "Opportunities",
    "dexArb.stats.chains": "Chains Active",
    "dexArb.stats.crossChain": "Cross-Chain",
    "dexArb.stats.sameChain": "Same-Chain",
    "dexArb.noOpp.title": "No profitable opportunities found",
    "dexArb.noOpp.desc": "No spread exceeds fees among scanned pairs & chains.",
    "dexArb.loading": "Scanning all chains…",
    "dexArb.stable.loading": "Loading stablecoin quotes…",
    "dexArb.stable.empty": "No stable pair spread or quotes on 2+ chains.",
    "dexArb.recent.title": "Recently Spotted (24h)",
    "dexArb.recent.desc": "Cumulative log of opportunities detected by the scanner — higher repeat count means more persistent.",
    "dexArb.recent.none": "No history yet. Appears after a few scan cycles.",
    "dexArb.recent.seen": " sightings",
    "dexArb.recent.first": "First",
    "dexArb.recent.last": "Last",
    "cex.subtitle": "Monitoring Upbit, Bithumb, Binance, Bybit, OKX spot prices.",
    "cex.noOpp.title": "No profitable CEX-to-CEX opportunities right now",
    "cex.noOpp.desc": "Cross-exchange spreads are within fees. Refreshing every 30 seconds.",
    "cex.loading": "Loading CEX prices…",
    "compare.subtitle": "Same DEX, multiple chains — find the widest spread.",
    "compare.loading": "Loading DEX prices…",
    "compare.noData": "No asset is currently quoted on two or more chains by the same DEX.",
    "calculator.title": "Calculator",
    "calculator.subtitle": "Investment, fees & break-even simulation",
    "simulator.title": "Simulator",
    "simulator.subtitle": "Step timing & bottleneck analysis",
    "settings.title": "Settings",
    "settings.liveData": "Live Data",
    "settings.refreshInterval": "Refresh interval",
    "settings.refreshIntervalDesc": "Applies to CEX-to-CEX, Kimchi, CEX→DEX→CEX, DEX Arbitrage and DEX Compare views.",
    "settings.displayCurrency": "Display currency",
    "settings.displayCurrencyDesc": "Currency for profit & price display — independent of language.",
    "settings.currency.KRW": "KRW (₩)",
    "settings.currency.USD": "USD ($)",
    "settings.language": "Language",
    "settings.languageDesc": "Interface language — affects tabs, headers and tables.",
    "settings.alerts": "Alerts",
    "settings.alertsDesc": "When an opportunity exceeds the threshold, you will be notified via browser notification (and Telegram if enabled). Per-coin cooldown prevents spam.",
    "settings.enableAlerts": "Enable alerts",
    "settings.enableAlertsDesc": "Use browser notifications",
    "settings.permissionUnsupported": "This browser does not support notifications.",
    "settings.permissionGranted": "✓ Notification permission granted",
    "settings.requestPermission": "Request permission",
    "settings.testNotification": "Send test notification",
    "settings.kimchiThreshold": "Kimchi premium ≥",
    "settings.roundTripThreshold": "Round-trip profit ≥",
    "settings.dexThreshold": "DEX arb ≥",
    "settings.cexThreshold": "CEX arb ≥",
    "settings.hybridThreshold": "Hybrid ≥",
    "settings.cooldown": "Per-coin cooldown:",
    "settings.telegram": "Telegram (optional)",
    "settings.telegramDesc": "Create a bot via @BotFather, chat with it, then enter your chat_id.",
    "settings.telegramEnable": "Use Telegram alerts",
    "settings.botToken": "Bot Token",
    "settings.chatId": "Chat ID",
    "settings.save": "Save Settings",
    "settings.saved": "✓ Saved!",
    "settings.testTitle": "Arb Scanner — Test notification",
    "settings.testBody": "Notifications are working correctly.",
    "settings.testTelegram": "Arb Scanner — Telegram test notification is working.",
    "risk.title": "Risk",
    "risk.axis.liquidity": "Liquidity",
    "risk.axis.execution": "Execution",
    "risk.axis.exchange": "Exchange",
    "risk.axis.token": "Token",
    "risk.axis.volatility": "Volatility",
    "risk.grade.A": "Very Low",
    "risk.grade.B": "Low",
    "risk.grade.C": "Medium",
    "risk.grade.D": "High",
    "risk.grade.F": "Very High",
    "risk.weighted": "Weighted 30/25/20/15/10",
    "risk.breakdown": "Risk Breakdown",
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
