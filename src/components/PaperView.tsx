"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import {
  clearAccount,
  consumeDraft,
  executeMarket,
  loadAccount,
  newAccount,
  saveAccount,
  valuate,
  PAPER_FEES,
  type PaperAccount,
  type PaperQuote,
  type PaperSide,
  type PaperVenue,
} from "@/lib/paper";

interface KimchiItem {
  coin: string;
  upbitAsk?: number;
  upbitBid?: number;
  upbitKrw: number;
  globalAsk?: number;
  globalBid?: number;
  globalUsd: number;
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v >= 1000) return `${sign}$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `${sign}$${v.toPrecision(4)}`;
}

export default function PaperView() {
  const { t, lang } = useLang();
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [startInput, setStartInput] = useState("10000");
  const [items, setItems] = useState<KimchiItem[]>([]);
  const [fx, setFx] = useState(1386);
  const [symbol, setSymbol] = useState("BTC");
  const [venue, setVenue] = useState<PaperVenue>("upbit");
  const [side, setSide] = useState<PaperSide>("buy");
  const [qtyInput, setQtyInput] = useState("0.01");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      setAccount(loadAccount());
      const draft = consumeDraft();
      if (draft) setSymbol(draft.toUpperCase());
    }, 0);
    const onDraft = () => {
      const coin = consumeDraft();
      if (coin) setSymbol(coin.toUpperCase());
    };
    window.addEventListener("paperDraft", onDraft);
    window.addEventListener("storage", onDraft);
    return () => {
      clearTimeout(kickoff);
      window.removeEventListener("paperDraft", onDraft);
      window.removeEventListener("storage", onDraft);
    };
  }, []);

  const refreshMarks = useCallback(async () => {
    try {
      const res = await fetch("/api/kimchi");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.items)) setItems(data.items);
      if (typeof data.fxRate === "number" && data.fxRate > 500) setFx(data.fxRate);
    } catch {}
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => { void refreshMarks(); }, 0);
    const timer = setInterval(() => { void refreshMarks(); }, 60 * 1000);
    return () => { clearTimeout(kickoff); clearInterval(timer); };
  }, [refreshMarks]);

  const byCoin = useMemo(() => {
    const map = new Map<string, KimchiItem>();
    for (const item of items) map.set(item.coin.toUpperCase(), item);
    return map;
  }, [items]);

  const quote: PaperQuote | null = useMemo(() => {
    const item = byCoin.get(symbol.trim().toUpperCase());
    if (!item) return null;
    if (venue === "upbit") {
      const bid = (item.upbitBid ?? item.upbitKrw) / fx;
      const ask = (item.upbitAsk ?? item.upbitKrw) / fx;
      if (!(bid > 0) || !(ask > 0)) return null;
      return { venue, coin: item.coin, bidUsd: bid, askUsd: ask };
    }
    const bid = item.globalBid ?? item.globalUsd;
    const ask = item.globalAsk ?? item.globalUsd;
    if (!(bid > 0) || !(ask > 0)) return null;
    return { venue, coin: item.coin, bidUsd: bid, askUsd: ask };
  }, [byCoin, symbol, venue, fx]);

  const mark = useCallback((v: PaperVenue, coin: string): number | null => {
    const item = byCoin.get(coin.toUpperCase());
    if (!item) return null;
    if (v === "upbit") {
      const bid = (item.upbitBid ?? item.upbitKrw) / fx;
      return bid > 0 ? bid : null;
    }
    const ask = item.globalAsk ?? item.globalUsd;
    return ask > 0 ? ask : null;
  }, [byCoin, fx]);

  const valuation = useMemo(() => (account ? valuate(account, mark) : null), [account, mark]);

  const qty = Number.parseFloat(qtyInput);
  const estPrice = quote ? (side === "buy" ? quote.askUsd : quote.bidUsd) : 0;
  const estGross = Number.isFinite(qty) && qty > 0 ? qty * estPrice : 0;
  const estFee = estGross * PAPER_FEES[venue];

  const submit = (s: PaperSide) => {
    if (!account || !quote) return;
    setMsg(null);
    if (!Number.isFinite(qty) || qty <= 0) { setMsg(t("paper.badQty")); return; }
    const result = executeMarket(account, quote, s, qty, `${quote.coin} ${quote.venue}`);
    if ("error" in result) {
      setMsg(result.error === "cash" ? t("paper.noCash") : result.error === "position" ? t("paper.noPosition") : t("paper.badQty"));
      return;
    }
    setAccount(result.account);
    saveAccount(result.account);
    setMsg(t("paper.filled"));
  };

  const closePosition = (v: PaperVenue, coin: string, qtyToClose: number) => {
    if (!account) return;
    const item = byCoin.get(coin.toUpperCase());
    if (!item) return;
    const bid = v === "upbit" ? (item.upbitBid ?? item.upbitKrw) / fx : (item.globalBid ?? item.globalUsd);
    const ask = v === "upbit" ? (item.upbitAsk ?? item.upbitKrw) / fx : (item.globalAsk ?? item.globalUsd);
    if (!(bid > 0) || !(ask > 0)) return;
    const result = executeMarket(account, { venue: v, coin, bidUsd: bid, askUsd: ask }, "sell", qtyToClose, "close");
    if (!("error" in result)) {
      setAccount(result.account);
      saveAccount(result.account);
    }
  };

  const selBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${active ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`;

  if (!account) {
    return (
      <div className="max-w-md mx-auto rounded-xl border border-zinc-800 p-6">
        <h2 className="text-base font-semibold mb-1">{t("paper.setupTitle")}</h2>
        <p className="text-xs text-zinc-500 mb-4">{t("paper.setupDesc")}</p>
        <label className="block text-xs text-zinc-400 mb-1">{t("paper.startBalance")} (USD)</label>
        <div className="flex gap-2">
          <input
            value={startInput}
            onChange={e => setStartInput(e.target.value)}
            inputMode="decimal"
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm font-mono"
          />
          <button
            onClick={() => {
              const v = Number.parseFloat(startInput);
              if (!Number.isFinite(v) || v <= 0) return;
              const acc = newAccount(v);
              setAccount(acc);
              saveAccount(acc);
            }}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium"
          >
            {t("paper.start")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {valuation && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { label: t("paper.equity"), value: fmtUsd(valuation.equityUsd), cls: "text-zinc-100" },
            { label: t("paper.cash"), value: fmtUsd(valuation.cashUsd), cls: "text-zinc-300" },
            { label: t("paper.unrealized"), value: `${valuation.unrealizedPnlUsd >= 0 ? "+" : ""}${fmtUsd(valuation.unrealizedPnlUsd)}`, cls: valuation.unrealizedPnlUsd >= 0 ? "text-emerald-400" : "text-red-400" },
            { label: t("paper.realized"), value: `${valuation.realizedPnlUsd >= 0 ? "+" : ""}${fmtUsd(valuation.realizedPnlUsd)}`, cls: valuation.realizedPnlUsd >= 0 ? "text-emerald-400" : "text-red-400" },
            { label: t("paper.totalPnl"), value: `${valuation.totalPnlPct >= 0 ? "+" : ""}${valuation.totalPnlPct.toFixed(2)}%`, cls: valuation.totalPnlPct >= 0 ? "text-emerald-400" : "text-red-400" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-[11px] text-zinc-500">{s.label}</p>
              <p className={`text-lg font-bold font-mono ${s.cls}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="text-sm font-semibold mb-3">🎫 {t("paper.ticket")}</h2>
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            placeholder="BTC"
            className="px-2.5 py-1 rounded-md text-xs bg-zinc-900 border border-zinc-700 font-mono w-24"
          />
          {(["upbit", "binance"] as PaperVenue[]).map(v => (
            <button key={v} onClick={() => setVenue(v)} className={selBtn(venue === v)}>{v}</button>
          ))}
          {(["buy", "sell"] as PaperSide[]).map(s => (
            <button key={s} onClick={() => setSide(s)} className={selBtn(side === s)}>
              {s === "buy" ? t("paper.buy") : t("paper.sell")}
            </button>
          ))}
          <input
            value={qtyInput}
            onChange={e => setQtyInput(e.target.value)}
            inputMode="decimal"
            placeholder={lang === "ko" ? "수량" : "Qty"}
            className="px-2.5 py-1 rounded-md text-xs bg-zinc-900 border border-zinc-700 font-mono w-28"
          />
          <button onClick={() => submit("buy")} className="px-4 py-1 rounded-md text-xs font-bold bg-emerald-600 text-white">
            {t("paper.buy")} · {quote ? fmtUsd(quote.askUsd) : "-"}
          </button>
          <button onClick={() => submit("sell")} className="px-4 py-1 rounded-md text-xs font-bold bg-red-600 text-white">
            {t("paper.sell")} · {quote ? fmtUsd(quote.bidUsd) : "-"}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">
          {t("paper.estimate")}: {fmtUsd(estGross)} + {t("paper.fee")} {fmtUsd(estFee)}
          {quote && <span className="ml-2 text-zinc-600">{quote.coin} @ {quote.venue}</span>}
          {msg && <span className="ml-2 text-amber-300">{msg}</span>}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">📦 {t("paper.positions")} ({account.positions.length})</h2>
        {account.positions.length === 0 ? (
          <p className="text-xs text-zinc-500">{t("paper.noPositions")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2">{t("paper.venue")}</th>
                  <th className="px-3 py-2">{t("ta.coin")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.qty")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.avg")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.mark")}</th>
                  <th className="px-3 py-2 text-right">uPnL</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {account.positions.map(p => {
                  const m = mark(p.venue, p.coin);
                  const upnl = m !== null ? (m - p.avgPriceUsd) * p.qty : 0;
                  return (
                    <tr key={`${p.venue}:${p.coin}`} className="border-t border-zinc-800">
                      <td className="px-3 py-2 text-zinc-400">{p.venue}</td>
                      <td className="px-3 py-2 font-bold">${p.coin}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.qty.toPrecision(6)}</td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-400">{fmtUsd(p.avgPriceUsd)}</td>
                      <td className="px-3 py-2 text-right font-mono">{m !== null ? fmtUsd(m) : "-"}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${upnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {upnl >= 0 ? "+" : ""}{fmtUsd(upnl)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => closePosition(p.venue, p.coin, p.qty)} className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
                          {t("paper.close")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">🧾 {t("paper.fills")} ({account.fills.length})</h2>
        {account.fills.length === 0 ? (
          <p className="text-xs text-zinc-500">{t("paper.noFills")}</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {account.fills.slice(0, 50).map(f => (
              <div key={f.id} className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                <span className={f.side === "buy" ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                  {f.side === "buy" ? t("paper.buy") : t("paper.sell")}
                </span>
                <span>{f.venue}</span>
                <span className="text-zinc-200 font-bold">${f.coin}</span>
                <span>{f.qty.toPrecision(6)} @ {fmtUsd(f.priceUsd)}</span>
                <span className="ml-auto text-zinc-600">{new Date(f.ts).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => {
            if (!confirmReset) { setConfirmReset(true); return; }
            clearAccount();
            setAccount(null);
            setConfirmReset(false);
          }}
          onBlur={() => setConfirmReset(false)}
          className="mt-3 px-3 py-1 rounded-md text-xs border border-zinc-700 text-zinc-500 hover:text-red-300 hover:border-red-800"
        >
          {confirmReset ? t("paper.confirmReset") : t("paper.reset")}
        </button>
      </section>
      <p className="text-[11px] text-zinc-600">{t("paper.disclaimer")}</p>
    </div>
  );
}
