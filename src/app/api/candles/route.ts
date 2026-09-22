import { NextResponse } from "next/server";
import { BINANCE_SPOT } from "@/lib/binance";

export const dynamic = "force-dynamic";

// Thin klines proxy for the signal detail chart (cached per symbol+interval).
const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

const INTERVALS = new Set(["5m", "15m", "1h", "4h", "1d"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  const interval = url.searchParams.get("interval") ?? "15m";
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol) || !INTERVALS.has(interval)) {
    return NextResponse.json({ error: "symbol like BTCUSDT, interval 5m|15m|1h|4h|1d" }, { status: 400 });
  }
  const key = `${symbol}:${interval}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  try {
    const res = await fetch(`${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=120`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`klines ${res.status}`);
    const raw = (await res.json()) as [number, string, string, string, string, string][];
    const candles = (Array.isArray(raw) ? raw : []).map(k => ({
      t: k[0],
      o: Number.parseFloat(k[1]),
      h: Number.parseFloat(k[2]),
      l: Number.parseFloat(k[3]),
      c: Number.parseFloat(k[4]),
      v: Number.parseFloat(k[5]),
    })).filter(k => Number.isFinite(k.c) && k.c > 0);
    const payload = { symbol, interval, candles, timestamp: new Date().toISOString() };
    if (cache.size > 60) cache.clear();
    cache.set(key, { at: now, data: payload });
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "candles failed" }, { status: 502 });
  }
}
