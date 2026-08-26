import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OUR_CHAINS = new Set(["ethereum", "arbitrum", "polygon", "base", "optimism", "bsc"]);

const CACHE_TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: unknown } | null = null;

interface BoostEntry {
  url?: string;
  chainId?: string;
  tokenAddress?: string;
  amount?: number;
  totalAmount?: number;
  icon?: string;
  header?: string;
  description?: string;
  links?: { label?: string; url?: string }[];
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=60" } });
  }

  try {
    const res = await fetch("https://api.dexscreener.com/token-boosts/latest/v1", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as BoostEntry[];
    const entries = Array.isArray(data) ? data : [];
    const filtered = entries
      .filter(entry => entry.chainId && OUR_CHAINS.has(entry.chainId))
      .slice(0, 40)
      .map(entry => ({
        chainId: entry.chainId,
        tokenAddress: entry.tokenAddress,
        url: entry.url,
        boostAmount: entry.amount ?? 0,
        totalBoost: entry.totalAmount ?? 0,
        icon: entry.icon,
        header: entry.header,
        description: entry.description,
      }));
    const payload = { entries: filtered, count: filtered.length, timestamp: new Date().toISOString() };
    cache = { at: now, data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    const fallback = cache?.data ?? { entries: [], count: 0, timestamp: new Date().toISOString() };
    return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=15" } });
  }
}
