// GMGN deep links — token safety/holders/bundle checks on gmgn.ai
// GMGN uses non-standard chain slugs (eth, bsc, base, arb, polygon)

const GMGN_CHAIN_SLUGS: Record<string, string> = {
  ethereum: "eth",
  arbitrum: "arb",
  polygon: "polygon",
  base: "base",
  optimism: "optimism",
  bsc: "bsc",
};

export function gmgnTokenUrl(chainId: string, tokenAddress: string): string {
  const slug = GMGN_CHAIN_SLUGS[chainId] ?? chainId;
  return `https://gmgn.ai/${slug}/${tokenAddress}`;
}
