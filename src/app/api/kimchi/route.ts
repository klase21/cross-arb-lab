import { NextResponse } from "next/server";
import { getUsdKrwRate } from "@/lib/fx";
import { evaluateUpbitUsdtRoundTrips } from "@/lib/stablecoin-arbitrage";

export const dynamic = "force-dynamic";

export interface KimchiItem {
  coin: string;            // Upbit ticker
  nameKr: string;
  binanceSymbol?: string;  // ticker actually used on Binance (may differ)
  binanceSource?: "spot" | "alpha"; // alpha = Binance Alpha (pre-spot listing)
  binanceOnCmc?: boolean;  // does CMC project page list Binance as a market? (symbol-collision check)
  upbitKrw: number;        // executable bid price (매도) in KRW - for backward compat
  upbitAsk?: number;       // best ask (매수) in KRW
  upbitBid?: number;       // best bid (매도) in KRW
  globalUsd: number;       // executable ask price (매수) in USD - for backward compat
  globalAsk?: number;      // best ask (매수) in USD
  globalBid?: number;      // best bid (매도) in USD
  premiumPct: number;      // based on executable prices: (Upbit Bid - Binance Ask) / Binance Ask
  cmcUsd?: number;         // CoinMarketCap reference price (cross-validation)
  binanceDevPct?: number;  // |Binance - CMC| / CMC * 100
  verified: boolean;       // true when CMC agrees with Binance within 5%
  walletStatus?: string;   // reference to wallet status page
  volumeKrw?: number;      // Upbit 24h acc_trade_price_24h (KRW) — liquidity proxy
  trip?: {
    netProfitKrw: number;
    netProfitPct: number;
    currentPremiumPct: number;
    breakevenPremiumPct: number;
    premiumGapToBreakevenPct: number;
    upbitPriceRiseNeededPct: number;
  };
}

const MARKET_NAMES_TTL_MS = 24 * 60 * 60 * 1000;
let marketNamesCache: { at: number; names: Map<string, string> } | null = null;

const CMC_TTL_MS = 10 * 60 * 1000;
let cmcCache: { at: number; entries: Map<string, { price: number; id: number }> } | null = null;

// Upbit ticker -> Binance ticker/price, resolved through CMC market pairs (24h cache)
const ALIAS_TTL_MS = 24 * 60 * 60 * 1000;
let aliasCache: { at: number; map: Map<string, AliasResolution> } | null = null;
const ALIAS_RESOLVE_BATCH = 40; // per request, to avoid bursts

// CMC project page -> does Binance list this coin? (24h cache, batched)
const PRESENCE_TTL_MS = 24 * 60 * 60 * 1000;
let presenceCache: { at: number; map: Map<string, boolean> } | null = null;
const PRESENCE_BATCH = 30;

interface AliasResolution {
  ticker: string;
  price: number;               // USD price from the CMC market pair itself
  source: "spot" | "alpha";
}

const WITHDRAW_FEE_TTL_MS = 10 * 60 * 1000;
let withdrawFeeCache: { at: number; fees: Map<string, number> } | null = null;

