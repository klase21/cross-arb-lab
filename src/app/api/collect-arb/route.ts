import { NextResponse } from "next/server";
import { findCexOpportunities } from "@/lib/cex-arbitrage";
import { dbEnabled, ensureArbStatsSchema, upsertArbDaily, pruneArbStats } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 10 min by the local scheduler (mirrors KimpRadar-*-Collect tasks).
// Rolls observed opportunities into per-day buckets: 1 year of per-asset
// opportunity frequency in a tiny table (vs. storing every tick).
const TOP_N = 60;
const KIMCHI_PREMIUM_CUT = 1.0; // gross % — observable dislocation
const RETENTION_DAYS = 365;

async function getJson(url: string, timeoutMs = 15000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
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
    await ensureArbStatsSchema();

    // Top coins by Upbit 24h volume — same universe as /api/collect.
    const markets = (await getJson("https://api.upbit.com/v1/market/all?isDetails=false").catch(() => [])) as { market: string }[];
    const krwMarkets = markets.map(m => m.market).filter(m => typeof m === "string" && m.startsWith("KRW-"));
    if (krwMarkets.length === 0) throw new Error("upbit markets empty");
    const tickers = (await getJson(`https://api.upbit.com/v1/ticker?markets=${krwMarkets.join(",")}`)) as {
      market: string; trade_price: number; acc_trade_price_24h: number;
    }[];
    const topCoins = [...tickers]
      .sort((a, b) => (b.acc_trade_price_24h ?? 0) - (a.acc_trade_price_24h ?? 0))
      .slice(0, TOP_N)
      .map(t => t.market.replace("KRW-", ""))
      .filter(c => /^[A-Z0-9]{2,12}$/.test(c));
    if (topCoins.length === 0) throw new Error("top coins empty");

    const base = new URL(req.url);
    const cex = (await getJson(
      `${base.origin}/api/cex-prices?coins=${encodeURIComponent(topCoins.join(","))}`,
      45000,
    )) as { prices?: Record<string, Record<string, number>> };

    const prices = cex.prices ?? {};
    const rows: { coin: string; type: "kimchi" | "inventory"; net: number }[] = [];

    // Inventory: same quote-based logic as the UI column (net > 0.1%), best per coin.
    const seen = new Set<string>();
    for (const opp of findCexOpportunities(prices)) {
      if (seen.has(opp.coin)) continue;
      seen.add(opp.coin);
      rows.push({ coin: opp.coin, type: "inventory", net: opp.netSpreadPct });
    }
    // Kimchi: gross premium dislocation from Upbit vs Binance last prices.
    for (const [coin, ex] of Object.entries(prices)) {
      const up = ex.upbit ?? 0;
      const bin = ex.binance ?? 0;
      if (!(up > 0 && bin > 0)) continue;
      const premium = ((up - bin) / bin) * 100;
      if (premium > KIMCHI_PREMIUM_CUT) {
        rows.push({ coin, type: "kimchi", net: premium });
      }
    }

    // Bucket by KST calendar day.
    const dayIso = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const upserted = await upsertArbDaily(dayIso, rows);
    await pruneArbStats(RETENTION_DAYS);
    return NextResponse.json({
      ok: true,
      day: dayIso,
      universe: topCoins.length,
      opportunities: rows.length,
      upserted,
      ms: Date.now() - started,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "collect-arb failed" }, { status: 502 });
  }
}
