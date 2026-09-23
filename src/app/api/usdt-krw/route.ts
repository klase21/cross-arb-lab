import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Upbit KRW-USDT top-of-book, fetched server-side (browser-direct calls fail
// silently behind adblockers / transient Upbit errors and render as "—").
let cache: { at: number; ask: number; bid: number } | null = null;
const TTL_MS = 10_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ ...cache, cached: true });
  }
  try {
    const res = await fetch("https://api.upbit.com/v1/orderbook?markets=KRW-USDT", {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const unit = data?.[0]?.orderbook_units?.[0];
    if (!unit?.ask_price) throw new Error("empty book");
    cache = { at: Date.now(), ask: unit.ask_price, bid: unit.bid_price };
    return NextResponse.json({ ...cache, cached: false });
  } catch {
    if (cache) return NextResponse.json({ ...cache, cached: true, stale: true });
    return NextResponse.json({ error: "Upbit unavailable" }, { status: 502 });
  }
}
