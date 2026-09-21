import { NextResponse } from "next/server";
import { dbEnabled, queryHistory } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_POINTS = 500;

interface Pt {
  t: number;
  usd: number;
  krw: number;
}

function downsample(pts: Pt[]): Pt[] {
  if (pts.length <= MAX_POINTS) return pts;
  const bucket = Math.ceil(pts.length / MAX_POINTS);
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i += bucket) {
    const slice = pts.slice(i, i + bucket);
    const n = slice.length;
    out.push({
      t: Math.round(slice.reduce((a, p) => a + p.t, 0) / n),
      usd: slice.reduce((a, p) => a + p.usd, 0) / n,
      krw: slice.reduce((a, p) => a + p.krw, 0) / n,
    });
  }
  return out;
}

export async function GET(req: Request) {
  if (!dbEnabled()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  }
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
    return NextResponse.json({ error: "symbol required, e.g. BTC" }, { status: 400 });
  }
  const days = Math.min(30, Math.max(1, Number.parseInt(url.searchParams.get("days") ?? "7", 10) || 7));
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = await queryHistory(symbol, since);
    const byExchange = new Map<string, Pt[]>();
    for (const r of rows) {
      const list = byExchange.get(r.exchange) ?? [];
      list.push({ t: Date.parse(r.collectedAt), usd: r.priceUsd, krw: r.priceKrw });
      byExchange.set(r.exchange, list);
    }
    const series: Record<string, Pt[]> = {};
    for (const [ex, pts] of byExchange) series[ex] = downsample(pts);

    // Kimchi premium history: upbit KRW vs binance USD→KRW is implicit in usd ratio.
    const up = byExchange.get("upbit") ?? [];
    const bin = byExchange.get("binance") ?? [];
    const premium: { t: number; pct: number }[] = [];
    let j = 0;
    for (const u of up) {
      while (j < bin.length - 1 && Math.abs(bin[j + 1].t - u.t) < Math.abs(bin[j].t - u.t)) j++;
      const b = bin[j];
      if (b && Math.abs(b.t - u.t) < 15 * 60 * 1000 && b.usd > 0) {
        premium.push({ t: u.t, pct: ((u.usd - b.usd) / b.usd) * 100 });
      }
    }

    return NextResponse.json({
      symbol,
      days,
      points: rows.length,
      series,
      premium: downsample(premium.map(p => ({ t: p.t, usd: p.pct, krw: p.pct }))).map(p => ({ t: p.t, pct: p.usd })),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "history failed" }, { status: 502 });
  }
}
