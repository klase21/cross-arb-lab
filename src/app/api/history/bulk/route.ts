import { NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

// Shared premium history for table sparklines: 30-min buckets per coin from the
// same Neon table the collector fills, so every browser sees identical charts.
export async function GET(req: Request) {
  if (!dbEnabled()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  }
  const url = new URL(req.url);
  const coins = (url.searchParams.get("coins") ?? "")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(s => /^[A-Z0-9]{2,12}$/.test(s))
    .slice(0, 300);
  if (coins.length === 0) {
    return NextResponse.json({ error: "coins required, e.g. BTC,ETH" }, { status: 400 });
  }
  const hours = Math.min(168, Math.max(1, Number.parseInt(url.searchParams.get("hours") ?? "24", 10) || 24));
  const bucketSec = Math.max(300, Math.floor((hours * 3600) / 48));
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await sql`
      SELECT symbol,
             (floor(extract(epoch from collected_at) / ${bucketSec}) * ${bucketSec})::bigint AS bucket,
             AVG(price_usd) FILTER (WHERE exchange = 'upbit') AS u,
             AVG(price_usd) FILTER (WHERE exchange = 'binance') AS b
      FROM price_history
      WHERE symbol = ANY(${coins}::text[])
        AND collected_at >= now() - (${hours}::int * interval '1 hour')
      GROUP BY symbol, bucket
      ORDER BY bucket ASC`) as { symbol: string; bucket: string; u: string | null; b: string | null }[];
    const out: Record<string, { t: number; pct: number }[]> = {};
    for (const r of rows) {
      const u = Number.parseFloat(r.u ?? "");
      const b = Number.parseFloat(r.b ?? "");
      if (!(u > 0) || !(b > 0)) continue;
      const list = out[r.symbol] ?? [];
      list.push({ t: Number(r.bucket) * 1000, pct: ((u - b) / b) * 100 });
      out[r.symbol] = list;
    }
    return NextResponse.json({ coins: out, hours, bucketSec, timestamp: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bulk failed" }, { status: 502 });
  }
}
