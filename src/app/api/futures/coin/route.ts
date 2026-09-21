import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FAPI = "https://fapi.binance.com";
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

async function getJson<T>(url: string, timeoutMs = 10000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function GET(req: Request) {
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^([A-Z0-9]{2,20})USDT$/.test(symbol)) {
    return NextResponse.json({ error: "symbol must be like BTCUSDT" }, { status: 400 });
  }
  const now = Date.now();
  const hit = cache.get(symbol);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, { headers: { "Cache-Control": "public, max-age=20" } });
  }
  try {
    const [depth, trades, funding, oiHist, lsrHist, klines] = await Promise.all([
      getJson<{ bids: [string, string][]; asks: [string, string][] }>(`${FAPI}/fapi/v1/depth?symbol=${symbol}&limit=20`, 8000),
      getJson<{ price: string; qty: string; time: number; isBuyerMaker: boolean }[]>(
        `${FAPI}/fapi/v1/aggTrades?symbol=${symbol}&limit=50`, 8000,
      ).catch(() => []),
      getJson<{ fundingRate: string; fundingTime: number }[]>(`${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&limit=20`, 8000).catch(() => []),
      getJson<{ sumOpenInterest: string; timestamp: number }[]>(
        `${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=48`, 8000,
      ).catch(() => []),
      getJson<{ longShortRatio: string; timestamp: number }[]>(
        `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=48`, 8000,
      ).catch(() => []),
      getJson<[number, string, string, string, string, string][]>(
        `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=96`, 8000,
      ).catch(() => []),
    ]);
    const payload = {
      symbol,
      depth: {
        bids: depth.bids.slice(0, 12).map(([p, q]) => ({ p: Number(p), q: Number(q) })),
        asks: depth.asks.slice(0, 12).map(([p, q]) => ({ p: Number(p), q: Number(q) })),
      },
      trades: trades.slice(-30).reverse().map(t => ({
        p: Number(t.price),
        q: Number(t.qty),
        t: t.time,
        sell: t.isBuyerMaker,
      })),
      funding: funding.map(f => ({ r: Number(f.fundingRate), t: f.fundingTime })),
      oiHist: oiHist.map(o => ({ v: Number(o.sumOpenInterest), t: o.timestamp })),
      lsrHist: lsrHist.map(l => ({ v: Number(l.longShortRatio), t: l.timestamp })),
      klines: klines.map(k => ({ t: k[0], o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) })),
      timestamp: new Date().toISOString(),
    };
    if (cache.size > 60) cache.clear();
    cache.set(symbol, { at: now, data: payload });
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=20" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "coin failed" }, { status: 502 });
  }
}
