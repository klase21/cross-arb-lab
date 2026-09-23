import { NextResponse } from "next/server";
import { getUsdKrwRate } from "@/lib/fx";
import { BINANCE_SPOT } from "@/lib/binance";

export const dynamic = "force-dynamic";

const COINS = ["USDT", "BTC", "ETH", "XRP", "SOL", "ADA"];

export async function GET(request: Request) {
  const prices: Record<string, Record<string, number>> = {}; // coin -> exchange -> priceUsd
  const fxRate = await getUsdKrwRate();

  // Optional ?coins=BTC,ETH,... to cover any kimchi-table coins (default: core majors).
  const requested = new URL(request.url).searchParams.get("coins");
  const COINS = (() => {
    if (!requested) return ["USDT", "BTC", "ETH", "XRP", "SOL", "ADA"];
    const list = requested.split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9]{2,12}$/.test(s) && s !== "USDT");
    return list.length > 0 ? list.slice(0, 150) : ["USDT", "BTC", "ETH", "XRP", "SOL", "ADA"];
  })();

  const fetchers: Promise<void>[] = [];

  fetchers.push((async () => {
    try {
      const symbols = COINS.filter(coin => coin !== "USDT").map(c => `"${c}USDT"`).join(",");
      const res = await fetch(`${BINANCE_SPOT}/api/v3/ticker/price?symbols=[${symbols}]`, { next: { revalidate: 5 } });
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

  fetchers.push((async () => {
    try {
      const res = await fetch("https://api.coinone.co.kr/ticker?currency=all", { next: { revalidate: 5 } });
      if (!res.ok) return;
      const data = await res.json();
      for (const coin of COINS) {
        const t = data.data?.[coin.toLowerCase()] ?? data[coin.toLowerCase()];
        if (t?.last) {
          prices[coin] = prices[coin] ?? {};
          prices[coin].coinone = parseFloat(t.last) / fxRate;
        }
      }
    } catch {}
  })());

  await Promise.all(fetchers);

  return NextResponse.json({ prices, fxRate, timestamp: new Date().toISOString() });
}
