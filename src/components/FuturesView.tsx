"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { useLang } from "@/lib/i18n";
import { liquidationZones } from "@/lib/futures";

interface FutRow {
  symbol: string;
  base: string;
  price: number;
  change24h: number;
  volume24h: number;
  oiUsd: number;
  oiChange24h: number | null;
  fundingApr: number;
  nextFundingMs: number;
  longAccount: number | null;
  lsRatio: number | null;
  squeezeScore: number;
  squeezeSide: "LONG" | "SHORT" | null;
}

interface FundingArb {
  base: string;
  quotes: { venue: string; apr: number }[];
  spreadApr: number;
  longVenue: string;
  shortVenue: string;
  dailyPer10k: number;
  nVenues: number;
}

const VENUES = ["Binance", "Hyperliquid", "Aster", "dYdX", "Paradex"] as const;
const VENUE_SHORT: Record<string, string> = {
  Binance: "Bin",
  Hyperliquid: "HL",
  Aster: "Aster",
  dYdX: "dYdX",
  Paradex: "Paradex",
};

interface CoinDetail {
  symbol: string;
  depth: { bids: { p: number; q: number }[]; asks: { p: number; q: number }[] };
  trades: { p: number; q: number; t: number; sell: boolean }[];
  funding: { r: number; t: number }[];
  oiHist: { v: number; t: number }[];
  lsrHist: { v: number; t: number }[];
}

type SubTab = "screen" | "funding" | "squeeze";
type SortKey = "vol" | "fund" | "oi" | "sqz";

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (n > 0) return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
  return "-";
}

function fundCountdown(ms: number, lang: string): string {
  const s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return lang === "ko" ? `${h}시간 ${m}분` : `${h}h ${m}m`;
}

