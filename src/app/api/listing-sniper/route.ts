import { NextResponse } from "next/server";
import { BINANCE_SPOT } from "@/lib/binance";

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
      fetch(`${BINANCE_SPOT}/api/v3/ticker/price`, { signal: AbortSignal.timeout(8000), next: { revalidate: 60 } }),
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

    // Delisting watch: Upbit notices for caution designation (유의) and
    // end-of-support (거래지원 종료). Symbols extracted from titles and
    // confirmed against live Upbit markets.
    type DelistNotice = { symbol: string; market: string; title: string; dateIso: string; kind: "caution" | "delist" };
    const delisting: DelistNotice[] = [];
    try {
      const noticeRes = await fetch("https://api-manager.upbit.com/api/v1/announcements?os=web&category=trade&page=1&per_page=30", {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
        next: { revalidate: 300 },
      });
      if (noticeRes.ok) {
        interface UpbitNoticeItem { id?: number; title?: string; listed_at?: string; first_listed_at?: string }
        const noticeJson = (await noticeRes.json()) as unknown;
        const data = (noticeJson as { data?: { notices?: unknown } }).data;
        const notices: UpbitNoticeItem[] = Array.isArray((data as { notices?: unknown } | undefined)?.notices)
          ? ((data as { notices: UpbitNoticeItem[] }).notices ?? [])
          : [];
        for (const notice of notices) {
          const title = notice.title ?? "";
          const flat = title.replace(/\s+/g, "");
          const kind: DelistNotice["kind"] | null =
            flat.includes("거래지원종료") ? "delist"
            : flat.includes("유의") ? "caution"
            : null;
          if (!kind) continue;
          const tickers = title.match(/\(([A-Z0-9]{2,12})\)/g) ?? [];
          for (const hit of tickers) {
            const symbol = hit.slice(1, -1);
            if (!upbitMarkets.has(symbol)) continue;
            if (delisting.some(d => d.symbol === symbol && d.kind === kind)) continue;
            delisting.push({
              symbol,
              market: `KRW-${symbol}`,
              title,
              dateIso: notice.listed_at ?? notice.first_listed_at ?? new Date().toISOString(),
              kind,
            });
          }
          if (delisting.length >= 20) break;
        }
      }
    } catch {}

    const payload = {
      waiting: waiting.slice(0, 60),
      newListings: newListings.slice(0, 20),
      delisting,
      trackedUpbitMarkets: upbitMarkets.size,
      timestamp: new Date().toISOString(),
    };
    cache = { at: now, data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    const fallback = cache?.data ?? { waiting: [], newListings: [], delisting: [], trackedUpbitMarkets: 0, timestamp: new Date().toISOString() };
    return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=15" } });
  }
}
