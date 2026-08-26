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
}

interface DexPair {
  chainId?: string;
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h1?: number };
  priceChange?: { h24?: number; h1?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

export interface TrendToken {
  chainId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCap: number;
  fdv: number;
  liquidityUsd: number;
  volumeH24: number;
  volumeH1: number;
  priceChangeH24: number;
  priceChangeH1: number;
  dexId: string;
  pairCreatedAt?: number;
  boostAmount: number;
  totalBoost: number;
  icon?: string;
  description?: string;
}

async function enrichToken(chainId: string, tokenAddress: string): Promise<Partial<TrendToken>> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return {};
    const data = await res.json() as { pairs?: DexPair[] };
    const pairs = (Array.isArray(data.pairs) ? data.pairs : []).filter(p => p.chainId === chainId);
    if (pairs.length === 0) return {};
    // pick pair with highest liquidity as the representative
    const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return {
      symbol: best.baseToken?.symbol ?? "",
      name: best.baseToken?.name ?? "",
      priceUsd: Number.parseFloat(best.priceUsd ?? "0") || 0,
      marketCap: best.marketCap ?? 0,
      fdv: best.fdv ?? 0,
      liquidityUsd: best.liquidity?.usd ?? 0,
      volumeH24: best.volume?.h24 ?? 0,
      volumeH1: best.volume?.h1 ?? 0,
      priceChangeH24: best.priceChange?.h24 ?? 0,
      priceChangeH1: best.priceChange?.h1 ?? 0,
      dexId: best.dexId ?? "",
      pairCreatedAt: best.pairCreatedAt,
    };
  } catch {
    return {};
  }
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
    const boosted = entries
      .filter(entry => entry.chainId && OUR_CHAINS.has(entry.chainId) && entry.tokenAddress)
      // dedupe by chain+token keeping highest boost
      .reduce<Map<string, BoostEntry>>((map, entry) => {
        const key = `${entry.chainId}:${entry.tokenAddress}`;
        const existing = map.get(key);
        if (!existing || (entry.amount ?? 0) > (existing.amount ?? 0)) map.set(key, entry);
        return map;
      }, new Map());

    const top = Array.from(boosted.values())
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .slice(0, 24);

    // enrich in small batches to stay within rate limits
    const tokens: TrendToken[] = [];
    const BATCH = 6;
    for (let i = 0; i < top.length; i += BATCH) {
      const batch = top.slice(i, i + BATCH);
      const enriched = await Promise.all(batch.map(async entry => {
        const info = await enrichToken(entry.chainId!, entry.tokenAddress!);
        return {
          chainId: entry.chainId!,
          tokenAddress: entry.tokenAddress!,
          symbol: info.symbol ?? "",
          name: info.name ?? "",
          priceUsd: info.priceUsd ?? 0,
          marketCap: info.marketCap ?? 0,
          fdv: info.fdv ?? 0,
          liquidityUsd: info.liquidityUsd ?? 0,
          volumeH24: info.volumeH24 ?? 0,
          volumeH1: info.volumeH1 ?? 0,
          priceChangeH24: info.priceChangeH24 ?? 0,
          priceChangeH1: info.priceChangeH1 ?? 0,
          dexId: info.dexId ?? "",
          pairCreatedAt: info.pairCreatedAt,
          boostAmount: entry.amount ?? 0,
          totalBoost: entry.totalAmount ?? 0,
          icon: entry.icon,
          description: entry.description,
        } satisfies TrendToken;
      }));
      tokens.push(...enriched);
    }

    tokens.sort((a, b) => b.boostAmount - a.boostAmount || b.marketCap - a.marketCap);

    const payload = { entries: tokens, count: tokens.length, timestamp: new Date().toISOString() };
    cache = { at: now, data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    const fallback = cache?.data ?? { entries: [], count: 0, timestamp: new Date().toISOString() };
    return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=15" } });
  }
}