function Spark({ vals, w = 120, h = 32, color = "#34d399" }: { vals: number[]; w?: number; h?: number; color?: string }) {
  if (vals.length < 2) return <span className="text-zinc-600">-</span>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(" ");
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

export default function FuturesView() {
  const { t, lang } = useLang();
  const [sub, setSub] = useState<SubTab>("screen");
  const [rows, setRows] = useState<FutRow[]>([]);
  const [arbs, setArbs] = useState<FundingArb[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("vol");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CoinDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const intervalSec = usePollingInterval();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [r1, r2] = await Promise.all([fetch("/api/futures"), fetch("/api/futures/funding")]);
      if (r1.ok) {
        const d = await r1.json();
        const rowsData: FutRow[] = Array.isArray(d.rows) ? d.rows : [];
        setRows(rowsData);
        const { notifyFutSqueeze } = await import("@/lib/notifications");
        for (const row of rowsData) {
          if (row.squeezeSide) notifyFutSqueeze(row.base, row.squeezeSide, row.squeezeScore);
        }
      }
      if (r2.ok) {
        const d = await r2.json();
        const arbData: FundingArb[] = Array.isArray(d.rows) ? d.rows : [];
        setArbs(arbData);
        const { notifyFutFunding } = await import("@/lib/notifications");
        for (const arb of arbData.slice(0, 8)) {
          notifyFutFunding(arb.base, arb.spreadApr, arb.longVenue, arb.shortVenue);
        }
      }
      setLastUpdated(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {} finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    const kickoff = setTimeout(() => { void load(); }, 0);
    const timer = setInterval(() => { void load(); }, Math.max(intervalSec, 60) * 1000);
    return () => { clearTimeout(kickoff); clearInterval(timer); };
  }, [load, intervalSec]);

  const loadDetail = useCallback(async (symbol: string) => {
    try {
      setDetailLoading(true);
      const res = await fetch(`/api/futures/coin?symbol=${symbol}`);
      if (res.ok) setDetail(await res.json());
    } catch {} finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    const kickoff = setTimeout(() => { void loadDetail(selected); }, 0);
    return () => clearTimeout(kickoff);
  }, [selected, loadDetail]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const list = rows.filter(r => !q || r.base.includes(q));
    return [...list].sort((a, b) => {
      if (sort === "fund") return Math.abs(b.fundingApr) - Math.abs(a.fundingApr);
      if (sort === "oi") return (b.oiChange24h ?? -Infinity) - (a.oiChange24h ?? -Infinity);
      if (sort === "sqz") return b.squeezeScore - a.squeezeScore;
      return b.volume24h - a.volume24h;
    });
  }, [rows, search, sort]);

  const squeezed = useMemo(() => [...rows].sort((a, b) => b.squeezeScore - a.squeezeScore).slice(0, 15), [rows]);

  const selBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${active ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`;

  const selRow = rows.find(r => r.symbol === selected) ?? null;
  const bidSum = detail ? detail.depth.bids.reduce((a, x) => a + x.p * x.q, 0) : 0;
  const askSum = detail ? detail.depth.asks.reduce((a, x) => a + x.p * x.q, 0) : 0;
  const pressure = bidSum + askSum > 0 ? (bidSum / (bidSum + askSum)) * 100 : 50;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["screen", "funding", "squeeze"] as SubTab[]).map(s => (
          <button key={s} onClick={() => setSub(s)} className={selBtn(sub === s)}>{t(`fut.sub.${s}`)}</button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t("fut.searchPlaceholder")}
          className="px-2.5 py-1 rounded-md text-xs bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 w-36"
        />
        <span className="ml-auto text-xs text-zinc-500">{t("common.lastUpdated")}: {lastUpdated ?? "-"}</span>
      </div>

      {sub === "screen" && (
        <section>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(["vol", "fund", "oi", "sqz"] as SortKey[]).map(s => (
              <button key={s} onClick={() => setSort(s)} className={selBtn(sort === s)}>↓ {t(`fut.sort.${s}`)}</button>
            ))}
          </div>
          {loading && rows.length === 0 ? (
            <p className="text-xs text-zinc-500">{t("common.loading")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-xs min-w-[900px]">
                <thead>
                  <tr className="bg-zinc-900 text-zinc-400 text-left">
                    <th className="px-3 py-2">{t("fut.coin")}</th>
                    <th className="px-3 py-2 text-right">{t("fut.price")}</th>
                    <th className="px-3 py-2 text-right">24h %</th>
                    <th className="px-3 py-2 text-right">{t("fut.funding")}</th>
                    <th className="px-3 py-2 text-right">OI</th>
                    <th className="px-3 py-2 text-right">OI 24h</th>
                    <th className="px-3 py-2 text-right">L/S</th>
                    <th className="px-3 py-2">{t("fut.squeeze")}</th>
                    <th className="px-3 py-2 text-right">{t("fut.volume")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr
                      key={r.symbol}
                      onClick={() => {
                        const next = selected === r.symbol ? null : r.symbol;
                        setSelected(next);
                        if (next === null) setDetail(null);
                      }}
                      className={`border-t border-zinc-800 hover:bg-zinc-900/60 cursor-pointer ${selected === r.symbol ? "bg-zinc-900/80" : ""}`}
                    >
                      <td className="px-3 py-2 font-bold">${r.base}</td>
                      <td className="px-3 py-2 text-right">${fmtPrice(r.price)}</td>
                      <td className={`px-3 py-2 text-right ${r.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {r.change24h >= 0 ? "+" : ""}{r.change24h.toFixed(1)}%
                      </td>
                      <td className={`px-3 py-2 text-right ${r.fundingApr >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {r.fundingApr >= 0 ? "+" : ""}{r.fundingApr.toFixed(1)}%
                        <span className="block text-[10px] text-zinc-500">{fundCountdown(r.nextFundingMs, lang)}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-300">{fmtUsd(r.oiUsd)}</td>
                      <td className={`px-3 py-2 text-right ${r.oiChange24h !== null && r.oiChange24h >= 0 ? "text-sky-300" : "text-zinc-400"}`}>
                        {r.oiChange24h !== null ? `${r.oiChange24h >= 0 ? "+" : ""}${r.oiChange24h.toFixed(1)}%` : "-"}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-300">
                        {r.longAccount !== null ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block w-10 h-1.5 rounded bg-zinc-800 overflow-hidden">
                              <span className="block h-full bg-emerald-500" style={{ width: `${r.longAccount * 100}%` }} />
                            </span>
                            {(r.longAccount * 100).toFixed(0)}%
                          </span>
                        ) : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {r.squeezeSide ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.squeezeSide === "LONG" ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                            {r.squeezeSide === "LONG" ? t("fut.longSqz") : t("fut.shortSqz")} {r.squeezeScore}
                          </span>
                        ) : <span className="text-zinc-600">-</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-400">{fmtUsd(r.volume24h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selected && (
            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-2 mb-2">
                <b className="text-sm">${selRow?.base ?? selected.replace(/USDT$/, "")}</b>
                <button onClick={() => { setSelected(null); setDetail(null); }} className="ml-auto text-xs text-zinc-500 hover:text-zinc-200">✕</button>
              </div>
              {detailLoading && !detail ? (
                <p className="text-xs text-zinc-500">{t("common.loading")}</p>
              ) : detail ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-xs">
                  <div>
                    <h3 className="font-semibold mb-1.5">{t("fut.book")}</h3>
                    <div className="mb-1.5">
                      <div className="flex justify-between text-[10px] text-zinc-500 mb-0.5">
                        <span>Bid {fmtUsd(bidSum)}</span><span>{pressure.toFixed(0)}%</span><span>Ask {fmtUsd(askSum)}</span>
                      </div>
                      <div className="h-1.5 rounded bg-red-500/40 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${pressure}%` }} />
                      </div>
                    </div>
                    {detail.depth.asks.slice().reverse().map((a, i) => (
                      <div key={`a${i}`} className="flex justify-between text-red-300/90"><span>{fmtPrice(a.p)}</span><span className="text-zinc-500">{a.q.toFixed(3)}</span></div>
                    ))}
                    <div className="border-t border-zinc-700 my-1" />
                    {detail.depth.bids.map((b, i) => (
                      <div key={`b${i}`} className="flex justify-between text-emerald-300/90"><span>{fmtPrice(b.p)}</span><span className="text-zinc-500">{b.q.toFixed(3)}</span></div>
                    ))}
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1.5">{t("fut.tape")}</h3>
                    {detail.trades.map((x, i) => (
                      <div key={i} className="flex justify-between">
                        <span className={x.sell ? "text-red-300/90" : "text-emerald-300/90"}>{fmtPrice(x.p)}</span>
                        <span className="text-zinc-500">{x.q.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <h3 className="font-semibold mb-1">{t("fut.fundingHist")}</h3>
                      <Spark vals={detail.funding.map(f => f.r * 100)} color="#38bdf8" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">OI</h3>
                      <Spark vals={detail.oiHist.map(o => o.v)} color="#a78bfa" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">L/S</h3>
                      <Spark vals={detail.lsrHist.map(l => l.v)} color="#fbbf24" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1.5">{t("fut.liqZones")}</h3>
                    <table className="w-full text-[11px]">
                      <thead><tr className="text-zinc-500 text-left"><th>Lev</th><th className="text-right">Long↓</th><th className="text-right">Short↑</th></tr></thead>
                      <tbody>
                        {liquidationZones(selRow?.price ?? detail.depth.bids[0]?.p ?? 0).map(z => (
                          <tr key={z.leverage} className="border-t border-zinc-800">
                            <td className="py-1">{z.leverage}x</td>
                            <td className="py-1 text-right text-red-300">{fmtPrice(z.longLiq)}</td>
                            <td className="py-1 text-right text-emerald-300">{fmtPrice(z.shortLiq)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[10px] text-zinc-600 mt-1">{t("fut.liqEst")}</p>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}

      {sub === "funding" && (
        <section>
          <p className="text-[11px] text-zinc-500 mb-2">{t("fut.arbDesc")}</p>
          {arbs.length === 0 ? (
            <p className="text-xs text-zinc-500">{loading ? t("common.loading") : t("common.noData")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-xs min-w-[880px]">
                <thead>
                  <tr className="bg-zinc-900 text-zinc-400 text-left">
                    <th className="px-3 py-2">{t("fut.coin")}</th>
                    <th className="px-3 py-2 text-right">{t("fut.spread")}</th>
                    <th className="px-3 py-2">{t("fut.direction")}</th>
                    <th className="px-3 py-2 text-right">$/day·$10k</th>
                    {VENUES.map(v => (
                      <th key={v} className="px-3 py-2 text-right">{VENUE_SHORT[v]} APR</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {arbs.map(a => {
                    const q = new Map(a.quotes.map(x => [x.venue, x.apr]));
                    return (
                      <tr key={a.base} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                        <td className="px-3 py-2 font-bold">
                          ${a.base}
                          <span className="ml-1.5 font-normal text-zinc-500">×{a.nVenues}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-amber-300">
                          {a.spreadApr >= 0 ? "+" : ""}{(a.spreadApr * 100).toFixed(0)}bp
                        </td>
                        <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">
                          L <b className="text-emerald-300">{VENUE_SHORT[a.longVenue] ?? a.longVenue}</b>
                          {" / "}S <b className="text-red-300">{VENUE_SHORT[a.shortVenue] ?? a.shortVenue}</b>
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-200">${a.dailyPer10k.toFixed(2)}</td>
                        {VENUES.map(v => {
                          const apr = q.get(v);
                          return (
                            <td key={v} className={`px-3 py-2 text-right ${apr === undefined ? "text-zinc-700" : apr >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {apr === undefined ? "-" : `${apr >= 0 ? "+" : ""}${apr.toFixed(1)}%`}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-zinc-600 mt-2">{t("fut.arbRisk")}</p>
        </section>
      )}

      {sub === "squeeze" && (
        <section>
          <p className="text-[11px] text-zinc-500 mb-2">{t("fut.sqzDesc")}</p>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">{t("fut.coin")}</th>
                  <th className="px-3 py-2">{t("fut.crowded")}</th>
                  <th className="px-3 py-2 w-48">{t("fut.risk")}</th>
                  <th className="px-3 py-2 text-right">{t("fut.funding")}</th>
                  <th className="px-3 py-2 text-right">OI 24h</th>
                  <th className="px-3 py-2 text-right">24h %</th>
                </tr>
              </thead>
              <tbody>
                {squeezed.map((r, i) => (
                  <tr key={r.symbol} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                    <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                    <td className="px-3 py-2 font-bold">${r.base}</td>
                    <td className="px-3 py-2">
                      {r.squeezeSide ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.squeezeSide === "LONG" ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                          {r.squeezeSide === "LONG" ? t("fut.longSqz") : t("fut.shortSqz")}
                        </span>
                      ) : <span className="text-zinc-600">-</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded bg-zinc-800 overflow-hidden">
                          <div className={`h-full ${r.squeezeScore >= 50 ? "bg-red-500" : r.squeezeScore >= 30 ? "bg-amber-500" : "bg-zinc-500"}`} style={{ width: `${r.squeezeScore}%` }} />
                        </div>
                        <span className="w-7 text-right text-zinc-300">{r.squeezeScore}</span>
                      </div>
                    </td>
                    <td className={`px-3 py-2 text-right ${r.fundingApr >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {r.fundingApr >= 0 ? "+" : ""}{r.fundingApr.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-300">
                      {r.oiChange24h !== null ? `${r.oiChange24h >= 0 ? "+" : ""}${r.oiChange24h.toFixed(1)}%` : "-"}
                    </td>
                    <td className={`px-3 py-2 text-right ${r.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {r.change24h >= 0 ? "+" : ""}{r.change24h.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-600 mt-2">{t("fut.liqEst")}</p>
        </section>
      )}
    </div>
  );
}
