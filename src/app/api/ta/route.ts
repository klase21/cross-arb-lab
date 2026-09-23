import { NextResponse } from "next/server";
import { analyze, type Candle, type TaReading } from "@/lib/ta";
import { BINANCE_SPOT } from "@/lib/binance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BINANCE_24H = `${BINANCE_SPOT}/api/v3/ticker/24hr`;
const BINANCE_KLINES = `${BINANCE_SPOT}/api/v3/klines`;
const UPBIT_MARKETS = "https://api.upbit.com/v1/market/all?isDetails=false";

const INTERVALS = new Set(["15m", "1h", "4h", "1d"]);
const UNIVERSE_SIZE = 100;
const KLINE_LIMIT = 200;

const EXCLUDED_QUOTES = ["USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "EUR", "BRL", "TRY", "GBP"];
const STABLE_BASES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "USD1", "AEUR", "XUSD", "PYUSD", "USDD", "FRAX", "LUSD", "SUSD"]);

let universeCache: { at: number; symbols: { symbol: string; change: number }[] } | null = null;
let nameCache: { at: number; names: Record<string, string> } | null = null;
const klineCache = new Map<string, { at: number; candles: Candle[] }>();

function klineTtl(interval: string): number {
  return interval === "1d" ? 10 * 60 * 1000 : 2 * 60 * 1000;
}

function isExcluded(symbol: string): boolean {
  if (!symbol.endsWith("USDT")) return true;
  const base = symbol.slice(0, -4);
  if (EXCLUDED_QUOTES.includes(base) || STABLE_BASES.has(base)) return true;
  if (/(UP|DOWN|BULL|BEAR)USDT$/.test(symbol)) return true;
  return false;
}

async function getUniverse(): Promise<{ symbol: string; change: number }[]> {
  const now = Date.now();
  if (universeCache && now - universeCache.at < 10 * 60 * 1000) return universeCache.symbols;
  const res = await fetch(BINANCE_24H, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`24hr ticker ${res.status}`);
  const list = (await res.json()) as { symbol: string; quoteVolume: string; priceChangePercent: string }[];
  const symbols = list
    .filter(r => !isExcluded(r.symbol))
    .map(r => ({ symbol: r.symbol, vol: Number.parseFloat(r.quoteVolume) || 0, change: Number.parseFloat(r.priceChangePercent) || 0 }))
    .filter(r => r.vol > 0)
    .sort((a, b) => b.vol - a.vol)
    .slice(0, UNIVERSE_SIZE)
    .map(r => ({ symbol: r.symbol, change: r.change }));
  universeCache = { at: now, symbols };
  return symbols;
}

async function getKoNames(): Promise<Record<string, string>> {
  const now = Date.now();
  if (nameCache && now - nameCache.at < 60 * 60 * 1000) return nameCache.names;
  try {
    const res = await fetch(UPBIT_MARKETS, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return nameCache?.names ?? {};
    const list = (await res.json()) as { market: string; korean_name: string }[];
    const names: Record<string, string> = {};
    for (const m of list) {
      if (m.market.startsWith("KRW-")) names[m.market.slice(4)] = m.korean_name;
    }
    nameCache = { at: now, names };
    return names;
  } catch {
    return nameCache?.names ?? {};
  }
}

async function getKlines(symbol: string, interval: string): Promise<Candle[]> {
  const key = `${symbol}:${interval}`;
  const now = Date.now();
  const hit = klineCache.get(key);
  if (hit && now - hit.at < klineTtl(interval)) return hit.candles;
  const res = await fetch(`${BINANCE_KLINES}?symbol=${symbol}&interval=${interval}&limit=${KLINE_LIMIT}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    if (hit) return hit.candles;
    throw new Error(`klines ${symbol} ${res.status}`);
  }
  const raw = (await res.json()) as [number, string, string, string, string, string][];
  const candles: Candle[] = (Array.isArray(raw) ? raw : [])
    .map(k => ({
      t: k[0],
      o: Number.parseFloat(k[1]),
      h: Number.parseFloat(k[2]),
      l: Number.parseFloat(k[3]),
      c: Number.parseFloat(k[4]),
      v: Number.parseFloat(k[5]),
    }))
    .filter(k => Number.isFinite(k.c) && k.c > 0);
  if (candles.length > 0) {
    if (klineCache.size > 500) klineCache.clear();
    klineCache.set(key, { at: now, candles });
  }
  return candles.length > 0 ? candles : (hit?.candles ?? []);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const interval = INTERVALS.has(url.searchParams.get("interval") ?? "") ? url.searchParams.get("interval")! : "1h";
  const onlySymbol = (url.searchParams.get("symbol") ?? "").toUpperCase();

  try {
    // Screener mode serves the precomputed 15-min snapshot (no per-request
    // klines fan-out). Falls back to live compute when the collector is stale.
    if (!onlySymbol) {
      const { queryTaLatest } = await import("@/lib/db");
      const snap = await queryTaLatest(interval, 45, 80).catch(() => null);
      if (snap) {
        const names = await getKoNames();
        const readings = (snap.readings as TaReading[]).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        return NextResponse.json({
          interval,
          readings,
          candles: undefined,
          names,
          count: readings.length,
          source: "db",
          timestamp: snap.collectedAt,
        }, { headers: { "Cache-Control": "public, max-age=60" } });
      }
    }
    const [names, universe] = await Promise.all([getKoNames(), getUniverse()]);
    const targets = onlySymbol
      ? [{ symbol: onlySymbol, change: 0 as number | null }]
      : universe.map(u => ({ symbol: u.symbol, change: u.change as number | null }));

    const readings: TaReading[] = [];
    const candleStore: Record<string, Candle[]> = {};
    const BATCH = 8;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async t => {
          try {
            const candles = await getKlines(t.symbol, interval);
            if (candles.length < 70) return null;
            const change = t.change ?? ((candles[candles.length - 1].c - candles[0].c) / candles[0].c) * 100;
            if (onlySymbol) candleStore[t.symbol] = candles.slice(-150);
            return analyze(t.symbol, candles, change);
          } catch {
            return null;
          }
        }),
      );
      for (const r of results) if (r) readings.push(r);
    }

    readings.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    const payload = {
      interval,
      readings,
      candles: onlySymbol ? (candleStore[onlySymbol] ?? []) : undefined,
      names,
      count: readings.length,
      source: "live",
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ta failed" }, { status: 502 });
  }
}
