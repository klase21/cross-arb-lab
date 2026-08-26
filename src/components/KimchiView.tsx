"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { scoreKimchi, riskColor } from "@/lib/risk-scorer";
import { useLang } from "@/lib/i18n";
import { useDisplayCurrency } from "@/lib/use-currency";

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
  walletStatus?: string;
  trip?: {
    netProfitKrw: number;
    netProfitPct: number;
    currentPremiumPct: number;
    breakevenPremiumPct: number;
    premiumGapToBreakevenPct: number;
    upbitPriceRiseNeededPct: number;
  };
}

function formatGlobalPrice(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

function formatKrw(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

type SortKey = "premium" | "roundTrip" | "cmcDev" | "coin" | "risk";
type SortDir = "desc" | "asc";

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <span className="text-zinc-600 text-[10px]">-</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 60;
  const height = 20;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");
  const positive = data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
      <polyline fill="none" stroke={positive ? "#34d399" : "#38bdf8"} strokeWidth="1.5" points={points} />
    </svg>
  );
}

export default function KimchiView() {
  const { t, lang } = useLang();
  const displayCurrency = useDisplayCurrency();
  const [items, setItems] = useState<KimchiItem[]>([]);
  const [fxRate, setFxRate] = useState(1350);
  const [search, setSearch] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [walletMap, setWalletMap] = useState<Map<string, { wallet_state: string; block_state: string; message: string }>>(new Map());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("premium");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [minVolume, setMinVolume] = useState(0);
  const [history, setHistory] = useState<Record<string, { time: number; premium: number }[]>>({});
  const [topMovers, setTopMovers] = useState<{ coin: string; delta: number }[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("kimchiFavorites");
      if (raw) setFavorites(new Set(JSON.parse(raw) as string[]));
      const histRaw = localStorage.getItem("kimchiHistory");
      if (histRaw) setHistory(JSON.parse(histRaw));
    } catch {}
  }, []);

  const toggleFavorite = (coin: string) => {
    setFavorites(previous => {
      const next = new Set(previous);
      if (next.has(coin)) next.delete(coin);
      else next.add(coin);
      try { localStorage.setItem("kimchiFavorites", JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(dir => dir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [kimchiRes, walletRes] = await Promise.all([
        fetch("/api/kimchi"),
        fetch("/api/upbit/wallet-status").catch(() => null),
      ]);
      if (kimchiRes.ok) {
        const data = await kimchiRes.json();
        if (Array.isArray(data.items)) {
          setItems(data.items);
          const { notifyKimchi } = await import("@/lib/notifications");
          for (const item of data.items as KimchiItem[]) {
            notifyKimchi(item.coin, item.premiumPct, item.trip?.netProfitPct);
          }
          // Update history (keep last 48 points, ~24h at 30min intervals)
          const now = Date.now();
          setHistory(previous => {
            const next = { ...previous };
            for (const item of data.items as KimchiItem[]) {
              const arr = next[item.coin] ? [...next[item.coin]] : [];
              if (arr.length === 0 || now - arr[arr.length - 1].time > 5 * 60 * 1000) {
                arr.push({ time: now, premium: item.premiumPct });
                if (arr.length > 48) arr.shift();
                next[item.coin] = arr;
              }
            }
            try { localStorage.setItem("kimchiHistory", JSON.stringify(next)); } catch {}
            // Compute top movers (1h delta)
            const movers: { coin: string; delta: number }[] = [];
            for (const [coin, points] of Object.entries(next)) {
              if (points.length < 2) continue;
              const recent = points[points.length - 1].premium;
              // Find point ~1h ago
              const targetTime = now - 60 * 60 * 1000;
              let closest = points[0];
              for (const point of points) if (Math.abs(point.time - targetTime) < Math.abs(closest.time - targetTime)) closest = point;
              if (now - closest.time < 30 * 60 * 1000) continue; // need at least 30min history
              movers.push({ coin, delta: recent - closest.premium });
            }
            movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
            setTopMovers(movers.slice(0, 5));
            return next;
          });
        }
        if (typeof data.fxRate === "number" && data.fxRate > 500) setFxRate(data.fxRate);
      }
      if (walletRes?.ok) {
        const walletData = await walletRes.json();
        const list = Array.isArray(walletData.data) ? walletData.data : [];
        const map = new Map<string, { wallet_state: string; block_state: string; message: string }>();
        for (const entry of list) {
          if (entry.currency && !map.has(entry.currency)) {
            map.set(entry.currency, { wallet_state: entry.wallet_state, block_state: entry.block_state, message: entry.message ?? "" });
          }
        }
        if (map.size > 0) setWalletMap(map);
      }
      setLastUpdated(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  const intervalSec = usePollingInterval();

  useEffect(() => {
    load();
    const interval = setInterval(load, intervalSec * 1000);
    return () => clearInterval(interval);
  }, [load, intervalSec]);

  const getKimchiRisk = (item: KimchiItem) => {
    const wallet = walletMap.get(item.coin);
    const delta1h = topMovers.find(m => m.coin === item.coin)?.delta;
    // history-based fallback if not in topMovers: compute from last 2 points
    let histDelta: number | undefined = delta1h;
    if (histDelta === undefined) {
      const hist = history[item.coin];
      if (hist && hist.length >= 2) histDelta = hist[hist.length - 1].premium - hist[0].premium;
    }
    const spreadBufferPct = item.trip ? -item.trip.premiumGapToBreakevenPct : undefined;
    return scoreKimchi({
      coin: item.coin,
      volumeKrw: item.volumeKrw,
      binanceDevPct: item.binanceDevPct,
      verified: item.verified,
      binanceOnCmc: item.binanceOnCmc,
      walletState: wallet?.wallet_state,
      blockState: wallet?.block_state,
      walletMessage: wallet?.message,
      delta1h: histDelta,
      spreadBufferPct,
    });
  };

  const exportCsv = () => {
    const headers = ["Coin", "Name", "Upbit_KRW_Bid", "Global_USD_Ask", "Premium_Pct", "CMC_Dev_Pct", "Volume_KRW_24h", "RoundTrip_KRW", "RoundTrip_Pct", "Risk_Total", "Risk_Grade"];
    const rows = filtered.map(item => {
      const r = getKimchiRisk(item);
      return [
        item.coin,
        item.nameKr,
        item.upbitKrw.toFixed(2),
        item.globalUsd.toFixed(5),
        item.premiumPct.toFixed(2),
        item.binanceDevPct?.toFixed(1) ?? "",
        item.volumeKrw ? Math.round(item.volumeKrw).toString() : "",
        item.trip ? Math.round(item.trip.netProfitKrw).toString() : "",
        item.trip ? item.trip.netProfitPct.toFixed(2) : "",
        r.total.toString(),
        r.grade,
      ];
    });
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kimchi_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => {
    const value = (item: KimchiItem): number => {
      switch (sortKey) {
        case "premium": return item.premiumPct;
        case "roundTrip": return item.trip?.netProfitPct ?? -Infinity;
        case "cmcDev": return item.binanceDevPct ?? Infinity;
        case "risk": return getKimchiRisk(item).total;
        case "coin": return 0;
      }
    };
    return items
      .filter(item => {
        if (verifiedOnly && !item.verified) return false;
        if (minVolume > 0 && (item.volumeKrw ?? 0) < minVolume) return false;
        const query = search.trim().toLowerCase();
        if (!query) return true;
        const nameKo = (item.nameKr || "").toLowerCase();
        const nameEn = (item.nameEn || "").toLowerCase();
        return item.coin.toLowerCase().includes(query) || nameKo.includes(query) || nameEn.includes(query);
      })
      .sort((left, right) => {
        // Favorites always float to the top (alphabetical among themselves)
        const leftFav = favorites.has(left.coin) ? 0 : 1;
        const rightFav = favorites.has(right.coin) ? 0 : 1;
        if (leftFav !== rightFav) return leftFav - rightFav;
        if (leftFav === 1 && sortKey === "coin") return left.coin.localeCompare(right.coin);
        const diff = (value(right) ?? 0) - (value(left) ?? 0);
        if (Number.isNaN(diff)) return 0;
        return sortDir === "desc" ? diff : -diff;
      });
  }, [items, search, verifiedOnly, favorites, sortKey, sortDir, walletMap, history, topMovers]);

  return (
    <>
      <div className="rounded-xl border border-orange-900/50 bg-orange-950/20 p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-orange-300 font-medium">{t("kimchi.subtitle")}</p>
          <div className="flex items-center gap-3">
            {lastUpdated && <span className="text-xs text-zinc-600">{t("common.lastUpdated")}: {lastUpdated}</span>}
            <span className="text-xs font-mono text-zinc-400" title="Live USD/KRW rate used to convert Upbit KRW prices to USD">FX: {fxRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} KRW/USD</span>
          </div>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          {lang === "ko"
            ? `Premium = (업비트 매도 Bid ÷ ${fxRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} - 바이낸스 매수 Ask) ÷ 바이낸스 Ask. 오더북 최우선 호가 기준이며, 입출금 상태는 우측 지갑 아이콘에서 확인하세요.`
            : `Premium = (Upbit Bid ÷ ${fxRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })} - Binance Ask) ÷ Binance Ask. Based on top orderbook levels; check wallet status on the right.`}
        </p>
      </div>

      {topMovers.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 mb-3">
          <p className="text-xs font-medium text-zinc-400 mb-2">{t("kimchi.trending")}</p>
          <div className="flex flex-wrap gap-2">
            {topMovers.map(mover => (
              <span key={mover.coin} className={`px-2 py-1 rounded-full text-xs font-mono ${mover.delta >= 0 ? "bg-red-950/40 text-red-300" : "bg-sky-950/40 text-sky-300"}`}>
                {mover.coin} {mover.delta >= 0 ? "+" : ""}{mover.delta.toFixed(2)}%p
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder={t("kimchi.searchPlaceholder")}
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="w-full md:w-56 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-orange-500"
          />
          <select value={minVolume} onChange={event => setMinVolume(Number(event.target.value))} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-400 outline-none">
            <option value={0}>{t("kimchi.filter.allVolume")}</option>
            <option value={100_000_000}>{t("kimchi.filter.volume100m")}</option>
            <option value={1_000_000_000}>{t("kimchi.filter.volume1b")}</option>
            <option value={10_000_000_000}>{t("kimchi.filter.volume10b")}</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none" title={lang === "ko" ? "Binance와 CoinMarketCap 가격 오차가 5% 이내인 페어만 표시" : "Show only pairs where Binance and CMC prices agree within 5%"}>
            <button onClick={() => setVerifiedOnly(value => !value)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${verifiedOnly ? "bg-emerald-600" : "bg-zinc-700"}`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${verifiedOnly ? "translate-x-[18px]" : "translate-x-1"}`} />
            </button>
            {t("kimchi.verifiedOnly")}
          </label>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500">{filtered.length} / {items.length} {t("kimchi.pairsTracking")}</p>
          <button onClick={exportCsv} className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs text-zinc-300">{t("kimchi.exportCsv")}</button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm min-w-[1180px]">
          <thead>
            <tr className="bg-zinc-900/80 text-zinc-500 text-xs">
              <th className="text-left font-medium px-4 py-2.5">{t("kimchi.header.coin")}</th>
              <th className="text-right font-medium px-4 py-2.5">{t("kimchi.header.volume")}</th>
              <th className="text-center font-medium px-2 py-2.5">{t("kimchi.header.trend")}</th>
              <th className="text-right font-medium px-4 py-2.5">{t("kimchi.header.upbitKrw")} <span className="text-[10px] font-normal">{t("kimchi.header.upbitKrwBid")}</span></th>
              <th className="text-right font-medium px-4 py-2.5">{t("kimchi.header.upbitUsd")}</th>
              <th className="text-right font-medium px-4 py-2.5">{t("kimchi.header.globalUsd")} <span className="text-[10px] font-normal">{t("kimchi.header.globalUsdAsk")}</span></th>
              <th className="text-right font-medium px-4 py-2.5">{t("kimchi.header.globalKrw")}</th>
              <th
                className="text-right font-medium px-4 py-2.5 cursor-pointer hover:text-zinc-300 select-none"
                title={lang === "ko" ? "클릭하여 CMC 오차 기준 정렬" : "Sort by CMC deviation"}
                onClick={() => toggleSort("cmcDev")}
              >
                {t("kimchi.header.cmcCheck")} {sortKey === "cmcDev" && <span className="text-emerald-400">{sortDir === "desc" ? "▼" : "▲"}</span>}
              </th>
              <th
                className="text-right font-medium px-4 py-2.5 cursor-pointer hover:text-zinc-300 select-none"
                title={lang === "ko" ? "오더북 기준: (Upbit Bid - Binance Ask) / Binance Ask — 클릭하여 정렬" : "Orderbook: (Upbit Bid - Binance Ask) / Binance Ask — click to sort"}
                onClick={() => toggleSort("premium")}
              >
                {t("kimchi.header.premium")} {sortKey === "premium" && <span className="text-emerald-400">{sortDir === "desc" ? "▼" : "▲"}</span>}
              </th>
              <th
                className="text-center font-medium px-3 py-2.5 cursor-pointer hover:text-zinc-300 select-none"
                title={t("risk.weighted") + " — click to sort"}
                onClick={() => toggleSort("risk")}
              >
                {t("kimchi.header.risk")} {sortKey === "risk" && <span className="text-emerald-400">{sortDir === "desc" ? "▼" : "▲"}</span>}
              </th>
              <th className="text-center font-medium px-2 py-2.5" title={lang === "ko" ? "업비트 입출금 현황 - 클릭하면 공식 페이지로 이동" : "Upbit wallet status — click for official page"}>{t("kimchi.header.wallet")}</th>
              <th
                className="text-right font-medium px-4 py-2.5 pr-5 cursor-pointer hover:text-zinc-300 select-none"
                title={lang === "ko" ? "Round trip with 1M KRW — 클릭하여 수익 기준 정렬" : "Round trip with 1M KRW — click to sort"}
                onClick={() => toggleSort("roundTrip")}
              >
                {t("kimchi.header.roundTrip")} {sortKey === "roundTrip" && <span className="text-emerald-400">{sortDir === "desc" ? "▼" : "▲"}</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item, idx) => {
              const positive = item.premiumPct >= 0;
              const strong = Math.abs(item.premiumPct) >= 3;
              const upbitUsd = item.upbitKrw / fxRate;
              const globalKrw = item.globalUsd * fxRate;
              const trip = item.trip;
              return (
                <tr key={`${item.coin}-${item.binanceSymbol ?? ''}-${idx}`} className={`border-t border-zinc-800/70 hover:bg-zinc-900/60 transition-colors ${favorites.has(item.coin) ? "bg-amber-950/10" : ""}`}>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => toggleFavorite(item.coin)}
                      className={`mr-2 text-base leading-none align-middle transition-transform hover:scale-125 ${favorites.has(item.coin) ? "text-amber-400" : "text-zinc-700 hover:text-zinc-500"}`}
                      title={favorites.has(item.coin) ? (lang === "ko" ? "즐겨찾기 해제" : "Remove from favorites") : (lang === "ko" ? "즐겨찾기 추가 — 항상 상단 고정" : "Add to favorites — pinned to top")}
                    >
                      {favorites.has(item.coin) ? "★" : "☆"}
                    </button>
                    <span className="font-semibold">{item.coin}</span>
                    {(() => {
                      const displayName = lang === "ko" ? item.nameKr : (item.nameEn || item.nameKr);
                      return displayName !== item.coin ? <span className="ml-2 text-xs text-zinc-500">{displayName}</span> : null;
                    })()}
                    {item.binanceSymbol && (
                      <p className="text-[10px] text-cyan-400/80 font-mono mt-0.5" title="Binance uses a different ticker for this coin (resolved via CoinMarketCap)">
                        Binance{item.binanceSource === "alpha" ? " Alpha" : ""}: {item.binanceSymbol}
                      </p>
                    )}
                    {!item.binanceSymbol && item.binanceSource === "alpha" && (
                      <p className="text-[10px] text-cyan-400/80 font-mono mt-0.5" title="Trades on Binance Alpha (pre-spot listing), price via CoinMarketCap">Binance Alpha</p>
                    )}
                  </td>
                  <td className="text-right px-4 py-2.5 font-mono text-zinc-400 text-xs">
                    {item.volumeKrw ? (
                      lang === "ko"
                        ? (item.volumeKrw >= 1_000_000_000 ? `${(item.volumeKrw / 1_000_000_000).toFixed(1)}B` : `${(item.volumeKrw / 100_000_000).toFixed(1)}억`)
                        : (item.volumeKrw >= 1_000_000_000 ? `${(item.volumeKrw / 1_000_000_000).toFixed(1)}B` : `${(item.volumeKrw / 1_000_000).toFixed(0)}M`)
                    ) : "-"}
                  </td>
                  <td className="text-center px-2 py-2.5">
                    <Sparkline data={(history[item.coin] ?? []).map(point => point.premium)} />
                  </td>
                  <td className="text-right px-4 py-2.5 font-mono text-zinc-200" title={item.upbitAsk ? (lang === "ko" ? `매수 Ask: ${formatKrw(item.upbitAsk)} / 매도 Bid: ${formatKrw(item.upbitBid ?? item.upbitKrw)}` : `Ask: ${formatKrw(item.upbitAsk)} / Bid: ${formatKrw(item.upbitBid ?? item.upbitKrw)}`) : undefined}>
                    {formatKrw(item.upbitKrw)}
                    {item.upbitAsk && item.upbitAsk !== item.upbitKrw && <div className="text-[10px] text-zinc-500">Ask {formatKrw(item.upbitAsk)}</div>}
                  </td>
                  <td className="text-right px-4 py-2.5 font-mono text-zinc-400">${formatGlobalPrice(upbitUsd)}</td>
                  <td className="text-right px-4 py-2.5 font-mono text-zinc-400" title={item.globalBid ? (lang === "ko" ? `매수 Ask: $${formatGlobalPrice(item.globalAsk ?? item.globalUsd)} / 매도 Bid: $${formatGlobalPrice(item.globalBid)}` : `Ask: $${formatGlobalPrice(item.globalAsk ?? item.globalUsd)} / Bid: $${formatGlobalPrice(item.globalBid)}`) : undefined}>
                    ${formatGlobalPrice(item.globalUsd)}
                    {item.globalBid && item.globalBid !== item.globalUsd && <div className="text-[10px] text-zinc-500">Bid ${formatGlobalPrice(item.globalBid)}</div>}
                  </td>
                  <td className="text-right px-4 py-2.5 font-mono text-zinc-200">{formatKrw(globalKrw)}</td>
                  <td className={`text-right px-4 py-2.5 font-mono text-xs ${item.binanceDevPct === undefined ? "text-zinc-600" : item.verified ? "text-emerald-400" : item.binanceDevPct <= 20 ? "text-amber-400" : "text-red-400"}`} title={[
                      item.cmcUsd !== undefined ? `CMC: $${formatGlobalPrice(item.cmcUsd)}` : null,
                      item.binanceDevPct !== undefined ? `Binance 대비 오차 ${item.binanceDevPct.toFixed(2)}%` : null,
                      item.binanceOnCmc === true ? "CMC 프로젝트 페이지에 Binance 있음" : item.binanceOnCmc === false ? "CMC 프로젝트 페이지에 Binance 없음 — 동명 티커 의심" : null,
                    ].filter(Boolean).join(" | ") || "CoinMarketCap에 없는 심볼"}>
                    <div>{item.binanceDevPct === undefined ? "-" : `${item.verified ? "✓" : "⚠"} ${item.binanceDevPct?.toFixed(1)}%`}</div>
                    {item.binanceOnCmc === false && <div className="text-[10px] text-red-400" title={lang === "ko" ? "CMC 프로젝트 페이지에 Binance 마켓이 없어 동일 티커의 다른 코인일 가능성이 높습니다" : "No Binance market on CMC project page — likely a different coin with same ticker"}>{lang === "ko" ? "Binance 없음" : "No Binance"}</div>}
                    {item.binanceOnCmc === true && item.binanceDevPct !== undefined && item.binanceDevPct > 5 && <div className="text-[10px] text-emerald-300">{lang === "ko" ? "Binance 있음" : "Has Binance"}</div>}
                  </td>
                  <td className={`text-right px-4 py-2.5 font-mono font-semibold ${positive ? (strong ? "text-red-400" : "text-red-300") : "text-sky-300"}`}>
                    {positive ? "+" : ""}{item.premiumPct.toFixed(2)}%
                  </td>
                  <td className="text-center px-3 py-2.5">
                    {(() => {
                      const r = getKimchiRisk(item);
                      const gradeLabel = t(`risk.grade.${r.grade}`);
                      return (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${riskColor(r.grade)}`}
                          title={`Risk ${r.grade} ${gradeLabel} (${r.total}) — ${t("risk.axis.liquidity")} ${r.axes.liquidity} · ${t("risk.axis.execution")} ${r.axes.execution} · ${t("risk.axis.exchange")} ${r.axes.exchange} · ${t("risk.axis.token")} ${r.axes.token} · ${t("risk.axis.volatility")} ${r.axes.volatility}`}
                        >
                          {r.grade} {r.total}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="text-center px-2 py-2.5">
                    {(() => {
                      const wallet = walletMap.get(item.coin);
                      const href = "https://www.upbit.com/service_center/wallet_status";
                      if (!wallet) {
                        return (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-500 transition-colors" title={lang === "ko" ? "지갑 상태 정보 없음 — 공식 페이지에서 확인" : "No wallet status — check official page"}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M20 12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2"/><path d="M20 12a2 2 0 0 0 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12z"/><circle cx="8" cy="8" r="1"/><circle cx="8" cy="16" r="1"/></svg>
                          </a>
                        );
                      }
                      const isWorking = wallet.wallet_state === "working" && wallet.block_state === "normal" && !wallet.message;
                      const isWithdrawOnly = wallet.wallet_state === "withdraw_only";
                      const color = isWorking ? "text-emerald-400 bg-emerald-950/30" : isWithdrawOnly ? "text-amber-400 bg-amber-950/30" : "text-red-400 bg-red-950/30";
                      const label = isWorking ? t("kimchi.wallet.normal") : isWithdrawOnly ? t("kimchi.wallet.withdrawOnly") : wallet.wallet_state;
                      const title = wallet.message ? `${label}: ${wallet.message}` : isWorking ? t("kimchi.wallet.tooltipNormal") : `${label} — ${lang === "ko" ? "클릭하면 공식 현황 페이지" : "click for official status"}`;
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-medium ${color} hover:opacity-80 transition-colors`} title={title}>
                          {isWorking ? "●" : isWithdrawOnly ? "◐" : "●"} <span className="ml-1 hidden xl:inline">{label}</span>
                        </a>
                      );
                    })()}
                  </td>
                  <td className={`text-right px-4 py-2.5 pr-5 font-mono ${!trip ? "text-zinc-600" : trip.netProfitKrw >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {!trip ? "-" : (
                      <>
                        <span className="font-semibold">
                          {displayCurrency === "USD"
                            ? `${trip.netProfitKrw >= 0 ? "+" : ""}$${(Math.abs(trip.netProfitKrw) / (fxRate || 1350)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : `${trip.netProfitKrw >= 0 ? "+" : ""}${trip.netProfitKrw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KRW`}
                        </span>
                        <span className="ml-1 text-[10px] opacity-80">({trip.netProfitPct >= 0 ? "+" : ""}{trip.netProfitPct.toFixed(2)}%)</span>
                        <p className="text-[10px] font-normal text-zinc-500">
                          {displayCurrency === "USD"
                            ? `${Math.round(trip.netProfitKrw).toLocaleString()} KRW`
                            : `$${(trip.netProfitKrw / (fxRate || 1350)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </p>
                        <p className="text-[10px] font-normal text-zinc-500" title={`Break-even premium ${trip.breakevenPremiumPct.toFixed(2)}% — premium must rise ${Math.max(trip.premiumGapToBreakevenPct, 0).toFixed(2)}%p more`}>
                          BE gap {trip.premiumGapToBreakevenPct >= 0 ? "+" : ""}{trip.premiumGapToBreakevenPct.toFixed(2)}%p
                        </p>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={12} className="text-center text-zinc-500 py-8">{t("kimchi.noMatch")}</td></tr>
            )}
            {loading && items.length === 0 && (
              <tr><td colSpan={12} className="text-center text-zinc-500 py-8 animate-pulse">{t("kimchi.loadingPairs")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
