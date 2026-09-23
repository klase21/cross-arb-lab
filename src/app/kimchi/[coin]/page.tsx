"use client";

import { useState, useEffect, use, useCallback } from "react";
import { LangProvider, useLang } from "@/lib/i18n";
import { useDisplayCurrency } from "@/lib/use-currency";
import { scoreKimchi, riskColor, riskBarColor } from "@/lib/risk-scorer";
import HistoryChart from "@/components/HistoryChart";
import { normNet } from "@/lib/networks";

interface KimchiItem {
  coin: string;
  nameKr: string;
  nameEn: string;
  binanceSymbol?: string;
  binanceSource?: "spot" | "alpha" | "gate";
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

function fmtKrw(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
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
  const [wallet, setWallet] = useState<{ wallet_state: string; block_state: string; message: string } | null>(null);
  const [gate, setGate] = useState<{ chains: { name: string; depositOk: boolean; withdrawOk: boolean; delayed: boolean }[] } | null>(null);
  const [upbitNets, setUpbitNets] = useState<{ net: string; name: string; fee: number; wallet_state: string; block_state: string; message: string }[]>([]);

  const refreshLive = useCallback(async () => {
    try {
      const res = await fetch("/api/usdt-krw");
      if (res.ok) {
        const data = await res.json() as { ask?: number };
        if (data.ask) setLiveUsdtKrw(data.ask);
      }
      setLiveFetchedAt(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {}
  }, [lang]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/kimchi").then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch("https://open.er-api.com/v6/latest/USD").then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/upbit/wallet-status").then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/gate/wallet-status?currency=${encodeURIComponent(coin)}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([kimchiData, fxData, walletData, gateData]) => {
      if (cancelled) return;
      const found = (kimchiData?.items as KimchiItem[] | undefined)?.find(i => i.coin.toUpperCase() === coin) ?? null;
      setItem(found);
      const list = Array.isArray(walletData?.data) ? walletData.data : [];
      const coinRows = list.filter((e: { currency?: string }) => e.currency === coin);
      const first = coinRows[0] ?? null;
      if (first) setWallet({ wallet_state: first.wallet_state, block_state: first.block_state, message: first.message ?? "" });
      const feeMap = new Map<string, number>();
      const nets = (walletData?.networks as Record<string, { net: string; name: string; fee: number }[]> | undefined)?.[coin];
      if (Array.isArray(nets)) for (const n of nets) feeMap.set(n.net, n.fee);
      if (coinRows.length > 0) {
        setUpbitNets(coinRows.map((e: { net_type?: string; network_name?: string; wallet_state?: string; block_state?: string; message?: string }) => ({
          net: e.net_type ?? "",
          name: e.network_name ?? e.net_type ?? "",
          fee: feeMap.get(e.net_type ?? "") ?? 0,
          wallet_state: e.wallet_state ?? "",
          block_state: e.block_state ?? "",
          message: e.message ?? "",
        })).filter((r: { net: string }) => r.net).slice(0, 12));
      }
      if (gateData && Array.isArray(gateData.chains) && gateData.chains.length > 0 && !gateData.delisted) {
        setGate({ chains: gateData.chains.slice(0, 8) });
      }
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

        {/* DEX Chart + GMGN verification — UI unmounted (on-chain plan pending; code kept in lib/dexscreener.ts + lib/gmgn.ts). */}
        <HistoryChart symbol={coin} />

        <div className="rounded-xl border border-zinc-800 p-6 mb-6">
          <h2 className="text-base font-semibold mb-3">{lang === "ko" ? "입출금 상태" : "Wallet Status"}</h2>
          {(() => {
            if (upbitNets.length === 0 && !gate) {
              return <p className="text-xs text-zinc-600">{lang === "ko" ? "조회 불가" : "Unavailable"}</p>;
            }
            const upDep = (r: { wallet_state: string; block_state: string }) =>
              r.block_state === "normal" && (r.wallet_state === "working" || r.wallet_state === "deposit_only");
            const upWd = (r: { wallet_state: string; block_state: string }) =>
              r.block_state === "normal" && (r.wallet_state === "working" || r.wallet_state === "withdraw_only");
            const upDepositOk = upbitNets.some(upDep);
            const upWithdrawOk = upbitNets.some(upWd);
            const badge = (ok: boolean, label: string) => (
              <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                {label} {ok ? (lang === "ko" ? "가능" : "OK") : (lang === "ko" ? "중단" : "Halted")}
              </span>
            );
            const rows: {
              key: string; label: string; fee: number;
              upDep: boolean | null; upWd: boolean | null;
              gate?: { depositOk: boolean; withdrawOk: boolean };
            }[] = [];
            for (const n of upbitNets) {
              const id = normNet(n.net);
              if (!rows.some(r => r.key === id)) {
                rows.push({ key: id, label: n.name, fee: n.fee, upDep: upDep(n), upWd: upWd(n) });
              }
            }
            for (const c of gate?.chains ?? []) {
              const id = normNet(c.name);
              const row = rows.find(r => r.key === id);
              if (row) { if (!row.gate) row.gate = c; }
              else rows.push({ key: id, label: c.name, fee: 0, upDep: null, upWd: null, gate: c });
            }
            const dot = (ok: boolean | null) => ok === null
              ? <span className="text-zinc-600">-</span>
              : <span className={ok ? "text-emerald-400" : "text-red-400"}>{ok ? "●" : "○"}</span>;
            const notice = upbitNets.map(n => n.message).find(m => m) ?? wallet?.message ?? "";
            const anyDirect = rows.some(row =>
              row.upDep === true && row.upWd === true && !!row.gate && row.gate.depositOk && row.gate.withdrawOk,
            );
            const upOnly = rows.filter(r => r.upDep !== null && !r.gate).length;
            const gateOnly = rows.filter(r => r.upDep === null && r.gate).length;
            return (
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="text-[11px] font-semibold text-zinc-400 w-14">Upbit</span>
                  {upbitNets.length > 0 ? (
                    <>
                      {badge(upDepositOk, lang === "ko" ? "입금" : "Deposit")}
                      {badge(upWithdrawOk, lang === "ko" ? "출금" : "Withdraw")}
                    </>
                  ) : (
                    <span className="text-xs text-zinc-600">{lang === "ko" ? "조회 불가" : "Unavailable"}</span>
                  )}
                </div>
                {rows.length > 0 && !anyDirect && (
                  <p className="px-3 py-2 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 text-xs font-bold mb-3">
                    ⛔ {lang === "ko" ? "직접 전송 불가 — 양쪽이 열린 공통 네트워크가 없어 차익 실행이 안 됩니다" : "Direct transfer impossible — no commonly open network, arb not executable"}
                    {(upOnly > 0 || gateOnly > 0) && (
                      <span className="block mt-0.5 font-normal text-red-300/70 text-[11px]">
                        {lang === "ko"
                          ? `Upbit 전용 ${upOnly}개 · Gate 전용 ${gateOnly}개`
                          : `${upOnly} Upbit-only · ${gateOnly} Gate-only`}
                      </span>
                    )}
                  </p>
                )}
                {rows.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-zinc-500 text-left">
                        <th className="py-1 pr-2 font-medium">{lang === "ko" ? "네트워크" : "Network"}</th>
                        <th className="py-1 pr-2 font-medium text-center">Upbit {lang === "ko" ? "입금" : "DP"}</th>
                        <th className="py-1 pr-2 font-medium text-center">Upbit {lang === "ko" ? "출금" : "WD"}</th>
                        <th className="py-1 pr-2 font-medium text-center">Gate {lang === "ko" ? "입금" : "DP"}</th>
                        <th className="py-1 pr-2 font-medium text-center">Gate {lang === "ko" ? "출금" : "WD"}</th>
                        <th className="py-1 font-medium text-right">{lang === "ko" ? "직접 전송" : "Direct"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => {
                        const direct = row.upDep === true && row.upWd === true && !!row.gate && row.gate.depositOk && row.gate.withdrawOk;
                        return (
                          <tr key={row.key} className={`border-t border-zinc-800/70 ${direct ? "bg-emerald-950/30" : ""}`}>
                            <td className="py-1.5 pr-2 text-zinc-300">
                              {row.label}
                              {row.fee > 0 && <span className="ml-1.5 text-[10px] text-zinc-600 font-mono">⛽{row.fee}</span>}
                            </td>
                            <td className="py-1.5 pr-2 text-center">{dot(row.upDep)}</td>
                            <td className="py-1.5 pr-2 text-center">{dot(row.upWd)}</td>
                            <td className="py-1.5 pr-2 text-center">{dot(row.gate ? row.gate.depositOk : null)}</td>
                            <td className="py-1.5 pr-2 text-center">{dot(row.gate ? row.gate.withdrawOk : null)}</td>
                            <td className="py-1.5 text-right">{direct && <span className="text-emerald-300 font-bold text-[11px]">★ {lang === "ko" ? "가능" : "OK"}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {notice && <p className="text-[11px] text-amber-300/90 mt-2">{notice}</p>}
                {wallet && (!upDepositOk || !upWithdrawOk) && (
                  <p className="text-[11px] text-zinc-600 mt-1 font-mono">{wallet.wallet_state} / {wallet.block_state}</p>
                )}
              </div>
            );
          })()}
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
