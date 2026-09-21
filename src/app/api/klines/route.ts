import { NextResponse } from "next/server";
import { getUsdKrwRate } from "@/lib/fx";
import { BINANCE_SPOT } from "@/lib/binance";

export const dynamic = "force-dynamic";

// Live klines fallback for coins outside the DB collection universe.
// Upbit candles + Binance klines via server (Upbit blocks browser CORS),
// normalized to the same {t, usd} shape as /api/history.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
    return NextResponse.json({ error: "symbol required, e.g. ARX" }, { status: 400 });
  }
  const days = Math.min(30, Math.max(1, Number.parseInt(url.searchParams.get("days") ?? "7", 10) || 7));
  const cfg = days <= 1
    ? { upbit: "minutes/30", bin: "30m", count: 48 }
    : days <= 7
      ? { upbit: "minutes/60", bin: "1h", count: 168 }
      : { upbit: "minutes/240", bin: "4h", count: 180 };
  try {
    const [upRes, binRes, fx] = await Promise.all([
      fetch(`https://api.upbit.com/v1/candles/${cfg.upbit}?market=KRW-${symbol}&count=${cfg.count}`, {
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000),
      }).catch(() => null),
      fetch(`${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}USDT&interval=${cfg.bin}&limit=${cfg.count}`, {
        signal: AbortSignal.timeout(12000),
      }).catch(() => null),
      getUsdKrwRate(),
    ]);
    if (!upRes?.ok || !(fx > 500)) {
      return NextResponse.json({ error: "upbit klines unavailable" }, { status: 502 });
    }
    const up = (await upRes.json()) as { candle_date_time_utc: string; trade_price: number }[];
    const upPts = (Array.isArray(up) ? up : [])
      .filter(c => c.trade_price > 0)
      .map(c => ({ t: Date.parse(`${c.candle_date_time_utc}Z`), usd: c.trade_price / fx, krw: c.trade_price }))
      .sort((a, b) => a.t - b.t);
    if (upPts.length < 2) {
      return NextResponse.json({ error: "upbit klines unavailable" }, { status: 502 });
    }
    let binPts: { t: number; usd: number }[] = [];
    try {
      const bin = (await binRes?.json()) as [number, string, string, string, string][];
      if (Array.isArray(bin)) {
        binPts = bin
          .map(k => ({ t: k[0], usd: Number.parseFloat(k[4]) }))
          .filter(p => p.usd > 0)
          .sort((a, b) => a.t - b.t);
      }
    } catch {}
    const premium: { t: number; pct: number }[] = [];
    if (binPts.length >= 2) {
      let j = 0;
      for (const u of upPts) {
        while (j < binPts.length - 1 && Math.abs(binPts[j + 1].t - u.t) < Math.abs(binPts[j].t - u.t)) j++;
        const b = binPts[j];
        if (b && Math.abs(b.t - u.t) < 30 * 60 * 1000 && b.usd > 0) {
          premium.push({ t: u.t, pct: ((u.usd - b.usd) / b.usd) * 100 });
        }
      }
    }
    return NextResponse.json({
      symbol, days, fx,
      series: { upbit: upPts, ...(binPts.length >= 2 ? { binance: binPts } : {}) },
      premium,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "klines failed" }, { status: 502 });
  }
}