async function getUpbitWithdrawFees(): Promise<Map<string, number>> {
  if (withdrawFeeCache && Date.now() - withdrawFeeCache.at < WITHDRAW_FEE_TTL_MS) return withdrawFeeCache.fees;
  try {
    const response = await fetch("https://ccx.upbit.com/api/v1/status/withdraw_fee", { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { withdraw_fee_conditions: { currency: string; withdraw_fee: string }[] };
    const fees = new Map<string, number>();
    for (const entry of data.withdraw_fee_conditions ?? []) {
      const fee = Number.parseFloat(entry.withdraw_fee);
      if (!Number.isFinite(fee) || fee < 0) continue;
      // Keep the lowest fee per currency across networks (e.g., USDT TRON 0 vs ETH 4)
      const existing = fees.get(entry.currency);
      if (existing === undefined || fee < existing) fees.set(entry.currency, fee);
    }
    if (fees.size > 0) {
      withdrawFeeCache = { at: Date.now(), fees };
      return fees;
    }
    throw new Error("empty fee list");
  } catch {
    return withdrawFeeCache?.fees ?? new Map();
  }
}

const CMC_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};
const CMC_LISTING_URL = "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=5000&sortBy=market_cap&sortType=desc&convert=USD&cryptoType=all&tagType=all&audited=false";

async function getCmcEntries(): Promise<Map<string, { price: number; id: number }>> {
  if (cmcCache && Date.now() - cmcCache.at < CMC_TTL_MS) return cmcCache.entries;
  try {
    const response = await fetch(CMC_LISTING_URL, { headers: CMC_HEADERS, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { data?: { cryptoCurrencyList?: { id: number; symbol: string; quotes?: { name: string; price: number }[] }[] } };
    const list = data.data?.cryptoCurrencyList;
    if (!Array.isArray(list)) throw new Error("unexpected CMC shape");
    const entries = new Map<string, { price: number; id: number }>();
    for (const row of list) {
      // Listing is sorted by market cap desc — first occurrence per symbol wins
      if (entries.has(row.symbol)) continue;
      const price = row.quotes?.find(quote => quote.name === "USD")?.price;
      if (typeof price === "number" && price > 0) entries.set(row.symbol, { price, id: row.id });
    }
    if (entries.size === 0) throw new Error("empty CMC list");
    cmcCache = { at: Date.now(), entries };
    return entries;
  } catch {
    // CMC failed — fall back to Coingecko markets (top 2000 by market cap)
    const gecko = await getCoingeckoEntries();
    if (gecko.size > 0) {
      cmcCache = { at: Date.now(), entries: gecko };
      return gecko;
    }
    return cmcCache?.entries ?? new Map();
  }
}

// Coingecko fallback — used only when CoinMarketCap is unreachable.
// Free API allows ~30 calls/min; 8 pages × 250 coins covers the top 2000.
let geckoCache: { at: number; entries: Map<string, { price: number; id: number }> } | null = null;
const GECKO_TTL_MS = 10 * 60 * 1000;

async function getCoingeckoEntries(): Promise<Map<string, { price: number; id: number }>> {
  if (geckoCache && Date.now() - geckoCache.at < GECKO_TTL_MS) return geckoCache.entries;
  const entries = new Map<string, { price: number; id: number }>();
  const PAGES = 8;
  for (let page = 1; page <= PAGES; page++) {
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`,
        { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) break;
      const list = await response.json() as { id: string; symbol: string; current_price: number }[];
      if (!Array.isArray(list) || list.length === 0) break;
      for (const row of list) {
        const symbol = row.symbol.toUpperCase();
        // Sorted by market cap desc — first occurrence per symbol wins
        if (entries.has(symbol)) continue;
        if (typeof row.current_price === "number" && row.current_price > 0) entries.set(symbol, { price: row.current_price, id: 0 });
      }
    } catch {
      break;
    }
  }
  if (entries.size > 0) {
    geckoCache = { at: Date.now(), entries };
    return entries;
  }
  return geckoCache?.entries ?? new Map();
}

interface AliasResolution {
  ticker: string;
  price: number;               // USD price from the CMC market pair itself
  source: "spot" | "alpha";
}

async function checkBinancePresenceOnCmc(
  coins: string[],
  cmcEntries: Map<string, { price: number; id: number }>,
): Promise<Map<string, boolean>> {
  const map = presenceCache && Date.now() - presenceCache.at < PRESENCE_TTL_MS ? new Map(presenceCache.map) : new Map<string, boolean>();
  const unresolved = coins.filter(coin => !map.has(coin) && cmcEntries.has(coin)).slice(0, PRESENCE_BATCH);
  await Promise.all(unresolved.map(async coin => {
    const entry = cmcEntries.get(coin);
    if (!entry) return;
    try {
      const response = await fetch(
        `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/market-pairs/latest?id=${entry.id}&start=1&limit=200`,
        { headers: CMC_HEADERS, signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) return;
      const data = await response.json() as { data?: { marketPairs?: { exchangeName?: string }[] } };
      const pairs = data.data?.marketPairs ?? [];
      const hasBinance = pairs.some(pair => pair.exchangeName === "Binance" || pair.exchangeName === "Binance Alpha");
      map.set(coin, hasBinance);
    } catch {}
  }));
  presenceCache = { at: Date.now(), map };
  return map;
}

// CMC market pairs per coin (24h cache, batched) — used for symbol-collision
// corrections and Binance presence checks without hammering the CMC API.
const PAIRS_TTL_MS = 24 * 60 * 60 * 1000;
let pairsCache: { at: number; map: Map<string, { exchangeName?: string; baseSymbol?: string; quoteSymbol?: string; price?: number }[]> } | null = null;
const PAIRS_BATCH = 30;

async function fetchCmcMarketPairsFor(
  coins: string[],
  cmcEntries: Map<string, { price: number; id: number }>,
): Promise<Map<string, { exchangeName?: string; baseSymbol?: string; quoteSymbol?: string; price?: number }[]>> {
  const map = pairsCache && Date.now() - pairsCache.at < PAIRS_TTL_MS ? new Map(pairsCache.map) : new Map();
  const unresolved = coins.filter(coin => !map.has(coin) && cmcEntries.has(coin)).slice(0, PAIRS_BATCH);
  await Promise.all(unresolved.map(async coin => {
    const entry = cmcEntries.get(coin);
    if (!entry) return;
    try {
      const response = await fetch(
        `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/market-pairs/latest?id=${entry.id}&start=1&limit=200`,
        { headers: CMC_HEADERS, signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) return;
      const data = await response.json() as { data?: { marketPairs?: { exchangeName?: string; baseSymbol?: string; quoteSymbol?: string; price?: number }[] } };
      const pairs = data.data?.marketPairs ?? [];
      if (pairs.length > 0) map.set(coin, pairs);
    } catch {}
  }));
  pairsCache = { at: Date.now(), map };
  return map;
}

/**
 * For Upbit coins whose symbol is missing on Binance spot, look up the coin on
 * CoinMarketCap and read which base ticker Binance actually uses for it
 * (e.g. Upbit "XYZ" -> Binance "AIGENSYN"). The pair's own price is returned
 * too, because some of these trade on Binance Alpha (pre-spot) which the
 * regular spot ticker API does not cover. Resolved lazily in small batches
 * and cached for a day.
 */
async function resolveBinanceAliases(coins: string[], cmcEntries: Map<string, { price: number; id: number }>): Promise<Map<string, AliasResolution>> {
  const map = aliasCache && Date.now() - aliasCache.at < ALIAS_TTL_MS ? new Map(aliasCache.map) : new Map<string, AliasResolution>();
  const unresolved = coins.filter(coin => !map.has(coin) && cmcEntries.has(coin)).slice(0, ALIAS_RESOLVE_BATCH);

  await Promise.all(unresolved.map(async coin => {
    const entry = cmcEntries.get(coin);
    if (!entry) return;
    try {
      const response = await fetch(
        `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/market-pairs/latest?id=${entry.id}&start=1&limit=200`,
        { headers: CMC_HEADERS, signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) return;
      const data = await response.json() as { data?: { marketPairs?: { exchangeName?: string; baseSymbol?: string; quoteSymbol?: string; price?: number }[] } };
      const pairs = data.data?.marketPairs ?? [];
      const pick = (name: string) => pairs.find(pair => pair.exchangeName === name && pair.quoteSymbol === "USDT")
        ?? pairs.find(pair => pair.exchangeName === name);
      const spotPair = pick("Binance");
      const alphaPair = pick("Binance Alpha");
      const pair = spotPair ?? alphaPair;
      if (!pair?.baseSymbol || typeof pair.price !== "number" || pair.price <= 0) return;
      map.set(coin, {
        ticker: pair.baseSymbol,
        price: pair.price,
        source: spotPair ? "spot" : "alpha",
      });
    } catch {}
  }));

  aliasCache = { at: Date.now(), map };
  return map;
}

async function getUpbitKrwMarketNames(): Promise<Map<string, string>> {
  if (marketNamesCache && Date.now() - marketNamesCache.at < MARKET_NAMES_TTL_MS) return marketNamesCache.names;
  try {
    const response = await fetch("https://api.upbit.com/v1/market/all?isDetails=false", { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { market: string; korean_name: string; english_name: string }[];
    const names = new Map<string, string>();
    for (const entry of data) {
      if (!entry.market.startsWith("KRW-")) continue;
      names.set(entry.market, entry.korean_name);
    }
    if (names.size > 0) {
      marketNamesCache = { at: Date.now(), names };
      return names;
    }
    throw new Error("empty market list");
  } catch {
    return marketNamesCache?.names ?? new Map();
  }
}

async function getUpbitTickers(markets: string[]): Promise<Map<string, number>> {
  const tickers = new Map<string, number>();
  const CHUNK = 100;
  const requests: Promise<void>[] = [];
  for (let index = 0; index < markets.length; index += CHUNK) {
    const chunk = markets.slice(index, index + CHUNK);
    requests.push((async () => {
      try {
        const response = await fetch(`https://api.upbit.com/v1/ticker?markets=${chunk.join(",")}`, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) return;
        const data = await response.json() as { market: string; trade_price: number }[];
        for (const entry of data ?? []) {
          if (typeof entry.trade_price === "number" && entry.trade_price > 0) {
            tickers.set(entry.market.replace("KRW-", ""), entry.trade_price);
          }
        }
      } catch {}
    })());
  }
  await Promise.all(requests);
  return tickers;
}

