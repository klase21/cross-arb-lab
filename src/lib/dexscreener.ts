export type DexscreenerPair = {
  chainId: string; // dexscreener chain id: ethereum, arbitrum, polygon, base, bsc, etc.
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
};

const CHAIN_SLUGS: Record<string, string> = {
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  polygon: "polygon",
  base: "base",
  optimism: "optimism",
  bsc: "bsc",
  sepolia: "sepolia",
};

export function toDexscreenerChain(chainId: string): string {
  return CHAIN_SLUGS[chainId] ?? chainId;
}

export function dexscreenerEmbedUrl(chainId: string, tokenAddress: string): string {
  const slug = toDexscreenerChain(chainId);
  return `https://dexscreener.com/${slug}/${tokenAddress}?embed=1&theme=dark&info=0`;
}

export function dexscreenerTokenUrl(chainId: string, tokenAddress: string): string {
  const slug = toDexscreenerChain(chainId);
  return `https://dexscreener.com/${slug}/${tokenAddress}`;
}

// Fetch pairs for a token address (proxied via Next API to avoid CORS + for caching)
export async function fetchDexscreenerPairs(chainId: string, tokenAddress: string): Promise<DexscreenerPair[]> {
  try {
    const res = await fetch(`/api/dexscreener?chain=${encodeURIComponent(chainId)}&token=${encodeURIComponent(tokenAddress)}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.pairs) ? data.pairs : [];
  } catch {
    return [];
  }
}
