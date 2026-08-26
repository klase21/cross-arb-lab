import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BROWSER_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

const STABLES = new Set(["USDT", "USDC", "DAI", "TUSD", "FDUSD", "BUSD", "USDP", "EUR", "AEUR", "USD1"]);

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: unknown } | null = null;

// In-memory state across requests (per server process)
let knownUpbitMarkets: Set<string> | null = null;
const newListings: { symbol: string; market: string; detectedAt: string }[] = [];
const NEW_LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CmcRow {
  symbol: string;
  name: string;
  dateAdded?: string;
  quotes?: { name: string; price?: number; marketCap?: number; volume24h?: number; percentChange24h?: number }[];
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=60" } });
  }

  try {
    const [marketRes, binanceRes, cmcRes] = await Promise.all([
      fetch("https://api.upbit.com/v1/market/all?isDetails=false", { signal: AbortSignal.timeout(8000), next: { revalidate: 300 } }),
      fetch("https://api.binance.com/api/v3/ticker/price", { signal: AbortSignal.timeout(8000), next: { revalidate: 60 } }),
      fetch("https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=500&sortBy=market_cap&sortType=desc&convert=USD&cryptoType=all&tagType=all&audited=false", { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(12000), next: { revalidate: 300 } }),
    ]);

    // Upbit KRW markets
    const upbitMarkets = new Set<string>();
    if (marketRes.ok) {
      const markets = await marketRes.json() as { market: string }[];
      for (const m of markets ?? []) {
        if (m.market.startsWith("KRW-")) upbitMarkets.add(m.market.replace("KRW-", ""));
      }
    }

    // Detect newly added Upbit markets (after first init)
    const detectedNow: { symbol: string; market: string; detectedAt: string }[] = [];
    if (upbitMarkets.size > 0) {
      if (knownUpbitMarkets) {
        for (const sym of upbitMarkets) {
          if (!knownUpbitMarkets.has(sym)) {
            detectedNow.push({ symbol: sym, market: `KRW-${sym}`, detectedAt: new Date().toISOString() });
          }
        }
        for (const d of detectedNow) {
          if (!newListings.some(x => x.symbol === d.symbol)) newListings.unshift(d);
        }
        while (newListings.length > 0 && Date.now() - Date.parse(newListings[newListings.length - 1].detectedAt) > NEW_LISTING_TTL_MS) {
          newListings.pop();
        }
      }
      knownUpbitMarkets = upbitMarkets;
    }

    // Binance USDT spot symbols
    const binanceSymbols = new Set<string>();
    if (binanceRes.ok) {
      const tickers = await binanceRes.json() as { symbol: string }[];
      for (const tk of tickers ?? []) {
        if (tk.symbol.endsWith("USDT")) binanceSymbols.add(tk.symbol.slice(0, -4));
      }
    }

    // CMC top 500 for filtering meaningful coins
    let cmcRows: CmcRow[] = [];
    if (cmcRes.ok) {
      const data = await cmcRes.json() as { data?: { cryptoCurrencyList?: CmcRow[] } };
      cmcRows = data.data?.cryptoCurrencyList ?? [];
    }
    const cmcBySymbol = new Map<string, CmcRow>();
    for (const row of cmcRows) {
      if (!cmcBySymbol.has(row.symbol)) cmcBySymbol.set(row.symbol, row);
    }

    // Waiting list: on Binance, not on Upbit, meaningful (CMC top 500), not stable
    const waiting: {
      symbol: string;
      name: string;
      priceUsd: number;
      marketCap: number;
      volume24h: number;
      percentChange24h: number;
      cmcAddedAt?: string;
    }[] = [];
    for (const [symbol, row] of cmcBySymbol) {
      if (STABLES.has(symbol)) continue;
      if (!binanceSymbols.has(symbol)) continue;
      if (upbitMarkets.has(symbol)) continue;
      const q = row.quotes?.find(x => x.name === "USD");
      waiting.push({
        symbol,
        name: row.name,
        priceUsd: q?.price ?? 0,
        marketCap: q?.marketCap ?? 0,
        volume24h: q?.volume24h ?? 0,
        percentChange24h: q?.percentChange24h ?? 0,
        cmcAddedAt: row.dateAdded,
      });
      if (waiting.length >= 100) break;
    }
    waiting.sort((a, b) => b.marketCap - a.marketCap);

    const payload = {
      waiting: waiting.slice(0, 60),
      newListings: newListings.slice(0, 20),
      trackedUpbitMarkets: upbitMarkets.size,
      timestamp: new Date().toISOString(),
    };
    cache = { at: now, data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    const fallback = cache?.data ?? { waiting: [], newListings: [], trackedUpbitMarkets: 0, timestamp: new Date().toISOString() };
    return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=15" } });
  }
}
