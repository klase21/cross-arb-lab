"use client";

import { useState, useEffect, use, useCallback } from "react";
import { CHAIN_DEXES, type ChainId } from "@/lib/dex-config";
import { LangProvider, useLang } from "@/lib/i18n";
import { useDisplayCurrency } from "@/lib/use-currency";
import { dexscreenerEmbedUrl, dexscreenerTokenUrl } from "@/lib/dexscreener";
import { gmgnTokenUrl } from "@/lib/gmgn";
import { scoreKimchi, riskColor, riskBarColor } from "@/lib/risk-scorer";

interface KimchiItem {
  coin: string;
  nameKr: string;
  nameEn: string;
  binanceSymbol?: string;
  binanceSource?: "spot" | "alpha";
  binanceOnCmc?: boolean;
  upbitKrw: number;
  upbitAsk?: number;
  upbitBid?: number;
  globalUsd: number;
  globalAsk?: number;
  globalBid?: number;
  premiumPct: number;
  cmcUsd?: number;
  binanceDevPct?: number;
  verified: boolean;
  volumeKrw?: number;
  trip?: {
    netProfitKrw: number;
    netProfitPct: number;
    currentPremiumPct: number;
    breakevenPremiumPct: number;
    premiumGapToBreakevenPct: number;
    upbitPriceRiseNeededPct: number;
  };
}

const CHAIN_NAMES: Record<string, string> = {
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  base: "Base",
  optimism: "Optimism",
  bsc: "BNB Chain",
};

