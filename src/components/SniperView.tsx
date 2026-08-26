"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePollingInterval } from "@/lib/use-polling";
import { useLang } from "@/lib/i18n";
import { loadSettings } from "@/components/SettingsView";

interface WaitingCoin {
  symbol: string;
  name: string;
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  percentChange24h: number;
  cmcAddedAt?: string;
}

interface NewListing {
  symbol: string;
  market: string;
  detectedAt: string;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  if (n > 0) return `$${n.toPrecision(4)}`;
  return "-";
}

export default function SniperView() {
  const { t, lang } = useLang();
  const [waiting, setWaiting] = useState<WaitingCoin[]>([]);
  const [newListings, setNewListings] = useState<NewListing[]>([]);
  const [tracked, setTracked] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const lastAlertedAt = useRef<string | null>(null);
  const intervalSec = usePollingInterval();

  useEffect(() => {
    try { lastAlertedAt.current = localStorage.getItem("sniperLastAlert"); } catch {}
  }, []);

  const fireAlert = useCallback(async (items: NewListing[]) => {
    if (items.length === 0) return;
    const latest = items[0].detectedAt;
    if (lastAlertedAt.current && Date.parse(latest) <= Date.parse(lastAlertedAt.current)) return;
    lastAlertedAt.current = latest;
    try { localStorage.setItem("sniperLastAlert", latest); } catch {}
    const settings = loadSettings();
    const names = items.map(i => i.symbol).join(", ");
    const body = lang === "ko" ? `업비트 신규 상장 감지: ${names}` : `New Upbit listing detected: ${names}`;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try { new Notification("🎯 " + (lang === "ko" ? "상장 스나이퍼" : "Listing Sniper"), { body, tag: "sniper" }); } catch {}
    }
    if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: settings.telegramChatId, text: `🎯 ${body}` }),
      }).catch(() => {});
    }
  }, [lang]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/listing-sniper");
      if (res.ok) {
        const data = await res.json();
        const prevLatest = newListings[0]?.detectedAt;
        setWaiting(Array.isArray(data.waiting) ? data.waiting : []);
        setNewListings(Array.isArray(data.newListings) ? data.newListings : []);
        setTracked(data.trackedUpbitMarkets ?? 0);
        if (alertEnabled && Array.isArray(data.newListings) && data.newListings.length > 0) {
          if (!prevLatest || Date.parse(data.newListings[0].detectedAt) > Date.parse(prevLatest)) {
            fireAlert(data.newListings);
          }
        }
      }
      setLastUpdated(new Date().toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US"));
    } catch {} finally {
      setLoading(false);
    }
  }, [lang, alertEnabled, newListings, fireAlert]);

  useEffect(() => {
    load();
    const interval = setInterval(load, Math.max(intervalSec, 30) * 1000);
    return () => clearInterval(interval);
  }, [load, intervalSec]);

  const filtered = waiting.filter(w =>
    !search.trim() || w.symbol.toLowerCase().includes(search.trim().toLowerCase()) || w.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <p className="text-xs text-zinc-500">
          {lang === "ko"
            ? `바이낸스에는 있고 업비트에는 없는 코인을 감시합니다. 업비트 신규 상장 감지 시 알림 (추적 마켓 ${tracked}개)`
            : `Watches coins on Binance but not on Upbit. Alerts when a new Upbit listing appears (tracking ${tracked} markets).`}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
            <button
              onClick={() => {
                const next = !alertEnabled;
                setAlertEnabled(next);
                if (next && typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
                  Notification.requestPermission();
                }
              }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${alertEnabled ? "bg-emerald-600" : "bg-zinc-700"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${alertEnabled ? "translate-x-[18px]" : "translate-x-1"}`} />
            </button>
            {lang === "ko" ? "상장 알림" : "Listing alerts"}
          </label>
          {lastUpdated && <p className="text-xs text-zinc-600">{t("common.lastUpdated")}: {lastUpdated}</p>}
        </div>
      </div>

      {/* New Upbit listings — the alert zone */}
      <div className={`rounded-xl border p-4 mb-4 ${newListings.length > 0 ? "border-emerald-600 bg-emerald-950/20" : "border-zinc-800 bg-zinc-900/30"}`}>
        <p className="text-sm font-semibold mb-1">
          🎯 {lang === "ko" ? "업비트 신규 상장 감지" : "New Upbit Listings"}
          {newListings.length > 0 && <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-mono">{newListings.length}</span>}
        </p>
        <p className="text-[11px] text-zinc-500 mb-3">
          {lang === "ko"
            ? "상장 직후 1~3시간이 프리미엄 피크 구간입니다. 김치 프리미엄 탭에서 실시간 프리미엄을 확인하세요."
            : "First 1–3 hours after listing are the premium peak. Check the Kimchi tab for live premium."}
        </p>
        {newListings.length === 0 ? (
          <p className="text-xs text-zinc-600">
            {loading ? t("common.loading") : (lang === "ko" ? "아직 감지된 신규 상장이 없습니다. 서버가 마켓을 학습한 후 신규 상장부터 감지합니다." : "No new listings yet. Detection starts after the server learns current markets.")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {newListings.map(item => (
              <a
                key={item.symbol}
                href="/?tab=kimchi"
                className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-700/50 text-emerald-300 text-sm font-semibold hover:bg-emerald-500/25 transition-colors"
                title={item.market}
              >
                {item.symbol}
                <span className="ml-1.5 text-[10px] font-normal text-zinc-400">{new Date(item.detectedAt).toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Waiting list */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/60 flex-wrap gap-2">
          <p className="text-xs font-medium text-zinc-400">
            {lang === "ko" ? "업비트 상장 대기 리스트" : "Upbit listing candidates"} <span className="ml-1 text-emerald-400 font-mono">{filtered.length}</span>
            <span className="ml-2 text-[10px] text-zinc-600">{lang === "ko" ? "바이낸스 상장 · CMC 시총 500위 내 · 업비트 미상장" : "on Binance · CMC top 500 · not on Upbit"}</span>
          </p>
          <input
            type="text"
            placeholder={lang === "ko" ? "코인 검색…" : "Search…"}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-40 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="bg-zinc-900/80 text-zinc-500 text-xs">
                <th className="text-left font-medium px-4 py-2">{lang === "ko" ? "코인" : "Coin"}</th>
                <th className="text-right font-medium px-4 py-2">{lang === "ko" ? "가격" : "Price"}</th>
                <th className="text-right font-medium px-4 py-2">{lang === "ko" ? "시총" : "MCap"}</th>
                <th className="text-right font-medium px-4 py-2">24h Vol</th>
                <th className="text-right font-medium px-4 py-2 pr-5">24h</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(coin => (
                <tr key={coin.symbol} className="border-t border-zinc-800/70 hover:bg-zinc-900/60 transition-colors">
                  <td className="px-4 py-2">
                    <span className="font-semibold">{coin.symbol}</span>
                    <span className="ml-2 text-xs text-zinc-500">{coin.name}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zinc-300">{fmtPrice(coin.priceUsd)}</td>
                  <td className="px-4 py-2 text-right font-mono text-zinc-400">{fmtUsd(coin.marketCap)}</td>
                  <td className="px-4 py-2 text-right font-mono text-zinc-400">{fmtUsd(coin.volume24h)}</td>
                  <td className={`px-4 py-2 pr-5 text-right font-mono ${(coin.percentChange24h ?? 0) >= 0 ? "text-red-400" : "text-sky-400"}`}>
                    {(coin.percentChange24h ?? 0) >= 0 ? "+" : ""}{(coin.percentChange24h ?? 0).toFixed(1)}%
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={5} className="text-center text-zinc-500 py-8">{lang === "ko" ? "대기 코인이 없습니다." : "No candidates."}</td></tr>
              )}
              {loading && waiting.length === 0 && (
                <tr><td colSpan={5} className="text-center text-zinc-500 py-8 animate-pulse">{t("common.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
