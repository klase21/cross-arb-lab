import { NextResponse } from "next/server";
import { BINANCE_SPOT } from "@/lib/binance";

export const dynamic = "force-dynamic";

// Whale tape: large spot prints (≥$50k) from public aggTrades — no key needed.
// Directional bias only, not entry/TP/SL signals.
const CACHE_TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: unknown } | null = null;

const UNIVERSE = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "NEAR", "SUI", "PEPE", "SHIB"];
const WHALE_USD = 50000;

interface AggTrade {
  p: string;
  q: string;
  T: number;
  m: boolean;
}

export interface WhaleRow {
  symbol: string;
  base: string;
  price: number;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  prints: number;
  bias: "ACCUMULATE" | "DISTRIBUTE" | "NEUTRAL";
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  try {
    const BATCH = 4;
    const rows: WhaleRow[] = [];
    for (let i = 0; i < UNIVERSE.length; i += BATCH) {
      const batch = UNIVERSE.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async base => {
          try {
            const res = await fetch(
              `${BINANCE_SPOT}/api/v3/aggTrades?symbol=${base}USDT&limit=1000`,
              { signal: AbortSignal.timeout(10000) },
            );
            if (!res.ok) return null;
            const trades = (await res.json()) as AggTrade[];
            let buyUsd = 0;
            let sellUsd = 0;
            let prints = 0;
            let price = 0;
            for (const t of trades) {
              const p = Number.parseFloat(t.p);
              const q = Number.parseFloat(t.q);
              if (!(p > 0) || !(q > 0)) continue;
              price = p;
              const notional = p * q;
              if (notional < WHALE_USD) continue;
              prints++;
              if (t.m) sellUsd += notional;
              else buyUsd += notional;
            }
            if (prints === 0 || price <= 0) return null;
            const netUsd = buyUsd - sellUsd;
            const total = buyUsd + sellUsd;
            return {
              symbol: `${base}USDT`,
              base,
              price,
              buyUsd,
              sellUsd,
              netUsd,
              prints,
              bias: netUsd > total * 0.2 ? "ACCUMULATE" : netUsd < -total * 0.2 ? "DISTRIBUTE" : "NEUTRAL",
            } satisfies WhaleRow;
          } catch {
            return null;
          }
        }),
      );
      for (const r of results) if (r) rows.push(r);
    }
    rows.sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd));
    const payload = { rows, thresholdUsd: WHALE_USD, timestamp: new Date().toISOString() };
    cache = { at: now, data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "whales failed" }, { status: 502 });
  }
}
