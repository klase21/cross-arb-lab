import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 1000;
type CacheEntry = { at: number; data: unknown };
const cache = new Map<string, CacheEntry>();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain");
  const token = searchParams.get("token");
  if (!chain || !token) {
    return NextResponse.json({ error: "Missing chain or token" }, { status: 400 });
  }

  const key = `${chain}:${token.toLowerCase()}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, { headers: { "Cache-Control": "public, max-age=30" } });
  }

  try {
    // Dexscreener tokens endpoint returns all pairs for a token across chains
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      const fallback = hit?.data ?? { pairs: [] };
      return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=10" } });
    }
    const data = await res.json() as { pairs?: unknown[] };
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    // Filter to requested chain (dexscreener chainId is slug like ethereum, bsc, polygon, etc.)
    const chainSlug = chain === "bsc" ? "bsc" : chain;
    const filtered = pairs.filter((p: unknown) => {
      const rec = p as { chainId?: string };
      return rec.chainId === chainSlug || rec.chainId === chain;
    });
    const payload = { pairs: filtered.length > 0 ? filtered : pairs.slice(0, 5), chain, token };
    cache.set(key, { at: now, data: payload });
    // naive LRU
    if (cache.size > 200) {
      const first = cache.keys().next().value as string | undefined;
      if (first) cache.delete(first);
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch (e) {
    const fallback = hit?.data ?? { pairs: [] };
    return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=10" } });
  }
}
