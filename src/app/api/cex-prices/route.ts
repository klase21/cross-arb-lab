import { NextResponse } from "next/server";
import { getUsdKrwRate } from "@/lib/fx";
import { BINANCE_SPOT } from "@/lib/binance";
import { findCexOpportunities } from "@/lib/cex-arbitrage";
import { CEX_TRADING_FEES } from "@/lib/calculator-config";

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

  // Stage 2: verify top opportunities against real orderbooks — can 1M KRW actually fill?
  const depth = await verifyDepth(findCexOpportunities(prices).slice(0, 10), fxRate);

  return NextResponse.json({ prices, fxRate, depth, timestamp: new Date().toISOString() });
}

type Book = { asks: [number, number][]; bids: [number, number][] }; // [priceUsd, qty]

async function fetchBook(venue: string, coin: string, fxRate: number): Promise<Book | null> {
  const krwToUsd = (krw: number) => krw / fxRate;
  try {
    if (venue === "upbit") {
      const res = await fetch(`https://api.upbit.com/v1/orderbook?markets=KRW-${coin}`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const data = await res.json();
      const units = data[0]?.orderbook_units ?? [];
      return {
        asks: units.map((u: { ask_price: number; ask_size: number }) => [krwToUsd(u.ask_price), u.ask_size] as [number, number]),
        bids: units.map((u: { bid_price: number; bid_size: number }) => [krwToUsd(u.bid_price), u.bid_size] as [number, number]),
      };
    }
    if (venue === "bithumb") {
      const res = await fetch(`https://api.bithumb.com/public/orderbook/${coin}_KRW?count=15`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const data = await res.json();
      const norm = (rows: { price: string; quantity: string }[]) =>
        (rows ?? []).map(r => [krwToUsd(parseFloat(r.price)), parseFloat(r.quantity)] as [number, number]);
      return { asks: norm(data.data?.asks), bids: norm(data.data?.bids) };
    }
    if (venue === "coinone") {
      const res = await fetch(`https://api.coinone.co.kr/public/v2/orderbook/KRW/${coin}`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const data = await res.json();
      const norm = (rows: { price: string; qty: string }[]) =>
        (rows ?? []).map(r => [krwToUsd(parseFloat(r.price)), parseFloat(r.qty)] as [number, number]);
      return { asks: norm(data.asks), bids: norm(data.bids) };
    }
    if (venue === "binance") {
      const res = await fetch(`${BINANCE_SPOT}/api/v3/depth?symbol=${coin}USDT&limit=20`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const data = await res.json();
      const norm = (rows: string[][]) => (rows ?? []).map(r => [parseFloat(r[0]), parseFloat(r[1])] as [number, number]);
      return { asks: norm(data.asks), bids: norm(data.bids) };
    }
    if (venue === "bybit") {
      const res = await fetch(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${coin}USDT&limit=20`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const data = await res.json();
      const norm = (rows: string[][]) => (rows ?? []).map(r => [parseFloat(r[0]), parseFloat(r[1])] as [number, number]);
      return { asks: norm(data.result?.a), bids: norm(data.result?.b) };
    }
    if (venue === "okx") {
      const res = await fetch(`https://www.okx.com/api/v5/market/books?instId=${coin}-USDT&sz=20`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const data = await res.json();
      const norm = (rows: string[][]) => (rows ?? []).map(r => [parseFloat(r[0]), parseFloat(r[1])] as [number, number]);
      return { asks: norm(data.data?.[0]?.asks), bids: norm(data.data?.[0]?.bids) };
    }
    return null;
  } catch {
    return null;
  }
}

/** Simulate a 1M KRW market buy + sell through both books. */
async function verifyDepth(
  opps: { coin: string; buyCex: string; sellCex: string }[],
  fxRate: number,
): Promise<Record<string, { buy: string; sell: string; netPct: number; fillable: boolean; filledPct: number }>> {
  const out: Record<string, { buy: string; sell: string; netPct: number; fillable: boolean; filledPct: number }> = {};
  if (opps.length === 0 || !(fxRate > 0)) return out;
  const budgetUsd = 1_000_000 / fxRate;

  // Dedupe (venue, coin) pairs — one fetch each, in parallel.
  const keys = new Map<string, Promise<Book | null>>();
  for (const opp of opps) {
    for (const venue of [opp.buyCex, opp.sellCex]) {
      const key = `${venue}:${opp.coin}`;
      if (!keys.has(key)) keys.set(key, fetchBook(venue, opp.coin, fxRate));
    }
  }
  const books = new Map<string, Book | null>();
  await Promise.all([...keys.entries()].map(async ([key, promise]) => {
    books.set(key, await promise);
  }));

  for (const opp of opps) {
    if (out[opp.coin]) continue; // best opp per coin (sorted desc)
    const buyBook = books.get(`${opp.buyCex}:${opp.coin}`);
    const sellBook = books.get(`${opp.sellCex}:${opp.coin}`);
    if (!buyBook || !sellBook || buyBook.asks.length === 0 || sellBook.bids.length === 0) continue;
    // Buy leg: fill budgetUsd through asks.
    let remaining = budgetUsd;
    let boughtQty = 0;
    let spent = 0;
    for (const [price, qty] of buyBook.asks) {
      if (!(price > 0 && qty > 0) || remaining <= 0) continue;
      const take = Math.min(qty, remaining / price);
      boughtQty += take;
      spent += take * price;
      remaining -= take * price;
      if (remaining <= 0.01) break;
    }
    // Sell leg: dump boughtQty through bids.
    let toSell = boughtQty;
    let proceeds = 0;
    for (const [price, qty] of sellBook.bids) {
      if (!(price > 0 && qty > 0) || toSell <= 0) continue;
      const take = Math.min(qty, toSell);
      proceeds += take * price;
      toSell -= take;
      if (toSell <= 0) break;
    }
    if (spent <= 0) continue;
    const filledPct = Math.min(spent / budgetUsd, 1) * 100;
    const feePct = (CEX_TRADING_FEES[opp.buyCex] ?? 0.1) + (CEX_TRADING_FEES[opp.sellCex] ?? 0.1) + 0.05;
    const netPct = ((proceeds - spent) / spent) * 100 - feePct;
    out[opp.coin] = {
      buy: opp.buyCex,
      sell: opp.sellCex,
      netPct,
      fillable: filledPct >= 99.9 && toSell <= boughtQty * 0.001 + 1e-9,
      filledPct,
    };
  }
  return out;
}
