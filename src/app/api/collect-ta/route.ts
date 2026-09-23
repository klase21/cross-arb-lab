import { NextResponse } from "next/server";
import { analyze, type Candle, type TaReading } from "@/lib/ta";
import { BINANCE_SPOT } from "@/lib/binance";
import { dbEnabled, ensureTaSchema, upsertTaSnapshots } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 15 min by the local scheduler. Precomputes TA readings for the
// top-100 universe x 4 intervals so /api/ta serves from DB (no per-request
// klines fan-out).
const INTERVALS = ["15m", "1h", "4h", "1d"];
const UNIVERSE_SIZE = 100;
const KLINE_LIMIT = 200;
const BATCH = 16;

const EXCLUDED_QUOTES = ["USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "EUR", "BRL", "TRY", "GBP"];
const STABLE_BASES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "USD1", "AEUR", "XUSD", "PYUSD", "USDD", "FRAX", "LUSD", "SUSD"]);

function isExcluded(symbol: string): boolean {
  if (!symbol.endsWith("USDT")) return true;
  const base = symbol.slice(0, -4);
  if (EXCLUDED_QUOTES.includes(base) || STABLE_BASES.has(base)) return true;
  if (/(UP|DOWN|BULL|BEAR)USDT$/.test(symbol)) return true;
  return false;
}

async function getUniverse(): Promise<{ symbol: string; change: number }[]> {
  const res = await fetch(`${BINANCE_SPOT}/api/v3/ticker/24hr`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`24hr ticker ${res.status}`);
  const list = (await res.json()) as { symbol: string; quoteVolume: string; priceChangePercent: string }[];
  return list
    .filter(r => !isExcluded(r.symbol))
    .map(r => ({ symbol: r.symbol, vol: Number.parseFloat(r.quoteVolume) || 0, change: Number.parseFloat(r.priceChangePercent) || 0 }))
    .filter(r => r.vol > 0)
    .sort((a, b) => b.vol - a.vol)
    .slice(0, UNIVERSE_SIZE)
    .map(r => ({ symbol: r.symbol, change: r.change }));
}

async function getKlines(symbol: string, interval: string): Promise<Candle[]> {
  const res = await fetch(`${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${KLINE_LIMIT}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`klines ${symbol}/${interval} ${res.status}`);
  const raw = (await res.json()) as [number, string, string, string, string, string][];
  return (Array.isArray(raw) ? raw : [])
    .map(k => ({
      t: k[0],
      o: Number.parseFloat(k[1]),
      h: Number.parseFloat(k[2]),
      l: Number.parseFloat(k[3]),
      c: Number.parseFloat(k[4]),
      v: Number.parseFloat(k[5]),
    }))
    .filter(k => Number.isFinite(k.c) && k.c > 0);
}

export async function GET(req: Request) {
  if (!dbEnabled()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  }
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const key = new URL(req.url).searchParams.get("key");
    if (key !== secret) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const started = Date.now();
  try {
    await ensureTaSchema();
    const universe = await getUniverse();
    const collectedAt = new Date();
    let stored = 0;
    for (const interval of INTERVALS) {
      const rows: { symbol: string; interval: string; bias: string; score: number; reading: TaReading }[] = [];
      for (let i = 0; i < universe.length; i += BATCH) {
        const batch = universe.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(async u => {
            try {
              const candles = await getKlines(u.symbol, interval);
              if (candles.length < 70) return null;
              return analyze(u.symbol, candles, u.change);
            } catch {
              return null;
            }
          }),
        );
        for (const r of results) {
          if (r) rows.push({ symbol: r.symbol, interval, bias: r.bias, score: r.score, reading: r });
        }
      }
      stored += await upsertTaSnapshots(rows, collectedAt);
    }
    return NextResponse.json({
      ok: true,
      universe: universe.length,
      stored,
      ms: Date.now() - started,
      at: collectedAt.toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "collect-ta failed" }, { status: 502 });
  }
}
