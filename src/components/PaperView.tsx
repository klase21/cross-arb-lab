"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import {
  accrueFunding,
  clearAccount,
  clearEquity,
  closeFunding,
  consumeDraft,
  executeMarket,
  executePair,
  fundingPricePnl,
  loadAccount,
  loadEquity,
  newAccount,
  openFunding,
  recordEquity,
  saveAccount,
  valuate,
  PAPER_FEES,
  type EquityPoint,
  type PaperAccount,
  type PaperQuote,
  type PaperSide,
  type PaperVenue,
} from "@/lib/paper";
import {
  DEFAULT_AUTO_CONFIG,
  loadAutoConfig,
  saveAutoConfig,
  type AutoConfig,
} from "@/lib/auto";
import { fmtQty, fmtUsd2 } from "@/lib/format";

interface FundRow {
  base: string;
  longVenue: string;
  shortVenue: string;
  spreadApr: number;
  dailyPer10k: number;
  longMark: number | null;
  longApr: number;
  shortMark: number | null;
  shortApr: number;
}

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
  return fmtUsd2(n);
}

function buildQuote(
  item: KimchiItem | undefined,
  venue: PaperVenue,
  fx: number,
): PaperQuote | null {
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
  const [pairDir, setPairDir] = useState<"u2b" | "b2u">("u2b");
  const [pairNotionalInput, setPairNotionalInput] = useState("1000");
  const [pairMsg, setPairMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [arbs, setArbs] = useState<FundRow[]>([]);
  const [fundBase, setFundBase] = useState<string | null>(null);
  const [fundNotional, setFundNotional] = useState("1000");
  const [fundMsg, setFundMsg] = useState<string | null>(null);
  const [autoCfg, setAutoCfgState] = useState<AutoConfig>(DEFAULT_AUTO_CONFIG);
  const [equity, setEquity] = useState<EquityPoint[]>([]);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      setAccount(loadAccount());
      setAutoCfgState(loadAutoConfig());
      setEquity(loadEquity());
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

  const refreshFunding = useCallback(async () => {
    try {
      const res = await fetch("/api/futures/funding");
      if (!res.ok) return;
      const data = await res.json();
      const rows: FundRow[] = ((data.rows ?? []) as {
        base: string; longVenue: string; shortVenue: string; spreadApr: number;
        dailyPer10k: number; quotes: { venue: string; apr: number; mark: number | null }[];
      }[])
        .map(r => {
          const lq = r.quotes.find(q => q.venue === r.longVenue);
          const sq = r.quotes.find(q => q.venue === r.shortVenue);
          return {
            base: r.base, longVenue: r.longVenue, shortVenue: r.shortVenue,
            spreadApr: r.spreadApr, dailyPer10k: r.dailyPer10k,
            longMark: lq?.mark ?? null, longApr: lq?.apr ?? 0,
            shortMark: sq?.mark ?? null, shortApr: sq?.apr ?? 0,
          } satisfies FundRow;
        })
        .filter(r => r.longMark !== null && r.shortMark !== null)
        .slice(0, 12);
      setArbs(rows);
      const qmap = new Map(rows.map(r => [r.base, r]));
      setAccount(prev => {
        if (!prev || prev.funding.length === 0) return prev;
        const now = Date.now();
        const funding = prev.funding.map(f => {
          const q = qmap.get(f.base);
          if (!q) return f;
          return accrueFunding(f, q.longApr, q.shortApr, now);
        });
        const next = { ...prev, funding, updatedAt: now };
        saveAccount(next);
        return next;
      });
    } catch {}
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => { void refreshFunding(); }, 0);
    const timer = setInterval(() => { void refreshFunding(); }, 120 * 1000);
    return () => { clearTimeout(kickoff); clearInterval(timer); };
  }, [refreshFunding]);

  const fundMark = useCallback((base: string, venue: string): number | null => {
    const row = arbs.find(r => r.base === base);
    if (!row) return null;
    if (venue === row.longVenue) return row.longMark;
    if (venue === row.shortVenue) return row.shortMark;
    return null;
  }, [arbs]);

  const byCoin = useMemo(() => {
    const map = new Map<string, KimchiItem>();
    for (const item of items) map.set(item.coin.toUpperCase(), item);
    return map;
  }, [items]);

  // Binance direct fallback for non-KRW coins (e.g. NIL): vision is CORS-open.
  // Covers the ticket symbol plus any open Binance positions missing from kimchi.
  const [extMap, setExtMap] = useState<Record<string, { bid: number; ask: number }>>({});
  useEffect(() => {
    let cancelled = false;
    const syms = new Set<string>();
    const ticket = symbol.trim().toUpperCase();
    if (/^[A-Z0-9]{2,12}$/.test(ticket) && !byCoin.has(ticket)) syms.add(ticket);
    for (const p of account?.positions ?? []) {
      if (p.venue === "binance" && !byCoin.has(p.coin.toUpperCase())) syms.add(p.coin.toUpperCase());
    }
    if (syms.size === 0) return;
    const kickoff = setTimeout(async () => {
      try {
        const list = [...syms].map(s => `"${s}USDT"`).join(",");
        const res = await fetch(`https://data-api.binance.vision/api/v3/ticker/bookTicker?symbols=[${list}]`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { symbol: string; bidPrice: string; askPrice: string }[];
        const next: Record<string, { bid: number; ask: number }> = {};
        for (const d of Array.isArray(data) ? data : []) {
          const base = d.symbol.replace(/USDT$/, "");
          const bid = Number.parseFloat(d.bidPrice);
          const ask = Number.parseFloat(d.askPrice);
          if (base && bid > 0 && ask > 0) next[base] = { bid, ask };
        }
        if (!cancelled) setExtMap(prev => ({ ...prev, ...next }));
      } catch {}
    }, 300);
    return () => { cancelled = true; clearTimeout(kickoff); };
  }, [symbol, byCoin, account]);

  const quote: PaperQuote | null = useMemo(() => {
    const sym = symbol.trim().toUpperCase();
    const base = buildQuote(byCoin.get(sym), venue, fx);
    if (base) return base;
    if (venue !== "binance") return null;
    const q = extMap[sym];
    return q ? { venue, coin: sym, bidUsd: q.bid, askUsd: q.ask } : null;
  }, [byCoin, symbol, venue, fx, extMap]);

  const pairBuyVenue: PaperVenue = pairDir === "u2b" ? "upbit" : "binance";
  const pairSellVenue: PaperVenue = pairDir === "u2b" ? "binance" : "upbit";
  const pairBuyQ = useMemo(() => {
    const sym = symbol.trim().toUpperCase();
    const base = buildQuote(byCoin.get(sym), pairBuyVenue, fx);
    if (base) return base;
    if (pairBuyVenue !== "binance") return null;
    const q = extMap[sym];
    return q ? { venue: pairBuyVenue, coin: sym, bidUsd: q.bid, askUsd: q.ask } : null;
  }, [byCoin, symbol, pairBuyVenue, fx, extMap]);
  const pairSellQ = useMemo(() => {
    const sym = symbol.trim().toUpperCase();
    const base = buildQuote(byCoin.get(sym), pairSellVenue, fx);
    if (base) return base;
    if (pairSellVenue !== "binance") return null;
    const q = extMap[sym];
    return q ? { venue: pairSellVenue, coin: sym, bidUsd: q.bid, askUsd: q.ask } : null;
  }, [byCoin, symbol, pairSellVenue, fx, extMap]);
  const pairNotional = Number.parseFloat(pairNotionalInput);
  const pairQty = pairBuyQ && Number.isFinite(pairNotional) && pairNotional > 0 ? pairNotional / pairBuyQ.askUsd : 0;
  const pairPreview = useMemo(() => {
    if (!pairBuyQ || !pairSellQ || !(pairQty > 0)) return null;
    const buyGross = pairQty * pairBuyQ.askUsd;
    const sellGross = pairQty * pairSellQ.bidUsd;
    const fees = buyGross * PAPER_FEES[pairBuyQ.venue] + sellGross * PAPER_FEES[pairSellQ.venue];
    return { buyGross, sellGross, fees, net: sellGross - buyGross - fees, prem: ((pairSellQ.bidUsd - pairBuyQ.askUsd) / pairBuyQ.askUsd) * 100 };
  }, [pairBuyQ, pairSellQ, pairQty]);

  const submitPair = () => {
    if (!account) return;
    setPairMsg(null);
    if (!pairBuyQ || !pairSellQ || !(pairQty > 0)) { setPairMsg(t("paper.badQty")); return; }
    const result = executePair(account, pairBuyQ, pairSellQ, pairQty, `pair:${symbol.trim().toUpperCase()}`);
    if ("error" in result) {
      setPairMsg(result.error === "cash" ? t("paper.noCash") : result.error === "position" ? t("paper.pairNoInventory") : t("paper.badQty"));
      return;
    }
    setAccount(result.account);
    saveAccount(result.account);
    setPairMsg(t("paper.filled"));
  };

  const mark = useCallback((v: PaperVenue, coin: string): number | null => {
    const sym = coin.trim().toUpperCase();
    const item = byCoin.get(sym);
    if (!item) {
      if (v === "binance") {
        const q = extMap[sym];
        return q && q.ask > 0 ? q.ask : null;
      }
      return null;
    }
    if (v === "upbit") {
      const bid = (item.upbitBid ?? item.upbitKrw) / fx;
      return bid > 0 ? bid : null;
    }
    const ask = item.globalAsk ?? item.globalUsd;
    return ask > 0 ? ask : null;
  }, [byCoin, fx, extMap]);

  const valuation = useMemo(() => (account ? valuate(account, mark, fundMark) : null), [account, mark, fundMark]);

  const assetStats = useMemo(() => {
    if (!account) return [];
    const map = new Map<string, { asset: string; pairs: number; spotRealized: number; fundRealized: number; fundOpen: number }>();
    const get = (a: string) => {
      let s = map.get(a);
      if (!s) { s = { asset: a, pairs: 0, spotRealized: 0, fundRealized: 0, fundOpen: 0 }; map.set(a, s); }
      return s;
    };
    for (const f of account.fills) if (f.note?.startsWith("pair:")) get(f.note.slice(5)).pairs += 0.5;
    for (const c of account.closedTrades) get(c.coin).spotRealized += c.realizedPnlUsd;
    for (const c of account.fundingClosed) get(c.base).fundRealized += c.pnlUsd;
    for (const p of account.funding) get(p.base).fundOpen += 1;
    for (const s of map.values()) s.pairs = Math.round(s.pairs);
    return [...map.values()].sort((a, b) => (b.spotRealized + b.fundRealized) - (a.spotRealized + a.fundRealized));
  }, [account]);

  const equityChart = useMemo(() => {
    if (equity.length < 2 || !account) return null;
    const W = 760;
    const H = 120;
    const vals = equity.map(p => p.e);
    const min = Math.min(...vals, account.startedUsd);
    const max = Math.max(...vals, account.startedUsd);
    const span = max - min || 1;
    const t0 = equity[0].t;
    const t1 = equity[equity.length - 1].t;
    const x = (time: number) => 40 + ((time - t0) / Math.max(t1 - t0, 1)) * (W - 48);
    const y = (v: number) => 8 + (1 - (v - min) / span) * (H - 24);
    const y0 = y(account.startedUsd);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        <line x1={40} y1={y0} x2={W - 8} y2={y0} stroke="#52525b" strokeWidth={1} strokeDasharray="4 3" />
        <polyline
          points={equity.map(p => `${x(p.t).toFixed(1)},${y(p.e).toFixed(1)}`).join(" ")}
          fill="none" stroke="#34d399" strokeWidth={1.5}
        />
        <text x={4} y={y(max) + 3} fontSize={9} fill="#71717a">{fmtUsd2(max)}</text>
        <text x={4} y={y(min) + 3} fontSize={9} fill="#71717a">{fmtUsd2(min)}</text>
      </svg>
    );
  }, [equity, account]);

  useEffect(() => {
    if (!valuation) return;
    const t = setTimeout(() => setEquity(recordEquity(valuation.equityUsd)), 0);
    return () => clearTimeout(t);
  }, [valuation]);

  const setAuto = (patch: Partial<AutoConfig>) => {
    setAutoCfgState(prev => {
      const next = { ...prev, ...patch };
      saveAutoConfig(next);
      return next;
    });
  };

  const openFund = () => {
    if (!account) return;
    setFundMsg(null);
    const row = arbs.find(r => r.base === fundBase);
    const notional = Number.parseFloat(fundNotional);
    if (!row || !Number.isFinite(notional) || notional <= 0) { setFundMsg(t("paper.badQty")); return; }
    if (row.longMark === null || row.shortMark === null) { setFundMsg(t("paper.noQuote")); return; }
    const result = openFunding(account, {
      base: row.base, longVenue: row.longVenue, shortVenue: row.shortVenue,
      notionalUsd: notional, longMark: row.longMark, shortMark: row.shortMark,
    });
    if ("error" in result) {
      setFundMsg(result.error === "cash" ? t("paper.noCash") : result.error === "exists" ? t("paper.fundExists") : t("paper.badQty"));
      return;
    }
    setAccount(result.account);
    saveAccount(result.account);
    setFundMsg(t("paper.filled"));
  };

  const closeFund = (id: string) => {
    if (!account) return;
    const pos = account.funding.find(f => f.id === id);
    if (!pos) return;
    const row = arbs.find(r => r.base === pos.base);
    if (!row || row.longMark === null || row.shortMark === null) return;
    const result = closeFunding(account, id, {
      longApr: row.longApr, shortApr: row.shortApr,
      longMark: row.longMark, shortMark: row.shortMark,
      // eslint-disable-next-line react-hooks/purity -- event handler, not render
    }, Date.now());
    if (!("error" in result)) {
      setAccount(result.account);
      saveAccount(result.account);
    }
  };

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

      {equityChart && (
        <section className="rounded-xl border border-zinc-800 p-4">
          <h2 className="text-sm font-semibold mb-2">📈 {t("paper.equityCurve")}</h2>
          {equityChart}
        </section>
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
          {!quote && venue === "upbit" && symbol.trim() && <span className="ml-2 text-amber-300">{t("paper.onlyBinance")}</span>}
          {msg && <span className="ml-2 text-amber-300">{msg}</span>}
        </p>
      </section>

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="text-sm font-semibold mb-3">⚖️ {t("paper.pair")}</h2>
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <button onClick={() => setPairDir("u2b")} className={selBtn(pairDir === "u2b")}>
            {t("paper.u2b")}
          </button>
          <button onClick={() => setPairDir("b2u")} className={selBtn(pairDir === "b2u")}>
            {t("paper.b2u")}
          </button>
          <input
            value={pairNotionalInput}
            onChange={e => setPairNotionalInput(e.target.value)}
            inputMode="decimal"
            placeholder="USD"
            className="px-2.5 py-1 rounded-md text-xs bg-zinc-900 border border-zinc-700 font-mono w-28"
          />
          <button onClick={submitPair} className="px-4 py-1 rounded-md text-xs font-bold bg-sky-600 text-white">
            {t("paper.pairExecute")}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">
          {pairPreview ? (
            <>
              {t("paper.pairPreview")}: L {pairBuyQ!.venue} {fmtUsd(pairBuyQ!.askUsd)} / S {pairSellQ!.venue} {fmtUsd(pairSellQ!.bidUsd)}
              {" · "}{t("paper.pairNet")}: <b className={pairPreview.net >= 0 ? "text-emerald-400" : "text-red-400"}>
                {pairPreview.net >= 0 ? "+" : ""}{fmtUsd(pairPreview.net)}
              </b>
              <span className="ml-2 text-zinc-600">
                {t("paper.pairPremium")}: {pairPreview.prem >= 0 ? "+" : ""}{pairPreview.prem.toFixed(2)}% · {t("paper.fee")} {fmtUsd(pairPreview.fees)}
              </span>
            </>
          ) : (
            <span>{t("paper.pairNeedInventory")}</span>
          )}
          {pairMsg && <span className="ml-2 text-amber-300">{pairMsg}</span>}
        </p>
      </section>

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="text-sm font-semibold mb-3">💸 {t("paper.funding")}</h2>
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <select
            value={fundBase ?? ""}
            onChange={e => setFundBase(e.target.value || null)}
            className="px-2.5 py-1 rounded-md text-xs bg-zinc-900 border border-zinc-700 font-mono"
          >
            <option value="">—</option>
            {arbs.map(r => (
              <option key={r.base} value={r.base}>
                {r.base} {(r.spreadApr * 100).toFixed(0)}bp L:{r.longVenue} S:{r.shortVenue}
              </option>
            ))}
          </select>
          <input
            value={fundNotional}
            onChange={e => setFundNotional(e.target.value)}
            inputMode="decimal"
            placeholder="USD"
            className="px-2.5 py-1 rounded-md text-xs bg-zinc-900 border border-zinc-700 font-mono w-28"
          />
          <button onClick={openFund} className="px-4 py-1 rounded-md text-xs font-bold bg-violet-600 text-white">
            {t("paper.fundOpen")}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 mb-2">
          {t("paper.fundDesc")}
          {fundMsg && <span className="ml-2 text-amber-300">{fundMsg}</span>}
        </p>
        {account.funding.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs min-w-[680px]">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2">{t("ta.coin")}</th>
                  <th className="px-3 py-2">{t("paper.fundLegs")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.fundNotional")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.fundAcc")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.fundPricePnl")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.fundTotal")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {account.funding.map(f => {
                  const row = arbs.find(r => r.base === f.base);
                  const pricePnl = row && row.longMark !== null && row.shortMark !== null
                    ? fundingPricePnl(f, row.longMark, row.shortMark) : 0;
                  const total = f.accFundingUsd + pricePnl;
                  return (
                    <tr key={f.id} className="border-t border-zinc-800">
                      <td className="px-3 py-2 font-bold">${f.base}</td>
                      <td className="px-3 py-2 text-zinc-400">
                        L <b className="text-emerald-300">{f.longVenue}</b> / S <b className="text-red-300">{f.shortVenue}</b>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{fmtUsd2(f.notionalUsd)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${f.accFundingUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {f.accFundingUsd >= 0 ? "+" : ""}{fmtUsd2(f.accFundingUsd)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${pricePnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {pricePnl >= 0 ? "+" : ""}{fmtUsd2(pricePnl)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${total >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {total >= 0 ? "+" : ""}{fmtUsd2(total)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => closeFund(f.id)} className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
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
        <h2 className="text-sm font-semibold mb-2">📦 {t("paper.positions")} ({account.positions.length})</h2>        {account.positions.length === 0 ? (
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
                      <td className="px-3 py-2 text-right font-mono">{fmtQty(p.qty)}</td>
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
        <h2 className="text-sm font-semibold mb-2">🏅 {t("paper.byAsset")} ({assetStats.length})</h2>
        {assetStats.length === 0 ? (
          <p className="text-xs text-zinc-500">{t("paper.noAssetStats")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs min-w-[560px]">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2">{t("ta.coin")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.assetPairs")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.assetSpot")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.assetFund")}</th>
                  <th className="px-3 py-2 text-right">{t("paper.assetTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {assetStats.slice(0, 20).map(s => {
                  const total = s.spotRealized + s.fundRealized;
                  return (
                    <tr key={s.asset} className="border-t border-zinc-800">
                      <td className="px-3 py-2 font-bold">
                        ${s.asset}
                        {s.fundOpen > 0 && <span className="ml-1.5 text-[10px] text-violet-300">●{s.fundOpen}</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-300">{s.pairs}</td>
                      <td className={`px-3 py-2 text-right font-mono ${s.spotRealized >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {s.spotRealized >= 0 ? "+" : ""}{fmtUsd2(s.spotRealized)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${s.fundRealized >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {s.fundRealized >= 0 ? "+" : ""}{fmtUsd2(s.fundRealized)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${total >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {total >= 0 ? "+" : ""}{fmtUsd2(total)}
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
                <span>{fmtQty(f.qty)} @ {fmtUsd(f.priceUsd)}</span>
                <span className="ml-auto text-zinc-600">{new Date(f.ts).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => {
            if (!confirmReset) { setConfirmReset(true); return; }
            clearAccount();
            clearEquity();
            setAccount(null);
            setEquity([]);
            setConfirmReset(false);
          }}
          onBlur={() => setConfirmReset(false)}
          className="mt-3 px-3 py-1 rounded-md text-xs border border-zinc-700 text-zinc-500 hover:text-red-300 hover:border-red-800"
        >
          {confirmReset ? t("paper.confirmReset") : t("paper.reset")}
        </button>
      </section>
      <section className="rounded-xl border border-zinc-800 p-4">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-sm font-semibold">🤖 {t("paper.autoTitle")}</h2>
          <button
            onClick={() => setAuto({ enabled: !autoCfg.enabled })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoCfg.enabled ? "bg-emerald-600" : "bg-zinc-700"}`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${autoCfg.enabled ? "translate-x-[18px]" : "translate-x-1"}`} />
          </button>
          <span className="text-[11px] text-zinc-500">{t("paper.autoDesc")}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <label className="flex items-center justify-between gap-2 bg-zinc-950 rounded p-2">
            <span className="text-zinc-400">{t("paper.autoSpot")}</span>
            <button onClick={() => setAuto({ spotEnabled: !autoCfg.spotEnabled })} className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ${autoCfg.spotEnabled ? "bg-emerald-600" : "bg-zinc-700"}`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${autoCfg.spotEnabled ? "translate-x-[18px]" : "translate-x-1"}`} />
            </button>
          </label>
          <label className="flex items-center justify-between gap-2 bg-zinc-950 rounded p-2">
            <span className="text-zinc-400">{t("paper.autoFunding")}</span>
            <button onClick={() => setAuto({ fundingEnabled: !autoCfg.fundingEnabled })} className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ${autoCfg.fundingEnabled ? "bg-emerald-600" : "bg-zinc-700"}`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${autoCfg.fundingEnabled ? "translate-x-[18px]" : "translate-x-1"}`} />
            </button>
          </label>
          <label className="block bg-zinc-950 rounded p-2">
            <span className="text-zinc-400">{t("paper.autoSpotThr")} ≥ <b className="text-zinc-200">{autoCfg.spotThresholdPct}%</b></span>
            <input type="range" min={0.5} max={10} step={0.5} value={autoCfg.spotThresholdPct} onChange={e => setAuto({ spotThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </label>
          <label className="block bg-zinc-950 rounded p-2">
            <span className="text-zinc-400">{t("paper.autoFundThr")} ≥ <b className="text-zinc-200">{autoCfg.fundingThresholdApr}%</b></span>
            <input type="range" min={10} max={300} step={10} value={autoCfg.fundingThresholdApr} onChange={e => setAuto({ fundingThresholdApr: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </label>
          <label className="block bg-zinc-950 rounded p-2">
            <span className="text-zinc-400">{t("paper.autoSpotNot")} $<b className="text-zinc-200">{autoCfg.spotNotionalUsd}</b></span>
            <input type="range" min={100} max={5000} step={100} value={autoCfg.spotNotionalUsd} onChange={e => setAuto({ spotNotionalUsd: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </label>
          <label className="block bg-zinc-950 rounded p-2">
            <span className="text-zinc-400">{t("paper.autoFundNot")} $<b className="text-zinc-200">{autoCfg.fundingNotionalUsd}</b></span>
            <input type="range" min={100} max={10000} step={100} value={autoCfg.fundingNotionalUsd} onChange={e => setAuto({ fundingNotionalUsd: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </label>
          <label className="block bg-zinc-950 rounded p-2">
            <span className="text-zinc-400">{t("paper.autoCooldown")} <b className="text-zinc-200">{autoCfg.cooldownMin}{t("common.minute")}</b></span>
            <input type="range" min={10} max={240} step={10} value={autoCfg.cooldownMin} onChange={e => setAuto({ cooldownMin: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </label>
          <label className="block bg-zinc-950 rounded p-2">
            <span className="text-zinc-400">{t("paper.autoFundExit")} &lt; <b className="text-zinc-200">{autoCfg.fundingExitApr}%</b></span>
            <input type="range" min={5} max={100} step={5} value={autoCfg.fundingExitApr} onChange={e => setAuto({ fundingExitApr: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </label>
        </div>
      </section>

      <p className="text-[11px] text-zinc-600">{t("paper.disclaimer")}</p>
    </div>
  );
}