async function getUpbitVolumes(markets: string[]): Promise<Map<string, number>> {
  const volumes = new Map<string, number>();
  const CHUNK = 100;
  const requests: Promise<void>[] = [];
  for (let index = 0; index < markets.length; index += CHUNK) {
    const chunk = markets.slice(index, index + CHUNK);
    requests.push((async () => {
      try {
        const response = await fetch(`https://api.upbit.com/v1/ticker?markets=${chunk.join(",")}`, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) return;
        const data = await response.json() as { market: string; acc_trade_price_24h: number }[];
        for (const entry of data ?? []) {
          if (typeof entry.acc_trade_price_24h === "number") {
            volumes.set(entry.market.replace("KRW-", ""), entry.acc_trade_price_24h);
          }
        }
      } catch {}
    })());
  }
  await Promise.all(requests);
  return volumes;
}

async function getUpbitOrderbooks(markets: string[]): Promise<Map<string, { ask: number; bid: number }>> {
  const books = new Map<string, { ask: number; bid: number }>();
  const CHUNK = 100;
  const requests: Promise<void>[] = [];
  for (let index = 0; index < markets.length; index += CHUNK) {
    const chunk = markets.slice(index, index + CHUNK);
    requests.push((async () => {
      try {
        const response = await fetch(`https://api.upbit.com/v1/orderbook?markets=${chunk.join(",")}`, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) return;
        const data = await response.json() as { market: string; orderbook_units: { ask_price: number; bid_price: number }[] }[];
        for (const entry of data ?? []) {
          const unit = entry.orderbook_units?.[0];
          if (unit && typeof unit.ask_price === "number" && typeof unit.bid_price === "number" && unit.ask_price > 0 && unit.bid_price > 0) {
            books.set(entry.market.replace("KRW-", ""), { ask: unit.ask_price, bid: unit.bid_price });
          }
        }
      } catch {}
    })());
  }
  await Promise.all(requests);
  return books;
}

