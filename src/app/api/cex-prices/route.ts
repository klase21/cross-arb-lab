import { NextResponse } from "next/server";
import { getUsdKrwRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

const COINS = ["USDT", "BTC", "ETH", "XRP", "SOL", "ADA"];

export async function GET() {
  const prices: Record<string, Record<string, number>> = {}; // coin -> exchange -> priceUsd
  const fxRate = await getUsdKrwRate();

  const fetchers: Promise<void>[] = [];

  fetchers.push((async () => {
    try {
      const symbols = COINS.filter(coin => coin !== "USDT").map(c => `"${c}USDT"`).join(",");
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=[${symbols}]`, { next: { revalidate: 5 } });
      if (!res.ok) return;
      const data = await res.json();
      for (const d of data) {
        const coin = d.symbol.replace("USDT", "");
        prices[coin] = prices[coin] ?? {};
        prices[coin].binance = parseFloat(d.price);
      }
    } catch {}
  })());

  fetchers.push((async () => {
    try {
      const res = await fetch("https://api.bybit.com/v5/market/tickers?category=spot", { next: { revalidate: 5 } });
      if (!res.ok) return;
      const data = await res.json();
      for (const t of data.result?.list ?? []) {
        const coin = t.symbol.replace("USDT", "");
        if (COINS.includes(coin)) {
          prices[coin] = prices[coin] ?? {};
          prices[coin].bybit = parseFloat(t.lastPrice);
        }
      }
    } catch {}
  })());

  fetchers.push((async () => {
    try {
      const markets = COINS.map(c => "KRW-" + c).join(",");
      const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${markets}`, { next: { revalidate: 5 } });
      if (!res.ok) return;
      const data = await res.json();
      for (const d of data) {
        const coin = d.market.replace("KRW-", "");
        prices[coin] = prices[coin] ?? {};
        prices[coin].upbit = d.trade_price / fxRate;
      }
    } catch {}
  })());

  fetchers.push((async () => {
    try {
      const res = await fetch("https://api.bithumb.com/public/ticker/ALL_KRW", { next: { revalidate: 5 } });
      if (!res.ok) return;
      const data = await res.json();
      for (const coin of COINS) {
        const t = data.data?.[coin];
        if (t?.closing_price) {
          prices[coin] = prices[coin] ?? {};
          prices[coin].bithumb = parseFloat(t.closing_price) / fxRate;
        }
      }
    } catch {}
  })());

  fetchers.push((async () => {
    try {
      const res = await fetch("https://www.okx.com/api/v5/market/tickers?instType=SPOT", { next: { revalidate: 5 } });
      if (!res.ok) return;
      const data = await res.json();
      for (const t of data.data ?? []) {
        if (!t.instId.endsWith("-USDT")) continue;
        const coin = t.instId.replace("-USDT", "");
        if (COINS.includes(coin)) {
          prices[coin] = prices[coin] ?? {};
          prices[coin].okx = parseFloat(t.last);
        }
      }
    } catch {}
  })());

  await Promise.all(fetchers);

  return NextResponse.json({ prices, fxRate, timestamp: new Date().toISOString() });
}
