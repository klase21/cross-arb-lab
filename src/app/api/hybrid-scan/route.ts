import { NextResponse } from "next/server";
import { scanAllChains } from "@/lib/price-scanner";
import { findHybridOpportunities } from "@/lib/hybrid-arbitrage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dexQuotes = await scanAllChains();
    // Fetch CEX prices internally
    const COINS = ["BTC", "ETH"];
    const prices: Record<string, Record<string, number>> = {};
    try {
      const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbols=[\"BTCUSDT\",\"ETHUSDT\"]", { next: { revalidate: 5 } });
      if (res.ok) {
        const data = await res.json();
        for (const d of data) {
          const coin = d.symbol.replace("USDT", "");
          prices[coin] = { binance: parseFloat(d.price) };
        }
      }
    } catch {}

    const opportunities = findHybridOpportunities(dexQuotes, prices);
    return NextResponse.json({ opportunities, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: "Hybrid scan failed", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}