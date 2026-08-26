import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
let cache: { at: number; data: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=60" } });
  }

  try {
    const response = await fetch("https://ccx.upbit.com/api/v1/status/network/wallet", {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 60 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const payload = { data, timestamp: new Date().toISOString() };
    cache = { at: Date.now(), data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (error) {
    if (cache) return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=60" } });
    return NextResponse.json(
      {
        data: null,
        reference: "https://www.upbit.com/service_center/wallet_status",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 502, headers: { "Cache-Control": "public, max-age=10" } }
    );
  }
}
