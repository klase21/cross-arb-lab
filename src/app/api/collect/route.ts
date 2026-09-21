import { NextResponse } from "next/server";
import { getUsdKrwRate } from "@/lib/fx";
import { BINANCE_SPOT } from "@/lib/binance";
import { dbEnabled, ensureSchema, insertPrices, pruneHistory } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOP_N = 60;
const RETENTION_DAYS = 30;

async function getJson(url: string, timeoutMs = 15000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

interface UpbitTicker {
  market: string;
  trade_price: number;
  acc_trade_price_24h: number;
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
    await ensureSchema();
    const fx = await getUsdKrwRate();
    const collectedAt = new Date();

    const [upbitMarkets, binance24, bithumb, bybit, okx] = await Promise.all([
      getJson("https://api.upbit.com/v1/market/all?isDetails=false").catch(() => [] as { market: string }[]),
      getJson(`${BINANCE_SPOT}/api/v3/ticker/24hr`).catch(() => []),
      getJson("https://api.bithumb.com/public/ticker/ALL_KRW").catch(() => null),
      getJson("https://api.bybit.com/v5/market/tickers?category=spot").catch(() => null),
      getJson("https://www.okx.com/api/v5/market/tickers?instType=SPOT").catch(() => null),
    ]);

    const krwMarkets = (Array.isArray(upbitMarkets) ? upbitMarkets : [])
      .map(m => m.market)
      .filter((m): m is string => typeof m === "string" && m.startsWith("KRW-"));
    if (krwMarkets.length === 0) throw new Error("upbit markets empty");

    const upbitTickers = (await getJson(
      `https://api.upbit.com/v1/ticker?markets=${krwMarkets.join(",")}`,
    )) as UpbitTicker[];
    const byMarket = new Map(upbitTickers.map(t => [t.market, t]));
    const top = [...byMarket.entries()]
      .sort((a, b) => (b[1].acc_trade_price_24h ?? 0) - (a[1].acc_trade_price_24h ?? 0))
      .slice(0, TOP_N);
    const topBases = new Set(top.map(([m]) => m.replace("KRW-", "")));

    const binMap = new Map<string, { price: number; vol: number }>();
    for (const r of (Array.isArray(binance24) ? binance24 : []) as { symbol: string; lastPrice: string; quoteVolume: string }[]) {
      if (typeof r.symbol === "string" && r.symbol.endsWith("USDT")) {
        binMap.set(r.symbol.slice(0, -4), {
          price: Number.parseFloat(r.lastPrice) || 0,
          vol: Number.parseFloat(r.quoteVolume) || 0,
        });
      }
    }
    const bybitMap = new Map<string, { price: number; vol: number }>();
    const bybitList = (bybit as { result?: { list?: { symbol: string; lastPrice: string; turnover24h: string }[] } } | null)?.result?.list ?? [];
    for (const t of bybitList) {
      if (typeof t.symbol === "string" && t.symbol.endsWith("USDT")) {
        bybitMap.set(t.symbol.slice(0, -4), {
          price: Number.parseFloat(t.lastPrice) || 0,
          vol: Number.parseFloat(t.turnover24h) || 0,
        });
      }
    }
    const okxMap = new Map<string, { price: number; vol: number }>();
    const okxList = (okx as { data?: { instId: string; last: string; volCcy24h: string }[] } | null)?.data ?? [];
    for (const t of okxList) {
      if (typeof t.instId === "string" && t.instId.endsWith("-USDT")) {
        okxMap.set(t.instId.slice(0, -5), {
          price: Number.parseFloat(t.last) || 0,
          vol: Number.parseFloat(t.volCcy24h) || 0,
        });
      }
    }
    const bithumbData = (bithumb as { data?: Record<string, { closing_price?: string; acc_trade_value_24h?: string }> } | null)?.data ?? {};

    const rows: { symbol: string; exchange: string; priceUsd: number; priceKrw: number; volumeUsd: number | null }[] = [];
    for (const base of topBases) {
      const up = byMarket.get(`KRW-${base}`);
      if (up && up.trade_price > 0) {
        rows.push({
          symbol: base, exchange: "upbit",
          priceUsd: up.trade_price / fx, priceKrw: up.trade_price,
          volumeUsd: (up.acc_trade_price_24h ?? 0) / fx || null,
        });
      }
      const bh = bithumbData[base];
      const bhPrice = bh ? Number.parseFloat(bh.closing_price ?? "") : 0;
      if (bhPrice > 0) {
        rows.push({
          symbol: base, exchange: "bithumb",
          priceUsd: bhPrice / fx, priceKrw: bhPrice,
          volumeUsd: (Number.parseFloat(bh.acc_trade_value_24h ?? "") || 0) / fx || null,
        });
      }
      const b = binMap.get(base);
      if (b && b.price > 0) {
        rows.push({
          symbol: base, exchange: "binance",
          priceUsd: b.price, priceKrw: b.price * fx, volumeUsd: b.vol || null,
        });
      }
      const yb = bybitMap.get(base);
      if (yb && yb.price > 0) {
        rows.push({
          symbol: base, exchange: "bybit",
          priceUsd: yb.price, priceKrw: yb.price * fx, volumeUsd: yb.vol || null,
        });
      }
      const ox = okxMap.get(base);
      if (ox && ox.price > 0) {
        rows.push({
          symbol: base, exchange: "okx",
          priceUsd: ox.price, priceKrw: ox.price * fx, volumeUsd: ox.vol || null,
        });
      }
    }

    const inserted = await insertPrices(rows, collectedAt);
    await pruneHistory(RETENTION_DAYS);
    return NextResponse.json({
      ok: true,
      symbols: topBases.size,
      rows: rows.length,
      inserted,
      fx,
      ms: Date.now() - started,
      at: collectedAt.toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "collect failed" }, { status: 502 });
  }
}