function fmtKrw(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// find a representative chain/token address for this coin symbol
function findTokenChain(coin: string): { chain: ChainId; address: string } | null {
  const upper = coin.toUpperCase();
  // map common W- prefixes
  const candidates = [upper, `W${upper}`, upper.replace(/^W/, "")];
  for (const chain of CHAIN_DEXES) {
    for (const cand of candidates) {
      const tok = chain.tokens[cand];
      if (tok) return { chain: chain.chain, address: tok.address };
    }
    // also try direct upper
    const direct = chain.tokens[upper];
    if (direct) return { chain: chain.chain, address: direct.address };
  }
  return null;
}

function KimchiDetailInner({ params }: { params: Promise<{ coin: string }> }) {
  const { t, lang } = useLang();
  const displayCurrency = useDisplayCurrency();
  const resolved = use(params);
  const coin = decodeURIComponent(resolved.coin).toUpperCase();
  const [item, setItem] = useState<KimchiItem | null>(null);
  const [fxRate, setFxRate] = useState(1350);
  const [loading, setLoading] = useState(true);
  const [liveUsdtKrw, setLiveUsdtKrw] = useState<number | null>(null);
  const [liveFetchedAt, setLiveFetchedAt] = useState<string | null>(null);

  const refreshLive = useCallback(async () => {
    try {
      const res = await fetch("https://api.upbit.com/v1/orderbook?markets=KRW-USDT");
      if (res.ok) {
        const data = await res.json() as { orderbook_units: { ask_price: number }[] }[];
        const ask = data?.[0]?.orderbook_units?.[0]?.ask_price;
        if (ask) setLiveUsdtKrw(ask);
      }
      setLiveFetchedAt(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {}
  }, [lang]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/kimchi").then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch("https://open.er-api.com/v6/latest/USD").then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([kimchiData, fxData]) => {
      if (cancelled) return;
      const found = (kimchiData?.items as KimchiItem[] | undefined)?.find(i => i.coin.toUpperCase() === coin) ?? null;
      setItem(found);
      if (fxData?.rates?.KRW) setFxRate(fxData.rates.KRW);
      else if (kimchiData?.fxRate) setFxRate(kimchiData.fxRate);
      setLoading(false);
    });
    refreshLive();
    return () => { cancelled = true; };
  }, [coin, refreshLive]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="animate-pulse text-lg text-zinc-500">{lang === "ko" ? "로딩 중…" : "Loading…"}</div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800 px-6 py-4">
          <a href="/?tab=kimchi" className="text-sm text-emerald-400 hover:text-emerald-300">← {lang === "ko" ? "김치 프리미엄으로 돌아가기" : "Back to Kimchi Premium"}</a>
        </header>
        <main className="max-w-3xl mx-auto px-6 py-16 text-center">
          <p className="text-lg text-zinc-400 mb-2">{coin} — {lang === "ko" ? "데이터를 찾을 수 없습니다" : "No data found"}</p>
          <p className="text-sm text-zinc-600">{lang === "ko" ? "해당 코인이 현재 업비트 KRW 마켓에 없거나 일시적으로 조회되지 않습니다." : "This coin is not currently on Upbit KRW market or temporarily unavailable."}</p>
        </main>
      </div>
    );
  }

  const displayName = lang === "ko" ? item.nameKr : item.nameEn || item.nameKr;
  const premiumPositive = item.premiumPct >= 0;
  const tokenChain = findTokenChain(coin);
  const embedUrl = tokenChain ? dexscreenerEmbedUrl(tokenChain.chain, tokenChain.address) : null;
  const dexUrl = tokenChain ? dexscreenerTokenUrl(tokenChain.chain, tokenChain.address) : null;
  const gmgnUrl = tokenChain ? gmgnTokenUrl(tokenChain.chain, tokenChain.address) : null;
  const upbitUsd = item.upbitKrw / fxRate;
  const globalKrw = item.globalUsd * fxRate;
  const risk = (() => {
    try {
      return scoreKimchi({
        coin: item.coin,
        volumeKrw: item.volumeKrw,
        binanceDevPct: item.binanceDevPct,
        verified: item.verified,
        binanceOnCmc: item.binanceOnCmc,
        spreadBufferPct: item.trip ? -item.trip.premiumGapToBreakevenPct : undefined,
      });
    } catch { return null; }
  })();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {item.coin} <span className="text-sm font-normal text-zinc-500 ml-2">{displayName}</span>
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {lang === "ko" ? "김치 프리미엄" : "Kimchi Premium"} · {premiumPositive ? "+" : ""}{item.premiumPct.toFixed(2)}% · {item.verified ? (lang === "ko" ? "검증됨" : "Verified") : (lang === "ko" ? "미검증" : "Unverified")}
            {item.binanceSymbol && <span className="ml-2 text-cyan-400/80">Binance: {item.binanceSymbol}</span>}
          </p>
        </div>
        <a href="/?tab=kimchi" className="px-4 py-1.5 rounded-lg border border-zinc-700 hover:border-emerald-500 text-sm font-medium transition-colors">
          ← {lang === "ko" ? "김치 프리미엄으로 돌아가기" : "Back to Kimchi Premium"}
        </a>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="rounded-lg border border-zinc-800 p-3">
            <p className="text-xs text-zinc-500 mb-0.5">{lang === "ko" ? "김치 프리미엄" : "Kimchi Premium"}</p>
            <p className={`text-base font-bold ${premiumPositive ? "text-red-400" : "text-sky-400"}`}>{premiumPositive ? "+" : ""}{item.premiumPct.toFixed(2)}%</p>
          </div>
          <div className="rounded-lg border border-zinc-800 p-3">
            <p className="text-xs text-zinc-500 mb-0.5">Upbit (KRW) Bid</p>
            <p className="text-base font-bold">{fmtKrw(item.upbitKrw)}</p>
            <p className="text-[11px] text-zinc-600">{fmtUsd(upbitUsd)}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 p-3">
            <p className="text-xs text-zinc-500 mb-0.5">Global Ask</p>
            <p className="text-base font-bold">{fmtUsd(item.globalUsd)}</p>
            <p className="text-[11px] text-zinc-600">{fmtKrw(globalKrw)}</p>
          </div>
          <div className={`rounded-lg border p-3 ${item.trip && item.trip.netProfitKrw >= 0 ? "border-emerald-800 bg-emerald-950/20" : "border-zinc-800"}`}>
            <p className="text-xs text-zinc-500 mb-0.5">{lang === "ko" ? "라운드트립 (100만원)" : "Round Trip (1M KRW)"}</p>
            {item.trip ? (
              <>
                <p className={`text-base font-bold ${item.trip.netProfitKrw >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {displayCurrency === "USD"
                    ? `${item.trip.netProfitKrw >= 0 ? "+" : ""}$${(Math.abs(item.trip.netProfitKrw) / fxRate).toFixed(2)}`
                    : `${item.trip.netProfitKrw >= 0 ? "+" : ""}${Math.round(item.trip.netProfitKrw).toLocaleString()} KRW`}
                </p>
                <p className="text-[11px] text-zinc-500">{item.trip.netProfitPct >= 0 ? "+" : ""}{item.trip.netProfitPct.toFixed(2)}% · BE gap {item.trip.premiumGapToBreakevenPct >= 0 ? "+" : ""}{item.trip.premiumGapToBreakevenPct.toFixed(2)}%p</p>
              </>
            ) : (
              <p className="text-sm text-zinc-600">-</p>
            )}
          </div>
        </div>

        {risk && (
          <div className="rounded-xl border border-zinc-800 p-6 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">{t("risk.breakdown")} <span className={`ml-2 px-3 py-1 rounded-full text-xs border ${riskColor(risk.grade)}`}>{risk.grade} {t(`risk.grade.${risk.grade}`)} · {risk.total}/100</span></h2>
              <span className="text-[11px] text-zinc-600">{t("risk.weighted")}</span>
            </div>
            <div className="space-y-2">
              {[
                [t("risk.axis.liquidity"), risk.axes.liquidity],
                [t("risk.axis.execution"), risk.axes.execution],
                [t("risk.axis.exchange"), risk.axes.exchange],
                [t("risk.axis.token"), risk.axes.token],
                [t("risk.axis.volatility"), risk.axes.volatility],
              ].map(([label, val]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-500 w-16">{label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div className={`h-full rounded-full ${riskBarColor(risk.grade)}`} style={{ width: `${val as number}%`, opacity: 0.3 + ((val as number) / 100) * 0.7 }} />
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400 w-6 text-right">{val as number}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">{lang === "ko" ? "실시간 기준가" : "Live Reference Prices"}</h2>
            <div className="flex items-center gap-2">
              {liveFetchedAt && <span className="text-[10px] text-zinc-500">{liveFetchedAt}</span>}
              <button onClick={refreshLive} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300">{lang === "ko" ? "새로고침" : "Refresh"}</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="rounded bg-zinc-950 p-2 text-center">
              <p className="text-zinc-500 mb-1">USDT/KRW Ask</p>
              <p className="font-mono font-bold">{liveUsdtKrw ? `${liveUsdtKrw.toLocaleString()} KRW` : "—"}</p>
            </div>
            <div className="rounded bg-zinc-950 p-2 text-center">
              <p className="text-zinc-500 mb-1">{item.coin} / KRW Bid</p>
              <p className="font-mono font-bold">{fmtKrw(item.upbitKrw)}</p>
              {item.upbitAsk && item.upbitAsk !== item.upbitKrw && <p className="text-[10px] text-zinc-600">Ask {fmtKrw(item.upbitAsk)}</p>}
            </div>
            <div className="rounded bg-zinc-950 p-2 text-center">
              <p className="text-zinc-500 mb-1">{item.coin} / USD Ask</p>
              <p className="font-mono font-bold">{fmtUsd(item.globalUsd)}</p>
            </div>
            <div className="rounded bg-zinc-950 p-2 text-center">
              <p className="text-zinc-500 mb-1">FX USD/KRW</p>
              <p className="font-mono font-bold">{fxRate.toFixed(2)}</p>
            </div>
          </div>
          {item.trip && (
            <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-4 mt-3">
              <p className="text-xs font-medium text-zinc-400 mb-2">{lang === "ko" ? "라운드트립 상세 (1,000,000 KRW)" : "Round-trip Detail (1,000,000 KRW)"}</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-zinc-400">{lang === "ko" ? "현재 프리미엄" : "Current premium"}</span><span className={`font-mono ${premiumPositive ? "text-red-400" : "text-sky-400"}`}>{premiumPositive ? "+" : ""}{item.premiumPct.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">{lang === "ko" ? "손익분기 프리미엄" : "Break-even premium"}</span><span className="font-mono text-amber-400">{item.trip.breakevenPremiumPct.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">BE gap</span><span className={`font-mono ${item.trip.premiumGapToBreakevenPct >= 0 ? "text-red-400" : "text-emerald-400"}`}>{item.trip.premiumGapToBreakevenPct >= 0 ? "+" : ""}{item.trip.premiumGapToBreakevenPct.toFixed(2)}%p</span></div>
                <div className="flex justify-between border-t border-zinc-700 pt-2 mt-2"><span className="text-zinc-300">{lang === "ko" ? "순수익" : "Net profit"}</span><span className={`font-mono font-bold ${item.trip.netProfitKrw >= 0 ? "text-emerald-400" : "text-red-400"}`}>{item.trip.netProfitKrw >= 0 ? "+" : ""}{displayCurrency === "USD" ? `$${(Math.abs(item.trip.netProfitKrw) / fxRate).toFixed(2)}` : `${Math.round(item.trip.netProfitKrw).toLocaleString()} KRW`}</span></div>
              </div>
            </div>
          )}
        </div>

        {embedUrl && (
          <div className="rounded-xl border border-zinc-800 p-6 mb-6">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-base font-semibold">{lang === "ko" ? "덱스 차트" : "DEX Chart"} <span className="text-xs font-normal text-zinc-500 ml-2">{coin} / {tokenChain ? CHAIN_NAMES[tokenChain.chain] ?? tokenChain.chain : "—"}</span></h2>
              <div className="flex items-center gap-3 text-xs">
                {gmgnUrl && (
                  <a href={gmgnUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline" title={lang === "ko" ? "GMGN에서 홀더 분포·번들·허니팟 검증" : "Verify holders, bundles & honeypot on GMGN"}>
                    {lang === "ko" ? "GMGN 보안 검증 →" : "GMGN safety check →"}
                  </a>
                )}
                {dexUrl && <a href={dexUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Dexscreener →</a>}
              </div>
            </div>
            <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900" style={{ height: 400 }}>
              <iframe src={embedUrl} style={{ width: "100%", height: "100%", border: 0 }} title={`Dexscreener ${coin}`} loading="lazy" />
            </div>
          </div>
        )}

        <div className="rounded-xl border border-zinc-800 p-6 mb-6">
          <h2 className="text-base font-semibold mb-3">{lang === "ko" ? "입출금 상태" : "Wallet Status"}</h2>
          <a href="https://www.upbit.com/service_center/wallet_status" target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-400 hover:underline">
            {lang === "ko" ? "업비트 지갑 상태 바로가기 →" : "Check Upbit wallet status →"}
          </a>
        </div>
      </main>
    </div>
  );
}

export default function KimchiDetail({ params }: { params: Promise<{ coin: string }> }) {
  return (
    <LangProvider>
      <KimchiDetailInner params={params} />
    </LangProvider>
  );
}
