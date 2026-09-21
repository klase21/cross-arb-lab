import { NextResponse } from "next/server";
import { binanceApr, squeezeRisk, type FutRow } from "@/lib/futures";

export const dynamic = "force-dynamic";

const FAPI = "https://fapi.binance.com";
const UNIVERSE_SIZE = 25;
const CACHE_TTL_MS = 2 * 60 * 1000;

let cache: { at: number; data: unknown } | null = null;

interface Ticker24 {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

interface PremIdx {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

async function getJson<T>(url: string, timeoutMs = 10000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=30" } });
  }

  try {
    const [tickers, premAll] = await Promise.all([
      getJson<Ticker24[]>(`${FAPI}/fapi/v1/ticker/24hr`),
      getJson<PremIdx[]>(`${FAPI}/fapi/v1/premiumIndex`),
    ]);
    const prem = new Map(premAll.filter(p => p.symbol.endsWith("USDT")).map(p => [p.symbol, p]));
    const universe = tickers
      .filter(t => t.symbol.endsWith("USDT") && prem.has(t.symbol))
      .map(t => ({ symbol: t.symbol, vol: Number.parseFloat(t.quoteVolume) || 0 }))
      .filter(t => t.vol > 0 && !/^(USDC|FDUSD|TUSD|USDP|DAI|USD1)USDT$/.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, UNIVERSE_SIZE)
      .map(t => t.symbol);

    const tickMap = new Map(tickers.map(t => [t.symbol, t]));
    const BATCH = 8;
    const rows: FutRow[] = [];
    for (let i = 0; i < universe.length; i += BATCH) {
      const batch = universe.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async symbol => {
          try {
            const [oi, oiHist, lsr] = await Promise.all([
              getJson<{ openInterest: string }>(`${FAPI}/fapi/v1/openInterest?symbol=${symbol}`, 8000),
              getJson<{ sumOpenInterest: string }[]>(
                `${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=25`, 8000,
              ).catch(() => [] as { sumOpenInterest: string }[]),
              getJson<{ longAccount: string; longShortRatio: string }[]>(
                `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`, 8000,
              ).catch(() => [] as { longAccount: string; longShortRatio: string }[]),
            ]);
            const t = tickMap.get(symbol)!;
            const p = prem.get(symbol)!;
            const price = Number.parseFloat(p.markPrice) || Number.parseFloat(t.lastPrice) || 0;
            const oiContracts = Number.parseFloat(oi.openInterest) || 0;
            let oiChange24h: number | null = null;
            if (oiHist.length >= 2) {
              const first = Number.parseFloat(oiHist[0].sumOpenInterest);
              const lastV = Number.parseFloat(oiHist[oiHist.length - 1].sumOpenInterest);
              if (first > 0) oiChange24h = ((lastV - first) / first) * 100;
            }
            const fundingRate = Number.parseFloat(p.lastFundingRate) || 0;
            const fundingApr = binanceApr(fundingRate);
            const longAccount = lsr.length > 0 ? Number.parseFloat(lsr[0].longAccount) : null;
            const lsRatio = lsr.length > 0 ? Number.parseFloat(lsr[0].longShortRatio) : null;
            const change24h = Number.parseFloat(t.priceChangePercent) || 0;
            const { score, side } = squeezeRisk(fundingApr, longAccount, oiChange24h, change24h);
            return {
              symbol,
              base: symbol.slice(0, -4),
              price,
              change24h,
              volume24h: Number.parseFloat(t.quoteVolume) || 0,
              oiContracts,
              oiUsd: oiContracts * price,
              oiChange24h,
              fundingRate,
              fundingApr,
              nextFundingMs: p.nextFundingTime ?? 0,
              longAccount: longAccount !== null && Number.isFinite(longAccount) ? longAccount : null,
              lsRatio: lsRatio !== null && Number.isFinite(lsRatio) ? lsRatio : null,
              squeezeScore: score,
              squeezeSide: side,
            } satisfies FutRow;
          } catch {
            return null;
          }
        }),
      );
      for (const r of results) if (r) rows.push(r);
    }

    rows.sort((a, b) => b.volume24h - a.volume24h);
    const payload = { rows, count: rows.length, timestamp: new Date().toISOString() };
    cache = { at: now, data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "futures failed" }, { status: 502 });
  }
}
