import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface UpbitTicker {
  market: string;
  trade_price: number;
}
export async function GET() {
  try {
    const markets = ["KRW-ETH", "KRW-BTC", "KRW-XRP"].join(",");
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${markets}`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) throw new Error(`Upbit API returned ${res.status}`);
    const tickers: UpbitTicker[] = await res.json();
    const prices: Record<string, number> = {};
    for (const t of tickers) {
      const symbol = t.market.replace("KRW-", "");
      prices[symbol] = t.trade_price;
    }
    return NextResponse.json({ prices, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch prices", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}