async function getBinancePrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  try {
    const response = await fetch("https://api.binance.com/api/v3/ticker/price", { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return prices;
    const data = await response.json() as { symbol: string; price: string }[];
    for (const entry of data ?? []) {
      if (entry.symbol.endsWith("USDT")) {
        const value = Number.parseFloat(entry.price);
        if (value > 0) prices.set(entry.symbol.slice(0, -4), value);
      }
    }
  } catch {}
  return prices;
}

async function getBinanceBookTickers(): Promise<Map<string, { ask: number; bid: number }>> {
  const books = new Map<string, { ask: number; bid: number }>();
  try {
    const response = await fetch("https://api.binance.com/api/v3/ticker/bookTicker", { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return books;
    const data = await response.json() as { symbol: string; bidPrice: string; askPrice: string }[];
    for (const entry of data ?? []) {
      if (entry.symbol.endsWith("USDT")) {
        const coin = entry.symbol.slice(0, -4);
        const ask = Number.parseFloat(entry.askPrice);
        const bid = Number.parseFloat(entry.bidPrice);
        if (ask > 0 && bid > 0) books.set(coin, { ask, bid });
      }
    }
  } catch {}
  return books;
}

async function getGateBookTickers(): Promise<Map<string, { ask: number; bid: number }>> {
  const books = new Map<string, { ask: number; bid: number }>();
  try {
    const response = await fetch("https://api.gateio.ws/api/v4/spot/tickers", { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return books;
    const data = await response.json() as { currency_pair: string; lowest_ask: string; highest_bid: string }[];
    for (const entry of data ?? []) {
      if (!entry.currency_pair.endsWith("_USDT")) continue;
      const coin = entry.currency_pair.slice(0, -5);
      const ask = Number.parseFloat(entry.lowest_ask);
      const bid = Number.parseFloat(entry.highest_bid);
      if (ask > 0 && bid > 0) books.set(coin, { ask, bid });
    }
  } catch {}
  return books;
}

export async function GET() {
  const fxRate = await getUsdKrwRate();
  const names = await getUpbitKrwMarketNames();
  const markets = Array.from(names.keys()).sort();
  // CMC/Coingecko is fetched first and treated as the reference price for premium validation;
  // executable buy ASK is then resolved as Binance -> Gate -> CMC alias.
  const [cmcEntries, upbitBooks, binanceBooks, gateBooks, volumeMap] = await Promise.all([
    getCmcEntries(),
    getUpbitOrderbooks(markets),
    getBinanceBookTickers(),
    getGateBookTickers(),
    getUpbitVolumes(markets),
  ]);

  // Fallback to ticker if orderbook is empty (e.g., API limits)
  let useOrderbook = upbitBooks.size > 0 && binanceBooks.size > 0;
  let tickers: Map<string, number> | null = null;
  let binancePrices: Map<string, number> | null = null;
  if (!useOrderbook) {
    [tickers, binancePrices] = await Promise.all([getUpbitTickers(markets), getBinancePrices()]);
  }

  const items: KimchiItem[] = [];
  const unmatched: string[] = [];

  if (useOrderbook) {
    for (const [coin, book] of upbitBooks) {
      const cmcEntry = cmcEntries.get(coin);
      const referenceUsd = cmcEntry?.price;
      // Executable buy ASK: Binance -> Gate fallback, validated against CMC/Coingecko reference when available
      const binanceBook = binanceBooks.get(coin);
      const gateBook = gateBooks.get(coin);
      let globalAsk = binanceBook?.ask ?? gateBook?.ask ?? 0;
      let globalBid = binanceBook?.bid ?? gateBook?.bid ?? 0;
      let source: "spot" | "alpha" | undefined;
      if (binanceBook) source = "spot";
      else if (gateBook) source = "alpha";
      if (coin === "USDT") { globalAsk = 1; globalBid = 1; source = "spot"; }
      if (!globalAsk || globalAsk <= 0) {
        if (coin !== "USDT") unmatched.push(coin);
        continue;
      }
      const upbitAsk = book.ask;
      const upbitBid = book.bid;
      // Premium is measured against the CMC/Coingecko reference when available, otherwise against the executable ask
      const premiumBase = referenceUsd && referenceUsd > 0 ? referenceUsd : globalAsk;
      const premium = ((upbitBid / fxRate - premiumBase) / premiumBase) * 100;
      const item = buildItemWithOrderbook(coin, coin, names.get(`KRW-${coin}`) ?? coin, upbitAsk, upbitBid, globalAsk, globalBid, premium, fxRate, cmcEntries, volumeMap.get(coin));
      if (source === "alpha") item.binanceSource = "alpha";
      // If Gate was used and we have no CMC entry, still mark the source for UI
      if (gateBook && !binanceBook) {
        item.binanceSymbol = coin;
        item.binanceSource = "alpha";
      }
      items.push(item);
    }
    // Alias resolution for unmatched coins using orderbook prices (CMC market-pairs -> Binance Alpha/Spot or Gate)
    if (unmatched.length > 0) {
      const aliases = await resolveBinanceAliases(unmatched, cmcEntries);
      for (const [coin, resolution] of aliases) {
        const book = upbitBooks.get(coin);
        if (!book || !resolution.price) continue;
        const binanceBook = binanceBooks.get(resolution.ticker);
        const gateBook = gateBooks.get(resolution.ticker) ?? gateBooks.get(coin);
        const globalAsk = resolution.price;
        const globalBid = binanceBook?.bid ?? gateBook?.bid ?? globalAsk;
        const cmcEntry = cmcEntries.get(coin);
        const premiumBase = cmcEntry?.price && cmcEntry.price > 0 ? cmcEntry.price : globalAsk;
        const premium = ((book.bid / fxRate - premiumBase) / premiumBase) * 100;
        const item = buildItemWithOrderbook(coin, resolution.ticker, names.get(`KRW-${coin}`) ?? coin, book.ask, book.bid, globalAsk, globalBid, premium, fxRate, cmcEntries, volumeMap.get(coin));
        item.binanceSource = resolution.source;
        items.push(item);
      }
      // Final Gate fallback for still-unmatched coins (direct Gate symbol, no CMC alias needed)
      const stillUnmatched = unmatched.filter(coin => !items.some(item => item.coin === coin));
      for (const coin of stillUnmatched) {
        const gateBook = gateBooks.get(coin);
        const book = upbitBooks.get(coin);
        if (!gateBook || !book) continue;
        const cmcEntry = cmcEntries.get(coin);
        const premiumBase = cmcEntry?.price && cmcEntry.price > 0 ? cmcEntry.price : gateBook.ask;
        const premium = ((book.bid / fxRate - premiumBase) / premiumBase) * 100;
        const item = buildItemWithOrderbook(coin, coin, names.get(`KRW-${coin}`) ?? coin, book.ask, book.bid, gateBook.ask, gateBook.bid, premium, fxRate, cmcEntries, volumeMap.get(coin));
        item.binanceSource = "alpha";
        items.push(item);
      }
    }
  } else {
    // Fallback: use last-price tickers (old behavior)
    for (const [coin, upbitKrw] of tickers!) {
      let globalUsd = binancePrices!.get(coin) ?? 0;
      if (coin === "USDT") globalUsd = 1;
      if (!globalUsd || globalUsd <= 0) {
        if (coin !== "USDT") unmatched.push(coin);
        continue;
      }
      items.push(buildItem(coin, coin, names.get(`KRW-${coin}`) ?? coin, upbitKrw, globalUsd, fxRate, cmcEntries, volumeMap.get(coin)));
    }
    if (unmatched.length > 0) {
      const aliases = await resolveBinanceAliases(unmatched, cmcEntries);
      for (const [coin, resolution] of aliases) {
        const upbitKrw = tickers!.get(coin);
        if (!upbitKrw || !resolution.price) continue;
        const item = buildItem(coin, resolution.ticker, names.get(`KRW-${coin}`) ?? coin, upbitKrw, resolution.price, fxRate, cmcEntries, volumeMap.get(coin));
        item.binanceSource = resolution.source;
        items.push(item);
      }
    }
  }

  // Single batched pass over CMC market pairs: corrects symbol collisions
  // (e.g., Upbit AI Gensyn vs Binance AI Sleepless AI) and annotates whether
  // the CMC project page lists Binance at all.
  const marketPairsByCoin = await fetchCmcMarketPairsFor(items.map(item => item.coin), cmcEntries);

  // 1) Corrections: matched coins whose CMC Binance ticker differs from the Upbit ticker
  for (const [coin, pairs] of marketPairsByCoin) {
    const item = items.find(entry => entry.coin === coin);
    if (!item) continue;
    const binancePair = pairs.find(pair => pair.exchangeName === "Binance" && pair.quoteSymbol === "USDT")
      ?? pairs.find(pair => pair.exchangeName === "Binance");
    if (!binancePair?.baseSymbol || typeof binancePair.price !== "number" || binancePair.price <= 0) continue;
    item.binanceOnCmc = true;
    if (binancePair.baseSymbol === coin) continue;
    // Ticker differs — symbol collision, replace price with the CMC-derived Binance pair price
    item.globalUsd = binancePair.price;
    item.globalAsk = binancePair.price;
    if (item.globalBid !== undefined) item.globalBid = binancePair.price;
    item.binanceSymbol = binancePair.baseSymbol;
    item.binanceSource = pairs.some(pair => pair.exchangeName === "Binance" && pair.quoteSymbol === "USDT" && pair.baseSymbol === binancePair.baseSymbol) ? "spot" : "alpha";
    const upbitBid = item.upbitBid ?? item.upbitKrw;
    item.premiumPct = ((upbitBid / fxRate - binancePair.price) / binancePair.price) * 100;
    const cmcEntry = cmcEntries.get(coin);
    if (cmcEntry) {
      item.cmcUsd = cmcEntry.price;
      item.binanceDevPct = Math.abs(binancePair.price - cmcEntry.price) / cmcEntry.price * 100;
      item.verified = item.binanceDevPct <= 5;
    }
  }

  // 2) Presence annotation for coins not covered by the pairs fetch above
  const presenceMap = await checkBinancePresenceOnCmc(items.filter(item => !marketPairsByCoin.has(item.coin)).map(item => item.coin), cmcEntries);
  for (const item of items) {
    const present = presenceMap.get(item.coin);
    if (present !== undefined) item.binanceOnCmc = present;
  }

  items.sort((left, right) => right.premiumPct - left.premiumPct);

  // Per-pair round trip with correct ask/bid and real withdrawal fees
  const withdrawFees = await getUpbitWithdrawFees();
  if (useOrderbook) {
    const usdtBook = upbitBooks.get("USDT");
    const usdtAsk = usdtBook?.ask ?? 0;
    if (usdtAsk > 0) {
      for (const item of items) {
        if (!item.upbitBid || !item.globalAsk) continue;
        const usdtFee = withdrawFees.get("USDT") ?? 1; // Upbit USDT withdraw fee (lowest across networks)
        const coinFee = withdrawFees.get(item.coin) ?? 2 / item.globalAsk; // fallback $2 worth
        const trip = computeRoundTripWithOrderbook(item.upbitBid, item.globalAsk, usdtAsk, fxRate, usdtFee, coinFee);
        if (trip) item.trip = trip;
      }
    }
  } else {
    const tripPrices: Record<string, Record<string, number>> = {};
    for (const item of items) {
      tripPrices[item.coin] = { upbit: item.upbitKrw / fxRate, binance: item.globalUsd };
    }
    // For ticker fallback, still use real fees if available
    const usdtFee = withdrawFees.get("USDT") ?? 1;
    // evaluateUpbitUsdtRoundTrips uses fixed fees internally; we patch it by computing directly when fees differ from defaults
    const trips = evaluateUpbitUsdtRoundTrips(tripPrices, fxRate);
    const tripByCoin = new Map(trips.map(trip => [trip.coin, trip]));
    for (const item of items) {
      const trip = tripByCoin.get(item.coin);
      if (!trip) continue;
      // If Upbit's actual fees differ from the hardcoded 1 USDT, recompute with real fees
      const coinFee = withdrawFees.get(item.coin);
      if (coinFee !== undefined && Math.abs(coinFee - 2 / item.globalUsd) > 1e-9) {
        const usdtAsk = tickers!.get("USDT") ?? 0;
        if (usdtAsk > 0) {
          const recomputed = computeRoundTripWithOrderbook(item.upbitKrw, item.globalUsd, usdtAsk, fxRate, usdtFee, coinFee);
          if (recomputed) { item.trip = recomputed; continue; }
        }
      }
      item.trip = {
        netProfitKrw: trip.netProfitKrw,
        netProfitPct: trip.netProfitPct,
        currentPremiumPct: trip.currentPremiumPct,
        breakevenPremiumPct: trip.breakevenPremiumPct,
        premiumGapToBreakevenPct: trip.premiumGapToBreakevenPct,
        upbitPriceRiseNeededPct: trip.upbitPriceRiseNeededPct,
      };
    }
  }

  return NextResponse.json({
    fxRate,
    count: items.length,
    items,
    timestamp: new Date().toISOString(),
  });
}

function buildItem(
  coin: string,
  binanceSymbol: string,
  nameKr: string,
  upbitKrw: number,
  globalUsd: number,
  fxRate: number,
  cmcEntries: Map<string, { price: number; id: number }>,
  volumeKrw?: number,
): KimchiItem {
  const upbitUsd = upbitKrw / fxRate;
  const cmcEntry = cmcEntries.get(coin);
  const cmcUsd = cmcEntry?.price;
  const binanceDevPct = cmcUsd ? Math.abs(globalUsd - cmcUsd) / cmcUsd * 100 : undefined;
  return {
    coin,
    nameKr,
    binanceSymbol: binanceSymbol !== coin ? binanceSymbol : undefined,
    upbitKrw,
    globalUsd,
    premiumPct: ((upbitUsd - globalUsd) / globalUsd) * 100,
    cmcUsd,
    binanceDevPct,
    verified: binanceDevPct !== undefined && binanceDevPct <= 5,
    walletStatus: "https://www.upbit.com/service_center/wallet_status",
    volumeKrw,
  };
}

function buildItemWithOrderbook(
  coin: string,
  binanceSymbol: string,
  nameKr: string,
  upbitAsk: number,
  upbitBid: number,
  globalAsk: number,
  globalBid: number,
  premiumPct: number,
  fxRate: number,
  cmcEntries: Map<string, { price: number; id: number }>,
  volumeKrw?: number,
): KimchiItem {
  const cmcEntry = cmcEntries.get(coin);
  const cmcUsd = cmcEntry?.price;
  const binanceDevPct = cmcUsd ? Math.abs(globalAsk - cmcUsd) / cmcUsd * 100 : undefined;
  return {
    coin,
    nameKr,
    binanceSymbol: binanceSymbol !== coin ? binanceSymbol : undefined,
    upbitKrw: upbitBid,
    upbitAsk,
    upbitBid,
    globalUsd: globalAsk,
    globalAsk,
    globalBid,
    premiumPct,
    cmcUsd,
    binanceDevPct,
    verified: binanceDevPct !== undefined && binanceDevPct <= 5,
    walletStatus: "https://www.upbit.com/service_center/wallet_status",
    volumeKrw,
  };
}

function computeRoundTripWithOrderbook(
  upbitBid: number,
  binanceAsk: number,
  usdtAskKrw: number,
  fxRate: number,
  usdtFee: number = 1,
  coinFee: number = 2 / binanceAsk,
): KimchiItem["trip"] {
  const UPBIT_FEE_PCT = 0.05;
  const BINANCE_FEE_PCT = 0.1;
  const investmentKrw = 1_000_000;
  const upbitUsdtKrwPrice = usdtAskKrw;

  const usdtPurchased = (investmentKrw / upbitUsdtKrwPrice) * (1 - UPBIT_FEE_PCT / 100);
  const usdtAtBinance = usdtPurchased - usdtFee;
  if (usdtAtBinance <= 0) return undefined;
  const coinBought = (usdtAtBinance / binanceAsk) * (1 - BINANCE_FEE_PCT / 100);
  const coinAtUpbit = coinBought - coinFee;
  if (coinAtUpbit <= 0) return undefined;
  const upbitCoinKrwPrice = upbitBid;
  const finalKrw = coinAtUpbit * upbitCoinKrwPrice * (1 - UPBIT_FEE_PCT / 100);
  const netProfitKrw = finalKrw - investmentKrw;
  const netProfitPct = (netProfitKrw / investmentKrw) * 100;

  const breakevenUpbitKrwPrice = investmentKrw / (coinAtUpbit * (1 - UPBIT_FEE_PCT / 100));
  const breakevenUpbitUsdPrice = breakevenUpbitKrwPrice / fxRate;
  const currentPremiumPct = ((upbitBid / fxRate - binanceAsk) / binanceAsk) * 100;
  const breakevenPremiumPct = ((breakevenUpbitUsdPrice - binanceAsk) / binanceAsk) * 100;

  return {
    netProfitKrw,
    netProfitPct,
    currentPremiumPct,
    breakevenPremiumPct,
    premiumGapToBreakevenPct: breakevenPremiumPct - currentPremiumPct,
    upbitPriceRiseNeededPct: (breakevenUpbitKrwPrice / upbitCoinKrwPrice - 1) * 100,
  };
}
