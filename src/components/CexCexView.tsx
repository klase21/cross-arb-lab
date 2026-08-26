"use client";

import { useCallback, useEffect, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { useLang } from "@/lib/i18n";
import { useDisplayCurrency } from "@/lib/use-currency";

interface CexArbitrageOpportunity {
  coin: string;
  buyCex: string;
  sellCex: string;
  buyPriceUsd: number;
  sellPriceUsd: number;
  spreadPct: number;
  netSpreadPct: number;
  estimatedProfitUsd: number;
  detectedAt: string;
}

export default function CexCexView() {
  const { t, lang } = useLang();
  const displayCurrency = useDisplayCurrency();
  const [opportunities, setOpportunities] = useState<CexArbitrageOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [fxRate, setFxRate] = useState(1350);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/cex-prices");
      const data = await response.json();
      if (typeof data.fxRate === "number" && data.fxRate > 500) setFxRate(data.fxRate);
      const { findCexOpportunities } = await import("@/lib/cex-arbitrage");
      const next = findCexOpportunities(data.prices ?? {});
      setOpportunities(next);
      const { notifyCex } = await import("@/lib/notifications");
      for (const opp of next) notifyCex(opp.coin, opp.buyCex, opp.sellCex, opp.netSpreadPct, "cex");
      setLastUpdated(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {} finally {
      setLoading(false);
    }
  }, [lang]);

  const intervalSec = usePollingInterval();

  useEffect(() => {
    load();
    const interval = setInterval(load, intervalSec * 1000);
    return () => clearInterval(interval);
  }, [load, intervalSec]);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500">{t("cex.subtitle")}</p>
        {lastUpdated && <p className="text-xs text-zinc-600">{t("common.lastUpdated")}: {lastUpdated}</p>}
      </div>

      <RebalanceCalculator fxRate={fxRate} />

      {opportunities.length > 0 && (
        <div className="space-y-3">
          {opportunities.map((opp, idx) => (
            <div key={`${opp.coin}-${opp.buyCex}-${opp.sellCex}-${idx}`} className="rounded-xl border border-blue-900/50 bg-gradient-to-r from-blue-950/20 to-zinc-900/80 p-5 hover:border-blue-700 transition-colors">
              <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-semibold">{opp.coin}</span>
                  <span className="px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 text-xs font-medium">CEX-to-CEX</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${opp.netSpreadPct > 0.5 ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-900/60 text-emerald-400"}`}>Net +{opp.netSpreadPct.toFixed(3)}%</span>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-emerald-400">
                    {displayCurrency === "USD"
                      ? `+${opp.estimatedProfitUsd.toFixed(2)} USD`
                      : `+${Math.round(opp.estimatedProfitUsd * fxRate).toLocaleString()} KRW`}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {displayCurrency === "USD" ? "est. profit / $1,000 trade" : "예상 수익 / 100만원 거래"}
                  </p>
                  <p className="text-[10px] text-zinc-600">
                    {displayCurrency === "USD"
                      ? `${Math.round(opp.estimatedProfitUsd * fxRate).toLocaleString()} KRW`
                      : `$${opp.estimatedProfitUsd.toFixed(2)} USD`}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Buy on</p>
                  <p className="font-medium capitalize">{opp.buyCex}</p>
                  <p className="text-xs text-zinc-600">@ ${opp.buyPriceUsd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Sell on</p>
                  <p className="font-medium capitalize">{opp.sellCex}</p>
                  <p className="text-xs text-zinc-600">@ ${opp.sellPriceUsd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Gross Spread</p>
                  <p className="font-medium">{opp.spreadPct.toFixed(3)}%</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Total Fees</p>
                  <p className="font-medium">{(opp.spreadPct - opp.netSpreadPct).toFixed(3)}%</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {opportunities.length === 0 && !loading && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center">
          <p className="text-lg text-zinc-400 mb-2">{t("cex.noOpp.title")}</p>
          <p className="text-sm text-zinc-600">{t("cex.noOpp.desc")}</p>
        </div>
      )}

      {loading && opportunities.length === 0 && (
        <div className="rounded-xl border border-zinc-800 p-12 text-center animate-pulse"><p className="text-lg text-zinc-500">{t("cex.loading")}</p></div>
      )}
    </>
  );
}

function RebalanceCalculator({ fxRate }: { fxRate: number }) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [coinQty, setCoinQty] = useState("0.5");
  const [quoteBal, setQuoteBal] = useState("1000");
  const [price, setPrice] = useState("");

  const qty = Number(coinQty) || 0;
  const quote = Number(quoteBal) || 0;
  const px = Number(price) || 0;

  const coinNotional = qty * px;
  const maxTradeQty = px > 0 ? Math.min(qty, quote / px) : 0;
  const maxTradeNotional = maxTradeQty * px;
  const coinRemaining = qty - maxTradeQty;
  const quoteRemaining = quote - maxTradeNotional;
  const imbalanceUsd = coinRemaining * px - quoteRemaining;
  const rebalanceUsd = Math.abs(imbalanceUsd) / 2;
  const balanced = Math.abs(imbalanceUsd) <= Math.max(maxTradeNotional * 0.02, 10);

  const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/10 mb-4">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3">
        <p className="text-sm font-medium text-cyan-300">
          ⚖️ {lang === "ko" ? "리밸런스 계산기" : "Rebalance Calculator"}
          <span className="ml-2 text-[10px] font-normal text-zinc-500">{lang === "ko" ? "양쪽 잔고로 최대 헤지 규모 계산" : "Max hedge size from both balances"}</span>
        </p>
        <span className="text-zinc-500 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">{lang === "ko" ? "매도 측 보유 코인 수량" : "Coin balance (sell side)"}</label>
              <input type="number" value={coinQty} onChange={e => setCoinQty(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">{lang === "ko" ? "매수 측 보유 현금 (USDT)" : "Cash balance (USDT, buy side)"}</label>
              <input type="number" value={quoteBal} onChange={e => setQuoteBal(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">{lang === "ko" ? "코인 가격 (USD)" : "Coin price (USD)"}</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 95000" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
            </div>
          </div>
          {px > 0 && qty > 0 && quote > 0 ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-zinc-500">{lang === "ko" ? "코인 평가액 (매도 측)" : "Coin value (sell side)"}</span><span className="font-mono text-zinc-300">{fmtUsd(coinNotional)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">{lang === "ko" ? "현금 (매수 측)" : "Cash (buy side)"}</span><span className="font-mono text-zinc-300">{fmtUsd(quote)}</span></div>
              <div className="flex justify-between border-t border-zinc-800 pt-2"><span className="text-cyan-300 font-medium">{lang === "ko" ? "최대 헤지 규모" : "Max hedge size"}</span><span className="font-mono font-bold text-cyan-300">{fmtUsd(maxTradeNotional)} <span className="text-[10px] font-normal text-zinc-500">({maxTradeQty.toPrecision(5)} {lang === "ko" ? "코인" : "coin"})</span></span></div>
              <div className="flex justify-between"><span className="text-zinc-500">{lang === "ko" ? "실행 후 잔액" : "After execution"}</span><span className="font-mono text-zinc-400 text-xs">{maxTradeQty.toPrecision(5)} {lang === "ko" ? "코인" : "coin"} + {fmtUsd(quoteRemaining)}</span></div>
              <div className={`rounded-lg p-3 mt-2 ${balanced ? "bg-emerald-950/30 border border-emerald-800" : "bg-amber-950/30 border border-amber-800"}`}>
                {balanced ? (
                  <p className="text-xs text-emerald-300">✓ {lang === "ko" ? "양쪽이 균형 상태입니다. 리밸런스 불필요." : "Balanced. No rebalance needed."}</p>
                ) : (
                  <p className="text-xs text-amber-300">
                    ⚠️ {lang === "ko"
                      ? `불균형 ${fmtUsd(Math.abs(imbalanceUsd))} — ${imbalanceUsd > 0 ? `코인 ${fmtUsd(rebalanceUsd)}어치를 매도 측에서 매수 측으로` : `현금 ${fmtUsd(rebalanceUsd)}를 매수 측에서 매도 측으로`} 이동 권장 (출금 1회).`
                      : `Imbalance ${fmtUsd(Math.abs(imbalanceUsd))} — move ${imbalanceUsd > 0 ? `${fmtUsd(rebalanceUsd)} of coin from sell side` : `${fmtUsd(rebalanceUsd)} cash from buy side`} (one withdrawal).`}
                  </p>
                )}
              </div>
              <p className="text-[10px] text-zinc-600">
                {lang === "ko"
                  ? `환율 적용: ${fmtUsd(fxRate ? 1 : 1)} ≈ ${Math.round(fxRate).toLocaleString()} KRW. 실제 출금 수수료는 별도입니다.`
                  : `FX: 1 USD ≈ ${Math.round(fxRate).toLocaleString()} KRW. Withdrawal fees excluded.`}
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-600">{lang === "ko" ? "세 값을 모두 입력하면 계산됩니다." : "Fill all fields to calculate."}</p>
          )}
        </div>
      )}
    </div>
  );
}
