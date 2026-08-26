import { NextResponse } from "next/server";
import { scanAllChains } from "@/lib/price-scanner";
import { buildScanResult, enrichWithRoundTrips, enrichWithSpotPrices } from "@/lib/arbitrage-engine";
import { getUsdKrwRate } from "@/lib/fx";
import { recordOpportunities } from "@/lib/recent-arbs-store";

export const dynamic = "force-dynamic";

const MARKET_NAMES_TTL_MS = 60 * 60 * 1000;
let marketNamesCache: { at: number; markets: string[] } | null = null;

async function getUpbitKrwMarkets(): Promise<string[]> {
  if (marketNamesCache && Date.now() - marketNamesCache.at < MARKET_NAMES_TTL_MS) return marketNamesCache.markets;
  try {
    const response = await fetch("https://api.upbit.com/v1/market/all?isDetails=false", { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { market: string }[];
    const markets = data.filter(entry => entry.market.startsWith("KRW-")).map(entry => entry.market);
    if (markets.length > 0) {
      marketNamesCache = { at: Date.now(), markets };
      return markets;
    }
    throw new Error("empty");
  } catch {
    return marketNamesCache?.markets ?? [];
  }
}

/** Upbit ticker symbol (e.g. "ETH") -> KRW last price */
async function getUpbitPricesKrw(): Promise<Record<string, number>> {
  const markets = await getUpbitKrwMarkets();
  const prices: Record<string, number> = {};
  const CHUNK = 100;
  const requests: Promise<void>[] = [];
  for (let index = 0; index < markets.length; index += CHUNK) {
    const chunk = markets.slice(index, index + CHUNK);
    requests.push((async () => {
      try {
        const response = await fetch(`https://api.upbit.com/v1/ticker?markets=${chunk.join(",")}`, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) return;
        const data = await response.json() as { market: string; trade_price: number }[];
        for (const entry of data ?? []) {
          if (typeof entry.trade_price === "number" && entry.trade_price > 0) {
            prices[entry.market.replace("KRW-", "")] = entry.trade_price;
          }
        }
      } catch {}
    })());
  }
  await Promise.all(requests);
  return prices;
}

export async function GET() {
  try {
    const [quotesByPair, upbitPricesKrw, fxRate] = await Promise.all([
      scanAllChains(),
      getUpbitPricesKrw(),
      getUsdKrwRate(),
    ]);
    const preliminary = buildScanResult(quotesByPair, upbitPricesKrw, fxRate);
    const roundTripOpps = await enrichWithRoundTrips(preliminary.opportunities);
    const enrichedOpps = await enrichWithSpotPrices(roundTripOpps);
    const result = { ...preliminary, opportunities: enrichedOpps };
    recordOpportunities(enrichedOpps);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Scan failed:", error);
    return NextResponse.json(
      { error: "Failed to scan DEX prices", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
